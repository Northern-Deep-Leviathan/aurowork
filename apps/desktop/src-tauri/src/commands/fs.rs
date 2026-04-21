use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::commands::spreadsheet::{
    CellDelta, SheetCapabilities, SheetWindowRequest, WorkbookCache, WorkbookData,
};

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
    FileLocked { message: String },
    #[error("{message}")]
    InvalidRequest { message: String },
    #[error("{message}")]
    Internal { message: String },
}

impl From<std::io::Error> for FsError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound {
                message: e.to_string(),
            },
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied {
                message: e.to_string(),
            },
            _ => FsError::Internal {
                message: e.to_string(),
            },
        }
    }
}

// ── Revision tracking ──

#[derive(Serialize, Deserialize, Eq, PartialEq, PartialOrd, Ord, Clone, Debug)]
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

#[derive(Serialize)]
pub struct FsWriteResponse {
    pub revision: FileRevision,
}

// ── File-type detection ──

const TEXT_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "json5", "yaml", "yml",
    "toml", "md", "mdx", "txt", "xml", "html", "htm", "css", "scss", "sass", "less", "graphql",
    "gql", "sql", "ini", "cfg", "conf", "env", "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
    "rb", "php", "swift", "kt", "scala", "r", "sh", "bash", "zsh", "fish", "ps1", "svg", "csv",
    "tsv", "log",
];

const PREDEFINED_TEST_FILES: &[&str] = &[
    "Dockerfile",
    "Makefile",
    "Vagrantfile",
    "Rakefile",
    "Gemfile",
    "Procfile",
    "Justfile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".eslintrc",
    ".env",
    ".dockerignore",
    ".prettierignore",
    ".eslintignore",
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
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    if PREDEFINED_TEST_FILES.contains(&filename) {
        return FileType::Text;
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext.is_empty() {
        return FileType::Text;
    }

    if SHEET_EXTENSIONS.contains(&ext.as_str()) {
        FileType::Sheet
    } else if UNSUPPORTED_SHEET_EXTENSIONS.contains(&ext.as_str()) {
        FileType::UnsupportedSheet
    } else if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        FileType::Text
    } else {
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

pub fn get_revision(path: &Path) -> Result<FileRevision, FsError> {
    let meta = std::fs::metadata(path)?;
    let mtime_ms = meta
        .modified()
        .map_err(|e| FsError::Internal {
            message: format!("Failed to get mtime: {}", e),
        })?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileRevision {
        mtime_ms,
        size: meta.len(),
    })
}

// ── Atomic write helper ──

pub fn atomic_write_with_lock(
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
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file"),
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
                let current = get_revision(target)?;
                if let Some(expected) = expected_revision {
                    if current == *expected {
                        std::fs::rename(&temp_path_clone, target)?;
                        return Ok(());
                    }
                }

                let _ = std::fs::remove_file(&temp_path_clone);
                Err(FsError::Conflict {
                    message: format!(
                        "File changed on disk. Expected {:?}, got {:?}",
                        expected_revision, current
                    ),
                })
            })?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Err(err) = exclusive_rename(&temp_path, target) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(FsError::Conflict {
                    message: format!("Failed to create new file, got error {:?}", err),
                });
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
    for _ in 0..max_attempts {
        match lock.try_write() {
            Ok(_guard) => {
                return under_lock();
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                return Err(FsError::Internal {
                    message: format!("Lock failed: {}", e),
                });
            }
        }
    }

    Err(FsError::FileLocked {
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
            libc::AT_FDCWD,
            src_c.as_ptr(),
            libc::AT_FDCWD,
            dst_c.as_ptr(),
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
    let src_w: Vec<u16> = src
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let dst_w: Vec<u16> = dst
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let ret = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(src_w.as_ptr(), dst_w.as_ptr(), 0)
    };
    if ret == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}


/// Boundary adapter: map `SheetError` from the spreadsheet gateway into `FsError`
/// for the Tauri fs_* commands. Kept until/unless those commands are rewritten
/// to surface `SheetError` directly.
fn sheet_err_to_fs(e: crate::commands::spreadsheet::SheetError) -> FsError {
    use crate::commands::spreadsheet::SheetError as S;
    match e {
        S::NotFound { message } => FsError::NotFound { message },
        S::PermissionDenied { message } => FsError::PermissionDenied { message },
        S::InvalidRequest { message } => FsError::InvalidRequest { message },
        S::RevisionMismatch { message }
        | S::CacheEvicted { message } => FsError::Conflict { message },
        S::FileLocked { message } => FsError::FileLocked { message },
        S::ParseError { message } | S::WriteFailed { message } | S::Internal { message } => {
            FsError::Internal { message }
        }
    }
}

#[tauri::command]
pub async fn fs_read_file(
    req: FsReadRequest,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<FsReadResponse, FsError> {
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
            let content = std::fs::read_to_string(path).map_err(|e| FsError::Internal {
                message: format!("Failed to read as text: {}", e),
            })?;
            Ok(FsReadResponse::Text { content, revision })
        }
        FileType::Sheet => {
            let (content, revision) = cache
                .open_windowed(path, req.sheet_window.as_ref())
                .map_err(sheet_err_to_fs)?;
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("xlsx")
                .to_lowercase();
            let capabilities = SheetCapabilities {
                can_edit_cells: true,
                can_save: true,
                format: ext,
            };
            Ok(FsReadResponse::Sheet {
                content,
                capabilities,
                revision,
            })
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
pub async fn fs_write_file(
    req: FsWriteRequest,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<FsWriteResponse, FsError> {
    let path = std::path::PathBuf::from(&req.path);
    let file_type = detect_file_type(&path);

    guard_file_write(&file_type, &req.payload)?;

    let revision = match req.payload {
        WritePayload::Text { content } => {
            atomic_write_with_lock(&path, req.expected_revision.as_ref(), |tmp| {
                std::fs::write(tmp, &content)?;
                Ok(())
            })?
        }
        WritePayload::Sheet { deltas } => cache
            .mutate(&path, req.expected_revision.as_ref(), &deltas)
            .map_err(sheet_err_to_fs)?,
    };

    Ok(FsWriteResponse { revision })
}

#[tauri::command]
pub async fn fs_close_file(
    path: String,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<(), FsError> {
    cache.close(Path::new(&path));
    Ok(())
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
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path();
        let full_path = entry_path.to_string_lossy().to_string();
        let extension = entry_path
            .extension()
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
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_file() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        let rev = atomic_write_with_lock(&target, None, |tmp| {
            fs::write(tmp, "hello")?;
            Ok(())
        })
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
        assert!(rev.size > 0);
    }

    #[test]
    fn atomic_write_conflict_on_stale_revision() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        fs::write(&target, "original").unwrap();
        let stale = FileRevision {
            mtime_ms: 0,
            size: 0,
        };
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
            Err(FsError::Internal {
                message: "boom".into(),
            })
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
        })
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert_ne!(new_rev.size, rev.size); // "updated" != "original" in length
    }
}
