//! Spreadsheet cache and workbook I/O gateway.
//!
//! All reads, writes, and evictions of `.xlsx` workbooks flow through
//! [`WorkbookCache`]. No other module should call `umya_spreadsheet::reader`
//! or `umya_spreadsheet::writer` directly.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::commands::fs::{atomic_write_with_lock, get_revision, FileRevision};

// ── Error model ──

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code")]
pub enum SheetError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    PermissionDenied { message: String },
    #[error("{message}")]
    RevisionMismatch { message: String },
    #[error("{message}")]
    FileLocked { message: String },
    #[error("{message}")]
    CacheEvicted { message: String },
    #[error("{message}")]
    ParseError { message: String },
    #[error("{message}")]
    WriteFailed { message: String },
    #[error("{message}")]
    InvalidRequest { message: String },
    #[error("{message}")]
    Internal { message: String },
}

impl From<std::io::Error> for SheetError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => SheetError::NotFound { message: e.to_string() },
            std::io::ErrorKind::PermissionDenied => {
                SheetError::PermissionDenied { message: e.to_string() }
            }
            _ => SheetError::Internal { message: e.to_string() },
        }
    }
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

#[derive(Serialize, Clone)]
pub struct SheetCapabilities {
    pub can_edit_cells: bool,
    pub can_save: bool,
    pub format: String,
}

#[derive(Deserialize)]
pub struct SheetWindowRequest {
    pub start_row: u32,
    pub start_col: u32,
    pub max_rows: u32,
    pub max_cols: u32,
}

#[derive(Deserialize)]
pub struct CellDelta {
    pub sheet: String,
    pub cell: CellRef,
}

// ── Workbook translation helpers ──

pub fn translate_workbook(
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

pub fn apply_deltas(
    workbook: &mut umya_spreadsheet::Spreadsheet,
    deltas: &[CellDelta],
) -> Result<(), SheetError> {
    for delta in deltas {
        let sheet = match workbook.get_sheet_by_name(&delta.sheet) {
            Some(_) => workbook.get_sheet_by_name_mut(&delta.sheet).unwrap(),
            None => workbook
                .new_sheet(&delta.sheet)
                .map_err(|e| SheetError::InvalidRequest {
                    message: format!("Failed to create sheet {}: {}", delta.sheet, e),
                })?,
        };

        let col = delta.cell.col;
        let row = delta.cell.row;
        let cv = sheet.get_cell_value_mut((col, row));

        let cell_type = delta.cell.cell_type.as_deref().unwrap_or_else(|| {
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
                let formula = delta
                    .cell
                    .value
                    .strip_prefix('=')
                    .unwrap_or(&delta.cell.value);
                cv.set_formula(formula);
            }
            _ => {
                cv.set_value_string(&delta.cell.value);
            }
        }
    }
    Ok(())
}

// ── Workbook cache ──

pub struct WorkbookSnapshot {
    pub book: umya_spreadsheet::Spreadsheet,
    pub revision: FileRevision,
}

#[derive(Default)]
pub struct WorkbookCache {
    entries: DashMap<PathBuf, Arc<Mutex<WorkbookSnapshot>>>,
}

impl WorkbookCache {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or return already-cached) workbook. Idempotent.
    /// Always returns the currently-cached snapshot's data and revision.
    #[cfg(test)]
    pub fn open(&self, path: &Path) -> Result<(WorkbookData, FileRevision), SheetError> {
        self.open_windowed(path, None)
    }

    pub fn open_windowed(
        &self,
        path: &Path,
        window: Option<&SheetWindowRequest>,
    ) -> Result<(WorkbookData, FileRevision), SheetError> {
        if let Some(entry) = self.entries.get(path) {
            let arc = entry.clone();
            drop(entry); // release DashMap shard before acquiring inner mutex
            let snap = arc.lock().unwrap();
            let data = translate_workbook(&snap.book, window);
            return Ok((data, snap.revision.clone()));
        }

        // Cache miss. Parse from disk.
        if !path.exists() {
            return Err(SheetError::NotFound {
                message: format!("File not found: {}", path.display()),
            });
        }
        let revision = get_revision(path).map_err(fs_to_sheet_err)?;
        let book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
            SheetError::ParseError {
                message: format!("Failed to read spreadsheet: {}", e),
            }
        })?;
        let data = translate_workbook(&book, window);
        self.entries.insert(
            path.to_path_buf(),
            Arc::new(Mutex::new(WorkbookSnapshot {
                book,
                revision: revision.clone(),
            })),
        );
        Ok((data, revision))
    }

    /// Apply deltas, atomically write to disk, update cache revision.
    /// Returns the new revision.
    ///
    /// Cache miss while file exists on disk → `CacheEvicted`.
    /// Cache miss and file does NOT exist → creates a new empty workbook.
    pub fn mutate(
        &self,
        path: &Path,
        expected_revision: Option<&FileRevision>,
        deltas: &[CellDelta],
    ) -> Result<FileRevision, SheetError> {
        // Fast path: cache hit. Requires expected_revision.
        if let Some(entry) = self.entries.get(path) {
            let arc = entry.clone();
            drop(entry); // release DashMap shard before acquiring inner mutex
            let mut snap = arc.lock().unwrap();

            let expected = expected_revision.ok_or_else(|| SheetError::InvalidRequest {
                message: format!(
                    "expected_revision is required to mutate a cached workbook: {}",
                    path.display()
                ),
            })?;

            if snap.revision != *expected {
                return Err(SheetError::RevisionMismatch {
                    message: format!(
                        "Cached revision mismatch. Expected {:?}, got {:?}",
                        expected, snap.revision
                    ),
                });
            }

            apply_deltas(&mut snap.book, deltas)?;
            let new_rev = atomic_write_with_lock(path, Some(expected), |tmp| {
                umya_spreadsheet::writer::xlsx::write(&snap.book, tmp).map_err(|e| {
                    crate::commands::fs::FsError::Internal {
                        message: format!("Failed to write spreadsheet: {}", e),
                    }
                })
            })
            .map_err(fs_to_sheet_err)?;
            snap.revision = new_rev.clone();
            return Ok(new_rev);
        }

        // Cache miss. Check disk.
        match path.try_exists() {
            Ok(true) => Err(SheetError::CacheEvicted {
                message: format!(
                    "Workbook not in cache but file exists on disk. Re-open the file before saving: {}",
                    path.display()
                ),
            }),
            Ok(false) => {
                // New-file path: expected_revision is ignored.
                let mut book = umya_spreadsheet::new_file_empty_worksheet();
                apply_deltas(&mut book, deltas)?;
                let new_rev = atomic_write_with_lock(path, None, |tmp| {
                    umya_spreadsheet::writer::xlsx::write(&book, tmp).map_err(|e| {
                        crate::commands::fs::FsError::Internal {
                            message: format!("Failed to write spreadsheet: {}", e),
                        }
                    })
                })
                .map_err(fs_to_sheet_err)?;
                self.entries.insert(
                    path.to_path_buf(),
                    Arc::new(Mutex::new(WorkbookSnapshot {
                        book,
                        revision: new_rev.clone(),
                    })),
                );
                Ok(new_rev)
            }
            Err(e) => Err(SheetError::Internal {
                message: format!("Failed to stat {}: {}", path.display(), e),
            }),
        }
    }

    pub fn close(&self, path: &Path) {
        self.entries.remove(path);
    }
}

fn fs_to_sheet_err(e: crate::commands::fs::FsError) -> SheetError {
    use crate::commands::fs::FsError as F;
    match e {
        F::NotFound { message } => SheetError::NotFound { message },
        F::PermissionDenied { message } => SheetError::PermissionDenied { message },
        F::Conflict { message } => SheetError::RevisionMismatch { message },
        F::FileLocked { message } => SheetError::FileLocked { message },
        F::InvalidRequest { message } => SheetError::InvalidRequest { message },
        F::NotSupported { message } => SheetError::InvalidRequest { message },
        F::Internal { message } => SheetError::WriteFailed { message },
        F::RevisionMismatch { message } => SheetError::RevisionMismatch { message },
        F::CacheEvicted { message } => SheetError::CacheEvicted { message },
        F::ParseError { message } => SheetError::ParseError { message },
        F::WriteFailed { message } => SheetError::WriteFailed { message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_deltas_sets_string_value() {
        let mut book = umya_spreadsheet::new_file_empty_worksheet();
        book.new_sheet("Sheet1").unwrap();
        let deltas = vec![CellDelta {
            sheet: "Sheet1".into(),
            cell: CellRef {
                row: 1,
                col: 1,
                value: "hello".into(),
                cell_type: Some("string".into()),
            },
        }];
        apply_deltas(&mut book, &deltas).unwrap();
        let sheet = book.get_sheet_by_name("Sheet1").unwrap();
        assert_eq!(sheet.get_cell_value((1u32, 1u32)).get_value().to_string(), "hello");
    }

    #[test]
    fn apply_deltas_creates_missing_sheet() {
        let mut book = umya_spreadsheet::new_file_empty_worksheet();
        let deltas = vec![CellDelta {
            sheet: "NewSheet".into(),
            cell: CellRef {
                row: 2,
                col: 3,
                value: "42".into(),
                cell_type: Some("number".into()),
            },
        }];
        apply_deltas(&mut book, &deltas).unwrap();
        assert!(book.get_sheet_by_name("NewSheet").is_some());
    }

    use tempfile::tempdir;

    #[test]
    fn cache_open_is_idempotent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wb.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = WorkbookCache::new();
        let (_, rev1) = cache.open(&path).unwrap();
        let (_, rev2) = cache.open(&path).unwrap();
        assert_eq!(rev1, rev2);
    }

    #[test]
    fn cache_mutate_missing_entry_errors_cache_evicted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wb.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = WorkbookCache::new();
        let fake_rev = FileRevision { mtime_ms: 0, size: 0 };
        let result = cache.mutate(&path, Some(&fake_rev), &[]);
        match result {
            Err(SheetError::CacheEvicted { .. }) => {}
            other => panic!("expected CacheEvicted, got {:?}", other),
        }
    }

    #[test]
    fn cache_mutate_missing_file_creates_empty_workbook() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("new.xlsx");

        let cache = WorkbookCache::new();
        let fake_rev = FileRevision { mtime_ms: 0, size: 0 };
        let rev = cache.mutate(&path, None, &[CellDelta {
            sheet: "Sheet1".into(),
            cell: CellRef { row: 1, col: 1, value: "x".into(), cell_type: None },
        }]).unwrap();
        assert!(path.exists());
        assert!(rev.size > 0);
        assert!(rev.mtime_ms > 0);
        // Confirm the returned revision is not the sentinel-like fake_rev: new-file path
        // ignores expected_revision rather than silently matching it.
        assert_ne!(rev, fake_rev);
    }

    #[test]
    fn cache_mutate_cached_requires_expected_revision() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wb.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = WorkbookCache::new();
        cache.open(&path).unwrap();
        // No expected_revision on a cached workbook → InvalidRequest
        let result = cache.mutate(&path, None, &[]);
        assert!(matches!(result, Err(SheetError::InvalidRequest { .. })));
    }

    #[test]
    fn cache_close_evicts() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wb.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = WorkbookCache::new();
        cache.open(&path).unwrap();
        cache.close(&path);
        // After close, mutate with any revision should hit CacheEvicted because file exists
        let fake_rev = FileRevision { mtime_ms: 0, size: 0 };
        let result = cache.mutate(&path, Some(&fake_rev), &[]);
        assert!(matches!(result, Err(SheetError::CacheEvicted { .. })));
    }

    #[test]
    fn concurrent_mutate_serialises() {
        use std::sync::Arc as StdArc;
        use std::thread;

        let dir = tempdir().unwrap();
        let path = dir.path().join("wb.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = StdArc::new(WorkbookCache::new());
        let (_, rev0) = cache.open(&path).unwrap();

        let p1 = path.clone();
        let c1 = cache.clone();
        let r1 = rev0.clone();
        let t1 = thread::spawn(move || {
            c1.mutate(&p1, Some(&r1), &[CellDelta {
                sheet: "Sheet1".into(),
                cell: CellRef { row: 1, col: 1, value: "A".into(), cell_type: None },
            }])
        });

        let p2 = path.clone();
        let c2 = cache.clone();
        let r2 = rev0.clone();
        let t2 = thread::spawn(move || {
            c2.mutate(&p2, Some(&r2), &[CellDelta {
                sheet: "Sheet1".into(),
                cell: CellRef { row: 2, col: 1, value: "B".into(), cell_type: None },
            }])
        });

        let res1 = t1.join().unwrap();
        let res2 = t2.join().unwrap();

        // Exactly one succeeds; the other sees the revision bump and gets RevisionMismatch.
        let (ok_count, rev_err_count) = [&res1, &res2].iter().fold((0, 0), |(a, b), r| match r {
            Ok(_) => (a + 1, b),
            Err(SheetError::RevisionMismatch { .. }) => (a, b + 1),
            other => panic!("unexpected result: {:?}", other),
        });
        assert_eq!(ok_count, 1);
        assert_eq!(rev_err_count, 1);
    }

    #[test]
    fn full_lifecycle_open_mutate_close_reopen() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("life.xlsx");
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

        let cache = WorkbookCache::new();

        // open
        let (_, rev0) = cache.open(&path).unwrap();

        // mutate
        let rev1 = cache
            .mutate(&path, Some(&rev0), &[CellDelta {
                sheet: "Sheet1".into(),
                cell: CellRef { row: 1, col: 1, value: "hello".into(), cell_type: None },
            }])
            .unwrap();
        assert_ne!(rev0, rev1);

        // close
        cache.close(&path);

        // re-open — should re-parse disk and see the saved value
        let (data, _rev2) = cache.open(&path).unwrap();
        let sheet1 = data.sheets.iter().find(|s| s.name == "Sheet1").unwrap();
        let cell = sheet1.cells.iter().find(|c| c.row == 1 && c.col == 1).unwrap();
        assert_eq!(cell.value, "hello");
    }
}
