use std::fs::OpenOptions;
use std::io::Write;

const DEBUG_LOG_PATH: &str = "/tmp/aurowork-debug.log";
const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

#[tauri::command]
pub fn debug_log_append(lines: Vec<String>) -> Result<(), String> {
    // Rotate if file exceeds max size
    if let Ok(meta) = std::fs::metadata(DEBUG_LOG_PATH) {
        if meta.len() > MAX_LOG_SIZE {
            let _ = std::fs::remove_file(DEBUG_LOG_PATH);
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(DEBUG_LOG_PATH)
        .map_err(|e| format!("Failed to open debug log: {e}"))?;

    for line in &lines {
        writeln!(file, "{}", line).map_err(|e| format!("Failed to write debug log: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn debug_log_clear() -> Result<(), String> {
    if std::path::Path::new(DEBUG_LOG_PATH).exists() {
        std::fs::remove_file(DEBUG_LOG_PATH)
            .map_err(|e| format!("Failed to clear debug log: {e}"))?;
    }
    Ok(())
}
