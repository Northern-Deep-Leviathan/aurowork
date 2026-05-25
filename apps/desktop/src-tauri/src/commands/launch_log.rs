//! Tauri commands exposing the launch log to the frontend.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::dev_mode;
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
pub fn dev_mode_info(
    aggregator: State<'_, LaunchLogAggregator>,
    diagnostic_status: State<'_, LaunchDiagnosticStatus>,
) -> DevModeInfo {
    DevModeInfo {
        // `enabled` reports whether the launch log is recording for this
        // session — true whenever dev mode is on OR this launch was
        // triggered by an armed diagnostic. The frontend uses this to
        // decide whether to ship UI entries via IPC.
        enabled: dev_mode::is_enabled() || diagnostic_status.armed_on_startup,
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

/// Process-wide state recording whether THIS launch was triggered by an
/// armed diagnostic flag. Captured in `lib::run().setup()` before the
/// flag is deleted, then read by the frontend at boot time.
pub struct LaunchDiagnosticStatus {
    pub armed_on_startup: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDiagnosticStatusDto {
    pub armed_on_startup: bool,
    pub log_file_path: Option<String>,
}

/// Arm the one-shot diagnostic flag. The next launch will write a
/// launch log file regardless of dev mode. Caller is expected to
/// trigger an app restart immediately after.
#[tauri::command]
pub fn arm_launch_diagnostic(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    crate::diagnostic_flag::set(&dir).map_err(|e| format!("Failed to arm diagnostic: {e}"))
}

/// Read whether this launch was diagnostic-triggered, and the current
/// launch log file path (if any). Called by the frontend on boot to
/// decide whether to show the "diagnostic captured" toast, and by the
/// Debug-tab panel to populate the "Last diagnostic" display.
#[tauri::command]
pub fn launch_diagnostic_status(
    status: State<'_, LaunchDiagnosticStatus>,
    aggregator: State<'_, LaunchLogAggregator>,
) -> LaunchDiagnosticStatusDto {
    LaunchDiagnosticStatusDto {
        armed_on_startup: status.armed_on_startup,
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn launch_log_mark_complete(aggregator: State<'_, LaunchLogAggregator>) -> Result<(), String> {
    aggregator.mark_complete();
    Ok(())
}
