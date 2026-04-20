# Spreadsheet Cache Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract spreadsheet cache + workbook I/O out of `fs.rs` into a new `spreadsheet.rs` module, making the cache the single gateway for every read/write/close of `.xlsx` files with per-path mutex locking and precise error variants.

**Architecture:** A new `commands/spreadsheet.rs` module owns a `WorkbookCache` backed by `DashMap<PathBuf, Arc<Mutex<WorkbookSnapshot>>>`. Three gateway methods — `open()`, `mutate()`, `close()` — are the *only* code paths that touch `umya_spreadsheet`. Per-path `Mutex` serialises all operations on a given workbook; the disk atomic-write happens *inside* that lock, so cache revision and disk revision advance or fail together. `fs.rs` keeps only generic filesystem concerns (text I/O, atomic write helper, directory listing, file-type detection, `FileRevision`, `FsError`); its sheet branches become thin delegations. Cache miss on mutate is a hard `CacheEvicted` error; the frontend must re-open the file. Eviction is manual via `fs_close_file`.

**Tech Stack:** Rust, Tauri 2, `umya-spreadsheet` 2, `dashmap` 6, `fd-lock` 4, `thiserror` 2, `tempfile` (dev). Frontend: TypeScript, SolidJS, `@tauri-apps/api`.

---

## File Structure

**New files:**
- `apps/desktop/src-tauri/src/commands/spreadsheet.rs` — gateway module. Owns `WorkbookCache`, `WorkbookSnapshot`, `open/mutate/close`, `apply_deltas`, `translate_workbook`, xlsx parse/write wrappers, `SheetError`, sheet-specific request/response types.

**Modified files:**
- `apps/desktop/src-tauri/src/commands/fs.rs` — remove `WorkbookCache`, `WorkbookSnapshot`, `translate_workbook`, `apply_deltas`, `WorkbookData`, `SheetData`, `CellRef`, `CellDelta`, `SheetCapabilities`, `SheetWindowRequest`, `SHEET_EXTENSIONS`-related sheet branches. Keep: `FsError`, `FileRevision`, `atomic_write_with_lock`, `with_exclusive_lock`, `exclusive_rename`, `detect_file_type`, `guard_file_write`, `get_revision`, text read/write, `fs_read_dir`.
- `apps/desktop/src-tauri/src/commands/mod.rs` — add `pub mod spreadsheet;`.
- `apps/desktop/src-tauri/src/lib.rs` — import `WorkbookCache` from `commands::spreadsheet` instead of `commands::fs`; register any new commands in `invoke_handler`.
- `apps/desktop/src-tauri/Cargo.toml` — add `dashmap = "6"` dependency.
- `apps/app/src/app/lib/tauri-fs.ts` — extend error-code union type to include new variants (`RevisionMismatch`, `FileLocked`, `CacheEvicted`, `ParseError`, `SheetNotSupported`, `WriteFailed`).

**Responsibility split:**
- `fs.rs` — generic filesystem: bytes in, bytes out, revisions, atomicity.
- `spreadsheet.rs` — stateful workbook lifecycle: parse once, mutate in place, write atomically, evict explicitly.

---

## Design Decisions (locked)

1. **Per-path locking:** `DashMap<PathBuf, Arc<Mutex<WorkbookSnapshot>>>`. Outer DashMap shard-locks the map; inner `Mutex` serialises mutations for one file. No cloning of workbooks during mutate.
2. **Cache miss during mutate when file exists:** Hard error `SheetError::CacheEvicted`. Frontend must call `fs_read_file` (which re-opens + re-caches) before retrying the save. Only exception: file does **not** exist on disk → create new empty workbook (preserves current new-file behaviour).
3. **Eviction policy:** None. Cache grows until `fs_close_file` is called. Frontend is responsible for closing.
4. **Error taxonomy:** Split into distinct `SheetError` variants. Each serialises with `{ code, message }` for the frontend.
5. **Revision comparison:** Under per-path lock, revisions are opaque tokens compared for **equality only**. The `snapshot.revision < revision` ordering from the current code is removed.

---

## Task 1: Add `dashmap` dependency

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add `dashmap` to `[dependencies]`**

Edit `apps/desktop/src-tauri/Cargo.toml`. Locate the `[dependencies]` block (it starts with `json5 = "0.4"`). Add immediately after the `umya-spreadsheet = "2"` line:

```toml
dashmap = "6"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean. `dashmap` is fetched and added to `Cargo.lock`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "build(desktop): add dashmap dep for spreadsheet cache"
```

---

## Task 2: Create skeleton `spreadsheet.rs` with error type

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create the new module file with the error type**

Create `apps/desktop/src-tauri/src/commands/spreadsheet.rs`:

```rust
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
```

- [ ] **Step 2: Register the module**

Edit `apps/desktop/src-tauri/src/commands/mod.rs`. After the `pub mod skills;` line add:

```rust
pub mod spreadsheet;
```

Keep modules in alphabetical order (insert after `skills`).

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles with warnings about unused imports (`DashMap`, `Arc`, `Mutex`, `Deserialize`, `Path`, `PathBuf`, `atomic_write_with_lock`, `get_revision`, `FileRevision`). That's OK — they'll be used in Task 3.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs apps/desktop/src-tauri/src/commands/mod.rs
git commit -m "feat(desktop): add commands/spreadsheet module skeleton with SheetError"
```

---

## Task 3: Move workbook transport types into `spreadsheet.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

- [ ] **Step 1: Append transport types to `spreadsheet.rs`**

Append at the bottom of `apps/desktop/src-tauri/src/commands/spreadsheet.rs`:

```rust
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
```

- [ ] **Step 2: Remove those same types from `fs.rs`**

In `apps/desktop/src-tauri/src/commands/fs.rs`, delete the following declarations (currently at lines ~58-115 and ~135-139):
- `pub struct SheetWindowRequest`
- `pub struct WorkbookData`
- `pub struct SheetData`
- `pub struct CellRef`
- `pub struct SheetCapabilities`
- `pub struct CellDelta`

Keep `FsReadRequest`, `FsReadResponse`, `FsWriteRequest`, `FsWriteResponse`, `WritePayload` in `fs.rs` for now — Task 7 will update their field types to reference the new module.

At the top of `fs.rs`, add the import so the remaining `FsReadResponse::Sheet` / `WritePayload::Sheet` variants can still reference the moved types:

```rust
use crate::commands::spreadsheet::{CellDelta, SheetCapabilities, SheetWindowRequest, WorkbookData};
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles. Warnings about unused imports in `spreadsheet.rs` persist; that's OK.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "refactor(desktop): move workbook transport types to spreadsheet module"
```

---

## Task 4: Move `translate_workbook` and `apply_deltas` into `spreadsheet.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

- [ ] **Step 1: Write failing unit test for `apply_deltas`**

Append to the bottom of `apps/desktop/src-tauri/src/commands/spreadsheet.rs`:

```rust
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
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet`
Expected: FAIL — `apply_deltas` not found in scope.

- [ ] **Step 3: Move `apply_deltas` and `translate_workbook` into `spreadsheet.rs`**

Append to `apps/desktop/src-tauri/src/commands/spreadsheet.rs` (before the `#[cfg(test)]` block):

```rust
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
```

- [ ] **Step 4: Delete `translate_workbook` and `apply_deltas` from `fs.rs`**

In `apps/desktop/src-tauri/src/commands/fs.rs`, delete the functions `translate_workbook` and `apply_deltas` (currently around lines 478-605).

Update the import at the top of `fs.rs` so `fs_read_file` and `fs_write_file` can still call them:

```rust
use crate::commands::spreadsheet::{
    apply_deltas, translate_workbook, CellDelta, SheetCapabilities, SheetWindowRequest,
    WorkbookData,
};
```

The existing sheet branches in `fs_read_file` / `fs_write_file` will call `apply_deltas` / `translate_workbook` from the new module. They must now convert `SheetError` → `FsError`. For the transitional period, add this conversion helper **inside `fs.rs`** just above `fs_read_file`:

```rust
fn sheet_err_to_fs(e: crate::commands::spreadsheet::SheetError) -> FsError {
    use crate::commands::spreadsheet::SheetError as S;
    match e {
        S::NotFound { message } => FsError::NotFound { message },
        S::PermissionDenied { message } => FsError::PermissionDenied { message },
        S::InvalidRequest { message } => FsError::InvalidRequest { message },
        S::RevisionMismatch { message }
        | S::FileLocked { message }
        | S::CacheEvicted { message } => FsError::Conflict { message },
        S::ParseError { message } | S::WriteFailed { message } | S::Internal { message } => {
            FsError::Internal { message }
        }
    }
}
```

At each call-site in `fs_read_file` / `fs_write_file`, change `apply_deltas(&mut book, &deltas)?` to `apply_deltas(&mut book, &deltas).map_err(sheet_err_to_fs)?`. `translate_workbook` is infallible — no change needed there.

This helper is **temporary**: it will be deleted in Task 7 when the sheet branches fully move out of `fs.rs`.

- [ ] **Step 5: Run unit tests — both should pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet`
Expected: 2 passed.

- [ ] **Step 6: Run the full test suite**

Run: `cd apps/desktop/src-tauri && cargo test --lib`
Expected: everything green. Note that tests inside `fs.rs` (`fs_error_*`, `atomic_write_*`, `workbook_cache_*`) still reference the **old** `WorkbookCache`. The current `workbook_cache_insert_and_get` and `workbook_cache_evict` tests call `cache.insert(...)` which does not exist on the public API — those tests are already broken. **Do not fix them here**; they'll be removed with `WorkbookCache` in Task 7.

If the broken tests cause `cargo test` to fail, temporarily gate them out by renaming `#[test]` to `#[test] #[ignore]` on `workbook_cache_insert_and_get` and `workbook_cache_evict` only. Revisit in Task 7.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "refactor(desktop): move translate_workbook and apply_deltas to spreadsheet module"
```

---

## Task 5: Implement `WorkbookSnapshot` and `WorkbookCache` with per-path locking

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`

- [ ] **Step 1: Write failing test for `open` idempotency**

Append inside the `#[cfg(test)]` block in `spreadsheet.rs`:

```rust
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
        let result = cache.mutate(&path, &fake_rev, &[]);
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
        let rev = cache.mutate(&path, &fake_rev, &[CellDelta {
            sheet: "Sheet1".into(),
            cell: CellRef { row: 1, col: 1, value: "x".into(), cell_type: None },
        }]).unwrap();
        assert!(path.exists());
        assert!(rev.size > 0);
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
        let result = cache.mutate(&path, &fake_rev, &[]);
        assert!(matches!(result, Err(SheetError::CacheEvicted { .. })));
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet`
Expected: compile errors — `WorkbookCache`, `WorkbookSnapshot` not defined.

- [ ] **Step 3: Implement `WorkbookSnapshot` and `WorkbookCache`**

Append to `spreadsheet.rs` (before the `#[cfg(test)]` block):

```rust
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
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or return already-cached) workbook. Idempotent.
    /// Always returns the currently-cached snapshot's data and revision.
    pub fn open(&self, path: &Path) -> Result<(WorkbookData, FileRevision), SheetError> {
        self.open_windowed(path, None)
    }

    pub fn open_windowed(
        &self,
        path: &Path,
        window: Option<&SheetWindowRequest>,
    ) -> Result<(WorkbookData, FileRevision), SheetError> {
        if let Some(entry) = self.entries.get(path) {
            let snap = entry.lock().unwrap();
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
        expected_revision: &FileRevision,
        deltas: &[CellDelta],
    ) -> Result<FileRevision, SheetError> {
        // Fast path: cache hit.
        if let Some(entry) = self.entries.get(path) {
            let arc = entry.clone();
            drop(entry); // release DashMap shard before acquiring inner mutex
            let mut snap = arc.lock().unwrap();

            if snap.revision != *expected_revision {
                return Err(SheetError::RevisionMismatch {
                    message: format!(
                        "Cached revision mismatch. Expected {:?}, got {:?}",
                        expected_revision, snap.revision
                    ),
                });
            }

            apply_deltas(&mut snap.book, deltas)?;
            let new_rev = atomic_write_with_lock(path, Some(expected_revision), |tmp| {
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
                // New file path: create empty workbook, apply deltas, write, cache it.
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
        F::Conflict { message } => {
            // Disk revision check failed inside atomic_write_with_lock
            if message.contains("locked") {
                SheetError::FileLocked { message }
            } else {
                SheetError::RevisionMismatch { message }
            }
        }
        F::InvalidRequest { message } => SheetError::InvalidRequest { message },
        F::NotSupported { message } => SheetError::InvalidRequest { message },
        F::Internal { message } => SheetError::WriteFailed { message },
    }
}
```

- [ ] **Step 4: Run tests — all four should pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet`
Expected: 6 passed (2 from Task 4 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs
git commit -m "feat(desktop): implement WorkbookCache gateway with per-path locking"
```

---

## Task 6: Add concurrent-mutation test

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`

- [ ] **Step 1: Write failing test for concurrent mutation**

Append inside the `#[cfg(test)]` block:

```rust
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
            c1.mutate(&p1, &r1, &[CellDelta {
                sheet: "Sheet1".into(),
                cell: CellRef { row: 1, col: 1, value: "A".into(), cell_type: None },
            }])
        });

        let p2 = path.clone();
        let c2 = cache.clone();
        let r2 = rev0.clone();
        let t2 = thread::spawn(move || {
            c2.mutate(&p2, &r2, &[CellDelta {
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
```

- [ ] **Step 2: Run it**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet::tests::concurrent_mutate_serialises`
Expected: PASS. The per-path `Mutex` serialises the two threads; the second to acquire sees the updated revision and fails with `RevisionMismatch`.

If it fails intermittently, the per-path lock is not holding across the disk write — that's a bug to fix before moving on.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs
git commit -m "test(desktop): verify WorkbookCache serialises concurrent mutations per path"
```

---

## Task 7: Replace `fs.rs` sheet branches with gateway calls, wire state

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Update `lib.rs` to use the new `WorkbookCache`**

In `apps/desktop/src-tauri/src/lib.rs`, find:

```rust
use commands::fs::{fs_close_file, fs_read_dir, fs_read_file, fs_write_file, WorkbookCache};
```

Change to:

```rust
use commands::fs::{fs_close_file, fs_read_dir, fs_read_file, fs_write_file};
use commands::spreadsheet::WorkbookCache;
```

(No other change in `lib.rs` — the `manage()`/`State` registration already uses the `WorkbookCache` type alias; it just resolves to the new type.)

- [ ] **Step 2: Rewrite `fs_read_file` in `fs.rs`**

In `apps/desktop/src-tauri/src/commands/fs.rs`, replace the whole body of `fs_read_file` with:

```rust
#[tauri::command]
pub async fn fs_read_file(
    req: FsReadRequest,
    cache: tauri::State<'_, crate::commands::spreadsheet::WorkbookCache>,
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
```

- [ ] **Step 3: Rewrite `fs_write_file` in `fs.rs`**

Replace the whole body of `fs_write_file` with:

```rust
#[tauri::command]
pub async fn fs_write_file(
    req: FsWriteRequest,
    cache: tauri::State<'_, crate::commands::spreadsheet::WorkbookCache>,
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
        WritePayload::Sheet { deltas } => {
            // Mutate always requires an expected_revision. Absence means "new file".
            let expected = req.expected_revision.unwrap_or(FileRevision {
                mtime_ms: 0,
                size: 0,
            });
            cache
                .mutate(&path, &expected, &deltas)
                .map_err(sheet_err_to_fs)?
        }
    };

    Ok(FsWriteResponse { revision })
}
```

- [ ] **Step 4: Rewrite `fs_close_file` in `fs.rs`**

Replace with:

```rust
#[tauri::command]
pub async fn fs_close_file(
    path: String,
    cache: tauri::State<'_, crate::commands::spreadsheet::WorkbookCache>,
) -> Result<(), FsError> {
    cache.close(Path::new(&path));
    Ok(())
}
```

- [ ] **Step 5: Delete obsolete code from `fs.rs`**

Remove from `fs.rs`:
- The entire `WorkbookSnapshot` struct.
- The entire `WorkbookCache` struct and its `impl` block (`evict`, `peek`, `upsert_with_revision`).
- The tests at the bottom of `fs.rs` that reference `WorkbookCache`: `workbook_cache_insert_and_get`, `workbook_cache_evict` (these were already broken — they called a non-existent `insert`).

Keep:
- `FsError`, `FileRevision`, `FsReadRequest`, `FsReadResponse`, `FsWriteRequest`, `FsWriteResponse`, `WritePayload`, `FsEntry`.
- `atomic_write_with_lock`, `with_exclusive_lock`, `exclusive_rename`, `get_revision`, `detect_file_type`, `guard_file_write`.
- `sheet_err_to_fs` helper (still used).
- Text write tests and error-type tests.
- `fs_read_dir`.

Keep `atomic_write_with_lock` and `get_revision` **pub** (they're called from `spreadsheet.rs`):

```rust
pub fn atomic_write_with_lock(...) { ... }
pub fn get_revision(path: &Path) -> Result<FileRevision, FsError> { ... }
```

- [ ] **Step 6: Compile**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: clean. If there are warnings about unused imports in `fs.rs`, remove them.

- [ ] **Step 7: Run full test suite**

Run: `cd apps/desktop/src-tauri && cargo test --lib`
Expected: all green. `commands::spreadsheet::tests` has 7 tests. `commands::fs::tests` has the 4 text/error tests (`fs_error_from_io_*`, `fs_error_display`, `atomic_write_*`).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "refactor(desktop): route fs sheet commands through WorkbookCache gateway"
```

---

## Task 8: Propagate error codes to frontend type

**Files:**
- Modify: `apps/app/src/app/lib/tauri-fs.ts`

- [ ] **Step 1: Locate the error type definition**

Open `apps/app/src/app/lib/tauri-fs.ts`. Find where errors from `invoke` are typed. If there is a `FsErrorCode` union or a `FsError` interface, locate it. If there is none, Tauri returns `FsError` as `{ code, message }` JSON already — the frontend may be treating it as `unknown`.

- [ ] **Step 2: Add a sheet error code union**

Append near the other exported types:

```ts
export type SheetErrorCode =
  | "NotFound"
  | "PermissionDenied"
  | "RevisionMismatch"
  | "FileLocked"
  | "CacheEvicted"
  | "ParseError"
  | "WriteFailed"
  | "InvalidRequest"
  | "Internal";

export interface SheetError {
  code: SheetErrorCode;
  message: string;
}

/** Returned by invoke() on Err for sheet ops; narrow with `code`. */
export type FsErrorCode =
  | "NotFound"
  | "PermissionDenied"
  | "NotSupported"
  | "Conflict"
  | "InvalidRequest"
  | "Internal";

export interface FsError {
  code: FsErrorCode;
  message: string;
}
```

Note: for now, sheet errors are still **flattened into `FsError::Conflict`** at the `fs.rs` boundary (`sheet_err_to_fs`). Surfacing `SheetError` end-to-end requires a deeper frontend refactor — out of scope for this plan. Document the forward path in a trailing comment:

```ts
// TODO(spreadsheet-cache): once fs_read_file/fs_write_file return SheetError
// directly for Sheet payloads, switch callers to FsError | SheetError discriminated on shape.
```

- [ ] **Step 3: Verify typescript compiles**

Run: `cd apps/app && pnpm tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/lib/tauri-fs.ts
git commit -m "types(app): declare SheetError code union for future gateway errors"
```

---

## Task 9: Integration smoke test of the gateway

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs`

- [ ] **Step 1: Add end-to-end cache cycle test**

Append inside the `#[cfg(test)]` block in `spreadsheet.rs`:

```rust
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
            .mutate(&path, &rev0, &[CellDelta {
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
```

- [ ] **Step 2: Run it**

Run: `cd apps/desktop/src-tauri && cargo test --lib commands::spreadsheet::tests::full_lifecycle_open_mutate_close_reopen`
Expected: PASS.

- [ ] **Step 3: Run the whole suite one more time**

Run: `cd apps/desktop/src-tauri && cargo test --lib`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs
git commit -m "test(desktop): full-lifecycle integration test for WorkbookCache"
```

---

## Task 10: Manual verification

**Files:**
- None (runtime check)

- [ ] **Step 1: Build the desktop app in dev mode**

Run: `cd apps/desktop && pnpm tauri dev`
Expected: app launches.

- [ ] **Step 2: Smoke test — open, edit, save, reload**

1. Open an existing `.xlsx` file in the file editor panel.
2. Edit cell B4 → press Cmd+S. Observe no error toast.
3. Close the file (trigger `fs_close_file`).
4. Re-open the same file. Verify B4 shows the edited value.

- [ ] **Step 3: Smoke test — stale revision rejection**

1. Open an `.xlsx` file.
2. In a terminal, `touch` the same file to bump its mtime.
3. Edit a cell in the app → Cmd+S.
4. Expected: save fails with a conflict error message (coming out as `FsError::Conflict` because atomic-write's revision check fails before the cache is touched — cache stays in sync with disk).

- [ ] **Step 4: Smoke test — new file creation**

1. In the app, create a new `.xlsx` file (where `expected_revision` is `null`).
2. Add some cells → Cmd+S.
3. Expected: file is created on disk; subsequent saves work against the now-cached workbook.

- [ ] **Step 5: No commit required; record findings in PR description if any issues.**

---

## Self-Review Notes

- **Spec coverage:** All five decisions locked at the top are implemented: DashMap (Task 5), hard `CacheEvicted` on miss (Task 5), no eviction policy (only `close()`), split error variants (`SheetError` in Task 2), equality-only revision comparison (Task 5 — no `<` anywhere).
- **Placeholders:** None. Every code step shows the actual code to paste.
- **Type consistency:** `WorkbookCache::open` / `open_windowed` / `mutate` / `close` names are consistent across tasks. `SheetError` variants used in tests match those defined in Task 2. `apply_deltas` signature `&mut Spreadsheet, &[CellDelta] -> Result<(), SheetError>` is consistent between definition (Task 4) and call sites (Task 5).
- **Known limitation documented:** Task 8 notes that `SheetError` is currently flattened into `FsError::Conflict` at the Tauri boundary. Full propagation of distinct error codes to the frontend is out of scope — flagged with a TODO. The backend *does* distinguish them internally; this plan completes the cache redesign without requiring a frontend-wide error-handling refactor.
