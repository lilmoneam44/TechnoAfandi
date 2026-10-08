use serde::Serialize;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;

// GitHub hosting strategy:
// - raw.githubusercontent.com works for regular files but returns a small
//   pointer text (~130 bytes) for files stored via Git LFS.
// - media.githubusercontent.com/media/ serves the actual LFS binaries but
//   returns 404 for non-LFS files.
// The download logic below tries raw first, and if it detects an LFS pointer,
// automatically retries with the media URL. So we can safely use raw here.
const ACTIVATION64_URL: &str =
    "https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/main/Activation64.dll";
const TECHNOAFANDI_DLL_URL: &str =
    "https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/main/TechnoAfandi.dll";
const ANADIUS64_URL: &str =
    "https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/main/anadius64.dll";
const LE_ZIP_RAW: &str =
    "https://raw.githubusercontent.com/lilmoneam44/EA-SPORTS-FC-27/main/Live%20Editor.zip";

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percent: f64,
    label: String,
}

/// Finds the installer XML file across common EA folder naming conventions.
pub fn find_installer_xml(base: &Path) -> Option<PathBuf> {
    let candidates = [
        "__Installer/installerdata.xml",
        "_installer/installerdata.xml",
        "_Installer/installerdata.xml",
        "__installer/installerdata.xml",
    ];
    for c in candidates {
        let p = base.join(c);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub fn parse_game_version(xml: &str) -> Option<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();

    // 1. Try standard XML parsing first
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) => {
                if e.name().as_ref() == b"gameVersion" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"version" {
                            return Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => (),
        }
        buf.clear();
    }

    // 2. Fallback to Regex if XML parsing failed (EA sometimes creates malformed XMLs)
    let re = regex::Regex::new(r#"<gameVersion\s+[^>]*version\s*=\s*"([^"]+)""#).ok()?;
    if let Some(captures) = re.captures(xml) {
        if let Some(m) = captures.get(1) {
            return Some(m.as_str().to_string());
        }
    }

    None
}

pub fn map_version(v1: &str) -> &str {
    match v1 {
        "1.0.140.52122" => "1.0.1",
        "1.0.140.62280" => "1.0.2",
        "1.0.140.64835" => "1.0.3",
        "1.0.141.12554" => "1.0.4",
        _ => "Unknown",
    }
}

async fn get_latest_supported_tag(client: &reqwest::Client, fallback: &str) -> String {
    let url = "https://api.github.com/repos/lilmoneam44/EA-SPORTS-FC-27/releases";
    let req = client
        .get(url)
        .header("User-Agent", "TechnoAfandi-FC-Tool")
        .send()
        .await;

    if let Ok(resp) = req {
        if let Ok(releases) = resp.json::<serde_json::Value>().await {
            if let Some(arr) = releases.as_array() {
                let mut max_version: Option<semver::Version> = None;
                let mut max_tag = fallback.to_string();

                for release in arr {
                    let mut has_exe = false;
                    if let Some(assets) = release.get("assets").and_then(|a| a.as_array()) {
                        for asset in assets {
                            if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                                if name.eq_ignore_ascii_case("FC27.exe") {
                                    has_exe = true;
                                    break;
                                }
                            }
                        }
                    }

                    if has_exe {
                        if let Some(tag_name) = release.get("tag_name").and_then(|t| t.as_str()) {
                            let tag_clean = tag_name.trim_start_matches('v');
                            if let Ok(ver) = semver::Version::parse(tag_clean) {
                                if let Some(ref max_v) = max_version {
                                    if ver > *max_v {
                                        max_version = Some(ver);
                                        max_tag = tag_clean.to_string();
                                    }
                                } else {
                                    max_version = Some(ver);
                                    max_tag = tag_clean.to_string();
                                }
                            }
                        }
                    }
                }
                return max_tag;
            }
        }
    }
    fallback.to_string()
}

/// Detects if a downloaded file is actually a Git LFS pointer text rather
/// than the real binary. LFS pointers are small (~130 bytes) and always
/// contain lines like `version https://git-lfs.github.com/spec/v1` and
/// `oid sha256:...`.
fn is_lfs_pointer(path: &Path) -> bool {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    // LFS pointers are always small. Real binaries never fit in this range.
    if metadata.len() > 1024 {
        return false;
    }
    let content = std::fs::read_to_string(path).unwrap_or_default();
    content.contains("git-lfs") || content.contains("oid sha256")
}

fn format_time(secs: u64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    if m > 59 {
        let h = m / 60;
        let m = m % 60;
        format!("{:02}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}

async fn wait_for_resume(
    cancel: &std::sync::atomic::AtomicBool,
    pause: &std::sync::atomic::AtomicBool,
) -> bool {
    while pause.load(std::sync::atomic::Ordering::Relaxed) {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    !cancel.load(std::sync::atomic::Ordering::Relaxed)
}

async fn send_with_control(
    request: reqwest::RequestBuilder,
    cancel: &std::sync::atomic::AtomicBool,
    pause: &std::sync::atomic::AtomicBool,
) -> Result<Option<reqwest::Response>, reqwest::Error> {
    let request = request.send();
    tokio::pin!(request);
    loop {
        tokio::select! {
            result = &mut request => return result.map(Some),
            _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                if cancel.load(std::sync::atomic::Ordering::Relaxed)
                    || pause.load(std::sync::atomic::Ordering::Relaxed)
                {
                    return Ok(None);
                }
            }
        }
    }
}

/// Get remote file size using reqwest, while remaining responsive to pause/cancel.
async fn get_remote_file_size(
    client: &reqwest::Client,
    url: &str,
    cancel: &std::sync::atomic::AtomicBool,
    pause: &std::sync::atomic::AtomicBool,
) -> Option<u64> {
    loop {
        if !wait_for_resume(cancel, pause).await {
            return None;
        }

        match send_with_control(client.get(url).header("Range", "bytes=0-0"), cancel, pause).await {
            Ok(Some(resp)) if resp.status().is_success() => {
                if let Some(cr) = resp.headers().get(reqwest::header::CONTENT_RANGE) {
                    if let Ok(cr_str) = cr.to_str() {
                        if let Some(total_str) = cr_str.rsplit('/').next() {
                            if let Ok(total) = total_str.trim().parse::<u64>() {
                                if total > 0 {
                                    return Some(total);
                                }
                            }
                        }
                    }
                }
                if let Some(len) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
                    if let Ok(s) = len.to_str() {
                        if let Ok(num) = s.parse::<u64>() {
                            if num > 0 {
                                return Some(num);
                            }
                        }
                    }
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => continue,
            Err(_) => {}
        }

        match send_with_control(client.head(url), cancel, pause).await {
            Ok(Some(resp)) if resp.status().is_success() => {
                if let Some(len) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
                    if let Ok(s) = len.to_str() {
                        if let Ok(num) = s.parse::<u64>() {
                            if num > 0 {
                                return Some(num);
                            }
                        }
                    }
                }
            }
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) => continue,
        }
    }
}

/// Skip an existing file only when the server reports a matching size.
fn file_already_exists(
    dest: &Path,
    app: &AppHandle,
    label: &str,
    remote_size: Option<u64>,
    progress_end: f64,
) -> bool {
    // File doesn't exist → need to download
    let local_meta = match std::fs::metadata(dest) {
        Ok(m) => m,
        Err(_) => return false,
    };

    let local_size = local_meta.len();

    // Zero-size file → corrupted/incomplete → re-download
    if local_size == 0 {
        return false;
    }

    // A matching size is the only available remote integrity signal. Do not
    // hash multi-gigabyte game executables here: the old hash was never
    // compared with a trusted remote digest, so it added disk I/O without
    // verifying the downloaded bytes.
    if remote_size != Some(local_size) {
        return false;
    }

    let mb = local_size as f64 / 1_048_576.0;

    let _ = app.emit(
        "activation-progress",
        ProgressPayload {
            percent: progress_end,
            label: format!("{} · {:.1} MB · ✓ Exists (size verified)", label, mb),
        },
    );

    true // skip download
}

pub fn staged_download_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().unwrap_or_default().to_string_lossy();
    dest.with_file_name(format!("{}.ta-download", name))
}

pub fn original_backup_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().unwrap_or_default().to_string_lossy();
    dest.with_file_name(format!("{}.ta-original", name))
}

pub fn original_backup_marker_path(backup: &Path) -> PathBuf {
    let name = backup.file_name().unwrap_or_default().to_string_lossy();
    backup.with_file_name(format!("{}.ta-backup-owned", name))
}

fn mark_download_owned(path: &Path, source_url: &str) -> Result<(), String> {
    crate::write_owned_download_marker(path, source_url)
}

fn ensure_regular_file_or_absent(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(format!(
            "Refusing to use a non-regular download path: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot inspect {}: {}", path.display(), error)),
    }
}

fn validate_download(path: &Path, label: &str) -> Result<(), String> {
    if label.eq_ignore_ascii_case("Live Editor") {
        validate_zip(path)
    } else {
        validate_exe(path)
    }
}

fn restore_original_backup(dest: &Path, backup: &Path) {
    let marker = original_backup_marker_path(backup);
    let backup_is_file = std::fs::symlink_metadata(backup)
        .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink());
    if backup_is_file && !dest.exists() && crate::owned_marker_matches(backup, &marker) {
        if std::fs::rename(backup, dest).is_ok() {
            let _ = std::fs::remove_file(marker);
            let _ = std::fs::remove_file(dest.with_extension("owned"));
        }
    }
}

/// Replaces a validated download only after preserving the existing file.
/// The backup is restored by the app's cleanup command if the user deletes the
/// downloaded activation files.
pub(crate) fn install_staged_download(
    stage: &Path,
    dest: &Path,
    source_url: &str,
) -> Result<(), String> {
    let stage_meta = std::fs::symlink_metadata(stage)
        .map_err(|e| format!("Cannot inspect completed download: {}", e))?;
    if stage_meta.file_type().is_symlink() || !stage_meta.is_file() {
        return Err("The staged download is not a regular file.".to_string());
    }

    let backup = original_backup_path(dest);
    let backup_marker = original_backup_marker_path(&backup);
    let existing = match std::fs::symlink_metadata(dest) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "Refusing to replace a non-regular game file: {}",
                    dest.display()
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("Cannot inspect {}: {}", dest.display(), error)),
    };
    let backup_exists = match std::fs::symlink_metadata(&backup) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "The reserved backup path is not a regular file: {}",
                    backup.display()
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("Cannot inspect backup: {}", error)),
    };
    let backup_owned = backup_exists && crate::owned_marker_matches(&backup, &backup_marker);
    if backup_exists && !backup_owned {
        return Err(format!(
            "A file already exists at the reserved backup path {}. Move it aside before retrying.",
            backup.display()
        ));
    }
    if !backup_exists && backup_marker.exists() {
        if existing && crate::owned_marker_matches(dest, &backup_marker) {
            let _ = std::fs::remove_file(&backup_marker);
        } else {
            return Err(format!(
                "A stale backup marker exists at {}. Move it aside before retrying.",
                backup_marker.display()
            ));
        }
    }

    let destination_owned = crate::owned_marker_matches(dest, &dest.with_extension("owned"));
    if existing && backup_owned && !destination_owned {
        return Err(format!(
            "{} changed after its original was backed up. The file was left untouched.",
            dest.display()
        ));
    }

    if existing && !backup_exists {
        crate::write_owned_marker_at(dest, &backup_marker)
            .map_err(|e| format!("Cannot prepare a backup marker: {}", e))?;
        if let Err(error) = std::fs::rename(dest, &backup) {
            let _ = std::fs::remove_file(&backup_marker);
            return Err(format!(
                "Cannot preserve the existing {}: {}",
                dest.display(),
                error
            ));
        }
        if !crate::owned_marker_matches(&backup, &backup_marker) {
            let _ = std::fs::rename(&backup, dest);
            let _ = std::fs::remove_file(&backup_marker);
            return Err("The preserved original did not match its backup marker.".to_string());
        }
        let _ = std::fs::remove_file(dest.with_extension("owned"));
    } else if existing {
        std::fs::remove_file(dest)
            .map_err(|e| format!("Cannot replace the previous downloaded file: {}", e))?;
        let _ = std::fs::remove_file(dest.with_extension("owned"));
    }

    if let Err(error) = std::fs::rename(stage, dest) {
        restore_original_backup(dest, &backup);
        return Err(format!("Cannot install the completed download: {}", error));
    }
    if let Err(error) = mark_download_owned(dest, source_url) {
        let _ = std::fs::rename(dest, stage);
        let _ = std::fs::remove_file(dest.with_extension("owned"));
        restore_original_backup(dest, &backup);
        return Err(format!("Cannot mark the installed download: {}", error));
    }
    let _ = std::fs::remove_file(stage.with_extension("owned"));
    Ok(())
}

fn remove_download_artifacts(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("state"));
    let _ = std::fs::remove_file(path.with_extension("owned"));
    restore_original_backup(path, &original_backup_path(path));
}

/// Converts a raw.githubusercontent.com URL into the media.githubusercontent.com
/// LFS-media URL that serves the real binary content.
fn to_lfs_media_url(raw_url: &str) -> Option<String> {
    if raw_url.contains("raw.githubusercontent.com/") {
        Some(raw_url.replace(
            "raw.githubusercontent.com/",
            "media.githubusercontent.com/media/",
        ))
    } else {
        None
    }
}

/// Smart download with duplicate detection and LFS fallback.
/// - Checks for a complete existing file with the expected size
/// - Tries raw URL first, auto-retries with LFS media URL if needed
async fn download_file_smart(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    label: &str,
    progress_start: f64,
    progress_end: f64,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pause: std::sync::Arc<std::sync::atomic::AtomicBool>,
    game_dir: &Path,
    optimal_connections: usize,
) -> Result<(), String> {
    let mut current_url = url.to_string();
    let stage = staged_download_path(dest);
    let state_path = stage.with_extension("state");
    let destination_marker = dest.with_extension("owned");
    let stage_marker = stage.with_extension("owned");
    for path in [
        dest,
        stage.as_path(),
        state_path.as_path(),
        destination_marker.as_path(),
        stage_marker.as_path(),
    ] {
        ensure_regular_file_or_absent(path)?;
    }
    let mut accumulated_time: u64 = 0;
    let mut retry_count = 0;
    let mut force_single_connection = false;
    // ━━━ Download with pause/resume support ━━━
    loop {
        while pause.load(std::sync::atomic::Ordering::Relaxed) {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Cancelled".to_string());
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }

        // Check if file already exists (might exist after resume)
        let mut remote_size = get_remote_file_size(client, &current_url, &cancel, &pause).await;
        // GitHub's raw endpoint reports the tiny LFS pointer size. Probe the
        // matching media URL before choosing a connection count so cached LFS
        // binaries can be recognized by their real size on later runs.
        if remote_size.is_some_and(|size| size <= 1024) {
            if let Some(media_url) = to_lfs_media_url(&current_url) {
                if let Some(media_size) =
                    get_remote_file_size(client, &media_url, &cancel, &pause).await
                {
                    if media_size > 1024 {
                        current_url = media_url;
                        remote_size = Some(media_size);
                    }
                }
            }
        }
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }
        if pause.load(std::sync::atomic::Ordering::Relaxed) {
            continue;
        }
        let has_partial_state = state_path.exists();
        let marker_path = dest.with_extension("owned");
        let destination_owned = crate::owned_download_source_matches(dest, &marker_path, url);
        if !has_partial_state
            && destination_owned
            && file_already_exists(dest, app, label, remote_size, progress_end)
        {
            // Check if it's an LFS pointer
            if is_lfs_pointer(dest) {
                remove_download_artifacts(dest);
                if let Some(media_url) = to_lfs_media_url(&current_url) {
                    current_url = media_url;
                    let _ = app.emit(
                        "activation-progress",
                        ProgressPayload {
                            percent: progress_start,
                            label: format!("{} (LFS — retrying via media URL)", label),
                        },
                    );
                    continue;
                } else {
                    return Err(format!(
                        "LFS detected but cannot build media URL from: {}",
                        current_url
                    ));
                }
            }
            if validate_download(dest, label).is_err() {
                remove_download_artifacts(dest);
                continue;
            }
            return Ok(());
        }

        let file_size_mb = remote_size.unwrap_or(0) as f64 / 1_048_576.0;
        let num_parts = if force_single_connection || file_size_mb < 2.0 {
            1
        } else {
            optimal_connections.max(1)
        };

        // Download attempt
        let result = download_file_stream(
            client,
            &current_url,
            &stage,
            app,
            label,
            progress_start,
            progress_end,
            cancel.clone(),
            pause.clone(),
            num_parts,
            remote_size,
            accumulated_time,
        )
        .await;

        match result {
            Ok(()) => {
                // Check if it's an LFS pointer
                if is_lfs_pointer(&stage) {
                    remove_download_artifacts(&stage);
                    if let Some(media_url) = to_lfs_media_url(&current_url) {
                        current_url = media_url;
                        let _ = app.emit(
                            "activation-progress",
                            ProgressPayload {
                                percent: progress_start,
                                label: format!("{} (LFS — retrying via media URL)", label),
                            },
                        );
                        continue;
                    } else {
                        return Err(format!(
                            "LFS detected but cannot build media URL from: {}",
                            current_url
                        ));
                    }
                }
                if let Err(error) = validate_download(&stage, label) {
                    remove_download_artifacts(&stage);
                    return Err(format!("{} is invalid: {}", label, error));
                }
                if let Err(error) = mark_download_owned(&stage, url) {
                    remove_download_artifacts(&stage);
                    return Err(format!("Cannot prepare the completed download: {}", error));
                }
                if let Err(error) = install_staged_download(&stage, dest, url) {
                    return Err(error);
                }
                crate::logger::log_msg(game_dir, &format!("✓ Successfully downloaded {}", label));
                break;
            } // success
            Err((e, t)) if e == "Resumed" => {
                accumulated_time = t;
                continue;
            }
            Err((e, t)) if e.starts_with("Fallback|") => {
                let actual_err = e
                    .split('|')
                    .nth(1)
                    .unwrap_or("Range requests are unavailable");
                crate::logger::log_msg(
                    game_dir,
                    &format!(
                        "Range download unavailable for {} ({}); retrying with one connection.",
                        label, actual_err
                    ),
                );
                force_single_connection = true;
                accumulated_time = t;
                remove_download_artifacts(&stage);
                let _ = app.emit(
                    "activation-progress",
                    ProgressPayload {
                        percent: progress_start,
                        label: format!("{} · Retrying with one connection...", label),
                    },
                );
                continue;
            }
            Err((e, t)) if e.starts_with("Retry") => {
                let actual_err = e.split('|').nth(1).unwrap_or("Unknown");
                accumulated_time = t;
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Cancelled".to_string());
                }
                if pause.load(std::sync::atomic::Ordering::Relaxed) {
                    continue;
                }
                retry_count += 1;
                if retry_count > 5 {
                    return Err(format!(
                        "Download failed after {} attempts: {}",
                        retry_count - 1,
                        actual_err
                    ));
                }
                crate::logger::log_msg(
                    game_dir,
                    &format!(
                        "⚠️ Retry {} for {} (Error: {})",
                        retry_count, label, actual_err
                    ),
                );
                let _ = app.emit(
                    "activation-progress",
                    ProgressPayload {
                        percent: progress_start,
                        label: format!("{} · Disconnected, retrying ({})...", label, retry_count),
                    },
                );
                let backoff = (1u64 << retry_count.min(3)).min(8);
                tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
                continue;
            }
            Err((e, _)) => {
                crate::logger::log_msg(
                    game_dir,
                    &format!("❌ Fatal error downloading {}: {}", label, e),
                );
                return Err(e); // real error or cancelled
            }
        }
    }

    Ok(())
}

/// Parallel download using multiple curl.exe connections — like IDM.
/// Splits the file into num_parts chunks, downloads each with a separate
/// curl process using HTTP Range headers, then concatenates them.
/// Falls back to single connection for small files (< 10 MB).

async fn download_file_stream(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    label: &str,
    progress_start: f64,
    progress_end: f64,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pause: std::sync::Arc<std::sync::atomic::AtomicBool>,
    num_parts: usize,
    pre_fetched_size: Option<u64>,
    accumulated_time: u64,
) -> Result<(), (String, u64)> {
    crate::downloader::download_file_stream_reqwest(
        client,
        url,
        dest,
        app,
        label,
        progress_start,
        progress_end,
        cancel,
        pause,
        num_parts,
        pre_fetched_size,
        accumulated_time,
    )
    .await
}

/// Verify a file has valid DOS and Windows PE signatures.
/// Detects LFS pointers, HTML error pages, and truncated downloads.
fn validate_pe_header<R: Read + std::io::Seek>(file: &mut R, size: u64) -> Result<(), String> {
    if size < 64 {
        return Err("File is too small to contain a DOS executable header.".to_string());
    }
    let mut dos_header = [0u8; 64];
    file.read_exact(&mut dos_header)
        .map_err(|e| format!("Cannot read DOS header: {}", e))?;
    if dos_header[..2] != [0x4D, 0x5A] {
        return Err("File is missing the MZ signature.".to_string());
    }

    let pe_offset = u32::from_le_bytes(dos_header[0x3C..0x40].try_into().unwrap()) as u64;
    if pe_offset < 64 || pe_offset.checked_add(4).is_none_or(|end| end > size) {
        return Err("File contains an invalid PE header offset.".to_string());
    }
    file.seek(std::io::SeekFrom::Start(pe_offset))
        .map_err(|e| format!("Cannot seek to PE header: {}", e))?;
    let mut signature = [0u8; 4];
    file.read_exact(&mut signature)
        .map_err(|e| format!("Cannot read PE signature: {}", e))?;
    if signature != *b"PE\0\0" {
        return Err("File is missing the PE signature.".to_string());
    }
    Ok(())
}

fn validate_exe(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();

    // Suspiciously small file — likely LFS pointer or error page
    if size < 500 {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        if content.contains("git-lfs") || content.contains("oid sha256") {
            return Err(format!(
                "الملف عبارة عن Git LFS pointer مش ملف حقيقي (حجمه {} بايت). لازم الرابط يخدم الـ binary مباشرة. \n\
                 The file is a Git LFS pointer, not the actual binary (only {} bytes). The URL must serve the actual binary directly.",
                size, size
            ));
        }
        return Err(format!(
            "الملف صغير جداً (حجمه {} بايت) وغالباً تحميله فشل / File is suspiciously small ({} bytes) — download likely failed",
            size, size
        ));
    }

    // Check both the DOS and PE signatures; MZ alone can be a truncated or
    // unrelated file and is not enough to safely hand the file to Windows.
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if let Err(error) = validate_pe_header(&mut file, size) {
        return Err(format!(
            "الملف مش تنفيذي Windows صالح: {} (حجمه {} بايت). \n\
             File is not a valid Windows PE executable: {} (size: {} bytes).",
            error, size, error, size
        ));
    }

    Ok(())
}

fn validate_zip(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();

    if size < 100 {
        return Err(format!(
            "ملف ZIP صغير جداً ({} بايت) / ZIP file too small ({} bytes)",
            size, size
        ));
    }

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;

    // Check if it opens as a valid zip archive without errors
    match zip::ZipArchive::new(file) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!(
            "الملف معطوب أو غير مكتمل التحميل / File is corrupted or incomplete download: {}",
            e
        )),
    }
}

fn sha1_file(path: &Path) -> Result<String, String> {
    use sha1::{Digest, Sha1};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = [0; 65536];
    loop {
        let n = std::io::Read::read(&mut file, &mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

fn safe_zip_output_path(root: &Path, entry_name: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let relative = Path::new(entry_name);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("Unsafe ZIP entry path: {}", entry_name));
    }

    let output = root.join(relative);
    if !output.starts_with(root) {
        return Err(format!("ZIP entry escapes the destination: {}", entry_name));
    }
    Ok(output)
}

fn ensure_safe_directory_chain(root: &Path, directory: &Path) -> Result<(), String> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| format!("ZIP entry escapes the destination: {}", directory.display()))?;
    let mut current = root.to_path_buf();

    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err(format!(
                "Unsafe ZIP directory path: {}",
                directory.display()
            ));
        };
        current.push(name);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!(
                    "ZIP entry traverses a non-directory path: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&current)
                    .map_err(|e| format!("Failed to create {}: {}", current.display(), e))?;
            }
            Err(error) => return Err(format!("Cannot inspect {}: {}", current.display(), error)),
        }
    }
    Ok(())
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    const MAX_ARCHIVE_ENTRIES: usize = 100_000;
    const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("ZIP archive contains too many entries.".to_string());
    }
    let root = dest
        .canonicalize()
        .map_err(|e| format!("Cannot resolve extraction destination: {}", e))?;
    let mut expanded_bytes = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .filter(|size| *size <= MAX_EXPANDED_BYTES)
            .ok_or_else(|| "ZIP archive expands beyond the 2 GiB safety limit.".to_string())?;
        let out_path = safe_zip_output_path(&root, entry.name())?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!(
                "ZIP symlink entries are not allowed: {}",
                entry.name()
            ));
        }
        if entry.is_dir() {
            ensure_safe_directory_chain(&root, &out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                ensure_safe_directory_chain(&root, parent)?;
            }
            match std::fs::symlink_metadata(&out_path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(format!(
                        "ZIP entry would replace a non-regular file: {}",
                        out_path.display()
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("Cannot inspect {}: {}", out_path.display(), error))
                }
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create {}: {}", out_path.display(), e))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to write {}: {}", out_path.display(), e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod zip_path_tests {
    use super::{find_installer_xml, parse_game_version, safe_zip_output_path, validate_pe_header};
    use std::io::Cursor;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(label: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ta-{label}-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn accepts_only_relative_zip_paths() {
        let root = Path::new(r"C:\game");
        assert_eq!(
            safe_zip_output_path(root, "LiveEditor/file.dll").unwrap(),
            root.join("LiveEditor/file.dll")
        );
        assert!(safe_zip_output_path(root, "../outside.dll").is_err());
        assert!(safe_zip_output_path(root, r"LiveEditor\..\outside.dll").is_err());
        assert!(safe_zip_output_path(root, r"C:\outside.dll").is_err());
    }

    #[test]
    fn parses_game_version_from_empty_and_paired_xml_elements() {
        assert_eq!(
            parse_game_version(r#"<root><gameVersion version="1.2.3.4"/></root>"#),
            Some("1.2.3.4".to_string())
        );
        assert_eq!(
            parse_game_version(r#"<root><gameVersion version="2.3.4.5"></gameVersion></root>"#),
            Some("2.3.4.5".to_string())
        );
        assert_eq!(parse_game_version("<root><unrelated/></root>"), None);
    }

    #[test]
    fn installer_xml_must_be_a_file_in_a_supported_folder() {
        let root = test_dir("installer");
        let installer = root.join("__Installer/installerdata.xml");
        std::fs::create_dir_all(installer.parent().unwrap()).unwrap();
        std::fs::create_dir(&installer).unwrap();
        assert_eq!(find_installer_xml(&root), None);
        std::fs::remove_dir(&installer).unwrap();
        std::fs::write(&installer, "<root/>").unwrap();
        assert_eq!(find_installer_xml(&root), Some(installer));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn executable_validation_checks_the_pe_signature_and_bounds() {
        let mut bytes = vec![0u8; 128];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3C..0x40].copy_from_slice(&64u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        assert!(validate_pe_header(&mut Cursor::new(bytes.clone()), bytes.len() as u64).is_ok());

        bytes[64..68].copy_from_slice(b"NOPE");
        assert!(validate_pe_header(&mut Cursor::new(bytes.clone()), bytes.len() as u64).is_err());

        bytes[0x3C..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(validate_pe_header(&mut Cursor::new(bytes.clone()), bytes.len() as u64).is_err());
    }
}

fn run_hidden(exe_path: &Path, cwd: &Path, args: &[&str]) -> std::io::Result<std::process::Child> {
    Command::new(exe_path)
        .args(args)
        .current_dir(cwd)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .spawn()
}

fn check_ticket_files(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(name_str) = name.to_str() {
                if name_str.starts_with("Denuvo_ticket") {
                    return true;
                }
            }
        }
    }
    false
}

fn get_ticket_file(dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(name_str) = name.to_str() {
                if name_str.starts_with("Denuvo_ticket") {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

/// Watch a directory for Denuvo_ticket files using a filesystem watcher.
/// Returns true if a ticket file is detected, false if timeout expires.
/// This is INSTANT — no polling delay. The moment the file is created,
/// we detect it.
async fn watch_for_ticket(
    game_dir: &Path,
    timeout_secs: u64,
    cancel: &std::sync::atomic::AtomicBool,
    pause: &std::sync::atomic::AtomicBool,
    app: &AppHandle,
    progress_base: f64,
) -> bool {
    use notify::{Event, EventKind, RecursiveMode, Watcher};
    use std::sync::mpsc;

    let start_time = std::time::Instant::now();

    // First check if ticket already exists
    if check_ticket_files(game_dir) {
        return true;
    }

    // Set up filesystem watcher
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(_) => {
            // Fallback to simple polling if watcher fails
            for _ in 0..(timeout_secs * 5) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                if check_ticket_files(game_dir) {
                    return true;
                }
                while pause.load(std::sync::atomic::Ordering::Relaxed) {
                    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                        return false;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return false;
                }
            }
            return false;
        }
    };

    if watcher
        .watch(game_dir, RecursiveMode::NonRecursive)
        .is_err()
    {
        // Fallback
        for _ in 0..(timeout_secs * 5) {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            if check_ticket_files(game_dir) {
                return true;
            }
            while pause.load(std::sync::atomic::Ordering::Relaxed) {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return false;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return false;
            }
        }
        return false;
    }

    let mut deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    let mut paused_total = std::time::Duration::ZERO;

    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return false;
        }

        if pause.load(std::sync::atomic::Ordering::Relaxed) {
            let paused_at = std::time::Instant::now();
            while pause.load(std::sync::atomic::Ordering::Relaxed) {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return false;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            let paused_for = paused_at.elapsed();
            deadline += paused_for;
            paused_total += paused_for;
            continue;
        }

        if std::time::Instant::now() >= deadline {
            return false; // timeout — no ticket
        }

        // Check for filesystem events (non-blocking with short timeout)
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(Ok(event)) => {
                // Check if the created/modified file is a Denuvo_ticket
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    for path in &event.paths {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.starts_with("Denuvo_ticket") {
                                return true; // Found it instantly!
                            }
                        }
                    }
                }
            }
            Ok(Err(_)) => {} // watcher error, continue
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Also do a quick manual check in case we missed the event
                if check_ticket_files(game_dir) {
                    return true;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return check_ticket_files(game_dir);
            }
        }

        let elapsed = start_time.elapsed().saturating_sub(paused_total).as_secs();
        let _ = app.emit(
            "activation-progress",
            ProgressPayload {
                percent: progress_base,
                label: format!(
                    "Game loaded — checking for Denuvo tickets... [{}/{}]",
                    format_time(elapsed),
                    format_time(timeout_secs)
                ),
            },
        );
    }
}

const ACHIEVEMENT_NAMES: [&str; 46] = [
    "Treble Glory",
    "European Glory",
    "Legend on the Pitch",
    "Mission Master",
    "Rival Domination",
    "Under the Spotlight",
    "Buy now Pay Later",
    "Win Travel",
    "Club Ambassador",
    "One of Your Own",
    "Welcome to The Grounds",
    "Exploring Kickabouts",
    "The Journey Begins",
    "Hit the Streets",
    "Taking it to the Max",
    "Kickabout Legend",
    "Club Legend",
    "Street Football Master",
    "Let's Get Social",
    "Hello World",
    "Group Effort",
    "Dead-ball Specialist",
    "Nerves of Steel",
    "Thunderstrike",
    "Status Earned",
    "Surgical Aim",
    "Bullseye",
    "The + Factor",
    "Tactical Mastermind",
    "Clean Sheet",
    "True To The Game",
    "Just a Little Extra",
    "We've Got Chemistry",
    "Trust the Process",
    "Defence Wins Games",
    "Always Evolving",
    "Weekend Warrior",
    "Still Here",
    "Top Tier",
    "Challenge Accepted",
    "Built Differently",
    "European Legend",
    "Best of Five",
    "Football is Everything",
    "One season, wonderful!",
    "All Aboard the Premium Track!",
];

const ANADIUS_CFG_TEMPLATE: &str = r#""Config2"
{
    "Game"
    {
        "Name"                  "EA SPORTS FC 27 Lite"
        "Version"               "@VERSION@"
        "ContentId"             "16425884_sc"
        "DenuvoToken"           "PASTE_A_VALID_DENUVO_TOKEN_HERE"
        "DenuvoExeHash"         "@EXE_HASH@"
        "DenuvoDllHash"         "@DLL_HASH@"
        "KeyForLicense"         "uCEBdaIKxv9wxM34P8USLw=="
        "Languages"             "ar_SA,cs_CZ,da_DK,de_DE,en_US,es_ES,es_MX,fr_FR,it_IT,ja_JP,ko_KR,nl_NL,no_NO,pl_PL,pt_BR,pt_PT,ru_RU,sv_SE,tr_TR,zh_CN,zh_HK"
        "Language"              "all"
        "LanguageRegistryKey"   "SOFTWARE\\EA Sports\\EA SPORTS FC 27\\Locale"
    }
    "Emulator"
    {
        "LoadExtraDLLs"         "@EXTRA_DLLS@"
    }
    "User"
    {
        "Username"              "AMGxSANTI"
        "PersonaId"             "1234567890"
        "UserId"                "112233445566"
    }
    "Achievements"
    {
        "AchievementsSet"       "50072_16425884_50844"
        "AchievementNames"
        {
@ACHIEVEMENTS@        }
    }
}"#;

/// Writes anadius.cfg for FC 27.
/// - `game_version`: the version string read from installerdata.xml
/// - `DenuvoDllHash`: SHA-1 of the game's own dbdata.dll
/// - `DenuvoExeHash`: SHA-1 of the *downloaded* (modified) fc27.exe that sits in the game folder.
///   This MUST be called after fc27.exe has been downloaded.
/// - FMM selected  -> only TechnoAfandi.DLL is loaded
///   Live Editor   -> TechnoAfandi.DLL + FCLiveEditor.DLL
fn generate_anadius_cfg(
    game_dir: &Path,
    game_version: &str,
    selection: &str,
) -> Result<(), String> {
    let dll_hash = sha1_file(&game_dir.join("dbdata.dll"))
        .map_err(|e| format!("Failed to hash dbdata.dll: {}", e))?;
    let exe_hash = sha1_file(&game_dir.join(GAME_EXE))
        .map_err(|e| format!("Failed to hash {}: {}", GAME_EXE, e))?;

    let extra_dlls = if selection == "FMM" {
        "TechnoAfandi.DLL"
    } else {
        "TechnoAfandi.DLL,FCLiveEditor.DLL"
    };

    let mut achievements = String::new();
    for (i, name) in ACHIEVEMENT_NAMES.iter().enumerate() {
        let key = format!("\"{}\"", i + 1);
        achievements.push_str(&format!("            {:<20}\"{}\"\n", key, name));
    }

    let cfg_content = ANADIUS_CFG_TEMPLATE
        .replace("@VERSION@", game_version)
        .replace("@EXE_HASH@", &exe_hash)
        .replace("@DLL_HASH@", &dll_hash)
        .replace("@EXTRA_DLLS@", extra_dlls)
        .replace("@ACHIEVEMENTS@", &achievements);

    let cfg_path = game_dir.join("anadius.cfg");
    std::fs::write(&cfg_path, cfg_content).map_err(|e| e.to_string())
}

// Soft-Close implementation below
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(windows)]
use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
#[cfg(windows)]
use windows::Win32::System::ProcessStatus::K32EnumProcessModules;
#[cfg(windows)]
use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
#[cfg(windows)]
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
};

#[cfg(windows)]
unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let target_pid = lparam.0 as u32;
    let mut window_pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut window_pid));

    if window_pid == target_pid {
        let _ = PostMessageW(
            hwnd,
            WM_CLOSE,
            windows::Win32::Foundation::WPARAM(0),
            windows::Win32::Foundation::LPARAM(0),
        );
    }
    BOOL(1)
}

fn close_process_gracefully(process_name: &str) {
    #[cfg(windows)]
    unsafe {
        let mut pids = [0u32; 1024];
        let mut bytes_returned = 0;

        let _ = windows::Win32::System::ProcessStatus::K32EnumProcesses(
            pids.as_mut_ptr(),
            std::mem::size_of_val(&pids) as u32,
            &mut bytes_returned,
        );
        if bytes_returned > 0 {
            let count = bytes_returned as usize / std::mem::size_of::<u32>();
            for &pid in &pids[..count] {
                if pid == 0 {
                    continue;
                }

                if let Ok(h_process) =
                    OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
                {
                    let mut h_mod = windows::Win32::Foundation::HMODULE::default();
                    let mut cb_needed = 0;

                    let _ = K32EnumProcessModules(
                        h_process,
                        &mut h_mod as *mut _,
                        std::mem::size_of_val(&h_mod) as u32,
                        &mut cb_needed,
                    );
                    if cb_needed > 0 {
                        let mut name_buf = [0u16; 256];
                        let len = K32GetModuleBaseNameW(h_process, h_mod, &mut name_buf);
                        if len > 0 {
                            let name = String::from_utf16_lossy(&name_buf[..len as usize]);
                            if name.eq_ignore_ascii_case(process_name) {
                                // Ask the app to close normally; never force-terminate it.
                                let _ = EnumWindows(Some(enum_windows_proc), LPARAM(pid as isize));
                            }
                        }
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(h_process);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("pkill")
            .arg("-TERM")
            .arg("-x")
            .arg(process_name)
            .status();
    }
}

// ───────────────────────────── FC 27 activation flow ─────────────────────────────

/// Name of the (modified) game executable placed in the game folder.
const GAME_EXE: &str = "fc27.exe";

/// Base URL of the GitHub Releases that host one fc27.exe per game version.
/// Release tags look like `v1.0.1`, `v1.0.2`, ... and each one carries an asset named `fc27.exe`.
const FC27_RELEASE_BASE: &str = "https://github.com/lilmoneam44/EA-SPORTS-FC-27/releases/download";

/// Newest version we have an fc27.exe for. Used for the "downgrade" path (Case B)
/// when the installed game is newer than anything we host.
const LATEST_SUPPORTED_TAG: &str = "1.0.3";

/// DLLs that must be out of the way while an activator runs (restored afterwards).
const CONFLICT_DLLS: &[&str] = &[
    "CryptBase.dll",
    "version.dll",
    "dinput8.dll",
    "FCLiveEditor.DLL",
    "EAAC.dll",
    "TechnoAfandi.dll",
];

fn fc27_release_url(tag: &str) -> String {
    format!("{}/v{}/FC27.exe", FC27_RELEASE_BASE, tag)
}

fn emit_prog(app: &AppHandle, percent: f64, label: &str) {
    let _ = app.emit(
        "activation-progress",
        ProgressPayload {
            percent,
            label: label.to_string(),
        },
    );
}

fn emit_finish(app: &AppHandle, success: bool, msg: &str) {
    let _ = app.emit(
        "activation-done",
        serde_json::json!({ "success": success, "message": msg }),
    );
}

/// Checks that a release asset really exists (HTTP 2xx) and returns its size.
/// Unlike `get_remote_file_size`, a 404 page is NOT mistaken for a file.
async fn probe_release_asset(
    client: &reqwest::Client,
    url: &str,
    cancel: &std::sync::atomic::AtomicBool,
    pause: &std::sync::atomic::AtomicBool,
) -> Option<u64> {
    let resp = loop {
        if !wait_for_resume(cancel, pause).await {
            return None;
        }
        match send_with_control(client.get(url).header("Range", "bytes=0-0"), cancel, pause).await {
            Ok(Some(response)) => break response,
            Ok(None) if !cancel.load(std::sync::atomic::Ordering::Relaxed) => continue,
            Ok(None) | Err(_) => return None,
        }
    };
    if !resp.status().is_success() {
        return None;
    }
    if let Some(cr) = resp.headers().get(reqwest::header::CONTENT_RANGE) {
        if let Ok(s) = cr.to_str() {
            if let Some(total) = s.rsplit('/').next() {
                if let Ok(n) = total.trim().parse::<u64>() {
                    if n > 1 {
                        return Some(n);
                    }
                }
            }
        }
    }
    resp.content_length().filter(|n| *n > 1)
}

fn clean_tickets(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Some(n) = entry.file_name().to_str() {
                if n.starts_with("Denuvo_ticket") {
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }
}

fn running_processes<'a>(names: &[&'a str]) -> Vec<&'a str> {
    if let Ok(out) = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
    {
        if !out.status.success() {
            return names.to_vec();
        }
        let listed: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| line.trim_start().strip_prefix('"'))
            .filter_map(|line| line.split('"').next())
            .map(str::to_ascii_lowercase)
            .collect();
        return names
            .iter()
            .copied()
            .filter(|name| listed.iter().any(|entry| entry.eq_ignore_ascii_case(name)))
            .collect();
    }
    names.to_vec()
}

fn is_process_running(name: &str) -> bool {
    !running_processes(&[name]).is_empty()
}

fn hide_conflict_dlls(game_dir: &Path) -> Result<(), String> {
    for dll in CONFLICT_DLLS {
        let path = game_dir.join(dll);
        if !path.exists() {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Cannot inspect {}: {}", path.display(), e))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Refusing to move a non-regular conflict file: {}",
                path.display()
            ));
        }
        let backup = game_dir.join(format!("{}.bak", dll));
        if std::fs::symlink_metadata(&backup).is_ok() {
            return Err(format!(
                "A backup already exists at {}. The tool left it untouched; move it aside and retry.",
                backup.display()
            ));
        }
    }

    let mut moved = Vec::new();
    for dll in CONFLICT_DLLS {
        let p = game_dir.join(dll);
        if p.exists() {
            let bak = game_dir.join(format!("{}.bak", dll));
            match std::fs::rename(&p, &bak) {
                Ok(_) => {
                    moved.push((p, bak));
                    crate::logger::log_msg(game_dir, &format!("Successfully hid {}", dll));
                }
                Err(e) => {
                    for (original, backup) in moved.into_iter().rev() {
                        if !original.exists() {
                            let _ = std::fs::rename(backup, original);
                        }
                    }
                    return Err(format!("Failed to hide {}: {}", dll, e));
                }
            }
        }
    }
    Ok(())
}

fn restore_conflict_dlls(game_dir: &Path) {
    for dll in CONFLICT_DLLS {
        let bak = game_dir.join(format!("{}.bak", dll));
        if bak.exists() {
            let target = game_dir.join(dll);
            if target.exists() {
                crate::logger::log_msg(
                    game_dir,
                    &format!(
                        "Preserved {} because a new file already exists; backup remains at {}.",
                        target.display(),
                        bak.display()
                    ),
                );
                continue;
            }
            match std::fs::rename(&bak, &target) {
                Ok(_) => {
                    crate::logger::log_msg(game_dir, &format!("Successfully restored {}", dll))
                }
                Err(e) => {
                    crate::logger::log_msg(game_dir, &format!("Failed to restore {}: {}", dll, e))
                }
            }
        }
    }
}

struct ConflictDllRestoreGuard(PathBuf);

impl Drop for ConflictDllRestoreGuard {
    fn drop(&mut self) {
        restore_conflict_dlls(&self.0);
    }
}

/// Runs one of the embedded activators (in memory, via a child instance of this exe)
/// and waits for it to finish. DLLs that could crash it are hidden meanwhile and
/// ALWAYS restored afterwards.
///  - `arg`: `--internal-activator` (the native, x64 activator.exe — runs purely in memory)
///  - `strict`: if true a non-zero exit code is an error, otherwise it is only logged
async fn run_embedded_activator(
    app: &AppHandle,
    game_dir: &Path,
    _arg: &str,
    label: &str,
    strict: bool,
    cancel: &AtomicBool,
) -> Result<(), String> {
    use std::io::Write;
    let activator_path = game_dir.join("activator.exe");
    if let Ok(mut f) = std::fs::File::create(&activator_path) {
        let _ = f.write_all(NATIVE_ACTIVATOR_BYTES);
    }

    struct HelperGuard(PathBuf);
    impl Drop for HelperGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _helper_guard = HelperGuard(activator_path.clone());

    emit_prog(app, 70.0, "Preparing environment for activator...");
    // Close the game/editor normally. Do not terminate generic launcher or
    // anti-cheat processes, which may belong to other apps or services.
    let processes_to_close = [GAME_EXE, "LiveEditor.exe", "FCLiveEditor.exe"];
    for proc in processes_to_close {
        close_process_gracefully(proc);
    }
    let mut processes_still_running = Vec::new();
    for _ in 0..30 {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".to_string());
        }
        processes_still_running = running_processes(&processes_to_close);
        if processes_still_running.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if !processes_still_running.is_empty() {
        return Err(format!(
            "Please close {} normally and retry. The tool will not force-terminate it.",
            processes_still_running.join(", ")
        ));
    }

    hide_conflict_dlls(game_dir)?;
    let _restore_guard = ConflictDllRestoreGuard(game_dir.to_path_buf());

    emit_prog(app, 72.0, &format!("Running {}...", label));
    crate::logger::log_msg(game_dir, &format!("Running {}", label));

    let log_path = game_dir.join("TA_Activator_Log.txt");
    let log_file1 = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let log_file2 = log_file1.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = std::process::Command::new(&activator_path);
    cmd.current_dir(game_dir)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdout(std::process::Stdio::from(log_file1))
        .stderr(std::process::Stdio::from(log_file2));

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("Failed to run {}: {}", label, e));
        }
    };

    // Wait for the activator itself (up to 5 minutes)
    emit_prog(app, 80.0, &format!("{} running — please wait...", label));
    let mut exit_code: Option<i32> = None;
    let mut finished = false;
    let mut success = false;
    for _ in 0..300 {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                finished = true;
                success = status.success();
                exit_code = status.code();
                break;
            }
            Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(1000)).await,
            Err(e) => {
                crate::logger::log_msg(game_dir, &format!("Activator wait error: {}", e));
                break;
            }
        }
    }

    // The activator may spawn the game and exit immediately. Wait for the game to close
    // BEFORE restoring the DLLs, otherwise the background game would load them and crash.
    emit_prog(app, 85.0, "Waiting for background activation to finish...");
    for _ in 0..120 {
        if cancel.load(Ordering::Relaxed) {
            crate::logger::log_msg(game_dir, "Activation cancelled during background wait.");
            break;
        }
        if !is_process_running(GAME_EXE) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    if !finished {
        let _ = child.kill();
        return Err(format!(
            "{} did not complete within 5 minutes or was cancelled.",
            label
        ));
    }
    crate::logger::log_msg(
        game_dir,
        &format!("{} exited with code {:?}", label, exit_code),
    );

    let output_str =
        std::fs::read_to_string(game_dir.join("TA_Activator_Log.txt")).unwrap_or_default();
    if !output_str.trim().is_empty() {
        crate::logger::log_msg(
            game_dir,
            &format!("Activator output:\n{}", output_str.trim()),
        );
    }

    if !success {
        if strict {
            return Err(format!(
                "{} failed (exit code: {:?})\nOutput:\n{}",
                label,
                exit_code,
                output_str.trim()
            ));
        }
        crate::logger::log_msg(
            game_dir,
            &format!(
                "WARNING: {} returned a non-zero exit code — continuing to verification.",
                label
            ),
        );
    }
    emit_prog(app, 90.0, &format!("{} finished", label));
    Ok(())
}

/// FC_27_Activator.exe is a .NET (x86, WinForms) program — it cannot be run from memory
/// like the native activator.exe, so it runs from a private temporary folder.
const FC27_ACTIVATOR_BYTES: &[u8] = include_bytes!("../assets/FC_27_Activator.exe");
const FC27_ACTIVATOR_NAME: &str = "FC_27_Activator.exe";

const NATIVE_ACTIVATOR_BYTES: &[u8] = include_bytes!("../assets/activator.exe");

/// True once the activator replaced the DenuvoToken placeholder in anadius.cfg.
fn denuvo_token_written(game_dir: &Path) -> bool {
    let cfg = std::fs::read_to_string(game_dir.join("anadius.cfg")).unwrap_or_default();
    for line in cfg.lines() {
        let l = line.trim();
        if l.starts_with("\"DenuvoToken\"") {
            return !l.contains("PASTE_A_VALID_DENUVO_TOKEN_HERE");
        }
    }
    false
}

/// Case A: extract FC_27_Activator.exe into a private temporary folder, run it
/// with the game folder as its working directory, and remove it after exit.
async fn run_fc27_activator(
    app: &AppHandle,
    game_dir: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let temp_root = std::env::temp_dir().join("TechnoAfandi-FC");
    std::fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Failed to create the temporary activator folder: {}", e))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let run_dir = temp_root.join(format!("activator-{}-{stamp}", std::process::id()));
    std::fs::create_dir(&run_dir)
        .map_err(|e| format!("Failed to create a private activator folder: {}", e))?;
    let exe_path = run_dir.join(FC27_ACTIVATOR_NAME);
    let mut activator_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&exe_path)
        .map_err(|e| {
            let _ = std::fs::remove_dir(&run_dir);
            format!("Failed to prepare {}: {}", FC27_ACTIVATOR_NAME, e)
        })?;
    if let Err(error) = std::io::Write::write_all(&mut activator_file, FC27_ACTIVATOR_BYTES) {
        let _ = std::fs::remove_file(&exe_path);
        let _ = std::fs::remove_dir(&run_dir);
        return Err(format!(
            "Failed to extract {}: {}",
            FC27_ACTIVATOR_NAME, error
        ));
    }
    if let Err(error) = activator_file.sync_all() {
        let _ = std::fs::remove_file(&exe_path);
        let _ = std::fs::remove_dir(&run_dir);
        return Err(format!(
            "Failed to flush {}: {}",
            FC27_ACTIVATOR_NAME, error
        ));
    }
    drop(activator_file);

    emit_prog(app, 60.0, "Running FC 27 Activator...");
    crate::logger::log_msg(game_dir, "Running FC_27_Activator.exe");
    let mut child = match Command::new(&exe_path).current_dir(game_dir).spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&exe_path);
            let _ = std::fs::remove_dir(&run_dir);
            return Err(format!("Failed to run {}: {}", FC27_ACTIVATOR_NAME, e));
        }
    };

    emit_prog(
        app,
        70.0,
        "FC 27 Activator is running — please follow its window...",
    );
    // 1) the process we started (up to 10 minutes — it may show dialogs the user has to confirm)
    let mut exited = false;
    for _ in 0..600 {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                exited = true;
                crate::logger::log_msg(
                    game_dir,
                    &format!("FC_27_Activator.exe exited with code {:?}", status.code()),
                );
                break;
            }
            Ok(None) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
            Err(e) => {
                crate::logger::log_msg(game_dir, &format!("Activator wait error: {}", e));
                break;
            }
        }
    }
    if !exited {
        let _ = child.kill();
        let _ = std::fs::remove_file(&exe_path);
        let _ = std::fs::remove_dir(&run_dir);
        return Err(if cancel.load(Ordering::Relaxed) {
            "Cancelled".to_string()
        } else {
            "FC 27 Activator did not finish within 10 minutes.".to_string()
        });
    }

    // 2) the activator re-launches itself elevated (UAC) and the first instance exits —
    //    keep waiting while ANY instance is still alive.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    let mut process_still_running = false;
    for _ in 0..600 {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        process_still_running = is_process_running(FC27_ACTIVATOR_NAME);
        if !process_still_running {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&exe_path);
        let _ = std::fs::remove_dir(&run_dir);
        return Err("Cancelled".to_string());
    }
    if process_still_running {
        return Err(format!(
            "{} is still running. Close it before retrying; its temporary file was preserved.",
            FC27_ACTIVATOR_NAME
        ));
    }

    // Cleanup the extracted activator (retry: the OS may still hold the file for a moment)
    for _ in 0..5 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if std::fs::remove_file(&exe_path).is_ok() || !exe_path.exists() {
            break;
        }
    }
    if !exe_path.exists() {
        let _ = std::fs::remove_dir(&run_dir);
    }

    let token_ok = denuvo_token_written(game_dir);
    crate::logger::log_msg(
        game_dir,
        &format!("Denuvo token written to anadius.cfg: {}", token_ok),
    );
    if !token_ok {
        crate::logger::log_msg(game_dir, "WARNING: DenuvoToken placeholder is still in anadius.cfg after the activator finished.");
        return Err(
            "FC 27 Activator finished without writing a Denuvo token.\nانتهى مفعّل FC 27 من غير ما يكتب رمز التفعيل. راجع سجل الأداة وحاول مرة أخرى."
                .to_string(),
        );
    }
    emit_prog(app, 90.0, "FC 27 Activator finished");
    Ok(())
}

/// Launches the game through PowerShell Start-Process (ShellExecute with the right
/// working directory), then verifies it stays alive. Returns whether a Denuvo ticket was seen.
async fn launch_and_verify(
    app: &AppHandle,
    game_dir: &Path,
    game_exe: &Path,
    cancel: &AtomicBool,
    pause: &AtomicBool,
) -> Result<bool, String> {
    // Give the OS time to release file handles, and drop stale tickets
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    clean_tickets(game_dir);

    emit_prog(app, 92.0, &format!("Launching {}...", GAME_EXE));
    let ps_cmd = format!(
        "Start-Process -FilePath '{}' -WorkingDirectory '{}'",
        game_exe.display().to_string().replace('\'', "''"),
        game_dir.display().to_string().replace('\'', "''")
    );
    std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-Command",
            ps_cmd.as_str(),
        ])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", GAME_EXE, e))?;

    // Wait up to 30s for the process to appear (EA App can be slow)
    let mut started = false;
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if is_process_running(GAME_EXE) {
            started = true;
            break;
        }
    }
    if !started {
        return Err(format!("{} did not start after activation", GAME_EXE));
    }

    emit_prog(app, 94.0, "Game launched — verifying Denuvo ticket...");
    let ticket_found = watch_for_ticket(game_dir, 10, cancel, pause, app, 94.0).await;
    crate::logger::log_msg(
        game_dir,
        &format!("Post-activation ticket seen: {}", ticket_found),
    );

    if !is_process_running(GAME_EXE) {
        crate::logger::log_msg(
            game_dir,
            &format!("ERROR: {} exited unexpectedly after activation.", GAME_EXE),
        );
        return Err(format!(
            "فشل التفعيل — اللعبة توقفت فجأة بعد التشغيل\nActivation Failed: {} exited unexpectedly. Try running the tool as Administrator.",
            GAME_EXE
        ));
    }
    Ok(ticket_found)
}

pub async fn run_activation(
    app: AppHandle,
    game_dir: PathBuf,
    selection: String,
    client: reqwest::Client,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
) {
    let _ = std::fs::remove_file(game_dir.join("TechnoAfandi.log"));
    crate::logger::log_msg(
        &game_dir,
        &format!("--- NEW ACTIVATION STARTED: {} ---", selection),
    );

    clean_tickets(&game_dir);
    crate::logger::log_msg(&game_dir, "Cleaned up old Denuvo tickets.");

    let optimal_connections = 8;
    let use_live_editor = selection != "FMM";

    // ── Step 0: read game version + sanity checks ─────────────────────────────
    emit_prog(&app, 0.0, "Reading game version...");
    let xml_content = find_installer_xml(&game_dir)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let game_version = parse_game_version(&xml_content).unwrap_or_else(|| "Unknown".to_string());
    if game_version == "Unknown" {
        crate::logger::log_msg(
            &game_dir,
            "ERROR: Failed to parse game version from installerdata.xml",
        );
        emit_finish(&app, false, "فشل قراءة إصدار اللعبة من installerdata.xml\nFailed to read game version. Make sure the game is properly installed and the installer XML exists.");
        return;
    }
    crate::logger::log_msg(
        &game_dir,
        &format!("Game version detected: {}", game_version),
    );

    if !game_dir.join("dbdata.dll").exists() {
        crate::logger::log_msg(&game_dir, "ERROR: dbdata.dll not found in game directory");
        emit_finish(&app, false, "ملف dbdata.dll غير موجود في مجلد اللعبة\ndbdata.dll not found. Please verify the game installation is complete.");
        return;
    }

    // ── Decide the flow ───────────────────────────────────────────────────────
    //  Case A: we host an fc27.exe for exactly this game version.
    //  Case B: the game is newer than anything we host -> downgrade to the newest fc27.exe.
    let mapped = map_version(&game_version);
    let mut case_a = false;
    let mut tag = get_latest_supported_tag(&client, LATEST_SUPPORTED_TAG).await;
    if mapped != "Unknown" {
        let supported_asset =
            probe_release_asset(&client, &fc27_release_url(mapped), &cancel, &pause).await;
        if cancel.load(Ordering::Relaxed) {
            emit_finish(&app, false, "Cancelled");
            return;
        }
        if supported_asset.is_some() {
            case_a = true;
            tag = mapped.to_string();
        } else {
            crate::logger::log_msg(
                &game_dir,
                &format!(
                    "Release v{} not found on GitHub — falling back to Case B.",
                    mapped
                ),
            );
        }
    }
    let fc27_url = fc27_release_url(&tag);
    if !case_a {
        let fallback_asset = probe_release_asset(&client, &fc27_url, &cancel, &pause).await;
        if cancel.load(Ordering::Relaxed) {
            emit_finish(&app, false, "Cancelled");
            return;
        }
        if fallback_asset.is_none() {
            crate::logger::log_msg(
                &game_dir,
                &format!("ERROR: fc27.exe release v{} not reachable", tag),
            );
            emit_finish(&app, false, &format!(
                "تعذر الوصول لملف fc27.exe (v{}) على GitHub. تأكد من اتصال الإنترنت.\nCould not reach fc27.exe (v{}) on GitHub. Check your internet connection.",
                tag, tag
            ));
            return;
        }
    }
    crate::logger::log_msg(
        &game_dir,
        &format!(
            "Flow: Case {} | game {} -> fc27.exe v{}",
            if case_a {
                "A (version supported)"
            } else {
                "B (downgrade)"
            },
            game_version,
            tag
        ),
    );

    // ── Downloads ─────────────────────────────────────────────────────────────
    emit_prog(&app, 0.0, "Starting downloads...");

    // Case B only: FAKE\Activation64.dll
    if !case_a {
        if let Err(e) = std::fs::create_dir_all(game_dir.join("FAKE")) {
            crate::logger::log_msg(
                &game_dir,
                &format!("ERROR: Failed to create FAKE dir: {}", e),
            );
            emit_finish(
                &app,
                false,
                &format!(
                    "Failed to create FAKE directory: {}\nتأكد من صلاحيات الكتابة على مجلد اللعبة",
                    e
                ),
            );
            return;
        }
        let dest = game_dir.join("FAKE").join("Activation64.dll");
        crate::logger::log_msg(&game_dir, "Starting download: Activation64.dll");
        if let Err(e) = download_file_smart(
            &client,
            ACTIVATION64_URL,
            &dest,
            &app,
            "Activation64.dll",
            0.0,
            5.0,
            cancel.clone(),
            pause.clone(),
            &game_dir,
            optimal_connections,
        )
        .await
        {
            crate::logger::log_msg(&game_dir, &format!("ERROR: Failed Activation64.dll: {}", e));
            emit_finish(
                &app,
                false,
                &format!("Failed to download Activation64.dll: {}", e),
            );
            return;
        }
    }

    // fc27.exe (10-30%)
    let fc27_path = game_dir.join(GAME_EXE);
    crate::logger::log_msg(
        &game_dir,
        &format!("Starting download: fc27.exe (v{})", tag),
    );
    if let Err(e) = download_file_smart(
        &client,
        &fc27_url,
        &fc27_path,
        &app,
        "fc27.exe",
        5.0,
        30.0,
        cancel.clone(),
        pause.clone(),
        &game_dir,
        optimal_connections,
    )
    .await
    {
        crate::logger::log_msg(&game_dir, &format!("ERROR: Failed fc27.exe: {}", e));
        emit_finish(&app, false, &format!("Failed to download fc27.exe: {}", e));
        return;
    }
    // Validate BEFORE running to avoid the "Unsupported 16-Bit Application" Windows popup
    if let Err(e) = validate_exe(&fc27_path) {
        remove_download_artifacts(&fc27_path);
        emit_finish(&app, false, &format!("fc27.exe invalid: {}", e));
        return;
    }

    // TechnoAfandi.dll (30-34%)
    let dest = game_dir.join("TechnoAfandi.dll");
    crate::logger::log_msg(&game_dir, "Starting download: TechnoAfandi.dll");
    if let Err(e) = download_file_smart(
        &client,
        TECHNOAFANDI_DLL_URL,
        &dest,
        &app,
        "TechnoAfandi.dll",
        30.0,
        34.0,
        cancel.clone(),
        pause.clone(),
        &game_dir,
        optimal_connections,
    )
    .await
    {
        crate::logger::log_msg(&game_dir, &format!("ERROR: Failed TechnoAfandi.dll: {}", e));
        emit_finish(
            &app,
            false,
            &format!("Failed to download TechnoAfandi.dll: {}", e),
        );
        return;
    }

    // anadius64.dll (34-38%)
    let dest = game_dir.join("anadius64.dll");
    crate::logger::log_msg(&game_dir, "Starting download: anadius64.dll");
    if let Err(e) = download_file_smart(
        &client,
        ANADIUS64_URL,
        &dest,
        &app,
        "anadius64.dll",
        34.0,
        38.0,
        cancel.clone(),
        pause.clone(),
        &game_dir,
        optimal_connections,
    )
    .await
    {
        crate::logger::log_msg(&game_dir, &format!("ERROR: Failed anadius64.dll: {}", e));
        emit_finish(
            &app,
            false,
            &format!("Failed to download anadius64.dll: {}", e),
        );
        return;
    }

    // Live Editor.zip (only when the user picked Live Editor)
    if use_live_editor {
        let zip_path = std::env::temp_dir()
            .join("TechnoAfandi-FC")
            .join("Live_Editor.zip");
        crate::logger::log_msg(&game_dir, "Starting download: Live Editor archive");
        if let Err(e) = download_file_smart(
            &client,
            LE_ZIP_RAW,
            &zip_path,
            &app,
            "Live Editor",
            38.0,
            44.0,
            cancel.clone(),
            pause.clone(),
            &game_dir,
            optimal_connections,
        )
        .await
        {
            crate::logger::log_msg(&game_dir, &format!("ERROR: Failed archive: {}", e));
            emit_finish(
                &app,
                false,
                &format!("Failed to download Live Editor: {}", e),
            );
            return;
        }
        emit_prog(&app, 44.0, "Extracting Live Editor");
        if let Err(e) = extract_zip(&zip_path, &game_dir) {
            remove_download_artifacts(&zip_path);
            emit_finish(
                &app,
                false,
                &format!("Failed to extract Live Editor: {}", e),
            );
            return;
        }
        remove_download_artifacts(&zip_path);
        emit_prog(&app, 46.0, "Live Editor ready");
    } else {
        crate::logger::log_msg(
            &game_dir,
            "FMM mode: no Live Editor package (not downloaded, not written to anadius.cfg).",
        );
    }

    while pause.load(Ordering::Relaxed) {
        if cancel.load(Ordering::Relaxed) {
            emit_finish(&app, false, "Cancelled");
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    if cancel.load(Ordering::Relaxed) {
        emit_finish(&app, false, "Cancelled");
        return;
    }

    // ── anadius.cfg (needs the downloaded fc27.exe for DenuvoExeHash) ─────────
    emit_prog(&app, 48.0, "Generating anadius.cfg");
    if let Err(e) = generate_anadius_cfg(&game_dir, &game_version, &selection) {
        crate::logger::log_msg(&game_dir, &format!("ERROR: anadius.cfg: {}", e));
        emit_finish(&app, false, &format!("Failed to create anadius.cfg: {}", e));
        return;
    }
    emit_prog(&app, 50.0, "anadius.cfg ready");

    while pause.load(Ordering::Relaxed) {
        if cancel.load(Ordering::Relaxed) {
            emit_finish(&app, false, "Cancelled");
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    if cancel.load(Ordering::Relaxed) {
        emit_finish(&app, false, "Cancelled");
        return;
    }

    // ═════════════════════════════ CASE A ═════════════════════════════
    // Activator first, then the game, then check the ticket.
    if case_a {
        if let Err(e) = run_fc27_activator(&app, &game_dir, &cancel).await {
            crate::logger::log_msg(&game_dir, &format!("ERROR: {}", e));
            emit_finish(&app, false, &e);
            return;
        }
        match launch_and_verify(&app, &game_dir, &fc27_path, &cancel, &pause).await {
            Ok(ticket_found) => {
                if ticket_found {
                    emit_finish(
                        &app,
                        false,
                        "Activation failed: Denuvo requested a new ticket.",
                    );
                } else {
                    emit_prog(&app, 100.0, "Activation complete");
                    let _ = std::fs::remove_file(game_dir.join("TechnoAfandi.log"));
                    emit_finish(&app, true, "تم التفعيل بنجاح واللعبة تعمل الآن! 🎮\nEA SPORTS FC 27 activated successfully and is running. Enjoy the game!");
                }
            }
            Err(e) => emit_finish(&app, false, &e),
        }
        return;
    }

    // ═════════════════════════════ CASE B ═════════════════════════════
    // Run the (older) game first to create the Denuvo ticket; only if a ticket
    // shows up run activator.exe, then relaunch the game.
    emit_prog(&app, 55.0, "Running fc27.exe...");
    match run_hidden(&fc27_path, &game_dir, &[]) {
        Ok(mut child) => {
            emit_prog(&app, 59.0, "Waiting for game to load...");
            let mut game_started = false;
            for _ in 0..10 {
                while pause.load(Ordering::Relaxed) {
                    if cancel.load(Ordering::Relaxed) {
                        let _ = child.kill();
                        let _ = child.wait();
                        emit_finish(&app, false, "Cancelled");
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
                if cancel.load(Ordering::Relaxed) {
                    let _ = child.kill();
                    let _ = child.wait();
                    emit_finish(&app, false, "Cancelled");
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                match child.try_wait() {
                    Ok(None) => {
                        game_started = true;
                        break;
                    }
                    Ok(Some(status)) => {
                        // fc27.exe may exit fast but still drop a ticket — check before failing
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if check_ticket_files(&game_dir) {
                            crate::logger::log_msg(&game_dir, &format!("fc27.exe exited quickly (code: {:?}) but ticket was found — continuing.", status.code()));
                            game_started = true;
                            break;
                        }
                        crate::logger::log_msg(
                            &game_dir,
                            &format!(
                                "fc27.exe exited immediately (code: {:?}) with no ticket.",
                                status.code()
                            ),
                        );
                        emit_finish(&app, false, &format!("fc27.exe exited immediately (code: {:?}).\nتحقق من الأنتي فايروس أو نزّل اللعبة من جديد.", status.code()));
                        return;
                    }
                    Err(e) => {
                        emit_finish(&app, false, &format!("Failed to check fc27.exe: {}", e));
                        return;
                    }
                }
            }
            if !game_started {
                emit_finish(&app, false, "fc27.exe did not start");
                return;
            }

            emit_prog(&app, 62.0, "Game loaded — checking for Denuvo tickets...");
            let ticket_found = watch_for_ticket(&game_dir, 30, &cancel, &pause, &app, 62.0).await;

            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                emit_finish(&app, false, "Cancelled");
                return;
            }

            if !ticket_found {
                match child.try_wait() {
                    Ok(None) => {
                        // Game still running without a ticket = already activated / Denuvo offline
                        crate::logger::log_msg(&game_dir, "fc27.exe running 30s with no ticket — game already activated. Skipping activator.");
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = std::fs::remove_file(game_dir.join("TechnoAfandi.log"));
                        emit_prog(&app, 100.0, "Activation complete");
                        emit_finish(&app, true, "تم التفعيل بنجاح! 🎮\nEA SPORTS FC 27 is already activated. Enjoy the game!");
                        return;
                    }
                    Ok(Some(status)) => {
                        // Exited without a ticket — AV may have blocked it; try the activator as recovery
                        crate::logger::log_msg(&game_dir, &format!("fc27.exe exited (code: {:?}) without ticket — attempting activator as recovery.", status.code()));
                    }
                    Err(e) => {
                        crate::logger::log_msg(&game_dir, &format!("Could not query fc27.exe status: {} — attempting activator anyway.", e));
                    }
                }
            } else {
                emit_prog(&app, 65.0, "Denuvo ticket detected — closing game...");
                let _ = child.kill();
                let _ = child.wait();
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
        Err(e) => {
            emit_finish(&app, false, &format!("Failed to run fc27.exe: {}", e));
            return;
        }
    }

    if let Err(e) = run_embedded_activator(
        &app,
        &game_dir,
        "--internal-activator",
        "activator.exe",
        false,
        &cancel,
    )
    .await
    {
        crate::logger::log_msg(&game_dir, &format!("ERROR: {}", e));
        emit_finish(&app, false, &e);
        return;
    }

    match launch_and_verify(&app, &game_dir, &fc27_path, &cancel, &pause).await {
        Ok(ticket_found) => {
            if ticket_found {
                emit_finish(
                    &app,
                    false,
                    "Activation failed: Denuvo requested a new ticket.",
                );
            } else {
                emit_prog(&app, 100.0, "Activation complete");
                let _ = std::fs::remove_file(game_dir.join("TechnoAfandi.log"));
                emit_finish(&app, true, "تم التفعيل بنجاح واللعبة تعمل الآن! 🎮\nEA SPORTS FC 27 activated successfully and is running. Enjoy the game!");
            }
        }
        Err(e) => emit_finish(&app, false, &e),
    }
}
