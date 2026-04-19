# File Editor Robustness Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four robustness concerns in `fs.rs`: thiserror for FsError, atomic writes with fd-lock, crash-safe write-then-rename, and workbook snapshot cache.

**Architecture:** Replace the manual `Display` impl and direct `fs::write` calls with `thiserror` derives and a single `atomic_write_with_lock` helper that handles temp-file → fsync → lock → revision-check → rename for all writes. Add a `WorkbookCache` (Tauri managed state) to avoid re-parsing xlsx on every sheet save, evicted via a new `fs_close_file` command.

**Tech Stack:** Rust (Tauri backend), thiserror 2, fd-lock 4, umya-spreadsheet 2, SolidJS/TypeScript (frontend)

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | Add `thiserror`, `fd-lock` deps |
| `apps/desktop/src-tauri/src/commands/fs.rs` | All backend changes: FsError, atomic write, cache, fs_close_file |
| `apps/desktop/src-tauri/src/lib.rs` | Register `fs_close_file`, manage `WorkbookCache` |
| `apps/app/src/app/lib/tauri-fs.ts` | Add `fsCloseFile` wrapper |
| `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx` | Call `fsCloseFile` on file switch and cleanup |

---

### Task 1: Add dependencies to Cargo.toml

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml:20-36`

- [ ] **Step 1: Add thiserror and fd-lock**

In `apps/desktop/src-tauri/Cargo.toml`, add two lines to `[dependencies]`:

```toml
thiserror = "2"
fd-lock = "4"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles successfully (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "chore: add thiserror and fd-lock dependencies"
```

---

### Task 2: FsError with thiserror + From<io::Error>

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:1-29`

- [ ] **Step 1: Write test for From<io::Error>**

Add at the bottom of `fs.rs`:

```rust
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
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::fs_error 2>&1 | tail -10`
Expected: FAIL — `From<io::Error>` not implemented, `Display` format mismatch

- [ ] **Step 3: Replace FsError and manual Display impl**

Replace lines 1-29 of `fs.rs`. Change the imports and FsError definition:

```rust
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
```

This removes the manual `impl Display for FsError` block (lines 18-29).

- [ ] **Step 4: Simplify get_revision using ?**

Replace the `get_revision` function (lines 227-248) to use `?` with the new `From<io::Error>`:

```rust
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
```

- [ ] **Step 5: Fix guard_file_write syntax bug**

Replace the `guard_file_write` function (lines 203-225). The match arms use `{ .. }` instead of `=> { .. }`:

```rust
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
```

Note: change parameter from `file_type: FileType` to `file_type: &FileType`, and update the call site in `fs_write_file` from `guard_file_write(file_type, &req.payload)` to `guard_file_write(&file_type, &req.payload)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::fs_error 2>&1 | tail -10`
Expected: 4 tests PASS

- [ ] **Step 7: Verify full compilation**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles successfully

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "refactor: derive thiserror::Error for FsError, add From<io::Error>"
```

---

### Task 3: Atomic write helper with fd-lock

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

- [ ] **Step 1: Write tests for atomic_write_with_lock**

Add to the `tests` module at the bottom of `fs.rs`:

```rust
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
            Err(FsError::Conflict { .. }) => {} // expected
            other => panic!("expected Conflict, got: {:?}", other),
        }
        // Original file unchanged
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
        // No temp files left behind
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn atomic_write_overwrites_existing_with_valid_revision() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("test.txt");
        fs::write(&target, "original").unwrap();

        let rev = get_revision(&target).unwrap();

        let new_rev = atomic_write_with_lock(&target, Some(&rev), |tmp| {
            fs::write(tmp, "updated")?;
            Ok(())
        }).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert_ne!(new_rev.mtime_ms, rev.mtime_ms);
    }
```

- [ ] **Step 2: Add tempfile dev-dependency**

In `Cargo.toml`, add under `[dependencies]` (or `[dev-dependencies]` if section exists):

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::atomic_write 2>&1 | tail -10`
Expected: FAIL — `atomic_write_with_lock` not defined

- [ ] **Step 4: Implement atomic_write_with_lock**

Add the following after the `check_revision_conflict` function (after line 266) in `fs.rs`:

```rust
use std::io::Write as IoWrite;

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
    let write_result = write_fn(&temp_path);
    if let Err(e) = write_result {
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
                // Check revision under lock
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
                // Rename temp → target
                std::fs::rename(&temp_path_clone, target)?;
                Ok(())
            })?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // NEW FILE path: exclusive rename
            if let Err(_) = exclusive_rename(&temp_path, target) {
                // File appeared between open and rename — fall back to lock path
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

/// Acquires an exclusive file lock with retry, executes `under_lock`, then releases.
fn with_exclusive_lock<R>(
    file: std::fs::File,
    under_lock: impl FnOnce() -> Result<R, FsError>,
) -> Result<R, FsError> {
    let mut lock = fd_lock::RwLock::new(file);
    let max_attempts = 100; // 100 * 50ms = 5s
    for attempt in 0..max_attempts {
        match lock.try_write() {
            Ok(_guard) => {
                // Lock held via _guard for the duration of under_lock
                return under_lock();
                // _guard dropped here → lock released
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

    // linkat with AT_FDCWD creates a hard link; fails with EEXIST if dst exists
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
    // Remove original temp name
    std::fs::remove_file(src)?;
    Ok(())
}

#[cfg(windows)]
fn exclusive_rename(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    let src_w: Vec<u16> = src.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let dst_w: Vec<u16> = dst.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    // MoveFileExW without MOVEFILE_REPLACE_EXISTING fails if dst exists
    let ret = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            src_w.as_ptr(),
            dst_w.as_ptr(),
            0, // no flags = fail if exists
        )
    };
    if ret == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
```

- [ ] **Step 5: Add libc dependency (Unix) and windows-sys (Windows)**

In `Cargo.toml`:

```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_Storage_FileSystem"] }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::atomic_write 2>&1 | tail -15`
Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs apps/desktop/src-tauri/Cargo.toml
git commit -m "feat: add atomic_write_with_lock with fd-lock and exclusive rename"
```

---

### Task 4: Refactor fs_write_file to use atomic writes

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:445-488`

- [ ] **Step 1: Write test for text write round-trip with atomic write**

Add to the `tests` module:

```rust
    #[test]
    fn text_write_uses_atomic_path() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("hello.txt");
        fs::write(&target, "original").unwrap();
        let rev = get_revision(&target).unwrap();

        // Simulate the text write path
        let new_rev = atomic_write_with_lock(&target, Some(&rev), |tmp| {
            fs::write(tmp, "updated")?;
            Ok(())
        }).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert!(new_rev.size > 0);
    }
```

- [ ] **Step 2: Run test to verify it passes** (it should pass since atomic_write_with_lock already works)

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::text_write_uses_atomic 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 3: Refactor fs_write_file to use atomic_write_with_lock**

Replace the `fs_write_file` function body (lines 446-488):

```rust
#[tauri::command]
pub async fn fs_write_file(req: FsWriteRequest) -> Result<FsWriteResponse, FsError> {
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
            // Read workbook from disk (cache integration in Task 5)
            let mut book = umya_spreadsheet::reader::xlsx::read(&path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to read spreadsheet for update: {}", e),
                }
            })?;
            apply_deltas(&mut book, &deltas)?;

            atomic_write_with_lock(&path, req.expected_revision.as_ref(), |tmp| {
                umya_spreadsheet::writer::xlsx::write(&book, tmp).map_err(|e| {
                    FsError::Internal {
                        message: format!("Failed to write spreadsheet: {}", e),
                    }
                })
            })?
        }
    };

    Ok(FsWriteResponse { revision })
}
```

- [ ] **Step 4: Remove old check_revision_conflict function**

Delete the `check_revision_conflict` function (lines 250-266) — it's no longer used. The revision check now happens inside `atomic_write_with_lock`.

- [ ] **Step 5: Verify full compilation**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles successfully

- [ ] **Step 6: Run all tests**

Run: `cd apps/desktop/src-tauri && cargo test --lib 2>&1 | tail -10`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "refactor: use atomic_write_with_lock for all file writes"
```

---

### Task 5: Workbook snapshot cache + fs_close_file

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs:23,154-158,208-210`

- [ ] **Step 1: Write tests for WorkbookCache**

Add to the `tests` module:

```rust
    #[test]
    fn workbook_cache_insert_and_get() {
        let cache = WorkbookCache::default();
        let path = std::path::PathBuf::from("/tmp/test.xlsx");
        let book = umya_spreadsheet::new_file();
        let rev = FileRevision { mtime_ms: 1000, size: 500 };

        cache.insert(path.clone(), book, rev.clone());

        let inner = cache.inner.lock().unwrap();
        let snap = inner.get(&path).unwrap();
        assert_eq!(snap.revision.mtime_ms, 1000);
        assert_eq!(snap.revision.size, 500);
    }

    #[test]
    fn workbook_cache_evict() {
        let cache = WorkbookCache::default();
        let path = std::path::PathBuf::from("/tmp/test.xlsx");
        let book = umya_spreadsheet::new_file();
        let rev = FileRevision { mtime_ms: 1000, size: 500 };

        cache.insert(path.clone(), book, rev);
        cache.evict(&path);

        let inner = cache.inner.lock().unwrap();
        assert!(inner.get(&path).is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::workbook_cache 2>&1 | tail -10`
Expected: FAIL — `WorkbookCache` not defined

- [ ] **Step 3: Implement WorkbookCache**

Add after the `FsWriteResponse` struct (after line 133) in `fs.rs`:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

// ── Workbook snapshot cache ──

struct WorkbookSnapshot {
    book: umya_spreadsheet::Spreadsheet,
    revision: FileRevision,
}

#[derive(Default)]
pub struct WorkbookCache {
    inner: Mutex<HashMap<PathBuf, WorkbookSnapshot>>,
}

impl WorkbookCache {
    pub fn insert(&self, path: PathBuf, book: umya_spreadsheet::Spreadsheet, revision: FileRevision) {
        let mut map = self.inner.lock().unwrap();
        map.insert(path, WorkbookSnapshot { book, revision });
    }

    pub fn evict(&self, path: &Path) {
        let mut map = self.inner.lock().unwrap();
        map.remove(path);
    }

    /// Take the cached book if revision matches expected. Returns None on miss or mismatch.
    pub fn take_if_fresh(&self, path: &Path, expected: Option<&FileRevision>) -> Option<umya_spreadsheet::Spreadsheet> {
        let mut map = self.inner.lock().unwrap();
        if let Some(snap) = map.get(path) {
            let matches = match expected {
                Some(exp) => snap.revision.mtime_ms == exp.mtime_ms && snap.revision.size == exp.size,
                None => true, // no expected revision = accept cache
            };
            if matches {
                return Some(map.remove(path).unwrap().book);
            }
        }
        None
    }

    pub fn update_revision(&self, path: &Path, book: umya_spreadsheet::Spreadsheet, revision: FileRevision) {
        let mut map = self.inner.lock().unwrap();
        map.insert(path.to_path_buf(), WorkbookSnapshot { book, revision });
    }
}
```

- [ ] **Step 4: Run cache tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- tests::workbook_cache 2>&1 | tail -10`
Expected: 2 tests PASS

- [ ] **Step 5: Add cache to fs_read_file (Sheet branch)**

Modify `fs_read_file` to accept Tauri state and populate cache. Change the function signature:

```rust
#[tauri::command]
pub async fn fs_read_file(
    req: FsReadRequest,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<FsReadResponse, FsError> {
```

In the `FileType::Sheet` branch, after reading the book, add cache insertion:

```rust
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
            // Cache the parsed workbook
            cache.insert(path.to_path_buf(), book, revision.clone());
            Ok(FsReadResponse::Sheet { content, capabilities, revision })
        }
```

- [ ] **Step 6: Add cache to fs_write_file (Sheet branch)**

Change `fs_write_file` signature to accept cache state:

```rust
#[tauri::command]
pub async fn fs_write_file(
    req: FsWriteRequest,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<FsWriteResponse, FsError> {
```

Replace the Sheet branch to use cached workbook:

```rust
        WritePayload::Sheet { deltas } => {
            let path_buf = path.to_path_buf();

            // Try cache first, fall back to disk read
            let mut book = cache.take_if_fresh(&path_buf, req.expected_revision.as_ref())
                .map(Ok)
                .unwrap_or_else(|| {
                    umya_spreadsheet::reader::xlsx::read(&path).map_err(|e| {
                        FsError::Internal {
                            message: format!("Failed to read spreadsheet for update: {}", e),
                        }
                    })
                })?;

            apply_deltas(&mut book, &deltas)?;

            let revision = atomic_write_with_lock(&path, req.expected_revision.as_ref(), |tmp| {
                umya_spreadsheet::writer::xlsx::write(&book, tmp).map_err(|e| {
                    FsError::Internal {
                        message: format!("Failed to write spreadsheet: {}", e),
                    }
                })
            })?;

            // Update cache with mutated book and new revision
            cache.update_revision(&path_buf, book, revision.clone());
            revision
        }
```

- [ ] **Step 7: Add fs_close_file command**

Add after `fs_write_file`:

```rust
#[tauri::command]
pub async fn fs_close_file(
    path: String,
    cache: tauri::State<'_, WorkbookCache>,
) -> Result<(), FsError> {
    cache.evict(Path::new(&path));
    Ok(())
}
```

- [ ] **Step 8: Register in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`:

1. Update the import line (line 23):
```rust
use commands::fs::{fs_close_file, fs_read_dir, fs_read_file, fs_write_file, WorkbookCache};
```

2. Add `.manage(WorkbookCache::default())` after line 157 (after `WorkspaceWatchState`):
```rust
        .manage(WorkbookCache::default())
```

3. Add `fs_close_file` to the `invoke_handler` list (after `fs_write_file` on line 210):
```rust
            fs_write_file,
            fs_close_file
```

- [ ] **Step 9: Verify full compilation**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles successfully

- [ ] **Step 10: Run all tests**

Run: `cd apps/desktop/src-tauri && cargo test --lib 2>&1 | tail -10`
Expected: all tests PASS

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add WorkbookCache and fs_close_file command"
```

---

### Task 6: Frontend — fsCloseFile and FileEditorPanel integration

**Files:**
- Modify: `apps/app/src/app/lib/tauri-fs.ts:97`
- Modify: `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx:7-16,79-108`

- [ ] **Step 1: Add fsCloseFile to tauri-fs.ts**

Add at the end of `apps/app/src/app/lib/tauri-fs.ts` (after line 97):

```ts

// ── Close API (cache eviction) ──

export async function fsCloseFile(path: string): Promise<void> {
  return invoke<void>("fs_close_file", { path });
}
```

- [ ] **Step 2: Import fsCloseFile in FileEditorPanel.tsx**

In `FileEditorPanel.tsx`, update the import (line 8-15):

```ts
import {
  fsReadFile,
  fsWriteFile,
  fsCloseFile,
  type FsEntry,
  type FsReadResponse,
  type FileRevision,
  type CellDelta,
} from "../../lib/tauri-fs";
```

- [ ] **Step 3: Call fsCloseFile on file switch**

In `FileEditorPanel.tsx`, in the `loadFile` function, add `fsCloseFile` call before loading the new file. After line 90 (`setIsDirty(false);`), add:

```ts
    // Evict previous file from backend cache
    const prevPath = selectedFilePath();
    if (prevPath) {
      fsCloseFile(prevPath).catch(() => {}); // fire-and-forget
    }
```

- [ ] **Step 4: Add onCleanup for panel unmount**

At the top of the `FileEditorPanel` component function (after line 36, the signal declarations), add:

```ts
  import { onCleanup } from "solid-js";
```

Wait — `onCleanup` is already importable from solid-js. Update the import at line 0:

```ts
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
```

Then add after line 36:

```ts
  // Evict cache on panel unmount
  onCleanup(() => {
    const path = selectedFilePath();
    if (path) {
      fsCloseFile(path).catch(() => {});
    }
  });
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd apps/app && npx tsc --noEmit 2>&1 | tail -10` (or equivalent build check)
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/app/lib/tauri-fs.ts apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx
git commit -m "feat: add fsCloseFile and call on file switch and panel unmount"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd apps/desktop/src-tauri && cargo test --lib 2>&1`
Expected: all tests PASS

- [ ] **Step 2: Verify full Rust compilation**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -5`
Expected: compiles cleanly

- [ ] **Step 3: Verify frontend compilation**

Run: `cd apps/app && npx tsc --noEmit 2>&1 | tail -10`
Expected: no type errors

- [ ] **Step 4: Final commit (if any cleanup needed)**

Only if previous steps revealed issues.
