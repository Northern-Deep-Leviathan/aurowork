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

    match classify_file(path) {
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
            let file_type = classify_file(path);
            if file_type != FileType::Sheet {
                return Err(FsError::NotSupported {
                    message: "This file type cannot be saved as a spreadsheet".to_string(),
                });
            }

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
