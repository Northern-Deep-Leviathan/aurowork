use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub ext: Option<String>,
}

#[tauri::command]
pub async fn fs_read_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(dir_path).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path();
        let full_path = entry_path.to_string_lossy().to_string();
        let extension = entry_path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_string());

        entries.push(FsEntry {
            name,
            path: full_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            ext: extension,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn fs_read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file {}: {}", path, e))
}
