//! Spreadsheet cache and workbook I/O gateway.
//!
//! All reads, writes, and evictions of `.xlsx` workbooks flow through
//! [`WorkbookCache`]. No other module should call `umya_spreadsheet::reader`
//! or `umya_spreadsheet::writer` directly.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::commands::fs::{atomic_write_with_lock, get_revision, FileRevision, FsError};

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
) -> Result<(), FsError> {
    for delta in deltas {
        let sheet = match workbook.get_sheet_by_name(&delta.sheet) {
            Some(_) => workbook.get_sheet_by_name_mut(&delta.sheet).unwrap(),
            None => workbook
                .new_sheet(&delta.sheet)
                .map_err(|e| FsError::InvalidRequest {
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

/// Compute a canonical `PathBuf` key for `WorkbookCache`.
///
/// For existing paths, `std::fs::canonicalize` produces the absolute, symlink-
/// resolved form (on Windows this includes the `\\?\` verbatim prefix).
/// For paths whose target does not yet exist (new-file creation through
/// `WorkbookCache::mutate`), we canonicalize the parent directory and join
/// the file name. The parent must exist; otherwise we surface `FsError::NotFound`.
///
/// Canonical keys are never surfaced to the frontend; they exist only to
/// deduplicate DashMap entries that alias the same underlying file.
fn canonical_key(path: &std::path::Path) -> Result<std::path::PathBuf, FsError> {
    match std::fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or_else(|| FsError::InvalidRequest {
                message: format!("Path has no parent directory: {}", path.display()),
            })?;
            let file_name = path.file_name().ok_or_else(|| FsError::InvalidRequest {
                message: format!("Path has no file name: {}", path.display()),
            })?;
            let canon_parent = std::fs::canonicalize(parent)?;
            Ok(canon_parent.join(file_name))
        }
        Err(e) => Err(FsError::from(e)),
    }
}

impl WorkbookCache {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or return already-cached) workbook. Idempotent.
    /// Always returns the currently-cached snapshot's data and revision.
    #[cfg(test)]
    pub fn open(&self, path: &Path) -> Result<(WorkbookData, FileRevision), FsError> {
        self.open_windowed(path, None)
    }

    pub fn open_windowed(
        &self,
        path: &Path,
        window: Option<&SheetWindowRequest>,
    ) -> Result<(WorkbookData, FileRevision), FsError> {
        let key = canonical_key(path)?;

        if let Some(entry) = self.entries.get(&key) {
            let arc = entry.clone();
            drop(entry); // release DashMap shard before acquiring inner mutex
            let snap = arc.lock().unwrap();
            let data = translate_workbook(&snap.book, window);
            return Ok((data, snap.revision.clone()));
        }

        if !key.exists() {
            return Err(FsError::NotFound {
                message: format!("File not found: {}", key.display()),
            });
        }
        let revision = get_revision(&key)?;
        let book = umya_spreadsheet::reader::xlsx::read(&key).map_err(|e| FsError::ParseError {
            message: format!("Failed to read spreadsheet: {}", e),
        })?;
        let data = translate_workbook(&book, window);
        self.entries.insert(
            key,
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
    /// Cache miss while file exists on disk → `FsError::CacheEvicted`.
    /// Cache miss and file does NOT exist → creates a new empty workbook.
    pub fn mutate(
        &self,
        path: &Path,
        expected_revision: Option<&FileRevision>,
        deltas: &[CellDelta],
    ) -> Result<FileRevision, FsError> {
        let key = canonical_key(path)?;

        if let Some(entry) = self.entries.get(&key) {
            let arc = entry.clone();
            drop(entry); // release DashMap shard before acquiring inner mutex
            let mut snap = arc.lock().unwrap();

            let expected = expected_revision.ok_or_else(|| FsError::InvalidRequest {
                message: format!(
                    "expected_revision is required to mutate a cached workbook: {}",
                    key.display()
                ),
            })?;

            if snap.revision != *expected {
                return Err(FsError::RevisionMismatch {
                    message: format!(
                        "Cached revision mismatch. Expected {:?}, got {:?}",
                        expected, snap.revision
                    ),
                });
            }

            apply_deltas(&mut snap.book, deltas)?;
            let new_rev = atomic_write_with_lock(&key, Some(expected), |tmp| {
                umya_spreadsheet::writer::xlsx::write(&snap.book, tmp).map_err(|e| {
                    FsError::WriteFailed {
                        message: format!("Failed to write spreadsheet: {}", e),
                    }
                })
            })?;
            snap.revision = new_rev.clone();
            return Ok(new_rev);
        }

        match key.try_exists() {
            Ok(true) => Err(FsError::CacheEvicted {
                message: format!(
                    "Workbook not in cache but file exists on disk. Re-open the file before saving: {}",
                    key.display()
                ),
            }),
            Ok(false) => {
                let mut book = umya_spreadsheet::new_file_empty_worksheet();
                apply_deltas(&mut book, deltas)?;
                let new_rev = atomic_write_with_lock(&key, None, |tmp| {
                    umya_spreadsheet::writer::xlsx::write(&book, tmp).map_err(|e| {
                        FsError::WriteFailed {
                            message: format!("Failed to write spreadsheet: {}", e),
                        }
                    })
                })?;
                self.entries.insert(
                    key,
                    Arc::new(Mutex::new(WorkbookSnapshot {
                        book,
                        revision: new_rev.clone(),
                    })),
                );
                Ok(new_rev)
            }
            Err(e) => Err(FsError::Internal {
                message: format!("Failed to stat {}: {}", key.display(), e),
            }),
        }
    }

    pub fn close(&self, path: &Path) {
        if let Ok(key) = canonical_key(path) {
            self.entries.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::{tempdir, TempDir};

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
        assert_eq!(
            sheet.get_cell_value((1u32, 1u32)).get_value().to_string(),
            "hello"
        );
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

    /// Create a tempdir and write an empty `.xlsx` workbook inside it.
    /// Returns `(dir, path)`; keep `dir` alive for the duration of the test.
    fn fresh_workbook(name: &str) -> (TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join(name);
        let book = umya_spreadsheet::new_file();
        umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();
        (dir, path)
    }

    /// Touch an empty file at `dir/name`. Used by `canonical_key` tests that
    /// need a real inode without caring about workbook contents.
    fn touch(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"").unwrap();
        path
    }

    /// RAII guard that sets the process cwd on construction and restores the
    /// previous cwd on drop — survives panics, unlike a manual restore call.
    struct CwdGuard(PathBuf);
    impl CwdGuard {
        fn set(new: &Path) -> Self {
            let prev = std::env::current_dir().unwrap();
            std::env::set_current_dir(new).unwrap();
            Self(prev)
        }
    }
    impl Drop for CwdGuard {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.0);
        }
    }

    #[test]
    fn cache_open_is_idempotent() {
        let (_dir, path) = fresh_workbook("wb.xlsx");
        let cache = WorkbookCache::new();
        let (_, rev1) = cache.open(&path).unwrap();
        let (_, rev2) = cache.open(&path).unwrap();
        assert_eq!(rev1, rev2);
    }

    #[test]
    fn mutate_cached_with_stale_revision_returns_fs_error_revision_mismatch() {
        let (_dir, path) = fresh_workbook("wb.xlsx");
        let cache = WorkbookCache::new();
        cache.open(&path).unwrap();
        let stale = FileRevision {
            mtime_ms: 0,
            size: 0,
        };
        let err = cache.mutate(&path, Some(&stale), &[]).unwrap_err();
        match err {
            crate::commands::fs::FsError::RevisionMismatch { .. } => {}
            other => panic!("expected FsError::RevisionMismatch, got {:?}", other),
        }
    }

    #[test]
    fn cache_mutate_missing_file_creates_empty_workbook() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("new.xlsx");

        let cache = WorkbookCache::new();
        let fake_rev = FileRevision {
            mtime_ms: 0,
            size: 0,
        };
        let rev = cache
            .mutate(
                &path,
                None,
                &[CellDelta {
                    sheet: "Sheet1".into(),
                    cell: CellRef {
                        row: 1,
                        col: 1,
                        value: "x".into(),
                        cell_type: None,
                    },
                }],
            )
            .unwrap();
        assert!(path.exists());
        assert!(rev.size > 0);
        assert!(rev.mtime_ms > 0);
        // Confirm the returned revision is not the sentinel-like fake_rev: new-file path
        // ignores expected_revision rather than silently matching it.
        assert_ne!(rev, fake_rev);
    }

    #[test]
    fn cache_mutate_cached_requires_expected_revision() {
        let (_dir, path) = fresh_workbook("wb.xlsx");
        let cache = WorkbookCache::new();
        cache.open(&path).unwrap();
        // No expected_revision on a cached workbook → InvalidRequest
        let result = cache.mutate(&path, None, &[]);
        assert!(matches!(
            result,
            Err(crate::commands::fs::FsError::InvalidRequest { .. })
        ));
    }

    #[test]
    fn full_lifecycle_open_mutate_close_reopen() {
        let (_dir, path) = fresh_workbook("life.xlsx");
        let cache = WorkbookCache::new();

        // open
        let (_, rev0) = cache.open(&path).unwrap();

        // mutate
        let rev1 = cache
            .mutate(
                &path,
                Some(&rev0),
                &[CellDelta {
                    sheet: "Sheet1".into(),
                    cell: CellRef {
                        row: 1,
                        col: 1,
                        value: "hello".into(),
                        cell_type: None,
                    },
                }],
            )
            .unwrap();
        assert_ne!(rev0, rev1);

        // close
        cache.close(&path);

        // re-open — should re-parse disk and see the saved value
        let (data, _rev2) = cache.open(&path).unwrap();
        let sheet1 = data.sheets.iter().find(|s| s.name == "Sheet1").unwrap();
        let cell = sheet1
            .cells
            .iter()
            .find(|c| c.row == 1 && c.col == 1)
            .unwrap();
        assert_eq!(cell.value, "hello");
    }

    #[test]
    fn canonical_key_behaviour() {
        let dir = tempdir().unwrap();
        let path = touch(dir.path(), "x.xlsx");
        let canon = std::fs::canonicalize(&path).unwrap();
        let canon_dir = std::fs::canonicalize(dir.path()).unwrap();

        // Identity: absolute existing path → canonicalized form.
        assert_eq!(canonical_key(&path).unwrap(), canon);

        // Dot segment "./" is stripped.
        assert_eq!(
            canonical_key(&dir.path().join(".").join("x.xlsx")).unwrap(),
            canon
        );

        // Dot-dot segment ".." is resolved (up-and-back through a sibling dir).
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        assert_eq!(
            canonical_key(&sub.join("..").join("x.xlsx")).unwrap(),
            canon
        );

        // New-file path (target missing, parent exists) canonicalizes the parent.
        let new_path = dir.path().join("does_not_exist.xlsx");
        assert_eq!(
            canonical_key(&new_path).unwrap(),
            canon_dir.join("does_not_exist.xlsx")
        );

        // Missing parent surfaces NotFound.
        let bogus = Path::new("/nonexistent_root_9f8e7d/dir/x.xlsx");
        assert!(matches!(
            canonical_key(bogus).unwrap_err(),
            crate::commands::fs::FsError::NotFound { .. }
        ));
    }

    #[test]
    #[serial]
    fn aliased_paths_dedup_cache_entries() {
        let (dir, abs_path) = fresh_workbook("x.xlsx");
        let _cwd = CwdGuard::set(dir.path());
        let rel_path = PathBuf::from("x.xlsx");

        let cache = WorkbookCache::new();
        cache.open(&abs_path).unwrap();
        cache.open(&rel_path).unwrap();

        assert_eq!(
            cache.entries.len(),
            1,
            "aliased absolute+relative paths must collapse to one entry"
        );
    }

    #[test]
    #[serial]
    fn concurrent_mutate_via_aliased_paths_serialises() {
        use std::sync::Arc as StdArc;
        use std::thread;

        let (dir, abs_path) = fresh_workbook("wb.xlsx");
        let _cwd = CwdGuard::set(dir.path());
        let rel_path = PathBuf::from("wb.xlsx");

        let cache = StdArc::new(WorkbookCache::new());
        let (_, rev0) = cache.open(&abs_path).unwrap();

        let spawn_mutate = |path: PathBuf, row: u32, value: &'static str| {
            let c = cache.clone();
            let rev = rev0.clone();
            thread::spawn(move || {
                c.mutate(
                    &path,
                    Some(&rev),
                    &[CellDelta {
                        sheet: "Sheet1".into(),
                        cell: CellRef {
                            row,
                            col: 1,
                            value: value.into(),
                            cell_type: None,
                        },
                    }],
                )
            })
        };

        let t1 = spawn_mutate(abs_path.clone(), 1, "A");
        let t2 = spawn_mutate(rel_path.clone(), 2, "B");

        let res1 = t1.join().unwrap();
        let res2 = t2.join().unwrap();

        let (ok_count, rev_err_count) = [&res1, &res2].iter().fold((0, 0), |(a, b), r| match r {
            Ok(_) => (a + 1, b),
            Err(crate::commands::fs::FsError::RevisionMismatch { .. }) => (a, b + 1),
            other => panic!("unexpected: {:?}", other),
        });
        assert_eq!(ok_count, 1, "exactly one mutate should succeed");
        assert_eq!(
            rev_err_count, 1,
            "the aliased competitor should see RevisionMismatch"
        );
    }

    #[test]
    #[serial]
    fn close_with_aliased_path_evicts_same_entry() {
        let (dir, abs_path) = fresh_workbook("wb.xlsx");
        let _cwd = CwdGuard::set(dir.path());
        let rel_path = PathBuf::from("wb.xlsx");

        let cache = WorkbookCache::new();
        cache.open(&abs_path).unwrap();
        cache.close(&rel_path);

        let fake_rev = FileRevision {
            mtime_ms: 0,
            size: 0,
        };
        let err = cache.mutate(&abs_path, Some(&fake_rev), &[]).unwrap_err();
        assert!(matches!(
            err,
            crate::commands::fs::FsError::CacheEvicted { .. }
        ));
    }
}
