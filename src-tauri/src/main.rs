//! main.rs
//! Production-grade command handlers & security-hardened backend for Techno Afandi FC27 Tool.
//! Features: Lossless UTF-8 path handling, case-insensitive discovery, bounded diagnostics,
//! and session-scoped scan cancellation.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

// Global synchronization flags
static SCAN_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static GAME_SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDiagnostics {
    pub exe_dir: String,
    pub installer_dir_found: bool,
    pub installer_found: bool,
    pub installer_path: Option<String>,
    pub dbdata_found: bool,
    pub top_level_entries: Vec<String>,
    pub total_entries_count: usize,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgressPayload {
    pub session_id: u64,
    pub current_dir: String,
    pub count: usize,
    pub percent: u32,
}

/// Hardened version of get_exe_dir with lossless path handling.
/// Avoids `to_string_lossy()` corruption on non-English or Arabic Windows usernames.
#[tauri::command]
pub fn get_exe_dir() -> Result<String, String> {
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to determine current executable path: {e}"))?;

    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "Failed to resolve parent directory of executable".to_string())?;

    let path_str = exe_dir.to_str().ok_or_else(|| {
        "Executable path contains non-UTF-8 characters that cannot be represented".to_string()
    })?;

    // Strip extended Windows UNC prefix if present
    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(path_str);
    Ok(clean_path.to_string())
}

/// Hardened game folder validator with case-insensitive installer directory discovery.
#[tauri::command]
pub fn check_game_folder(exe_dir: String) -> bool {
    let trimmed = exe_dir.trim();
    if trimmed.is_empty() {
        return false;
    }

    let base = PathBuf::from(trimmed);
    if !base.is_dir() {
        return false;
    }

    // Must contain dbdata.dll and installer metadata
    let has_dbdata = base.join("dbdata.dll").is_file();
    let has_installer = find_installer_xml_case_insensitive(&base).is_some();

    has_dbdata && has_installer
}

/// Cancels active game scan and invalidates current session.
#[tauri::command]
pub fn cancel_game_scan() -> bool {
    GAME_SCAN_CANCEL.store(true, Ordering::SeqCst);
    SCAN_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    true
}

/// Hardened diagnostic check with path bounds, case-insensitive discovery, and total count metadata.
#[tauri::command]
pub fn get_folder_diagnostics(exe_dir: String) -> FolderDiagnostics {
    let trimmed = exe_dir.trim();
    let base = PathBuf::from(trimmed);

    // Prevent arbitrary system-root traversal
    if trimmed.is_empty() || trimmed == "/" || trimmed == "C:\\" || trimmed == "C:" {
        return FolderDiagnostics {
            exe_dir,
            installer_dir_found: false,
            installer_found: false,
            installer_path: None,
            dbdata_found: false,
            top_level_entries: Vec::new(),
            total_entries_count: 0,
            error_message: Some("Direct system root path diagnostics are disallowed".to_string()),
        };
    }

    if !base.exists() || !base.is_dir() {
        return FolderDiagnostics {
            exe_dir,
            installer_dir_found: false,
            installer_found: false,
            installer_path: None,
            dbdata_found: false,
            top_level_entries: Vec::new(),
            total_entries_count: 0,
            error_message: Some("Specified path does not exist or is not a directory".to_string()),
        };
    }

    let found_xml = find_installer_xml_case_insensitive(&base);
    let installer_dir_present = find_installer_dir_case_insensitive(&base).is_some();
    let dbdata_present = base.join("dbdata.dll").is_file();

    let mut entries = Vec::new();
    let mut total_count = 0;

    if let Ok(rd) = std::fs::read_dir(&base) {
        for entry in rd.flatten() {
            total_count += 1;
            entries.push(entry.file_name().to_string_lossy().to_string());
        }
    }

    entries.sort();
    let truncated_entries = entries.into_iter().take(50).collect();

    FolderDiagnostics {
        exe_dir,
        installer_dir_found: installer_dir_present,
        installer_found: found_xml.is_some(),
        installer_path: found_xml.map(|p| p.to_string_lossy().to_string()),
        dbdata_found: dbdata_present,
        top_level_entries: truncated_entries,
        total_entries_count: total_count,
        error_message: None,
    }
}

/// Case-insensitive search for the __Installer directory
fn find_installer_dir_case_insensitive(base: &Path) -> Option<PathBuf> {
    if let Ok(rd) = std::fs::read_dir(base) {
        for entry in rd.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.eq_ignore_ascii_case("__installer")
                        || name_str.eq_ignore_ascii_case("_installer")
                    {
                        return Some(entry.path());
                    }
                }
            }
        }
    }
    None
}

/// Case-insensitive discovery for installerdata.xml
fn find_installer_xml_case_insensitive(base: &Path) -> Option<PathBuf> {
    let installer_dir = find_installer_dir_case_insensitive(base)?;
    if let Ok(rd) = std::fs::read_dir(&installer_dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.eq_ignore_ascii_case("installerdata.xml") {
                return Some(entry.path());
            }
        }
    }
    None
}
