# Workbook Cache — Path Aliasing & Error-Class Fixes

**Date:** 2026-04-21
**Scope:** `apps/desktop/src-tauri/src/commands/spreadsheet.rs`, `apps/desktop/src-tauri/src/commands/fs.rs`, `apps/app/src/app/lib/tauri-fs.ts`, `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`

## 1. Problem

Two correctness bugs currently live in the workbook gateway:

### 1.1 Path aliasing in `WorkbookCache`

`WorkbookCache.entries` is a `DashMap<PathBuf, Arc<Mutex<WorkbookSnapshot>>>` keyed by raw `PathBuf`. Paths pointing at the same file but spelled differently — `foo.xlsx`, `./foo.xlsx`, `/abs/foo.xlsx`, `/abs/./foo.xlsx` — produce distinct `DashMap` entries. Each entry has its own `Mutex`, so aliased concurrent callers bypass the per-workbook serialization guarantee and can race against the same underlying file. The visible symptoms are phantom `CacheEvicted` / stale reads, silent cache bloat, and non-deterministic `RevisionMismatch` results under concurrency.

### 1.2 Error-class collision at the IPC boundary

`fs.rs::sheet_err_to_fs` collapses both `SheetError::RevisionMismatch` and `SheetError::CacheEvicted` into `FsError::Conflict`:

```rust
S::RevisionMismatch { message } | S::CacheEvicted { message } => FsError::Conflict { message },
```

The frontend needs to distinguish these to pick the correct recovery: a `RevisionMismatch` means "reload latest and retry the save"; a `CacheEvicted` means "re-open the workbook before you can save." Both current paths hit the same `code === "Conflict"` branch in `FileEditorPanel.tsx`, so the user always sees the reload prompt even when re-open is required.

Neither bug is malicious; both stem from shortcuts taken during the initial cache implementation.

## 2. Goals

- `WorkbookCache` serializes all operations on aliases of the same underlying file through a single mutex.
- Frontend receives distinct error codes for `RevisionMismatch` vs. `CacheEvicted` and can branch on them.
- No change to `FileRevision` semantics, the optimistic-concurrency protocol, or the disk I/O layer.
- No regressions in the existing `WorkbookCache` / `atomic_write_*` test suites.

## 3. Non-Goals

- Adding a cache-size eviction policy.
- Normalizing paths outside `WorkbookCache` (callers still pass whatever path they want; canonicalization is an implementation detail of the cache).
- Resolving symlinks differently on Windows vs. Unix — we accept whatever `std::fs::canonicalize` returns per platform, including `\\?\` UNC prefixes on Windows.
- Migrating text-write error semantics. `atomic_write_with_lock` still returns `FsError::Conflict` for stale-revision on text writes; that remains its contract.

## 4. Design

### 4.1 Canonical path key inside `WorkbookCache`

Add a private helper:

```rust
fn canonical_key(path: &Path) -> Result<PathBuf, FsError> {
    match std::fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New-file path: canonicalize the parent, then join the filename.
            let parent = path.parent().ok_or_else(|| FsError::InvalidRequest {
                message: format!("Path has no parent directory: {}", path.display()),
            })?;
            let file_name = path.file_name().ok_or_else(|| FsError::InvalidRequest {
                message: format!("Path has no file name: {}", path.display()),
            })?;
            let canon_parent = std::fs::canonicalize(parent).map_err(FsError::from)?;
            Ok(canon_parent.join(file_name))
        }
        Err(e) => Err(FsError::from(e)),
    }
}
```

All public cache methods (`open_windowed`, `mutate`, `close`) compute `key = canonical_key(path)?` exactly once at entry and use `&key` for both every `DashMap` access and every filesystem call inside the method body. This guarantees the inner `Mutex` held via `entries.get(&key)` genuinely serializes aliased callers.

`close` is best-effort: if canonicalization fails, it is a no-op — nothing can be evicted under a key we can't compute.

### 4.2 Unified error enum — one `FsError`, no conversions

Collapse `FsError` and `SheetError` into a single flat enum in `fs.rs`. The `SheetError` type and every adapter (`fs_to_sheet_err`, `sheet_err_to_fs`) are deleted.

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
    FileLocked { message: String },
    #[error("{message}")]
    InvalidRequest { message: String },
    #[error("{message}")]
    Internal { message: String },
    // Previously on SheetError
    #[error("{message}")]
    RevisionMismatch { message: String },
    #[error("{message}")]
    CacheEvicted { message: String },
    #[error("{message}")]
    ParseError { message: String },
    #[error("{message}")]
    WriteFailed { message: String },
}

impl From<std::io::Error> for FsError { /* unchanged shape */ }
```

`Conflict` is kept as a distinct variant from `RevisionMismatch`: `Conflict` is for text-file atomic-write stale-revision failures (produced by `atomic_write_with_lock`); `RevisionMismatch` is for the cache's revision check on a live `WorkbookSnapshot`. They arise at different layers and call for different recovery, so they stay separate even under one enum.

Signature changes (no new types introduced):
- `WorkbookCache::open_windowed` → `Result<(WorkbookData, FileRevision), FsError>`
- `WorkbookCache::mutate` → `Result<FileRevision, FsError>`
- `WorkbookCache::open` (test-only) → `Result<(WorkbookData, FileRevision), FsError>`
- `apply_deltas` → `Result<(), FsError>` (only `InvalidRequest` path today)
- `canonical_key` → `Result<PathBuf, FsError>`
- `fs_read_file` / `fs_write_file` / `fs_close_file` keep their existing `Result<_, FsError>` return type; since there is now a single enum, no conversion at the boundary.

Internal helpers (`atomic_write_with_lock`, `get_revision`, `guard_file_write`) already return `FsError` and require no change.

### 4.3 Frontend updates

`apps/app/src/app/lib/tauri-fs.ts`:
- Delete the now-redundant `SheetError` / `SheetErrorCode` exports.
- Widen `FsErrorCode` to the union: `"NotFound" | "PermissionDenied" | "NotSupported" | "Conflict" | "FileLocked" | "InvalidRequest" | "Internal" | "RevisionMismatch" | "CacheEvicted" | "ParseError" | "WriteFailed"`.
- Remove the TODO on line 138 — the migration it anticipates is complete, with a simpler outcome (one enum, not two).

`apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`:
- Branch the save-error handler:
  - `code === "Conflict" || code === "RevisionMismatch"` → current "reload latest vs. overwrite" prompt.
  - `code === "CacheEvicted"` → "This workbook is no longer cached. Re-open the file to continue." Trigger `loadFile(entry)` unconditionally; do not offer overwrite, since `mutate` without a cache entry cannot proceed without a re-parse.

## 5. Data Flow

### 5.1 `open_windowed(path, window)`
1. `key = canonical_key(path)?`
2. `entries.get(&key)` hit → clone `Arc`, drop shard guard, lock, translate, return.
3. Miss → `key.exists()`; if absent, `FsError::NotFound`. Else parse from `&key`, insert under `key`.

### 5.2 `mutate(path, expected_revision, deltas)`
1. `key = canonical_key(path)?`
2. `entries.get(&key)` hit → unchanged logic, but `atomic_write_with_lock(&key, …)` and `get_revision(&key)` instead of `path`.
3. Miss + `key.try_exists() == Ok(true)` → `FsError::CacheEvicted`.
4. Miss + `Ok(false)` → new-file branch writes to `&key`, inserts under `key`.

### 5.3 `close(path)`
- `if let Ok(key) = canonical_key(path) { entries.remove(&key); }`.

## 6. Error Recovery Matrix (frontend contract)

| Backend code        | Meaning                                                 | Frontend recovery                        |
| ------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `Conflict`          | Text-file atomic write saw stale revision               | Offer reload or force-overwrite          |
| `RevisionMismatch`  | Cached workbook's revision disagrees with caller        | Offer reload or force-overwrite          |
| `CacheEvicted`      | Workbook not cached but file exists on disk             | Re-open workbook, then user retries save |
| `FileLocked`        | `fd_lock` contention exhausted retries                  | Toast + back-off retry                   |
| `NotFound`          | Path does not exist (or vanished during operation)      | Toast; refresh tree                      |
| `PermissionDenied`  | OS-level denial                                         | Toast                                    |
| `ParseError`        | `umya_spreadsheet` could not read the file              | Toast; mark file as non-editable         |
| `WriteFailed`       | Internal write failure surfaced from cache path         | Toast                                    |
| `InvalidRequest`    | Missing `expected_revision` on cached mutate, bad path  | Bug — log                                |
| `NotSupported`      | Payload/file-type mismatch                              | Bug — log                                |
| `Internal`          | Unexpected                                              | Toast; log                               |

## 7. Testing

**TDD order per user CLAUDE.md rule 2: each test is written and observed to fail before the corresponding implementation lands.**

### 7.1 `spreadsheet.rs` unit tests (new)

1. `canonical_key_dedups_relative_and_absolute` — open with absolute and with a relative form (resolved against a known CWD); assert `entries` contains exactly one entry after both calls.
2. `canonical_key_dedups_dot_segments` — open with `tmpdir.join("./a/../x.xlsx")` and `tmpdir.join("x.xlsx")`; exactly one entry.
3. `concurrent_mutate_via_aliased_paths_serialises` — two threads, one relative + one absolute, same expected revision. Exactly one `Ok`, the other `FsError::RevisionMismatch`. This test must fail on the pre-fix code (currently aliasing bypasses the mutex) and pass after.
4. `canonical_key_new_file_uses_parent_canonicalization` — mutate with a non-existent `./new.xlsx`; after success, iterate `entries` and assert the key equals the canonicalized absolute path.
5. `canonical_key_missing_parent_errors` — mutate with `/nonexistent_root/dir/x.xlsx`; pin the resulting `FsError` variant (expected: `NotFound` from `canonicalize(parent)`'s io::Error).
6. `close_with_aliased_path_evicts_same_entry` — open with absolute, close with relative form; subsequent mutate with a real prior revision returns `CacheEvicted`.

### 7.2 `fs.rs` unit tests (new)

7. `fs_error_serializes_revision_mismatch` — `serde_json::to_value(&FsError::RevisionMismatch{..})`; assert `code == "RevisionMismatch"`.
8. `fs_error_serializes_cache_evicted` — as above, `code == "CacheEvicted"`.
9. `fs_error_from_io_error_preserves_kind` — `io::ErrorKind::NotFound` → `FsError::NotFound`; `PermissionDenied` → `FsError::PermissionDenied`; other → `FsError::Internal`.

### 7.3 Frontend tests (if harness present in `apps/app`)

11. Given `{code: "CacheEvicted"}`, the save-error handler chooses the re-open branch and calls `loadFile`.
12. Given `{code: "RevisionMismatch"}`, the handler behaves identically to the existing `Conflict` path.

### 7.4 Regression safeguard

All existing `WorkbookCache` tests use absolute `tmpdir` paths; canonicalization is effectively a no-op for them and they must continue to pass unchanged. `atomic_write_*` tests are untouched by this work.

## 8. Implementation Ordering

Two independently green commits to keep bisection useful:

**Commit A — Unify `FsError`, delete `SheetError`**
1. Extend `FsError` with `RevisionMismatch`, `CacheEvicted`, `ParseError`, `WriteFailed` variants. Add unit tests 7, 8, 9.
2. Re-point `WorkbookCache`, `apply_deltas`, and all existing call sites to return `FsError`. Delete `SheetError`, `fs_to_sheet_err`, `sheet_err_to_fs`.
3. Command signatures (`fs_read_file`, `fs_write_file`, `fs_close_file`) remain `Result<_, FsError>` but now carry the new variants.
4. Update `tauri-fs.ts` (widen `FsErrorCode`, delete `SheetError`/`SheetErrorCode`). Update `FileEditorPanel.tsx` save-error branch (add `RevisionMismatch` / `CacheEvicted` handling).
5. Frontend tests 11, 12 if harness exists.
6. Path-aliasing bug is NOT yet fixed at this commit; backend behavior is preserved other than the new error tags being surfaced.

**Commit B — Canonical path key**
1. Add `canonical_key` private helper returning `FsError` (tests 1, 2, 4, 5: red → green).
2. Thread `key` through `open_windowed`, `mutate`, `close` (tests 3, 6).
3. No new enum variants, no frontend changes.

## 9. Risks & Mitigations

- **Windows canonical path prefix (`\\?\`).** Keys on Windows will carry the verbatim prefix. This is fine because (a) all callers of the cache pass paths the cache itself canonicalizes, and (b) we never surface keys to the frontend. Document this in a comment on `canonical_key`.
- **Missing parent on new-file path.** Surfaced as `FsError::NotFound` (matching `canonicalize`'s error kind). The current code would have failed anyway when `atomic_write_with_lock` tried to create the temp file in a nonexistent parent — behavior is unchanged, error class is cleaner.
- **Command-surface evolution.** `FsError` gains four new tags (`RevisionMismatch`, `CacheEvicted`, `ParseError`, `WriteFailed`). Existing frontend code that matches on the pre-existing seven codes continues to work; new codes are additive. No consumer of `SheetError` exists on the frontend today (the type was exported but never narrowed against), so deleting it is safe.
- **Performance.** `canonicalize` is one `stat`-family syscall per public-method entry. Workbook operations already do syscalls (parse/write), so this is in the noise.

## 10. Open Questions

None at time of writing. Answers captured in Section 4 resolve:
- Canonicalization strategy: `std::fs::canonicalize`.
- New-file handling: canonicalize parent + join name.
- Error model: single flat `FsError` enum — delete `SheetError`, eliminate all adapter functions.
