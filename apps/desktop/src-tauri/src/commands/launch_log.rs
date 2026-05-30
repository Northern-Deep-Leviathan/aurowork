//! Tauri commands exposing the launch log to the frontend.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::dev_mode;
use crate::dev_mode_flag;
use crate::launch_log::format::Level;
use crate::launch_log::LaunchLogAggregator;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogEntry {
    pub tag: String,
    pub level: String, // "trace" | "debug" | "info" | "warn" | "error"
    pub message: String,
    pub stack: Option<String>,
    /// Milliseconds since Unix epoch captured by the UI at the moment
    /// `launchLog()` was called. Optional for backwards compatibility:
    /// older callers that don't supply this fall back to the aggregator's
    /// "stamp at write time" behavior. When set, this is the authoritative
    /// timestamp written to the log file.
    pub timestamp_ms: Option<i64>,
}

fn parse_level(value: &str) -> Level {
    match value.to_ascii_lowercase().as_str() {
        "trace" => Level::Trace,
        "debug" => Level::Debug,
        "warn" | "warning" => Level::Warn,
        "error" => Level::Error,
        _ => Level::Info,
    }
}

#[tauri::command]
pub fn launch_log_append(
    aggregator: State<'_, LaunchLogAggregator>,
    entry: LaunchLogEntry,
) -> Result<(), String> {
    aggregator.append_with_ts(
        parse_level(&entry.level),
        &entry.tag,
        None,
        &entry.message,
        entry.stack.as_deref(),
        entry.timestamp_ms,
    );
    Ok(())
}

#[tauri::command]
pub fn launch_log_append_batch(
    aggregator: State<'_, LaunchLogAggregator>,
    entries: Vec<LaunchLogEntry>,
) -> Result<(), String> {
    for entry in entries {
        aggregator.append_with_ts(
            parse_level(&entry.level),
            &entry.tag,
            None,
            &entry.message,
            entry.stack.as_deref(),
            entry.timestamp_ms,
        );
    }
    Ok(())
}

#[tauri::command]
pub fn launch_log_path(aggregator: State<'_, LaunchLogAggregator>) -> Option<String> {
    aggregator.path().map(|p| p.to_string_lossy().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSummary {
    pub shell_ms: Option<u128>,
    pub orchestr_ms: Option<u128>,
    pub engine_ms: Option<u128>,
    pub server_ms: Option<u128>,
    pub ui_ms: Option<u128>,
}

#[tauri::command]
pub fn launch_log_summary(
    aggregator: State<'_, LaunchLogAggregator>,
    summary: LaunchSummary,
) -> Result<(), String> {
    let total_ms = aggregator.elapsed_ms().unwrap_or(0);
    let msg = format!(
        "=== launch summary === shell={s:?}ms orchestr={o:?}ms engine={e:?}ms server={sv:?}ms ui={u:?}ms total={total_ms}ms",
        s = summary.shell_ms,
        o = summary.orchestr_ms,
        e = summary.engine_ms,
        sv = summary.server_ms,
        u = summary.ui_ms,
    );
    aggregator.append(Level::Info, "launch:shell", Some(std::process::id()), &msg, None);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevModeInfo {
    pub enabled: bool,
    pub log_file_path: Option<String>,
}

#[tauri::command]
pub fn dev_mode_info(aggregator: State<'_, LaunchLogAggregator>) -> DevModeInfo {
    // `enabled` reports whether the launch log is recording for this
    // session. The aggregator already knows: if init was called with
    // `enabled=false` (i.e. neither AUROWORK_DEV_MODE/debug build nor the
    // sticky developer-mode flag was set when this process started),
    // `path()` returns None. The frontend uses this to decide whether
    // to ship UI entries via IPC.
    DevModeInfo {
        enabled: aggregator.path().is_some(),
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn open_launch_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open log folder: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogStatusDto {
    pub log_file_path: Option<String>,
}

/// Returns the current launch log file path (if any). Called by the
/// Debug-tab panel to populate the "Last launch log" display.
#[tauri::command]
pub fn launch_log_status(aggregator: State<'_, LaunchLogAggregator>) -> LaunchLogStatusDto {
    LaunchLogStatusDto {
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn launch_log_mark_complete(aggregator: State<'_, LaunchLogAggregator>) -> Result<(), String> {
    aggregator.mark_complete();
    Ok(())
}

/// Persist (or clear) the sticky "developer mode" flag in the app data
/// dir. When set, the next launch will open a launch log file
/// regardless of build flavor. Called by the frontend's
/// `toggleDeveloperMode` so the choice survives restarts.
#[tauri::command]
pub fn set_developer_mode_persistent(app: AppHandle, enabled: bool) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    if enabled {
        dev_mode_flag::enable(&dir).map_err(|e| format!("Failed to enable developer mode: {e}"))
    } else {
        dev_mode_flag::disable(&dir).map_err(|e| format!("Failed to disable developer mode: {e}"))
    }
}

/// Read the sticky "developer mode" flag. Called by the frontend at
/// startup to initialize its in-memory `developerMode` signal so the UI
/// matches the launch-log decision Rust already made in `setup`.
#[tauri::command]
pub fn get_developer_mode_persistent(app: AppHandle) -> Result<bool, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    // Tolerate either source of truth: the sticky flag OR the build-time
    // env/debug-assertion (`dev_mode::is_enabled()`). The latter is the
    // historical "always on" case for debug builds; we don't want users
    // running a dev build to see Developer Mode reported as "off" simply
    // because the flag file was never written.
    Ok(dev_mode::is_enabled() || dev_mode_flag::is_set(&dir))
}
