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
fn canonical_key(path: &Path) -> Result<PathBuf, SheetError> {
    match std::fs::canonicalize(path) {
        Ok(p) => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New-file path: canonicalize the parent, then join the filename.
            let parent = path.parent().ok_or_else(|| SheetError::InvalidRequest {
                message: format!("Path has no parent directory: {}", path.display()),
            })?;
            let file_name = path.file_name().ok_or_else(|| SheetError::InvalidRequest {
                message: format!("Path has no file name: {}", path.display()),
            })?;
            let canon_parent = std::fs::canonicalize(parent).map_err(SheetError::from)?;
            Ok(canon_parent.join(file_name))
        }
        Err(e) => Err(SheetError::from(e)),
    }
}
```

All public cache methods (`open_windowed`, `mutate`, `close`) compute `key = canonical_key(path)?` exactly once at entry and use `&key` for both every `DashMap` access and every filesystem call inside the method body. This guarantees the inner `Mutex` held via `entries.get(&key)` genuinely serializes aliased callers.

`close` is best-effort: if canonicalization fails, it is a no-op — nothing can be evicted under a key we can't compute.

### 4.2 Error surfacing at the command boundary

Introduce a unified command-level error enum in `fs.rs`:

```rust
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code")]
pub enum FsCommandError {
    // From FsError
    NotFound { message: String },
    PermissionDenied { message: String },
    NotSupported { message: String },
    Conflict { message: String },
    FileLocked { message: String },
    InvalidRequest { message: String },
    Internal { message: String },
    // New: from SheetError
    RevisionMismatch { message: String },
    CacheEvicted { message: String },
    ParseError { message: String },
    WriteFailed { message: String },
}

impl From<FsError> for FsCommandError { /* 1:1 variant map */ }
impl From<SheetError> for FsCommandError { /* 1:1 variant map; InvalidRequest/NotFound/PermissionDenied/FileLocked/Internal preserved */ }
```

Signature changes:
- `fs_read_file` → `Result<FsReadResponse, FsCommandError>`
- `fs_write_file` → `Result<FsWriteResponse, FsCommandError>`
- `fs_close_file` → `Result<(), FsCommandError>`

Delete the `sheet_err_to_fs` adapter. Internal helpers (`atomic_write_with_lock`, `get_revision`, `guard_file_write`) continue to return `FsError` — the conversion to `FsCommandError` happens only at command boundaries via `?`.

### 4.3 Frontend updates

`apps/app/src/app/lib/tauri-fs.ts`:
- Widen `FsErrorCode` to the union: `"NotFound" | "PermissionDenied" | "NotSupported" | "Conflict" | "FileLocked" | "InvalidRequest" | "Internal" | "RevisionMismatch" | "CacheEvicted" | "ParseError" | "WriteFailed"`.
- Rename the type alias to `FsCommandErrorCode` / `FsCommandError` (or keep the old names and document that they are now the unified command error). Remove the TODO on line 138.

`apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`:
- Branch the save-error handler:
  - `code === "Conflict" || code === "RevisionMismatch"` → current "reload latest vs. overwrite" prompt.
  - `code === "CacheEvicted"` → "This workbook is no longer cached. Re-open the file to continue." Trigger `loadFile(entry)` unconditionally; do not offer overwrite, since `mutate` without a cache entry cannot proceed without a re-parse.

## 5. Data Flow

### 5.1 `open_windowed(path, window)`
1. `key = canonical_key(path)?`
2. `entries.get(&key)` hit → clone `Arc`, drop shard guard, lock, translate, return.
3. Miss → `key.exists()`; if absent, `SheetError::NotFound`. Else parse from `&key`, insert under `key`.

### 5.2 `mutate(path, expected_revision, deltas)`
1. `key = canonical_key(path)?`
2. `entries.get(&key)` hit → unchanged logic, but `atomic_write_with_lock(&key, …)` and `get_revision(&key)` instead of `path`.
3. Miss + `key.try_exists() == Ok(true)` → `SheetError::CacheEvicted`.
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
3. `concurrent_mutate_via_aliased_paths_serialises` — two threads, one relative + one absolute, same expected revision. Exactly one `Ok`, the other `SheetError::RevisionMismatch`. This test must fail on the pre-fix code (currently aliasing bypasses the mutex) and pass after.
4. `canonical_key_new_file_uses_parent_canonicalization` — mutate with a non-existent `./new.xlsx`; after success, iterate `entries` and assert the key equals the canonicalized absolute path.
5. `canonical_key_missing_parent_errors` — mutate with `/nonexistent_root/dir/x.xlsx`; pin the resulting `SheetError` variant (expected: `NotFound` from `canonicalize(parent)`'s io::Error).
6. `close_with_aliased_path_evicts_same_entry` — open with absolute, close with relative form; subsequent mutate with a real prior revision returns `CacheEvicted`.

### 7.2 `fs.rs` unit tests (new)

7. `fs_command_error_serializes_revision_mismatch` — `serde_json::to_value(&FsCommandError::RevisionMismatch{..})`; assert `code == "RevisionMismatch"`.
8. `fs_command_error_serializes_cache_evicted` — as above, `code == "CacheEvicted"`.
9. `from_sheet_error_preserves_variant` — exhaustive match over each `SheetError` variant → `FsCommandError`, assert tag equality.
10. `from_fs_error_preserves_variant` — same for `FsError` → `FsCommandError`.

### 7.3 Frontend tests (if harness present in `apps/app`)

11. Given `{code: "CacheEvicted"}`, the save-error handler chooses the re-open branch and calls `loadFile`.
12. Given `{code: "RevisionMismatch"}`, the handler behaves identically to the existing `Conflict` path.

### 7.4 Regression safeguard

All existing `WorkbookCache` tests use absolute `tmpdir` paths; canonicalization is effectively a no-op for them and they must continue to pass unchanged. `atomic_write_*` tests are untouched by this work.

## 8. Implementation Ordering

Two independently green commits to keep bisection useful:

**Commit A — Canonical path key**
1. Add `canonical_key` private helper with unit tests 1, 2, 4, 5 (red → green).
2. Thread `key` through `open_windowed`, `mutate`, `close` (tests 3, 6).
3. No changes to `FsError`, no changes to frontend.

**Commit B — Error surfacing**
1. Add `FsCommandError` + `From` impls with unit tests 7, 8, 9, 10.
2. Change command signatures; delete `sheet_err_to_fs`.
3. Update `tauri-fs.ts` types; update `FileEditorPanel.tsx` save-error branch.
4. Frontend tests 11, 12 if harness exists.

## 9. Risks & Mitigations

- **Windows canonical path prefix (`\\?\`).** Keys on Windows will carry the verbatim prefix. This is fine because (a) all callers of the cache pass paths the cache itself canonicalizes, and (b) we never surface keys to the frontend. Document this in a comment on `canonical_key`.
- **Missing parent on new-file path.** Surfaced as `SheetError::NotFound` (matching `canonicalize`'s error kind). The current code would have failed anyway when `atomic_write_with_lock` tried to create the temp file in a nonexistent parent — behavior is unchanged, error class is cleaner.
- **Command-surface breaking change.** `FsCommandError` serialized payload is a superset of `FsError`'s (all existing tags preserved). Existing frontend code that only matches on the old codes continues to work. New codes are additive.
- **Performance.** `canonicalize` is one `stat`-family syscall per public-method entry. Workbook operations already do syscalls (parse/write), so this is in the noise.

## 10. Open Questions

None at time of writing. Answers captured in Section 4 resolve:
- Canonicalization strategy: `std::fs::canonicalize`.
- New-file handling: canonicalize parent + join name.
- Error surfacing: unified `FsCommandError` from both `FsError` and `SheetError`.
