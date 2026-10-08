#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::os::windows::process::CommandExt;

mod activation;
mod downloader;
mod logger;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Shared cancellation flag
struct CancelFlag(Arc<AtomicBool>);
struct PauseFlag(Arc<AtomicBool>);
struct ActivationRunning(Arc<AtomicBool>);
struct GameScanCancel(Arc<AtomicBool>);
struct GameScanRunning(Arc<AtomicBool>);

#[derive(Serialize, Clone)]
struct GameScanProgress {
    scanned_dirs: usize,
    elapsed_ms: u128,
    current_drive: String,
}

struct ActivationRunningGuard(Arc<AtomicBool>);

impl Drop for ActivationRunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct GameScanRunningGuard(Arc<AtomicBool>);

impl Drop for GameScanRunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
struct FolderDiagnostics {
    exe_dir: String,
    installer_dir_found: bool,
    installer_found: bool,
    installer_path: Option<String>,
    dbdata_found: bool,
    top_level_entries: Vec<String>,
}

#[tauri::command]
fn get_exe_dir() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe dir")?
        .to_path_buf();
    Ok(exe.to_string_lossy().to_string())
}

#[tauri::command]
fn check_game_folder(exe_dir: String) -> bool {
    let base = PathBuf::from(&exe_dir);
    base.join("dbdata.dll").is_file() && activation::find_installer_xml(&base).is_some()
}

#[tauri::command]
fn get_folder_diagnostics(exe_dir: String) -> FolderDiagnostics {
    let base = PathBuf::from(&exe_dir);
    let found = activation::find_installer_xml(&base);

    let mut entries: Vec<String> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            if let Some(n) = e.file_name().to_str() {
                entries.push(n.to_string());
            }
        }
    }
    entries.sort();
    entries.truncate(50);

    FolderDiagnostics {
        exe_dir,
        installer_dir_found: ["__Installer", "_installer", "_Installer", "__installer"]
            .iter()
            .any(|name| base.join(name).is_dir()),
        installer_found: found.is_some(),
        installer_path: found.map(|p| p.to_string_lossy().to_string()),
        dbdata_found: base.join("dbdata.dll").is_file(),
        top_level_entries: entries,
    }
}

#[tauri::command]
fn get_game_version(exe_dir: String) -> Result<(String, String), String> {
    let base = PathBuf::from(&exe_dir);
    let xml_path = activation::find_installer_xml(&base)
        .ok_or_else(|| format!("Cannot find installer XML in {}", exe_dir))?;

    let content =
        std::fs::read_to_string(&xml_path).map_err(|e| format!("Cannot read XML: {}", e))?;

    let version1 = activation::parse_game_version(&content).ok_or("Version not found in XML")?;

    let v1_clone = version1.clone();
    let version2 = activation::map_version(&v1_clone);
    Ok((version1, version2.to_string()))
}

#[tauri::command]
async fn start_activation(
    app: tauri::AppHandle,
    exe_dir: String,
    selection: String,
) -> Result<(), String> {
    if !matches!(selection.as_str(), "FMM" | "Live Editor") {
        return Err("Choose either FMM or Live Editor before activation.".to_string());
    }
    let dir = PathBuf::from(exe_dir)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve the game folder: {}", e))?;
    if !is_game_folder(&dir) {
        return Err("The selected folder is not a valid FC 27 game folder.".to_string());
    }

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .user_agent("TechnoAfandi-FC27-Tool/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let running = app.state::<ActivationRunning>().0.clone();
    running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "Activation is already running.".to_string())?;

    let app_handle = app.clone();
    let sel = selection;

    // Reset flags
    let flag = app.state::<CancelFlag>();
    flag.0.store(false, Ordering::Relaxed);
    let cancel = flag.0.clone();

    let pflag = app.state::<PauseFlag>();
    pflag.0.store(false, Ordering::Relaxed);
    let pause = pflag.0.clone();

    tokio::spawn(async move {
        let _running_guard = ActivationRunningGuard(running);
        activation::run_activation(app_handle, dir, sel, client, cancel, pause).await;
    });

    Ok(())
}

#[tauri::command]
fn cancel_activation(app: tauri::AppHandle) {
    let flag = app.state::<CancelFlag>();
    flag.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn pause_activation(app: tauri::AppHandle) {
    let flag = app.state::<PauseFlag>();
    flag.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn resume_activation(app: tauri::AppHandle) {
    let flag = app.state::<PauseFlag>();
    flag.0.store(false, Ordering::Relaxed);
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url.trim()).map_err(|_| "The link is not a valid URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTP and HTTPS links can be opened.".to_string());
    }
    open::that(parsed.as_str()).map_err(|e| e.to_string())
}

fn is_managed_download_url(url: &str) -> bool {
    url.starts_with("https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/")
        || url.starts_with("https://media.githubusercontent.com/media/lilmoneam44/EA-SPORTS-FC-27/")
        || url.starts_with("https://github.com/lilmoneam44/EA-SPORTS-FC-27/releases/download/")
}

/// A state sidecar is only trusted when it has the shape written by our downloader
/// and points to this tool's fixed binary repository.
fn managed_download_state(path: &std::path::Path) -> Option<Option<u64>> {
    let content = std::fs::read_to_string(path).ok()?;
    if let Some(url) = content.strip_prefix("single:") {
        return is_managed_download_url(url).then_some(None);
    }

    let state: serde_json::Value = serde_json::from_str(&content).ok()?;
    let url = state.get("source_url")?.as_str()?;
    let total_size = state.get("total_size")?.as_u64()?;
    let parts = state.get("parts_downloaded")?.as_array()?;
    if !is_managed_download_url(url)
        || total_size == 0
        || parts.is_empty()
        || !parts.iter().all(|part| part.as_u64().is_some())
    {
        return None;
    }
    Some(Some(total_size))
}

fn owned_marker_matches(path: &std::path::Path, marker_path: &std::path::Path) -> bool {
    let Ok(marker) = std::fs::read_to_string(marker_path) else {
        return false;
    };
    let mut fields = marker.trim().splitn(3, ':');
    let Some(expected_size) = fields.next() else {
        return false;
    };
    let Some(expected_modified) = fields.next() else {
        return false;
    };
    let (Ok(expected_size), Ok(expected_modified)) = (
        expected_size.parse::<u64>(),
        expected_modified.parse::<u128>(),
    ) else {
        return false;
    };
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos());
    metadata.len() == expected_size && modified == Some(expected_modified)
}

fn owned_download_source_matches(
    path: &std::path::Path,
    marker_path: &std::path::Path,
    source_url: &str,
) -> bool {
    let Ok(marker) = std::fs::read_to_string(marker_path) else {
        return false;
    };
    let mut fields = marker.trim().splitn(3, ':');
    let _ = fields.next();
    let _ = fields.next();
    fields.next() == Some(source_url) && owned_marker_matches(path, marker_path)
}

fn write_owned_marker(path: &std::path::Path) -> Result<(), String> {
    write_owned_marker_at(path, &path.with_extension("owned"))
}

fn write_owned_download_marker(path: &std::path::Path, source_url: &str) -> Result<(), String> {
    write_owned_marker_at_with_source(path, &path.with_extension("owned"), Some(source_url))
}

fn write_owned_marker_at(
    path: &std::path::Path,
    marker_path: &std::path::Path,
) -> Result<(), String> {
    write_owned_marker_at_with_source(path, marker_path, None)
}

fn write_owned_marker_at_with_source(
    path: &std::path::Path,
    marker_path: &std::path::Path,
    source_url: Option<&str>,
) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let source_suffix = source_url
        .map(|source| format!(":{}", source))
        .unwrap_or_default();
    match std::fs::symlink_metadata(marker_path) {
        Ok(existing) if existing.file_type().is_symlink() || !existing.is_file() => {
            return Err(format!(
                "Refusing to replace a non-regular ownership marker: {}",
                marker_path.display()
            ));
        }
        Ok(_) => std::fs::remove_file(marker_path).map_err(|e| e.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let mut marker = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker_path)
        .map_err(|e| e.to_string())?;
    std::io::Write::write_all(
        &mut marker,
        format!("{}:{}{}", metadata.len(), modified, source_suffix).as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    marker.sync_all().map_err(|e| e.to_string())
}

fn remove_managed_download(path: &std::path::Path) {
    let state_path = path.with_extension("state");
    let marker_path = path.with_extension("owned");
    let state_total = managed_download_state(&state_path);
    let owned = owned_marker_matches(path, &marker_path);
    let partial_matches_state = state_total.is_some_and(|expected_size| {
        let Ok(metadata) = std::fs::metadata(path) else {
            return false;
        };
        match expected_size {
            None => true,
            Some(total) => metadata.len() <= total,
        }
    });

    if owned || partial_matches_state {
        let _ = std::fs::remove_file(path);
    }
    if owned || partial_matches_state {
        let _ = std::fs::remove_file(&marker_path);
    }
    if state_total.is_some() {
        let _ = std::fs::remove_file(state_path);
    }

    let backup_path = activation::original_backup_path(path);
    let backup_marker = activation::original_backup_marker_path(&backup_path);
    if !backup_path.exists() && path.exists() && owned_marker_matches(path, &backup_marker) {
        let _ = std::fs::remove_file(&backup_marker);
    }
    let backup_is_file = std::fs::symlink_metadata(&backup_path)
        .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink());
    if backup_is_file && owned_marker_matches(&backup_path, &backup_marker) && !path.exists() {
        if std::fs::rename(&backup_path, path).is_ok() {
            let _ = std::fs::remove_file(backup_marker);
        }
    }
}

#[tauri::command]
fn clean_temp_files() {
    // Remove only files the downloader marked as app-owned, plus interrupted
    // downloads. Never sweep unrelated DLL backups or shared temporary files.
    if let Some(game_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
    {
        let managed_files = [
            PathBuf::from("FAKE").join("Activation64.dll"),
            PathBuf::from("fc27.exe"),
            PathBuf::from("TechnoAfandi.dll"),
            PathBuf::from("anadius64.dll"),
        ];
        for relative_path in managed_files {
            let download_path = game_dir.join(relative_path);
            remove_managed_download(&activation::staged_download_path(&download_path));
            remove_managed_download(&download_path);
        }
    }

    let archive_path = std::env::temp_dir()
        .join("TechnoAfandi-FC")
        .join("Live_Editor.zip");
    remove_managed_download(&archive_path);
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_app_version(app_handle: tauri::AppHandle) -> String {
    app_handle.package_info().version.to_string()
}

#[tauri::command]
fn get_current_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_and_relaunch(target_path: String) -> Result<(), String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let current_name = current
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Cannot determine the app executable name")?;
    let target = PathBuf::from(target_path);
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("The target path must include an executable name")?;
    let target_extension = target.extension().and_then(|extension| extension.to_str());
    if !target_name.eq_ignore_ascii_case(current_name)
        || !target_extension.is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err("The destination must use this app's executable name.".to_string());
    }
    let parent = target
        .parent()
        .ok_or("The destination has no parent folder")?;
    if !is_game_folder(parent) {
        return Err("The destination is not a valid game folder.".to_string());
    }

    let current_resolved = current.canonicalize().map_err(|e| e.to_string())?;
    if target.canonicalize().ok().as_ref() == Some(&current_resolved) {
        return Ok(());
    }
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("The destination already exists and is not a regular file.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Cannot inspect the destination: {}", error)),
    }

    let target_old = target.with_extension("exe.old");
    if target_old.exists() {
        return Err(format!(
            "A previous backup already exists at {}. Move it aside before relocating the app.",
            target_old.display()
        ));
    }
    let staged = target.with_file_name(format!("{}.{}.tmp", target_name, std::process::id()));
    let mut source = std::fs::File::open(&current).map_err(|e| e.to_string())?;
    let mut staged_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)
        .map_err(|e| format!("Cannot create temporary app copy: {}", e))?;
    if let Err(error) =
        std::io::copy(&mut source, &mut staged_file).and_then(|_| staged_file.sync_all())
    {
        let _ = std::fs::remove_file(&staged);
        return Err(format!("Failed to prepare the app copy: {}", error));
    }
    drop(staged_file);

    let had_target = target.exists();
    if had_target {
        if let Err(error) = std::fs::rename(&target, &target_old) {
            let _ = std::fs::remove_file(&staged);
            return Err(format!("Cannot preserve the existing app copy: {}", error));
        }
        if let Err(error) = write_owned_marker(&target_old) {
            let _ = std::fs::rename(&target_old, &target);
            let _ = std::fs::remove_file(target_old.with_extension("owned"));
            let _ = std::fs::remove_file(&staged);
            return Err(format!("Cannot mark the preserved app copy: {}", error));
        }
    }
    if let Err(error) = std::fs::rename(&staged, &target) {
        if had_target {
            let _ = std::fs::rename(&target_old, &target);
            let _ = std::fs::remove_file(target_old.with_extension("owned"));
        }
        let _ = std::fs::remove_file(&staged);
        return Err(format!("Cannot install the app copy: {}", error));
    }

    if let Err(error) = std::process::Command::new(&target).spawn() {
        let _ = std::fs::remove_file(&target);
        if had_target {
            let _ = std::fs::rename(&target_old, &target);
            let _ = std::fs::remove_file(target_old.with_extension("owned"));
        }
        return Err(format!("Cannot start the relocated app: {}", error));
    }

    // Exit current
    std::process::exit(0);
}

fn is_game_folder(path: &std::path::Path) -> bool {
    let dbdata = path.join("dbdata.dll");
    let xml_exists = activation::find_installer_xml(path).is_some();
    dbdata.is_file() && xml_exists
}

fn check_registry_for_game() -> Option<String> {
    let keys = [
        r#"HKLM\SOFTWARE\EA Sports\EA SPORTS FC 27"#,
        r#"HKLM\SOFTWARE\WOW6432Node\EA Sports\EA SPORTS FC 27"#,
    ];
    for key in &keys {
        if let Ok(output) = std::process::Command::new("reg")
            .args(&["query", key, "/v", "Install Dir"])
            .creation_flags(0x08000000)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.contains("Install Dir") && line.contains("REG_SZ") {
                        if let Some(idx) = line.find("REG_SZ") {
                            let path = line[idx + 6..].trim().to_string();
                            if is_game_folder(std::path::Path::new(&path)) {
                                return Some(path);
                            }
                        }
                    }
                }
            }
        }
    }

    // Check Steam Registry
    if let Ok(output) = std::process::Command::new("reg")
        .args(&[
            "query",
            r#"HKLM\SOFTWARE\WOW6432Node\Valve\Steam"#,
            "/v",
            "InstallPath",
        ])
        .creation_flags(0x08000000)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("InstallPath") && line.contains("REG_SZ") {
                    if let Some(idx) = line.find("REG_SZ") {
                        let steam_path = line[idx + 6..].trim();
                        let FC27_path =
                            format!("{}\\steamapps\\common\\EA SPORTS FC 27", steam_path);
                        if is_game_folder(std::path::Path::new(&FC27_path)) {
                            return Some(FC27_path);
                        }
                    }
                }
            }
        }
    }

    None
}

fn check_common_paths() -> Option<String> {
    let drives = (b'C'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|d| std::path::Path::new(d).exists())
        .collect::<Vec<_>>();

    for drive in &drives {
        let drive_paths = [
            format!("{}Program Files\\EA Games\\EA SPORTS FC 27", drive),
            format!(
                "{}Program Files (x86)\\Origin Games\\EA SPORTS FC 27",
                drive
            ),
            format!(
                "{}Program Files (x86)\\Steam\\steamapps\\common\\EA SPORTS FC 27",
                drive
            ),
            format!("{}Program Files\\Epic Games\\EA SPORTS FC 27", drive),
            format!("{}EA Games\\EA SPORTS FC 27", drive),
            format!("{}Games\\EA SPORTS FC 27", drive),
            format!("{}SteamLibrary\\steamapps\\common\\EA SPORTS FC 27", drive),
            format!("{}Origin Games\\EA SPORTS FC 27", drive),
            format!("{}Epic Games\\EA SPORTS FC 27", drive),
            format!("{}EA SPORTS FC 27", drive),
            format!("{}FC 27", drive),
            format!("{}FC27", drive),
        ];

        for p in &drive_paths {
            if is_game_folder(std::path::Path::new(p)) {
                return Some(p.to_string());
            }
        }
    }
    None
}

#[tauri::command]
async fn auto_locate_game(
    app: tauri::AppHandle,
    cancel: tauri::State<'_, GameScanCancel>,
    running: tauri::State<'_, GameScanRunning>,
) -> Result<Option<String>, String> {
    running
        .0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "A game folder search is already running.".to_string())?;
    cancel.0.store(false, Ordering::Release);

    let cancel = cancel.0.clone();
    let running = running.0.clone();
    tokio::task::spawn_blocking(move || {
        let _running_guard = GameScanRunningGuard(running);
        // 1. Try Registry (Instant)
        if cancel.load(Ordering::Acquire) {
            return Err("Game folder search cancelled.".to_string());
        }
        if let Some(p) = check_registry_for_game() {
            return Ok(Some(p));
        }

        // 2. Try Common Paths (Instant)
        if cancel.load(Ordering::Acquire) {
            return Err("Game folder search cancelled.".to_string());
        }
        if let Some(p) = check_common_paths() {
            return Ok(Some(p));
        }

        // 3. Fallback to exhaustive search (Slow)
        let drives = (b'C'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|d| std::path::Path::new(d).exists())
            .collect::<Vec<_>>();

        // Skip folders that are heavily nested or OS specific
        let skip_dirs = [
            "windows",
            "programdata",
            "appdata",
            "system volume information",
            "$recycle.bin",
            "temp",
            "tmp",
            "perflogs",
            "windowsapps",
            "$winreagent",
            "recovery",
            "node_modules",
            ".git",
            "target",
            "packages",
            "package cache",
        ];

        const MAX_SCANNED_DIRS: usize = 12_000;
        const MAX_QUEUED_DIRS: usize = 20_000;
        const MAX_SCAN_TIME: std::time::Duration = std::time::Duration::from_secs(20);
        let scan_started = std::time::Instant::now();
        let mut scanned_dirs = 0usize;
        let mut last_progress = std::time::Instant::now();
        let mut last_drive = String::new();
        let _ = app.emit(
            "game-scan-progress",
            GameScanProgress {
                scanned_dirs,
                elapsed_ms: 0,
                current_drive: String::new(),
            },
        );

        'drive_scan: for drive in drives {
            if cancel.load(Ordering::Acquire) {
                return Err("Game folder search cancelled.".to_string());
            }
            let drive_label = drive.trim_end_matches(['\\', '/']).to_string();
            let mut queue = std::collections::VecDeque::new();
            queue.push_back((std::path::PathBuf::from(drive), 0)); // Store path and depth

            while let Some((current, depth)) = queue.pop_front() {
                if cancel.load(Ordering::Acquire) {
                    return Err("Game folder search cancelled.".to_string());
                }
                if scanned_dirs >= MAX_SCANNED_DIRS || scan_started.elapsed() >= MAX_SCAN_TIME {
                    break 'drive_scan;
                }
                scanned_dirs += 1;

                if last_progress.elapsed() >= std::time::Duration::from_millis(500)
                    || last_drive != drive_label
                {
                    let _ = app.emit(
                        "game-scan-progress",
                        GameScanProgress {
                            scanned_dirs,
                            elapsed_ms: scan_started.elapsed().as_millis(),
                            current_drive: drive_label.clone(),
                        },
                    );
                    last_progress = std::time::Instant::now();
                    last_drive.clone_from(&drive_label);
                }

                if is_game_folder(&current) {
                    return Ok(Some(current.to_string_lossy().to_string()));
                }

                // Max depth of 5 to prevent infinite/excessive scanning
                if depth >= 5 {
                    continue;
                }

                if let Ok(entries) = std::fs::read_dir(&current) {
                    for entry in entries.flatten() {
                        if let Ok(file_type) = entry.file_type() {
                            if file_type.is_dir() {
                                let name = entry.file_name();
                                let name_str = name.to_string_lossy().to_lowercase();

                                if !skip_dirs.contains(&name_str.as_str())
                                    && queue.len() < MAX_QUEUED_DIRS
                                {
                                    queue.push_back((entry.path(), depth + 1));
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_game_scan(cancel: tauri::State<'_, GameScanCancel>) {
    cancel.0.store(true, Ordering::Release);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--internal-activator".to_string()) {
        let activator = include_bytes!("../assets/activator.exe");
        unsafe {
            let _ = memexec::memexec_exe(activator);
        }
        std::process::exit(0);
    }

    let activator = include_bytes!("../assets/activator.exe");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(activator.to_vec())
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(PauseFlag(Arc::new(AtomicBool::new(false))))
        .manage(ActivationRunning(Arc::new(AtomicBool::new(false))))
        .manage(GameScanCancel(Arc::new(AtomicBool::new(false))))
        .manage(GameScanRunning(Arc::new(AtomicBool::new(false))))
        .invoke_handler(tauri::generate_handler![
            get_exe_dir,
            get_app_version,
            get_current_exe_path,
            copy_and_relaunch,
            check_game_folder,
            auto_locate_game,
            cancel_game_scan,
            get_folder_diagnostics,
            get_game_version,
            start_activation,
            cancel_activation,
            pause_activation,
            resume_activation,
            open_url,
            clean_temp_files,
            exit_app,
        ])
        .setup(|app| {
            // Remove only a backup created by our own safe relocation path.
            if let Ok(current) = std::env::current_exe() {
                let target_old = current.with_extension("exe.old");
                let ownership = target_old.with_extension("owned");
                if owned_marker_matches(&target_old, &ownership) {
                    if std::fs::remove_file(&target_old).is_ok() {
                        let _ = std::fs::remove_file(ownership);
                    }
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    let _ = w.set_always_on_top(false);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let running = window
                    .app_handle()
                    .state::<ActivationRunning>()
                    .0
                    .load(Ordering::Acquire);
                if running {
                    api.prevent_close();
                    let _ = window.emit("show-exit-modal", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod download_cleanup_tests {
    use super::{
        managed_download_state, owned_marker_matches, remove_managed_download, write_owned_marker,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ta-{label}-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn cleanup_removes_a_file_only_when_its_ownership_marker_matches() {
        let dir = test_dir("owned-cleanup");
        let download = dir.join("activation.dll");
        std::fs::write(&download, b"owned payload").unwrap();
        write_owned_marker(&download).unwrap();
        let marker = download.with_extension("owned");

        remove_managed_download(&download);

        assert!(!download.exists());
        assert!(!marker.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_preserves_unmarked_files_and_untrusted_state() {
        let dir = test_dir("unowned-cleanup");
        let download = dir.join("user.dll");
        std::fs::write(&download, b"user data").unwrap();
        std::fs::write(download.with_extension("owned"), "not-a-valid-marker").unwrap();
        let state = download.with_extension("state");
        std::fs::write(&state, r#"single:https://example.com/file.dll"#).unwrap();

        remove_managed_download(&download);

        assert_eq!(std::fs::read(&download).unwrap(), b"user data");
        assert!(state.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn downloader_state_is_trusted_only_for_the_configured_repository() {
        let dir = test_dir("download-state");
        let state = dir.join("activation.state");
        std::fs::write(
            &state,
            r#"{"source_url":"https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/main/file.dll","total_size":128,"parts_downloaded":[0,64]}"#,
        )
        .unwrap();
        assert_eq!(managed_download_state(&state), Some(Some(128)));

        std::fs::write(&state, "single:https://example.com/file.dll").unwrap();
        assert_eq!(managed_download_state(&state), None);

        std::fs::write(
            &state,
            "single:https://github.com/lilmoneam44/EA-SPORTS-FC-27/releases/download/v1/fc27.exe",
        )
        .unwrap();
        assert_eq!(managed_download_state(&state), Some(None));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn staged_install_restores_the_original_file_when_downloads_are_deleted() {
        let dir = test_dir("preserve-original");
        let destination = dir.join("fc27.exe");
        let stage = crate::activation::staged_download_path(&destination);
        let backup = crate::activation::original_backup_path(&destination);
        std::fs::write(&destination, b"original game executable").unwrap();
        std::fs::write(&stage, b"validated replacement executable").unwrap();
        write_owned_marker(&stage).unwrap();

        crate::activation::install_staged_download(
            &stage,
            &destination,
            "https://github.com/test/release/file.exe",
        )
        .unwrap();
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"validated replacement executable"
        );
        assert_eq!(std::fs::read(&backup).unwrap(), b"original game executable");
        assert!(owned_marker_matches(
            &destination,
            &destination.with_extension("owned")
        ));

        remove_managed_download(&destination);
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"original game executable"
        );
        assert!(!backup.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
