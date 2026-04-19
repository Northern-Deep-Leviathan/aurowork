# File Editor Robustness Improvements

## Summary

Address four robustness concerns in the file editor panel backend: idiomatic error handling with `thiserror`, TOCTOU-safe atomic writes with exclusive file locking, crash-safe write-then-rename, and a workbook snapshot cache to avoid redundant xlsx parsing.

## Motivation

The current `fs.rs` implementation has:
1. `FsError` that doesn't impl `std::error::Error` — un-idiomatic, can't use `?` for error chaining.
2. A TOCTOU race between revision check and write — concurrent writes can silently clobber each other.
3. Direct writes to target path — a crash mid-write corrupts the file.
4. Full xlsx re-parse on every sheet save — wasteful when the workbook is already in memory from the read.

---

## 1. `FsError` with `thiserror`

### 1.1 Current

```rust
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
```

No `std::error::Error` impl. Cannot compose with `?` or error chains.

### 1.2 After

```rust
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
```

- `Display` is used for Rust-side logging and `?` propagation.
- `Serialize` with `serde(tag = "code")` is used for Tauri IPC (unchanged wire format).
- Add `thiserror = "2"` to `Cargo.toml`.

### 1.3 Convenience constructors

Add `From` impls for common error sources to enable `?` usage:

```rust
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

---

## 2. Atomic Write Protocol

### 2.1 Problem

The current write path has two issues:
- **TOCTOU race**: revision check and write are not atomic — two concurrent writers can both pass the check.
- **Crash safety**: `fs::write` / `umya::write` go directly to the target — a crash mid-write corrupts the file.

### 2.2 Protocol

All writes (text and sheet) use the same atomic write helper:

```
1. Write content to temp file:  .{filename}.tmp.{random}  (same directory)
2. fsync the temp file fd
3. Acquire exclusive lock on target file via fd-lock (retry loop, 5s timeout)
4. Check revision (mtime + size) under the lock → FsError::Conflict if mismatch
5. Rename temp → target (atomic on same filesystem)
6. Release lock (fd drop)
7. On any failure: clean up temp file
```

### 2.3 Helper signature

```rust
fn atomic_write_with_lock(
    target: &Path,
    expected_revision: Option<&FileRevision>,
    write_fn: impl FnOnce(&Path) -> Result<(), FsError>,
) -> Result<FileRevision, FsError>
```

- `write_fn` receives the temp file path and writes content there.
- The helper handles fsync, locking, revision check, rename, and cleanup.
- Returns the new `FileRevision` (stat after rename).

### 2.4 Locking details

- Use `fd-lock = "4"` crate for cross-platform exclusive file locks.
- Lock is acquired on the **target file** (opened for read, not the temp file).
- Retry loop with 50ms sleep, up to 5 seconds total. On timeout: `FsError::Conflict { message: "File is locked by another operation" }`.
- If the target file doesn't exist yet (new file creation): skip locking and revision check, just rename.

### 2.5 Text write integration

```rust
// Inside fs_write_file, WritePayload::Text branch:
atomic_write_with_lock(&path, expected_revision.as_ref(), |temp_path| {
    std::fs::write(temp_path, &content)?;
    Ok(())
})
```

### 2.6 Sheet write integration

```rust
// Inside fs_write_file, WritePayload::Sheet branch:
atomic_write_with_lock(&path, expected_revision.as_ref(), |temp_path| {
    // Get workbook from cache or re-read from disk (see section 3)
    umya_spreadsheet::writer::xlsx::write(&book, temp_path)
        .map_err(|e| FsError::Internal { message: e.to_string() })?;
    Ok(())
})
```

---

## 3. Workbook Snapshot Cache

### 3.1 Problem

Sheet writes currently re-parse the entire xlsx from disk on every save. Since `fs_read_file` already parsed the workbook, we can cache it and apply deltas to the in-memory copy.

### 3.2 Data structures

```rust
struct WorkbookSnapshot {
    book: umya_spreadsheet::Spreadsheet,
    revision: FileRevision,
}

pub struct WorkbookCache {
    inner: Mutex<HashMap<PathBuf, WorkbookSnapshot>>,
}
```

`WorkbookCache` is registered as Tauri managed state.

### 3.3 Read path

When `fs_read_file` returns a `Sheet` response:
1. Parse the xlsx with `umya_spreadsheet::reader::xlsx::read`.
2. Clone the `Spreadsheet` into the cache with the current `FileRevision`.
3. Translate to `WorkbookData` (sparse cells) for the frontend.

### 3.4 Write path

When `fs_write_file` receives a `Sheet` payload:
1. Look up the cached `WorkbookSnapshot` by path.
2. If cache hit and `snapshot.revision == expected_revision`: apply deltas to `snapshot.book`.
3. If cache miss or revision mismatch: re-read from disk, apply deltas.
4. Write via `atomic_write_with_lock` (section 2).
5. On success: update `snapshot.revision` in the cache to the new revision.

### 3.5 Eviction

- New Tauri command: `fs_close_file(path: String) -> Result<(), FsError>`.
- Removes the cache entry for the given path.
- Frontend calls `fsCloseFile(prevPath)` when switching files or closing the editor panel.

### 3.6 Frontend additions

In `tauri-fs.ts`:

```ts
export async function fsCloseFile(path: string): Promise<void> {
  return invoke<void>("fs_close_file", { path });
}
```

In `FileEditorPanel.tsx`:
- Before loading a new file (after unsaved-change guard), call `fsCloseFile(previousEntry.path)`.
- On panel unmount (`onCleanup`), call `fsCloseFile` for the current file.

---

## 4. Dependencies

| Crate | Version | Purpose |
|---|---|---|
| `thiserror` | `"2"` | Derive `std::error::Error` for `FsError` |
| `fd-lock` | `"4"` | Cross-platform exclusive file locks |

---

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/desktop/src-tauri/src/commands/fs.rs` | `FsError` derives `thiserror::Error`; `From<io::Error>` impl; `atomic_write_with_lock` helper; `WorkbookCache` struct; `fs_close_file` command; refactor `fs_write_file` to use atomic write |
| `apps/desktop/src-tauri/src/lib.rs` | Register `fs_close_file`; add `WorkbookCache` as `.manage()` state |
| `apps/desktop/src-tauri/Cargo.toml` | Add `thiserror = "2"`, `fd-lock = "4"` |
| `apps/app/src/lib/tauri-fs.ts` | Add `fsCloseFile(path)` function |
| `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx` | Call `fsCloseFile` on file switch and panel cleanup |

---

## 6. Test Plan

**Backend tests:**
- `FsError` implements `std::error::Error` and `Display` (compile-time + unit test)
- `From<io::Error>` maps `NotFound`, `PermissionDenied`, other → `Internal`
- Atomic write: temp file cleaned up on failure
- Atomic write: revision conflict detected under lock
- Atomic write: concurrent writes to same file — one succeeds, one gets `Conflict`
- Workbook cache: read populates cache, write uses cached book
- Workbook cache: `fs_close_file` evicts entry
- Workbook cache: write with stale revision re-reads from disk

**Frontend tests:**
- `fsCloseFile` called on file switch
- `fsCloseFile` called on panel unmount

---

## 7. Non-goals

- External-process lock coordination (advisory locks are best-effort against external tools).
- Streaming/partial xlsx writes — umya-spreadsheet requires full workbook serialization. The cache eliminates redundant parsing but not redundant serialization.
