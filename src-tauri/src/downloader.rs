use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub percent: f64,
    pub label: String,
}

pub fn format_time(secs: u64) -> String {
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

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct DownloadState {
    source_url: String,
    total_size: u64,
    parts_downloaded: Vec<u64>,
}

fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let Some(range) = value.strip_prefix("bytes ") else {
        return None;
    };
    let Some((range, total)) = range.split_once('/') else {
        return None;
    };
    let Some((start, end)) = range.split_once('-') else {
        return None;
    };
    let (Ok(start), Ok(end), Ok(total)) = (
        start.parse::<u64>(),
        end.parse::<u64>(),
        total.parse::<u64>(),
    ) else {
        return None;
    };
    (end >= start && total > end).then_some((start, end, total))
}

fn content_range_start_matches(
    response: &reqwest::Response,
    requested_start: u64,
    expected_total: Option<u64>,
) -> bool {
    let Some(value) = response.headers().get(reqwest::header::CONTENT_RANGE) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some((start, end, total)) = parse_content_range(value) else {
        return false;
    };

    start == requested_start
        && end >= start
        && total > end
        && expected_total.is_none_or(|expected| expected == total)
}

async fn send_with_control(
    request: reqwest::RequestBuilder,
    cancel: &AtomicBool,
    pause: &AtomicBool,
) -> Result<Option<reqwest::Response>, reqwest::Error> {
    let request = request.send();
    tokio::pin!(request);
    loop {
        tokio::select! {
            result = &mut request => return result.map(Some),
            _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                if cancel.load(Ordering::Relaxed) || pause.load(Ordering::Relaxed) {
                    return Ok(None);
                }
            }
        }
    }
}

async fn save_state(state_path: &Path, state: &DownloadState) {
    if let Ok(json) = serde_json::to_string(state) {
        let _ = tokio::fs::write(state_path, json).await;
    }
}

async fn load_state(
    state_path: &Path,
    num_parts: usize,
    total_size: u64,
    source_url: &str,
    chunk_size: u64,
) -> DownloadState {
    let max_part_lengths: Vec<u64> = (0..num_parts)
        .map(|i| {
            let start = i as u64 * chunk_size;
            let end = if i == num_parts - 1 {
                total_size
            } else {
                ((i as u64 + 1) * chunk_size).min(total_size)
            };
            end.saturating_sub(start)
        })
        .collect();

    if let Ok(content) = tokio::fs::read_to_string(state_path).await {
        if let Ok(state) = serde_json::from_str::<DownloadState>(&content) {
            let offsets_fit = state.parts_downloaded.len() == num_parts
                && state
                    .parts_downloaded
                    .iter()
                    .zip(&max_part_lengths)
                    .all(|(offset, max)| offset <= max);
            if state.source_url == source_url && state.total_size == total_size && offsets_fit {
                return state;
            }
        }
    }

    let fresh = DownloadState {
        source_url: source_url.to_string(),
        total_size,
        parts_downloaded: vec![0; num_parts],
    };
    save_state(state_path, &fresh).await;
    fresh
}

fn content_range_matches(resp: &reqwest::Response, start: u64, end: u64) -> bool {
    let Some(value) = resp.headers().get(reqwest::header::CONTENT_RANGE) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some(range) = value.strip_prefix("bytes ") else {
        return false;
    };
    let Some((range, total)) = range.split_once('/') else {
        return false;
    };
    let Some((actual_start, actual_end)) = range.split_once('-') else {
        return false;
    };
    let Ok(actual_start) = actual_start.parse::<u64>() else {
        return false;
    };
    let Ok(actual_end) = actual_end.parse::<u64>() else {
        return false;
    };
    let Ok(total) = total.parse::<u64>() else {
        return false;
    };
    actual_start == start && actual_end == end && total > end
}

async fn abort_and_join(tasks: &mut [tokio::task::JoinHandle<()>]) {
    for task in tasks.iter() {
        task.abort();
    }
    for task in tasks.iter_mut() {
        let _ = task.await;
    }
}

async fn download_chunk(
    client: Client,
    url: String,
    part_index: usize,
    base_start_byte: u64,
    end_byte: u64,
    dest_path: PathBuf,
    state_path: PathBuf,
    state: Arc<tokio::sync::Mutex<DownloadState>>,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    dl_counter: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut retry_count = 0;

    loop {
        let current_downloaded = {
            let s = state.lock().await;
            s.parts_downloaded[part_index]
        };
        let current_start = base_start_byte + current_downloaded;

        if current_start > end_byte {
            return Ok(()); // Done
        }

        let range = format!("bytes={}-{}", current_start, end_byte);
        let resp_res = client.get(&url).header("Range", range).send().await;

        let mut resp = match resp_res {
            Ok(r) if r.status() == reqwest::StatusCode::PARTIAL_CONTENT => {
                if !content_range_matches(&r, current_start, end_byte) {
                    return Err(
                        "Range unsupported: server returned an inconsistent Content-Range"
                            .to_string(),
                    );
                }
                r
            }
            Ok(r) if r.status() == reqwest::StatusCode::OK => {
                return Err(
                    "Range unsupported: server ignored the requested byte range".to_string()
                );
            }
            Ok(r) => {
                if !r.status().is_server_error()
                    && r.status() != reqwest::StatusCode::TOO_MANY_REQUESTS
                {
                    return Err(format!("HTTP error: {}", r.status()));
                }
                retry_count += 1;
                if retry_count > 10 {
                    return Err(format!("HTTP error: {}", r.status()));
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                continue;
            }
            Err(e) => {
                retry_count += 1;
                if retry_count > 10 {
                    return Err(e.to_string());
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        let mut file = match tokio::fs::OpenOptions::new()
            .write(true)
            .open(&dest_path)
            .await
        {
            Ok(file) => file,
            Err(e) => {
                retry_count += 1;
                if retry_count > 5 {
                    return Err(format!("Failed to open download file: {}", e));
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                continue;
            }
        };
        if let Err(e) = file.seek(std::io::SeekFrom::Start(current_start)).await {
            return Err(format!("Failed to seek: {}", e));
        }

        let mut success = true;
        let mut local_downloaded = current_downloaded;
        let mut last_save = std::time::Instant::now();

        while let Some(chunk_res) = resp.chunk().await.transpose() {
            if cancel.load(Ordering::Relaxed) || pause.load(Ordering::Relaxed) {
                return Err("Stopped".to_string());
            }
            match chunk_res {
                Ok(chunk) => {
                    let received = local_downloaded.saturating_sub(current_downloaded);
                    let remaining = end_byte
                        .saturating_add(1)
                        .saturating_sub(current_start)
                        .saturating_sub(received);
                    if chunk.len() as u64 > remaining {
                        return Err(
                            "Range unsupported: server sent more bytes than requested".to_string()
                        );
                    }
                    if file.write_all(&chunk).await.is_err() {
                        success = false;
                        break;
                    }
                    dl_counter.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                    local_downloaded += chunk.len() as u64;

                    if last_save.elapsed().as_secs() >= 2 {
                        let mut s = state.lock().await;
                        s.parts_downloaded[part_index] = local_downloaded;
                        save_state(&state_path, &s).await;
                        last_save = std::time::Instant::now();
                    }
                }
                Err(_) => {
                    success = false;
                    break;
                }
            }
        }

        // Final save for this attempt
        {
            let mut s = state.lock().await;
            s.parts_downloaded[part_index] = local_downloaded;
            save_state(&state_path, &s).await;
        }

        let expected_remaining = end_byte.saturating_add(1).saturating_sub(current_start);
        if success && local_downloaded.saturating_sub(current_downloaded) == expected_remaining {
            return Ok(());
        } else {
            retry_count += 1;
            if retry_count > 15 {
                return Err("Failed after 15 chunk retries".to_string());
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    }
}

pub async fn download_file_stream_reqwest(
    client: &Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    label: &str,
    progress_start: f64,
    progress_end: f64,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    num_parts: usize,
    total_size: Option<u64>,
    accumulated_time: u64,
) -> Result<(), (String, u64)> {
    use std::time::{Duration, Instant};

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| (e.to_string(), accumulated_time))?;
    }

    let num_parts = num_parts.max(1);
    let use_parallel = total_size
        .map(|s| s > 1 * 1024 * 1024 && num_parts > 1)
        .unwrap_or(false);

    if !use_parallel {
        // Resume a single-connection download from its last flushed byte. If
        // the server ignores Range (or the saved range is stale), restart from
        // the full response without appending duplicate or shifted bytes.
        let start_time = Instant::now();
        let state_path = dest.with_extension("state");
        let state_matches = tokio::fs::read_to_string(&state_path)
            .await
            .is_ok_and(|state| state == format!("single:{}", url));
        let mut partial_size = if state_matches {
            tokio::fs::symlink_metadata(dest)
                .await
                .ok()
                .filter(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
                .map(|metadata| metadata.len())
                .unwrap_or_default()
        } else {
            0
        };
        if total_size.is_some_and(|size| partial_size > size) {
            partial_size = 0;
        }
        if partial_size > 0 && total_size == Some(partial_size) {
            let _ = tokio::fs::remove_file(&state_path).await;
            let _ = app.emit(
                "activation-progress",
                ProgressPayload {
                    percent: progress_end,
                    label: format!("{} · Done ✓", label),
                },
            );
            return Ok(());
        }

        let initial_request = if partial_size > 0 {
            client
                .get(url)
                .header(reqwest::header::RANGE, format!("bytes={}-", partial_size))
        } else {
            client.get(url)
        };
        let mut resp = match send_with_control(initial_request, &cancel, &pause).await {
            Ok(Some(response)) => response,
            Ok(None) if cancel.load(Ordering::Relaxed) => {
                return Err(("Cancelled".to_string(), accumulated_time));
            }
            Ok(None) => return Err(("Resumed".to_string(), accumulated_time)),
            Err(error) => {
                return Err((
                    format!("Retry|{}", error),
                    accumulated_time + start_time.elapsed().as_secs(),
                ));
            }
        };

        let mut resume_from = 0;
        if partial_size > 0
            && resp.status() == reqwest::StatusCode::PARTIAL_CONTENT
            && content_range_start_matches(&resp, partial_size, total_size)
        {
            resume_from = partial_size;
        } else if partial_size > 0 && resp.status() != reqwest::StatusCode::OK {
            // A stale/unsupported range should not cause us to append an
            // invalid response. Request a clean copy instead.
            resp = match send_with_control(client.get(url), &cancel, &pause).await {
                Ok(Some(response)) => response,
                Ok(None) if cancel.load(Ordering::Relaxed) => {
                    return Err(("Cancelled".to_string(), accumulated_time));
                }
                Ok(None) => return Err(("Resumed".to_string(), accumulated_time)),
                Err(error) => {
                    return Err((
                        format!("Retry|{}", error),
                        accumulated_time + start_time.elapsed().as_secs(),
                    ));
                }
            };
        }

        if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT && resume_from == 0 {
            // The server returned a partial response even though no valid
            // offset was accepted. Fall back to a full request.
            resp = match send_with_control(client.get(url), &cancel, &pause).await {
                Ok(Some(response)) => response,
                Ok(None) if cancel.load(Ordering::Relaxed) => {
                    return Err(("Cancelled".to_string(), accumulated_time));
                }
                Ok(None) => return Err(("Resumed".to_string(), accumulated_time)),
                Err(error) => {
                    return Err((
                        format!("Retry|{}", error),
                        accumulated_time + start_time.elapsed().as_secs(),
                    ));
                }
            };
        }
        if !resp.status().is_success() {
            if resp.status().is_server_error()
                || resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            {
                return Err((
                    format!("Retry|HTTP error: {}", resp.status()),
                    accumulated_time + start_time.elapsed().as_secs(),
                ));
            }
            return Err((format!("HTTP error: {}", resp.status()), accumulated_time));
        }

        let file = match tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(resume_from == 0)
            .open(dest)
            .await
        {
            Ok(file) => file,
            Err(error) => {
                if resume_from == 0 {
                    let _ = tokio::fs::remove_file(&state_path).await;
                }
                return Err((error.to_string(), accumulated_time));
            }
        };
        let mut file = file;
        if resume_from > 0 {
            file.seek(std::io::SeekFrom::Start(resume_from))
                .await
                .map_err(|error| {
                    (
                        format!("Failed to seek in partial download: {}", error),
                        accumulated_time,
                    )
                })?;
        }
        if let Err(error) = tokio::fs::write(&state_path, format!("single:{}", url)).await {
            drop(file);
            if resume_from == 0 {
                let _ = tokio::fs::remove_file(dest).await;
                let _ = tokio::fs::remove_file(&state_path).await;
            }
            return Err((
                format!("Failed to write download marker: {}", error),
                accumulated_time,
            ));
        }
        let mut writer = tokio::io::BufWriter::with_capacity(1024 * 1024, file);
        let mut total_downloaded = resume_from;

        loop {
            let chunk_result = tokio::select! {
                result = resp.chunk() => Some(result),
                _ = tokio::time::sleep(Duration::from_millis(200)) => None,
            };
            let Some(chunk_result) = chunk_result else {
                if cancel.load(Ordering::Relaxed) {
                    let _ = writer.flush().await;
                    return Err((
                        "Cancelled".to_string(),
                        accumulated_time + start_time.elapsed().as_secs(),
                    ));
                }
                if pause.load(Ordering::Relaxed) {
                    writer.flush().await.map_err(|e| {
                        (
                            e.to_string(),
                            accumulated_time + start_time.elapsed().as_secs(),
                        )
                    })?;
                    return Err((
                        "Resumed".to_string(),
                        accumulated_time + start_time.elapsed().as_secs(),
                    ));
                }
                continue;
            };
            let chunk = chunk_result.map_err(|e| {
                (
                    format!("Retry|{}", e),
                    accumulated_time + start_time.elapsed().as_secs(),
                )
            })?;
            let Some(chunk) = chunk else {
                break;
            };
            if cancel.load(Ordering::Relaxed) {
                let _ = writer.flush().await;
                return Err((
                    "Cancelled".to_string(),
                    accumulated_time + start_time.elapsed().as_secs(),
                ));
            }
            if pause.load(Ordering::Relaxed) {
                writer.flush().await.map_err(|e| {
                    (
                        e.to_string(),
                        accumulated_time + start_time.elapsed().as_secs(),
                    )
                })?;
                return Err((
                    "Resumed".to_string(),
                    accumulated_time + start_time.elapsed().as_secs(),
                ));
            }

            writer.write_all(&chunk).await.map_err(|e| {
                (
                    e.to_string(),
                    accumulated_time + start_time.elapsed().as_secs(),
                )
            })?;
            total_downloaded += chunk.len() as u64;

            let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
            let downloaded_this_attempt = total_downloaded.saturating_sub(resume_from);
            let speed = (downloaded_this_attempt as f64 / 1_048_576.0) / elapsed;
            let mb = total_downloaded as f64 / 1_048_576.0;
            let total_elapsed = accumulated_time as f64 + elapsed;

            let (pct, text) = if let Some(total) = total_size {
                let frac = (total_downloaded as f64 / total as f64).min(1.0);
                let p = progress_start + (progress_end - progress_start) * frac;
                (
                    p,
                    format!(
                        "{} · {:.1}/{:.1} MB · {:.2} MB/s [{}]",
                        label,
                        mb,
                        total as f64 / 1_048_576.0,
                        speed,
                        format_time(total_elapsed.round() as u64)
                    ),
                )
            } else {
                (
                    progress_start,
                    format!(
                        "{} · {:.1} MB · {:.2} MB/s [{}]",
                        label,
                        mb,
                        speed,
                        format_time(total_elapsed.round() as u64)
                    ),
                )
            };
            let _ = app.emit(
                "activation-progress",
                ProgressPayload {
                    percent: pct,
                    label: text,
                },
            );
        }

        writer.flush().await.map_err(|e| {
            (
                e.to_string(),
                accumulated_time + start_time.elapsed().as_secs(),
            )
        })?;

        if let Some(expected) = total_size {
            if total_downloaded != expected {
                if total_downloaded > expected {
                    let _ = tokio::fs::remove_file(dest).await;
                    let _ = tokio::fs::remove_file(&state_path).await;
                }
                return Err((
                    format!(
                        "Retry|Incomplete download: received {} of {} bytes",
                        total_downloaded, expected
                    ),
                    accumulated_time + start_time.elapsed().as_secs(),
                ));
            }
        }

        let _ = tokio::fs::remove_file(&state_path).await;

        let _ = app.emit(
            "activation-progress",
            ProgressPayload {
                percent: progress_end,
                label: format!("{} · Done ✓", label),
            },
        );

        return Ok(());
    }

    let Some(total) = total_size else {
        return Err((
            "Parallel download requested without a known file size".to_string(),
            accumulated_time,
        ));
    };
    let chunk_size = total / num_parts as u64;
    let state_path = dest.with_extension("state");

    // Pre-allocate the file using set_len to avoid merging later
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .open(dest)
        .map_err(|e| (format!("Failed to create file: {}", e), accumulated_time))?;

    file.set_len(total)
        .map_err(|e| (format!("Failed to allocate file: {}", e), accumulated_time))?;

    let download_state = load_state(&state_path, num_parts, total, url, chunk_size).await;
    let state_arc = Arc::new(tokio::sync::Mutex::new(download_state.clone()));

    let initial_total_downloaded: u64 = download_state.parts_downloaded.iter().sum();
    let total_downloaded = Arc::new(AtomicU64::new(initial_total_downloaded));

    let error_msg = Arc::new(tokio::sync::Mutex::new(None));
    let mut tasks = Vec::new();

    for i in 0..num_parts {
        let base_start_byte = i as u64 * chunk_size;
        let end_byte = if i == num_parts - 1 {
            total - 1
        } else {
            (i as u64 + 1) * chunk_size - 1
        };

        let url_clone = url.to_string();
        let client_clone = client.clone();
        let cancel_clone = cancel.clone();
        let pause_clone = pause.clone();
        let dl_counter = total_downloaded.clone();
        let err_clone = error_msg.clone();
        let dest_clone = dest.to_path_buf();
        let state_path_clone = state_path.clone();
        let state_clone = state_arc.clone();

        let task = tokio::spawn(async move {
            if let Err(e) = download_chunk(
                client_clone,
                url_clone,
                i,
                base_start_byte,
                end_byte,
                dest_clone,
                state_path_clone,
                state_clone,
                cancel_clone,
                pause_clone,
                dl_counter,
            )
            .await
            {
                let mut lock = err_clone.lock().await;
                if lock.is_none() {
                    *lock = Some(e);
                }
            }
        });

        tasks.push(task);
    }

    let _ = app.emit(
        "activation-progress",
        ProgressPayload {
            percent: progress_start,
            label: format!("{} · Resuming/Starting", label),
        },
    );

    let start_time = Instant::now();

    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;

        if pause.load(Ordering::Relaxed) {
            abort_and_join(&mut tasks).await;
            while pause.load(Ordering::Relaxed) {
                if cancel.load(Ordering::Relaxed) {
                    let current_elapsed = start_time.elapsed().as_secs();
                    return Err(("Cancelled".to_string(), accumulated_time + current_elapsed));
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            let current_elapsed = start_time.elapsed().as_secs();
            return Err(("Resumed".to_string(), accumulated_time + current_elapsed));
        }

        if cancel.load(Ordering::Relaxed) {
            abort_and_join(&mut tasks).await;
            let current_elapsed = start_time.elapsed().as_secs();
            return Err(("Cancelled".to_string(), accumulated_time + current_elapsed));
        }

        let err_lock = error_msg.lock().await.clone();
        if let Some(err) = err_lock {
            abort_and_join(&mut tasks).await;
            let current_elapsed = start_time.elapsed().as_secs();
            if err == "Stopped" {
                return Err(("Resumed".to_string(), accumulated_time + current_elapsed));
            }
            if err.starts_with("Range unsupported:") {
                return Err((
                    format!("Fallback|{}", err),
                    accumulated_time + current_elapsed,
                ));
            }
            return Err((format!("Retry|{}", err), accumulated_time + current_elapsed));
        }

        let current_dl = total_downloaded.load(Ordering::Relaxed);
        let frac = (current_dl as f64 / total as f64).min(1.0);
        let current_pct = progress_start + (progress_end - progress_start) * frac;
        let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
        let total_elapsed = accumulated_time as f64 + elapsed;
        let session_downloaded = current_dl.saturating_sub(initial_total_downloaded);
        let speed = (session_downloaded as f64 / 1_048_576.0) / elapsed;
        let mb_dl = current_dl as f64 / 1_048_576.0;
        let mb_tot = total as f64 / 1_048_576.0;

        let _ = app.emit(
            "activation-progress",
            ProgressPayload {
                percent: current_pct,
                label: format!(
                    "{} · {:.1}/{:.1} MB · {:.2} MB/s [{}]",
                    label,
                    mb_dl,
                    mb_tot,
                    speed,
                    format_time(total_elapsed.round() as u64)
                ),
            },
        );

        let mut all_done = true;
        for t in &tasks {
            if !t.is_finished() {
                all_done = false;
                break;
            }
        }
        if all_done {
            if pause.load(Ordering::Relaxed) {
                continue;
            }
            break;
        }
    }

    for task in tasks {
        if let Err(e) = task.await {
            return Err((
                format!("Download worker failed: {}", e),
                accumulated_time + start_time.elapsed().as_secs(),
            ));
        }
    }

    let _ = tokio::fs::remove_file(&state_path).await;

    let _ = app.emit(
        "activation-progress",
        ProgressPayload {
            percent: progress_end,
            label: format!("{} · Done ✓", label),
        },
    );

    Ok(())
}

#[cfg(test)]
mod content_range_tests {
    use super::parse_content_range;

    #[test]
    fn parses_only_complete_valid_content_ranges() {
        assert_eq!(parse_content_range("bytes 50-99/100"), Some((50, 99, 100)));
        assert_eq!(parse_content_range("bytes */100"), None);
        assert_eq!(parse_content_range("bytes 50-99/*"), None);
        assert_eq!(parse_content_range("bytes 99-50/100"), None);
        assert_eq!(parse_content_range("items 50-99/100"), None);
    }
}
