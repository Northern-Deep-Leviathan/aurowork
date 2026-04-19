use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

// ── Error model ──

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code")]
pub enum FsError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    PermissionDenied { message: String },
    #[error("{message}")]
    NotSupported { message: String },
    #[error("{message}")]
    Conflict { message: String },
    #[error("{message}")]
    InvalidRequest { message: String },
    #[error("{message}")]
    Internal { message: String },
}

impl From<std::io::Error> for FsError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound { message: e.to_string() },
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied { message: e.to_string() },
            _ => FsError::Internal { message: e.to_string() },
        }
    }
}

// ── Revision tracking ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileRevision {
    pub mtime_ms: u64,
    pub size: u64,
}

// ── Read request/response ──

#[derive(Deserialize)]
pub struct FsReadRequest {
    pub path: String,
    pub sheet_window: Option<SheetWindowRequest>,
}

#[derive(Deserialize)]
pub struct SheetWindowRequest {
    pub start_row: u32,
    pub start_col: u32,
    pub max_rows: u32,
    pub max_cols: u32,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum FsReadResponse {
    #[serde(rename = "text")]
    Text {
        content: String,
        revision: FileRevision,
    },
    #[serde(rename = "sheet")]
    Sheet {
        content: WorkbookData,
        capabilities: SheetCapabilities,
        revision: FileRevision,
    },
    #[serde(rename = "binary")]
    Binary {
        mime: Option<String>,
        reason: String,
    },
}

#[derive(Serialize, Clone)]
pub struct SheetCapabilities {
    pub can_edit_cells: bool,
    pub can_save: bool,
    pub format: String,
}

// ── Workbook transport (sparse) ──

#[derive(Serialize, Clone)]
pub struct WorkbookData {
    pub sheets: Vec<SheetData>,
}

#[derive(Serialize, Clone)]
pub struct SheetData {
    pub name: String,
    pub max_row: u32,
    pub max_col: u32,
    pub cells: Vec<CellRef>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CellRef {
    pub row: u32,
    pub col: u32,
    pub value: String,
    pub cell_type: Option<String>,
}

// ── Write request/response ──

#[derive(Deserialize)]
pub struct FsWriteRequest {
    pub path: String,
    pub expected_revision: Option<FileRevision>,
    pub payload: WritePayload,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum WritePayload {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "sheet")]
    Sheet { deltas: Vec<CellDelta> },
}

#[derive(Deserialize)]
pub struct CellDelta {
    pub sheet: String,
    pub cell: CellRef,
}

#[derive(Serialize)]
pub struct FsWriteResponse {
    pub revision: FileRevision,
}

// ── File-type detection ──

const TEXT_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
    "json", "jsonc", "json5", "yaml", "yml", "toml",
    "md", "mdx", "txt", "xml", "html", "htm",
    "css", "scss", "sass", "less", "graphql", "gql", "sql",
    "ini", "cfg", "conf", "env",
    "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
    "rb", "php", "swift", "kt", "scala", "r",
    "sh", "bash", "zsh", "fish", "ps1",
    "svg", "csv", "tsv", "log",
];

const PREDEFINED_TEST_FILES: &[&str] = &[
    "Dockerfile", "Makefile", "Vagrantfile", "Rakefile", "Gemfile",
    "Procfile", "Justfile",
    ".gitignore", ".gitattributes", ".editorconfig",
    ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc", ".env",
    ".dockerignore", ".prettierignore", ".eslintignore",
];

const SHEET_EXTENSIONS: &[&str] = &["xlsx", "xlsm"];

const UNSUPPORTED_SHEET_EXTENSIONS: &[&str] = &["xls", "xlsb", "ods", "numbers"];

#[derive(Debug, PartialEq)]
enum FileType {
    Text,
    Sheet,
    UnsupportedSheet,
    Binary,
}

fn detect_file_type(path: &Path) -> FileType {
    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    if PREDEFINED_TEST_FILES.contains(&filename) {
        return FileType::Text;
    }

    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext.is_empty() {
        return FileType::Text;
    }

    if SHEET_EXTENSIONS.contains(&ext.as_str()) {
        FileType::Sheet
    }
    else if UNSUPPORTED_SHEET_EXTENSIONS.contains(&ext.as_str()) {
        FileType::UnsupportedSheet
    }
    else if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        FileType::Text
    }
    else {
        // Fallback to binary for unknown extensions
        FileType::Binary
    }
}

/// Guardrail for validation of file write requests, prevent mismatches between file types and payloads
fn guard_file_write(file_type: &FileType, payload: &WritePayload) -> Result<(), FsError> {
    match payload {
        WritePayload::Text { .. } => {
            if *file_type != FileType::Text {
                return Err(FsError::NotSupported {
                    message: format!("Cannot save {:?} as text", file_type),
                });
            }
            Ok(())
        }
        WritePayload::Sheet { .. } => {
            if *file_type != FileType::Sheet {
                return Err(FsError::NotSupported {
                    message: format!("Cannot save {:?} as spreadsheet", file_type),
                });
            }
            Ok(())
        }
    }
}

fn get_revision(path: &Path) -> Result<FileRevision, FsError> {
    let meta = std::fs::metadata(path)?;
    let mtime_ms = meta.modified()
        .map_err(|e| FsError::Internal { message: format!("Failed to get mtime: {}", e) })?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileRevision {
        mtime_ms,
        size: meta.len(),
    })
}

fn check_revision_conflict(
    path: &Path,
    expected: &Option<FileRevision>,
) -> Result<(), FsError> {
    if let Some(expected) = expected {
        let current = get_revision(path)?;
        if current.mtime_ms != expected.mtime_ms || current.size != expected.size {
            return Err(FsError::Conflict {
                message: format!(
                    "File changed on disk. Expected mtime={} size={}, got mtime={} size={}",
                    expected.mtime_ms, expected.size, current.mtime_ms, current.size
                ),
            });
        }
    }
    Ok(())
}

// ── Atomic write helper ──

fn atomic_write_with_lock(
    target: &Path,
    expected_revision: Option<&FileRevision>,
    write_fn: impl FnOnce(&Path) -> Result<(), FsError>,
) -> Result<FileRevision, FsError> {
    let parent = target.parent().ok_or_else(|| FsError::InvalidRequest {
        message: "Cannot determine parent directory".into(),
    })?;

    // 1. Generate temp file path in same directory
    let temp_name = format!(
        ".{}.tmp.{}",
        target.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        uuid::Uuid::new_v4()
    );
    let temp_path = parent.join(&temp_name);

    // 2. Write content to temp file
    if let Err(e) = write_fn(&temp_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(e);
    }

    // 3. fsync the temp file
    {
        let f = std::fs::File::open(&temp_path)?;
        f.sync_all()?;
    }

    // 4. Branch: existing file vs new file
    match std::fs::File::open(target) {
        Ok(file) => {
            // EXISTING FILE path: lock → revision check → rename
            let temp_path_clone = temp_path.clone();
            with_exclusive_lock(file, || {
                if let Some(expected) = expected_revision {
                    let current = get_revision(target)?;
                    if current.mtime_ms != expected.mtime_ms || current.size != expected.size {
                        let _ = std::fs::remove_file(&temp_path_clone);
                        return Err(FsError::Conflict {
                            message: format!(
                                "File changed on disk. Expected mtime={} size={}, got mtime={} size={}",
                                expected.mtime_ms, expected.size, current.mtime_ms, current.size
                            ),
                        });
                    }
                }
                std::fs::rename(&temp_path_clone, target)?;
                Ok(())
            })?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Err(_) = exclusive_rename(&temp_path, target) {
                let file = std::fs::File::open(target)?;
                let temp_path_clone = temp_path.clone();
                with_exclusive_lock(file, || {
                    if let Some(expected) = expected_revision {
                        let current = get_revision(target)?;
                        if current.mtime_ms != expected.mtime_ms || current.size != expected.size {
                            let _ = std::fs::remove_file(&temp_path_clone);
                            return Err(FsError::Conflict {
                                message: "File was created concurrently".into(),
                            });
                        }
                    }
                    std::fs::rename(&temp_path_clone, target)?;
                    Ok(())
                })?;
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(FsError::from(e));
        }
    }

    get_revision(target)
}

fn with_exclusive_lock<R>(
    file: std::fs::File,
    under_lock: impl FnOnce() -> Result<R, FsError>,
) -> Result<R, FsError> {
    let mut lock = fd_lock::RwLock::new(file);
    let max_attempts = 100; // 100 * 50ms = 5s
    for attempt in 0..max_attempts {
        match lock.try_write() {
            Ok(_guard) => {
                return under_lock();
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if attempt == max_attempts - 1 {
                    return Err(FsError::Conflict {
                        message: "File is locked by another operation".into(),
                    });
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(FsError::Internal { message: format!("Lock failed: {}", e) }),
        }
    }
    Err(FsError::Conflict {
        message: "File is locked by another operation".into(),
    })
}

#[cfg(unix)]
fn exclusive_rename(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let src_c = CString::new(src.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let dst_c = CString::new(dst.as_os_str().as_bytes())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    let ret = unsafe {
        libc::linkat(
            libc::AT_FDCWD, src_c.as_ptr(),
            libc::AT_FDCWD, dst_c.as_ptr(),
            0,
        )
    };
    if ret != 0 {
        return Err(std::io::Error::last_os_error());
    }
    std::fs::remove_file(src)?;
    Ok(())
}

#[cfg(windows)]
fn exclusive_rename(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    let src_w: Vec<u16> = src.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let dst_w: Vec<u16> = dst.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let ret = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            src_w.as_ptr(),
            dst_w.as_ptr(),
            0,
        )
    };
    if ret == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

// ── Workbook translation helpers ──

fn translate_workbook(
    workbook: &umya_spreadsheet::Spreadsheet,
    window: Option<&SheetWindowRequest>,
) -> WorkbookData {
    let default_max_rows: u32 = 500;
    let default_max_cols: u32 = 200;

    let start_row = window.map_or(1, |w| w.start_row.max(1));
    let start_col = window.map_or(1, |w| w.start_col.max(1));
    let max_rows = window.map_or(default_max_rows, |w| w.max_rows);
    let max_cols = window.map_or(default_max_cols, |w| w.max_cols);

    let sheets = workbook
        .get_sheet_collection()
        .iter()
        .map(|sheet| {
            let (highest_col, highest_row) = sheet.get_highest_column_and_row();

            let end_row = highest_row.min(start_row.saturating_add(max_rows).saturating_sub(1));
            let end_col = highest_col.min(start_col.saturating_add(max_cols).saturating_sub(1));

            let mut cells = Vec::new();

            for (&(col, row), cell) in sheet.get_collection_to_hashmap() {
                if row < start_row || row > end_row || col < start_col || col > end_col {
                    continue;
                }
                let cv = cell.get_cell_value();
                if cv.is_empty() {
                    continue;
                }

                let cell_type = if cv.is_formula() {
                    "formula"
                } else {
                    match cv.get_data_type() {
                        "n" => "number",
                        "b" => "boolean",
                        _ => "string",
                    }
                };

                let value = if cv.is_formula() {
                    format!("={}", cv.get_formula())
                } else {
                    cv.get_value().to_string()
                };

                cells.push(CellRef {
                    row,
                    col,
                    value,
                    cell_type: Some(cell_type.to_string()),
                });
            }

            SheetData {
                name: sheet.get_name().to_string(),
                max_row: highest_row,
                max_col: highest_col,
                cells,
            }
        })
        .collect();

    WorkbookData { sheets }
}

fn apply_deltas(
    workbook: &mut umya_spreadsheet::Spreadsheet,
    deltas: &[CellDelta],
) -> Result<(), FsError> {
    for delta in deltas {
        let sheet = workbook
            .get_sheet_by_name_mut(&delta.sheet)
            .ok_or_else(|| FsError::InvalidRequest {
                message: format!("Sheet not found: {}", delta.sheet),
            })?;

        let col = delta.cell.col;
        let row = delta.cell.row;
        let cv = sheet.get_cell_value_mut((col, row));

        let cell_type = delta.cell.cell_type.as_deref().unwrap_or_else(|| {
            // Infer type from value
            let v = &delta.cell.value;
            if v.starts_with('=') {
                "formula"
            } else if v.parse::<f64>().is_ok() {
                "number"
            } else if v == "true" || v == "false" {
                "boolean"
            } else {
                "string"
            }
        });

        match cell_type {
            "number" => {
                if let Ok(n) = delta.cell.value.parse::<f64>() {
                    cv.set_value_number(n);
                } else {
                    cv.set_value_string(&delta.cell.value);
                }
            }
            "boolean" => {
                cv.set_value_bool(delta.cell.value == "true");
            }
            "formula" => {
                let formula = delta.cell.value.strip_prefix('=').unwrap_or(&delta.cell.value);
                cv.set_formula(formula);
            }
            _ => {
                cv.set_value_string(&delta.cell.value);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_read_file(req: FsReadRequest) -> Result<FsReadResponse, FsError> {
    let path = Path::new(&req.path);

    if !path.exists() {
        return Err(FsError::NotFound {
            message: format!("File not found: {}", req.path),
        });
    }
    if path.is_dir() {
        return Err(FsError::InvalidRequest {
            message: format!("Path is a directory: {}", req.path),
        });
    }

    match detect_file_type(path) {
        FileType::Text => {
            let revision = get_revision(path)?;
            let content = std::fs::read_to_string(path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to read as text: {}", e),
                }
            })?;
            Ok(FsReadResponse::Text { content, revision })
        }
        FileType::Sheet => {
            let revision = get_revision(path)?;
            let book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to read spreadsheet: {}", e),
                }
            })?;
            let content = translate_workbook(&book, req.sheet_window.as_ref());
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("xlsx")
                .to_lowercase();
            let capabilities = SheetCapabilities {
                can_edit_cells: true,
                can_save: true,
                format: ext,
            };
            Ok(FsReadResponse::Sheet { content, capabilities, revision })
        }
        FileType::UnsupportedSheet => Ok(FsReadResponse::Binary {
            mime: None,
            reason: "Unsupported spreadsheet format in this phase".to_string(),
        }),
        FileType::Binary => Ok(FsReadResponse::Binary {
            mime: None,
            reason: "Binary file".to_string(),
        }),
    }
}

#[tauri::command]
pub async fn fs_write_file(req: FsWriteRequest) -> Result<FsWriteResponse, FsError> {
    let path = Path::new(&req.path);
    let file_type = detect_file_type(path);

    // Guardrail to prevent writing to mismatched file types.
    guard_file_write(&file_type, &req.payload)?;
    
    check_revision_conflict(path, &req.expected_revision)?;

    match req.payload {
        WritePayload::Text { content } => {
            std::fs::write(path, &content).map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    FsError::PermissionDenied {
                        message: format!("Permission denied: {}", req.path),
                    }
                } else {
                    FsError::Internal {
                        message: format!("Failed to write file: {}", e),
                    }
                }
            })?;
        }
        WritePayload::Sheet { deltas } => {
            let mut book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to read spreadsheet for update: {}", e),
                }
            })?;

            apply_deltas(&mut book, &deltas)?;

            umya_spreadsheet::writer::xlsx::write(&book, path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to write spreadsheet: {}", e),
                }
            })?;
        }
    }

    let revision = get_revision(path)?;
    Ok(FsWriteResponse { revision })
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fs_error_from_io_not_found() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        let fs_err = FsError::from(io_err);
        match fs_err {
            FsError::NotFound { message } => assert!(message.contains("gone")),
            other => panic!("expected NotFound, got: {}", other),
        }
    }

    #[test]
    fn fs_error_from_io_permission_denied() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        let fs_err = FsError::from(io_err);
        match fs_err {
            FsError::PermissionDenied { message } => assert!(message.contains("nope")),
            other => panic!("expected PermissionDenied, got: {}", other),
        }
    }

    #[test]
    fn fs_error_from_io_other() {
        let io_err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "pipe broke");
        let fs_err = FsError::from(io_err);
        match fs_err {
            FsError::Internal { message } => assert!(message.contains("pipe broke")),
            other => panic!("expected Internal, got: {}", other),
        }
    }

    #[test]
    fn fs_error_display() {
        let err = FsError::NotFound { message: "file.txt".into() };
        assert_eq!(format!("{}", err), "file.txt");
    }

    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_file() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        let rev = atomic_write_with_lock(&target, None, |tmp| {
            fs::write(tmp, "hello")?;
            Ok(())
        }).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
        assert!(rev.size > 0);
    }

    #[test]
    fn atomic_write_conflict_on_stale_revision() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        fs::write(&target, "original").unwrap();
        let stale = FileRevision { mtime_ms: 0, size: 0 };
        let result = atomic_write_with_lock(&target, Some(&stale), |tmp| {
            fs::write(tmp, "new")?;
            Ok(())
        });
        match result {
            Err(FsError::Conflict { .. }) => {}
            other => panic!("expected Conflict, got: {:?}", other),
        }
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
    }

    #[test]
    fn atomic_write_cleans_up_temp_on_write_failure() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        let result = atomic_write_with_lock(&target, None, |_tmp| {
            Err(FsError::Internal { message: "boom".into() })
        });
        assert!(result.is_err());
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn atomic_write_overwrites_existing_with_valid_revision() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        fs::write(&target, "original").unwrap();
        let rev = get_revision(&target).unwrap();
        // Sleep 10ms to ensure mtime changes
        std::thread::sleep(std::time::Duration::from_millis(10));
        let new_rev = atomic_write_with_lock(&target, Some(&rev), |tmp| {
            fs::write(tmp, "updated")?;
            Ok(())
        }).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert_ne!(new_rev.size, rev.size); // "updated" != "original" in length
    }
}
