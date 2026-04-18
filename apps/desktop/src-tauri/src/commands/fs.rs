use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

// ── Error model ──

#[derive(Debug, Serialize)]
#[serde(tag = "code")]
pub enum FsError {
    NotFound { message: String },
    PermissionDenied { message: String },
    NotSupported { message: String },
    Conflict { message: String },
    InvalidRequest { message: String },
    Internal { message: String },
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FsError::NotFound { message } => write!(f, "NotFound: {}", message),
            FsError::PermissionDenied { message } => write!(f, "PermissionDenied: {}", message),
            FsError::NotSupported { message } => write!(f, "NotSupported: {}", message),
            FsError::Conflict { message } => write!(f, "Conflict: {}", message),
            FsError::InvalidRequest { message } => write!(f, "InvalidRequest: {}", message),
            FsError::Internal { message } => write!(f, "Internal: {}", message),
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

const TEXT_FILENAMES: &[&str] = &[
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

fn classify_file(path: &Path) -> FileType {
    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    if TEXT_FILENAMES.contains(&filename) {
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
        return FileType::Sheet;
    }
    if UNSUPPORTED_SHEET_EXTENSIONS.contains(&ext.as_str()) {
        return FileType::UnsupportedSheet;
    }
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return FileType::Text;
    }

    FileType::Binary
}

fn get_revision(path: &Path) -> Result<FileRevision, FsError> {
    let meta = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FsError::NotFound { message: format!("File not found: {}", path.display()) }
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            FsError::PermissionDenied { message: format!("Permission denied: {}", path.display()) }
        } else {
            FsError::Internal { message: format!("Failed to read metadata: {}", e) }
        }
    })?;

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
