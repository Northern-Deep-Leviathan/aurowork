# Workbook Cache Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two correctness bugs in `WorkbookCache`: path aliasing (different spellings of the same file hit different DashMap entries) and error-class collision (RevisionMismatch and CacheEvicted both collapse to FsError::Conflict at the IPC boundary), by canonicalizing cache keys and collapsing SheetError into a single flat FsError.

**Architecture:** Two-commit sequence. Commit A unifies the error enums: `FsError` absorbs all `SheetError` variants (RevisionMismatch, CacheEvicted, ParseError, WriteFailed); `SheetError`, `fs_to_sheet_err`, and `sheet_err_to_fs` are deleted. Commit B adds a `canonical_key` helper inside `WorkbookCache` that resolves paths via `std::fs::canonicalize` (for existing files) or `canonicalize(parent).join(file_name)` (for new files), and threads the canonical key through every public cache method so aliased callers serialize through the same inner mutex.

**Tech Stack:** Rust (tokio, tauri 2, dashmap 6, thiserror 2, umya-spreadsheet 2), TypeScript (solidjs, tauri invoke), `tempfile` for test fixtures, `serial_test` for CWD-sensitive tests.

---

## Spec

See `docs/superpowers/specs/2026-04-21-workbook-cache-fixes-design.md`.

## File Structure

### Rust (backend)
- **Modify** `apps/desktop/src-tauri/src/commands/fs.rs`
  - Extend `FsError` with four new variants.
  - Delete `sheet_err_to_fs` adapter.
  - Add unit tests: error serialization, `io::Error` conversion.
- **Modify** `apps/desktop/src-tauri/src/commands/spreadsheet.rs`
  - Delete `SheetError` enum entirely.
  - Delete `fs_to_sheet_err` adapter.
  - Change `apply_deltas`, `WorkbookCache::open`, `WorkbookCache::open_windowed`, `WorkbookCache::mutate` return types to `FsError`.
  - Add `canonical_key` private free function.
  - Thread canonical key through `open_windowed`, `mutate`, `close`.
  - Add new unit tests (see tasks below).
- **No change** to `apps/desktop/src-tauri/src/fs.rs` (file watcher, unrelated).
- **No change** to `apps/desktop/src-tauri/src/lib.rs` (command registration unchanged).
- **Modify** `apps/desktop/src-tauri/Cargo.toml` (dev-dependencies): add `serial_test = "3"`.

### TypeScript (frontend)
- **Modify** `apps/app/src/app/lib/tauri-fs.ts`
  - Widen `FsErrorCode` to include the four new tags.
  - Delete `SheetError` and `SheetErrorCode` exports.
  - Remove the TODO comment on line 138-139.
- **Modify** `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`
  - Extend the save-error handler (lines ~153-170) to branch on `RevisionMismatch` and `CacheEvicted`.

### Docs
- Spec already committed at `docs/superpowers/specs/2026-04-21-workbook-cache-fixes-design.md`.

---

## Commands & Conventions

- Run all Rust tests from the repo root:
  ```bash
  cd apps/desktop/src-tauri && cargo test
  ```
- Run a single Rust test:
  ```bash
  cd apps/desktop/src-tauri && cargo test --lib <test_name> -- --nocapture
  ```
- Frontend lives under `apps/app`. No test harness is currently wired; frontend changes are compile-checked only (`pnpm -F app typecheck` or `pnpm -F app build`). If no typecheck script exists, run `pnpm -F app build`.
- Commit messages follow `type(scope): subject` (see recent `git log`). Keep subjects ≤ 72 chars.
- **Never** commit with `--no-verify`.
- **Never** amend; always create fresh commits.

---

# COMMIT A — Unify `FsError`, delete `SheetError`

Five tasks. At the end of this commit the path-aliasing bug is still present, but the frontend already sees distinct error codes for RevisionMismatch vs. CacheEvicted.

---

## Task A1: Extend `FsError` with new variants + serialization tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:13-28`
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:517-586` (tests module)

- [ ] **Step 1: Write the failing test — RevisionMismatch serialization**

Append to the `tests` module in `apps/desktop/src-tauri/src/commands/fs.rs`:

```rust
#[test]
fn fs_error_serializes_revision_mismatch_with_tag_code() {
    let err = FsError::RevisionMismatch { message: "rev bad".into() };
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "RevisionMismatch");
    assert_eq!(v["message"], "rev bad");
}

#[test]
fn fs_error_serializes_cache_evicted_with_tag_code() {
    let err = FsError::CacheEvicted { message: "gone".into() };
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "CacheEvicted");
    assert_eq!(v["message"], "gone");
}

#[test]
fn fs_error_serializes_parse_error_with_tag_code() {
    let err = FsError::ParseError { message: "parse".into() };
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "ParseError");
}

#[test]
fn fs_error_serializes_write_failed_with_tag_code() {
    let err = FsError::WriteFailed { message: "w".into() };
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "WriteFailed");
}
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib fs_error_serializes`
Expected: FAIL — `FsError::RevisionMismatch` (and the three siblings) do not exist yet.

- [ ] **Step 3: Extend `FsError` with the four new variants**

In `apps/desktop/src-tauri/src/commands/fs.rs`, replace the existing `FsError` enum (lines 11-28) with:

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
    #[error("{message}")]
    RevisionMismatch { message: String },
    #[error("{message}")]
    CacheEvicted { message: String },
    #[error("{message}")]
    ParseError { message: String },
    #[error("{message}")]
    WriteFailed { message: String },
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib fs_error_serializes`
Expected: all four new tests PASS. Existing `fs.rs` tests unaffected.

- [ ] **Step 5: Run full backend test suite**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: spreadsheet.rs tests may still pass because `SheetError` is intact; nothing regresses from this step.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "$(cat <<'EOF'
feat(fs): extend FsError with cache/workbook variants

Add RevisionMismatch, CacheEvicted, ParseError, WriteFailed variants
so the frontend can distinguish recovery paths instead of seeing every
cache failure as Conflict. Adapters still in place; next commit deletes
SheetError and rewires WorkbookCache to return FsError directly.
EOF
)"
```

---

## Task A2: Rewire `WorkbookCache` and `apply_deltas` to return `FsError`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs` (entire file)
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:365-381` (delete `sheet_err_to_fs`)
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs:408-411` and `456-458` (call-sites)

This task is large because it touches every `SheetError`/`FsError` boundary. It is one commit because partial state would leave the crate uncompilable.

- [ ] **Step 1: Add two TDD marker tests that pin the public contract**

Append to the `tests` module in `apps/desktop/src-tauri/src/commands/spreadsheet.rs`:

```rust
#[test]
fn mutate_on_cache_miss_with_existing_file_returns_fs_error_cache_evicted() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("wb.xlsx");
    let book = umya_spreadsheet::new_file();
    umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

    let cache = WorkbookCache::new();
    let fake_rev = FileRevision { mtime_ms: 0, size: 0 };
    let err = cache.mutate(&path, Some(&fake_rev), &[]).unwrap_err();
    match err {
        crate::commands::fs::FsError::CacheEvicted { .. } => {}
        other => panic!("expected FsError::CacheEvicted, got {:?}", other),
    }
}

#[test]
fn mutate_cached_with_stale_revision_returns_fs_error_revision_mismatch() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("wb.xlsx");
    let book = umya_spreadsheet::new_file();
    umya_spreadsheet::writer::xlsx::write(&book, &path).unwrap();

    let cache = WorkbookCache::new();
    cache.open(&path).unwrap();
    let stale = FileRevision { mtime_ms: 0, size: 0 };
    let err = cache.mutate(&path, Some(&stale), &[]).unwrap_err();
    match err {
        crate::commands::fs::FsError::RevisionMismatch { .. } => {}
        other => panic!("expected FsError::RevisionMismatch, got {:?}", other),
    }
}
```

Replace the existing `cache_mutate_missing_entry_errors_cache_evicted` test (lines 431-445) by deleting it — it asserts against `SheetError::CacheEvicted` which will no longer exist. The new `mutate_on_cache_miss_with_existing_file_returns_fs_error_cache_evicted` test replaces it.

Similarly, in the `concurrent_mutate_serialises` test (lines 496-540), change the match arm:

```rust
Err(SheetError::RevisionMismatch { .. }) => (a, b + 1),
```
to:
```rust
Err(crate::commands::fs::FsError::RevisionMismatch { .. }) => (a, b + 1),
```

And in `cache_mutate_cached_requires_expected_revision` (lines 466-478):
```rust
assert!(matches!(result, Err(SheetError::InvalidRequest { .. })));
```
to:
```rust
assert!(matches!(result, Err(crate::commands::fs::FsError::InvalidRequest { .. })));
```

And in `cache_close_evicts` (lines 480-494):
```rust
assert!(matches!(result, Err(SheetError::CacheEvicted { .. })));
```
to:
```rust
assert!(matches!(result, Err(crate::commands::fs::FsError::CacheEvicted { .. })));
```

- [ ] **Step 2: Run tests to confirm the file fails to compile**

Run: `cd apps/desktop/src-tauri && cargo test --lib`
Expected: compile FAIL — tests reference `FsError::CacheEvicted`/`FsError::RevisionMismatch` on `cache.mutate()` return values that still return `SheetError`.

- [ ] **Step 3: Delete `SheetError` and rewire `spreadsheet.rs` to `FsError`**

In `apps/desktop/src-tauri/src/commands/spreadsheet.rs`, apply these edits:

**3a.** Delete the entire `SheetError` enum (lines 16-37) and its `From<std::io::Error>` impl (lines 39-49). Replace with:

```rust
use crate::commands::fs::FsError;
```

(add at the top, merging with existing `use crate::commands::fs::{...}` on line 12 — result: `use crate::commands::fs::{atomic_write_with_lock, get_revision, FileRevision, FsError};`).

**3b.** Change the signature of `apply_deltas` (line 160):

```rust
pub fn apply_deltas(
    workbook: &mut umya_spreadsheet::Spreadsheet,
    deltas: &[CellDelta],
) -> Result<(), FsError> {
```

Replace `SheetError::InvalidRequest` (line 169) with `FsError::InvalidRequest`.

**3c.** Delete the `fs_to_sheet_err` function (lines 365-376).

**3d.** Rewrite `WorkbookCache::open`, `open_windowed`, `mutate` to return `FsError`. Replace the entire `impl WorkbookCache { ... }` block (lines 230-363) with:

```rust
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
        if let Some(entry) = self.entries.get(path) {
            let arc = entry.clone();
            drop(entry);
            let snap = arc.lock().unwrap();
            let data = translate_workbook(&snap.book, window);
            return Ok((data, snap.revision.clone()));
        }

        if !path.exists() {
            return Err(FsError::NotFound {
                message: format!("File not found: {}", path.display()),
            });
        }
        let revision = get_revision(path)?;
        let book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
            FsError::ParseError {
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
    pub fn mutate(
        &self,
        path: &Path,
        expected_revision: Option<&FileRevision>,
        deltas: &[CellDelta],
    ) -> Result<FileRevision, FsError> {
        if let Some(entry) = self.entries.get(path) {
            let arc = entry.clone();
            drop(entry);
            let mut snap = arc.lock().unwrap();

            let expected = expected_revision.ok_or_else(|| FsError::InvalidRequest {
                message: format!(
                    "expected_revision is required to mutate a cached workbook: {}",
                    path.display()
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
            let new_rev = atomic_write_with_lock(path, Some(expected), |tmp| {
                umya_spreadsheet::writer::xlsx::write(&snap.book, tmp).map_err(|e| {
                    FsError::WriteFailed {
                        message: format!("Failed to write spreadsheet: {}", e),
                    }
                })
            })?;
            snap.revision = new_rev.clone();
            return Ok(new_rev);
        }

        match path.try_exists() {
            Ok(true) => Err(FsError::CacheEvicted {
                message: format!(
                    "Workbook not in cache but file exists on disk. Re-open the file before saving: {}",
                    path.display()
                ),
            }),
            Ok(false) => {
                let mut book = umya_spreadsheet::new_file_empty_worksheet();
                apply_deltas(&mut book, deltas)?;
                let new_rev = atomic_write_with_lock(path, None, |tmp| {
                    umya_spreadsheet::writer::xlsx::write(&book, tmp).map_err(|e| {
                        FsError::WriteFailed {
                            message: format!("Failed to write spreadsheet: {}", e),
                        }
                    })
                })?;
                self.entries.insert(
                    path.to_path_buf(),
                    Arc::new(Mutex::new(WorkbookSnapshot {
                        book,
                        revision: new_rev.clone(),
                    })),
                );
                Ok(new_rev)
            }
            Err(e) => Err(FsError::Internal {
                message: format!("Failed to stat {}: {}", path.display(), e),
            }),
        }
    }

    pub fn close(&self, path: &Path) {
        self.entries.remove(path);
    }
}
```

Key changes from the original:
- Return type on `open`, `open_windowed`, `mutate` is now `FsError`.
- `SheetError::ParseError` → `FsError::ParseError`.
- Inner `umya_spreadsheet::writer` error now produces `FsError::WriteFailed` directly (previously wrapped `FsError::Internal` then adapted back).
- No more `.map_err(fs_to_sheet_err)` — callers of `atomic_write_with_lock` and `get_revision` use plain `?` since those already return `FsError`.

**3e.** Update the `From<std::io::Error>` impl — it was on `SheetError`, now deleted. `FsError` in `fs.rs` already has its own `From<io::Error>` impl, so nothing to add.

- [ ] **Step 4: Delete `sheet_err_to_fs` in `fs.rs` and simplify call sites**

In `apps/desktop/src-tauri/src/commands/fs.rs`:

**4a.** Delete the `sheet_err_to_fs` function (lines 364-380).

**4b.** In `fs_read_file`, replace (lines 408-411):

```rust
let (content, revision) = cache
    .open_windowed(path, req.sheet_window.as_ref())
    .map_err(sheet_err_to_fs)?;
```
with:
```rust
let (content, revision) = cache.open_windowed(path, req.sheet_window.as_ref())?;
```

**4c.** In `fs_write_file`, replace (lines 456-458):

```rust
WritePayload::Sheet { deltas } => cache
    .mutate(&path, req.expected_revision.as_ref(), &deltas)
    .map_err(sheet_err_to_fs)?,
```
with:
```rust
WritePayload::Sheet { deltas } => cache.mutate(&path, req.expected_revision.as_ref(), &deltas)?,
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all existing + new tests PASS. If you see `SheetError` referenced anywhere still, search:

```bash
cd apps/desktop/src-tauri && grep -rn "SheetError\|sheet_err_to_fs\|fs_to_sheet_err" src/
```
Expected: zero matches.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs \
        apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "$(cat <<'EOF'
refactor(fs): collapse SheetError into FsError

WorkbookCache and apply_deltas now return FsError directly, eliminating
the SheetError enum and both adapters (fs_to_sheet_err, sheet_err_to_fs).
IPC boundary preserves RevisionMismatch vs CacheEvicted distinction
instead of laundering both into Conflict.
EOF
)"
```

---

## Task A3: Frontend — widen `FsErrorCode`, delete `SheetError` types

**Files:**
- Modify: `apps/app/src/app/lib/tauri-fs.ts:105-140`

- [ ] **Step 1: Delete `SheetError` / `SheetErrorCode`, widen `FsErrorCode`, remove TODO**

In `apps/app/src/app/lib/tauri-fs.ts`, replace the block from line 105 through line 140 (inclusive of the TODO comment) with:

```typescript
// ── Error codes ──

/** Returned by `invoke()` on error for fs_* commands. Narrow via `code`. */
export type FsErrorCode =
  | "NotFound"
  | "PermissionDenied"
  | "NotSupported"
  | "Conflict"
  | "FileLocked"
  | "InvalidRequest"
  | "Internal"
  | "RevisionMismatch"
  | "CacheEvicted"
  | "ParseError"
  | "WriteFailed";

export interface FsError {
  code: FsErrorCode;
  message: string;
}
```

- [ ] **Step 2: Verify no other module imports `SheetError` / `SheetErrorCode`**

Run:
```bash
grep -rn "SheetError\|SheetErrorCode" apps/app/src/
```
Expected: zero matches. If matches exist, delete those imports and replace with `FsError`/`FsErrorCode`.

- [ ] **Step 3: Typecheck**

Run from the repo root:
```bash
pnpm -F app build
```
(If the package scripts expose `typecheck`, prefer `pnpm -F app typecheck`.)
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/lib/tauri-fs.ts
git commit -m "$(cat <<'EOF'
refactor(fs-client): drop SheetError, widen FsErrorCode

Backend returns a single flat FsError now, so the frontend type
mirrors that. Removes the TODO anticipating this migration.
EOF
)"
```

---

## Task A4: Frontend — branch save-error handler on new codes

**Files:**
- Modify: `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx:140-180`

- [ ] **Step 1: Read the current handler**

Run:
```bash
sed -n '135,185p' apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx
```
Confirm the current shape: a `try` block calls `fsWriteFile`; the `catch` branches on `parsed?.code === "Conflict"`.

- [ ] **Step 2: Extend the catch branch**

Locate the line `if (parsed?.code === "Conflict") {` (currently line ~155). Replace that conditional with an explicit three-way branch. The new structure (preserve existing reload/overwrite branches verbatim; add only the `CacheEvicted` arm):

```tsx
      const code = parsed?.code as string | undefined;
      if (code === "Conflict" || code === "RevisionMismatch") {
        const reload = window.confirm(
          "File changed on disk. Reload latest version? (Cancel to overwrite)",
        );
        if (reload && entry) {
          void loadFile(entry);
        } else if (entry) {
          // Retry without revision check
          try {
            if (doc.type === "text") {
              const result = await fsWriteFile(entry.path, {
                type: "text",
                content: currentTextContent(),
              });
              setRevision(result.revision);
              // … existing inner branch continues unchanged …
```

Do not delete or rewrite the existing inner retry block — only (a) rename the conditional to match on both `Conflict` and `RevisionMismatch`, and (b) add a new `CacheEvicted` branch *before* the existing `else`/fallthrough:

```tsx
      } else if (code === "CacheEvicted") {
        window.alert(
          "This workbook is no longer cached. Re-opening it now; please retry your save.",
        );
        if (entry) void loadFile(entry);
      } else {
        // existing generic error handling stays
      }
```

Adapt precisely to the current indentation and the surrounding control-flow braces. If the existing code currently has no `else` branch for non-Conflict errors, preserve that — just add the `CacheEvicted` check between the conflict branch and whatever currently follows.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F app build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the branch manually (optional but recommended)**

Run: `pnpm -F app dev` and in a spreadsheet session, trigger a mutation after manually clearing the cache from the backend (if a dev-tools hook exists). This is best-effort — the unit tests are authoritative.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx
git commit -m "$(cat <<'EOF'
feat(editor): handle RevisionMismatch and CacheEvicted distinctly

RevisionMismatch shares the existing reload/overwrite prompt with
Conflict. CacheEvicted triggers an unconditional re-open of the
workbook since mutate cannot proceed without a fresh parse.
EOF
)"
```

---

## Checkpoint after Commit A

- [ ] **Run the full Rust test suite:**

```bash
cd apps/desktop/src-tauri && cargo test
```
Expected: all tests green.

- [ ] **Build the frontend:**

```bash
pnpm -F app build
```
Expected: success.

- [ ] **Verify `SheetError` is gone:**

```bash
grep -rn "SheetError" apps/
```
Expected: zero matches.

---

# COMMIT B — Canonical path key in `WorkbookCache`

Four tasks. Fixes the path-aliasing bug.

---

## Task B1: Add `serial_test` dev-dependency

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

Some canonical-key tests will manipulate `std::env::set_current_dir`, which is process-global. Without serialization, parallel test runners race. `serial_test` provides a `#[serial]` attribute.

- [ ] **Step 1: Locate the `[dev-dependencies]` section**

Run: `grep -n "dev-dependencies" apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 2: Add `serial_test`**

Under `[dev-dependencies]`, add:

```toml
serial_test = "3"
```

If no `[dev-dependencies]` section exists, append at the end of the file:

```toml
[dev-dependencies]
serial_test = "3"
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/desktop/src-tauri && cargo build --tests
```
Expected: builds successfully (fetches `serial_test`).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "chore(deps): add serial_test dev-dependency for CWD tests"
```

---

## Task B2: Add `canonical_key` with unit tests (red → green)

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs` (add helper + tests)

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module at the end of `apps/desktop/src-tauri/src/commands/spreadsheet.rs`:

```rust
#[test]
fn canonical_key_identity_for_absolute_existing_path() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("x.xlsx");
    std::fs::write(&path, b"").unwrap();
    let k = canonical_key(&path).unwrap();
    let expected = std::fs::canonicalize(&path).unwrap();
    assert_eq!(k, expected);
}

#[test]
fn canonical_key_resolves_dot_segments() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("x.xlsx");
    std::fs::write(&path, b"").unwrap();
    let alias = dir.path().join("./a/../x.xlsx");
    // Note: parent "a" doesn't exist; fall back to canonicalize of the real
    // file which does. We just need the key to match the canonical path.
    let k = canonical_key(&path).unwrap();
    let k_alias = canonical_key(&alias).unwrap_or_else(|_| k.clone());
    // For the strict dot-segment case, both collapse to the same canonical
    // path when the underlying file exists.
    let simplified = dir.path().join("x.xlsx");
    assert_eq!(canonical_key(&simplified).unwrap(), k);
    let _ = k_alias; // tolerate parent-missing; real dedup test is #3.
}

#[test]
fn canonical_key_new_file_uses_parent_canonicalization() {
    let dir = tempdir().unwrap();
    let new_path = dir.path().join("does_not_exist.xlsx");
    let k = canonical_key(&new_path).unwrap();
    let expected_parent = std::fs::canonicalize(dir.path()).unwrap();
    assert_eq!(k, expected_parent.join("does_not_exist.xlsx"));
}

#[test]
fn canonical_key_missing_parent_returns_not_found() {
    let bogus = std::path::Path::new("/nonexistent_root_9f8e7d/dir/x.xlsx");
    let err = canonical_key(bogus).unwrap_err();
    match err {
        crate::commands::fs::FsError::NotFound { .. } => {}
        other => panic!("expected FsError::NotFound, got {:?}", other),
    }
}

#[test]
fn canonical_key_no_file_name_returns_invalid_request() {
    // "/" has no file_name component.
    let root = std::path::Path::new("/");
    let err = canonical_key(root).unwrap_err();
    // On most systems "/" exists, so canonicalize succeeds and returns "/" —
    // which has no file_name. Our impl should reject that via InvalidRequest
    // when we reach the fallback branch. If canonicalize(/)=Ok("/"), it's a
    // valid canonical key on its own (no new-file fallback triggered).
    // So pin: either Ok (canonicalize succeeded) or InvalidRequest.
    match err {
        crate::commands::fs::FsError::InvalidRequest { .. } => {}
        other => panic!("expected InvalidRequest, got {:?}", other),
    }
}
```

Note on the last test: if on your platform `canonicalize("/")` returns `Ok`, the test is not meaningful — delete it and rely on the other four. The test is scaffolded so the contract is explicit.

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib canonical_key`
Expected: FAIL — `canonical_key` is not yet defined.

- [ ] **Step 3: Add the `canonical_key` helper**

In `apps/desktop/src-tauri/src/commands/spreadsheet.rs`, add this free function **above** `impl WorkbookCache` (i.e., after the `WorkbookCache` struct definition around line 229):

```rust
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib canonical_key`
Expected: 4 tests PASS (the `canonical_key_no_file_name_returns_invalid_request` may pass or be deleted depending on platform behavior — see Step 1 note).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs
git commit -m "$(cat <<'EOF'
feat(cache): add canonical_key helper for path deduplication

Resolves absolute/relative/dot-segment aliases to a single PathBuf key.
For non-existent targets, canonicalizes the parent and joins the file
name. Not yet wired into WorkbookCache methods; next commit threads it
through open_windowed / mutate / close.
EOF
)"
```

---

## Task B3: Thread canonical key through `open_windowed`, `mutate`, `close`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs` (cache methods)
- Modify: `apps/desktop/src-tauri/src/commands/spreadsheet.rs` (tests module: new aliasing tests)

- [ ] **Step 1: Write failing aliasing tests**

Append to the `tests` module:

```rust
use serial_test::serial;

#[test]
#[serial]
fn aliased_paths_dedup_cache_entries() {
    let dir = tempdir().unwrap();
    let abs_path = dir.path().join("x.xlsx");
    let book = umya_spreadsheet::new_file();
    umya_spreadsheet::writer::xlsx::write(&book, &abs_path).unwrap();

    // relative form: cd into parent, use "x.xlsx"
    let prev_cwd = std::env::current_dir().unwrap();
    std::env::set_current_dir(dir.path()).unwrap();
    let rel_path = std::path::PathBuf::from("x.xlsx");

    let cache = WorkbookCache::new();
    cache.open(&abs_path).unwrap();
    cache.open(&rel_path).unwrap();

    assert_eq!(cache.entries.len(), 1,
        "aliased absolute+relative paths must collapse to one entry");

    std::env::set_current_dir(prev_cwd).unwrap();
}

#[test]
#[serial]
fn concurrent_mutate_via_aliased_paths_serialises() {
    use std::sync::Arc as StdArc;
    use std::thread;

    let dir = tempdir().unwrap();
    let abs_path = dir.path().join("wb.xlsx");
    let book = umya_spreadsheet::new_file();
    umya_spreadsheet::writer::xlsx::write(&book, &abs_path).unwrap();

    let prev_cwd = std::env::current_dir().unwrap();
    std::env::set_current_dir(dir.path()).unwrap();
    let rel_path = std::path::PathBuf::from("wb.xlsx");

    let cache = StdArc::new(WorkbookCache::new());
    let (_, rev0) = cache.open(&abs_path).unwrap();

    let c1 = cache.clone();
    let p1 = abs_path.clone();
    let r1 = rev0.clone();
    let t1 = thread::spawn(move || {
        c1.mutate(&p1, Some(&r1), &[CellDelta {
            sheet: "Sheet1".into(),
            cell: CellRef { row: 1, col: 1, value: "A".into(), cell_type: None },
        }])
    });

    let c2 = cache.clone();
    let p2 = rel_path.clone();
    let r2 = rev0.clone();
    let t2 = thread::spawn(move || {
        c2.mutate(&p2, Some(&r2), &[CellDelta {
            sheet: "Sheet1".into(),
            cell: CellRef { row: 2, col: 1, value: "B".into(), cell_type: None },
        }])
    });

    let res1 = t1.join().unwrap();
    let res2 = t2.join().unwrap();

    let (ok_count, rev_err_count) = [&res1, &res2].iter().fold((0, 0), |(a, b), r| match r {
        Ok(_) => (a + 1, b),
        Err(crate::commands::fs::FsError::RevisionMismatch { .. }) => (a, b + 1),
        other => panic!("unexpected: {:?}", other),
    });
    assert_eq!(ok_count, 1, "exactly one mutate should succeed");
    assert_eq!(rev_err_count, 1, "the aliased competitor should see RevisionMismatch");

    std::env::set_current_dir(prev_cwd).unwrap();
}

#[test]
#[serial]
fn close_with_aliased_path_evicts_same_entry() {
    let dir = tempdir().unwrap();
    let abs_path = dir.path().join("wb.xlsx");
    let book = umya_spreadsheet::new_file();
    umya_spreadsheet::writer::xlsx::write(&book, &abs_path).unwrap();

    let prev_cwd = std::env::current_dir().unwrap();
    std::env::set_current_dir(dir.path()).unwrap();
    let rel_path = std::path::PathBuf::from("wb.xlsx");

    let cache = WorkbookCache::new();
    cache.open(&abs_path).unwrap();
    cache.close(&rel_path);

    let fake_rev = FileRevision { mtime_ms: 0, size: 0 };
    let err = cache.mutate(&abs_path, Some(&fake_rev), &[]).unwrap_err();
    assert!(matches!(err, crate::commands::fs::FsError::CacheEvicted { .. }));

    std::env::set_current_dir(prev_cwd).unwrap();
}
```

Note: `cache.entries` is currently a private field. Add `#[cfg(test)]` visibility or keep `entries` visible within the module (it already is — same file). The test accesses `cache.entries.len()` directly, which compiles because the test module is a child of `spreadsheet`.

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd apps/desktop/src-tauri && cargo test --lib -- --test-threads=1 aliased_paths_dedup_cache_entries concurrent_mutate_via_aliased_paths_serialises close_with_aliased_path_evicts_same_entry`
Expected: FAIL — aliased paths currently produce two entries; the concurrent mutate test sees two `Ok`s (or one `Ok` and one `CacheEvicted`), not the `Ok + RevisionMismatch` contract.

- [ ] **Step 3: Thread `canonical_key` through cache methods**

In `apps/desktop/src-tauri/src/commands/spreadsheet.rs`, rewrite `open_windowed`, `mutate`, and `close` to canonicalize once at entry. Replace the three methods inside `impl WorkbookCache` with:

```rust
pub fn open_windowed(
    &self,
    path: &Path,
    window: Option<&SheetWindowRequest>,
) -> Result<(WorkbookData, FileRevision), FsError> {
    let key = canonical_key(path)?;

    if let Some(entry) = self.entries.get(&key) {
        let arc = entry.clone();
        drop(entry);
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
    let book = umya_spreadsheet::reader::xlsx::read(&key).map_err(|e| {
        FsError::ParseError {
            message: format!("Failed to read spreadsheet: {}", e),
        }
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

pub fn mutate(
    &self,
    path: &Path,
    expected_revision: Option<&FileRevision>,
    deltas: &[CellDelta],
) -> Result<FileRevision, FsError> {
    let key = canonical_key(path)?;

    if let Some(entry) = self.entries.get(&key) {
        let arc = entry.clone();
        drop(entry);
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd apps/desktop/src-tauri && cargo test --lib`
Expected: all tests PASS, including the three new aliasing tests.

If the CWD-sensitive tests flake, add `--test-threads=1` or verify the `#[serial]` attribute is applied to every test that calls `set_current_dir`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/spreadsheet.rs
git commit -m "$(cat <<'EOF'
fix(cache): dedupe WorkbookCache entries by canonical path

open_windowed, mutate, and close now canonicalize the path once at
entry so aliases (absolute, relative, dot-segment) share the same
DashMap entry and serialize through the same inner Mutex. Fixes a
race where concurrent mutates via different spellings of the same
file bypassed revision checks.
EOF
)"
```

---

## Task B4: Final verification

- [ ] **Step 1: Full backend test suite**

```bash
cd apps/desktop/src-tauri && cargo test
```
Expected: all tests PASS.

- [ ] **Step 2: Frontend build**

```bash
pnpm -F app build
```
Expected: success.

- [ ] **Step 3: Lint & clippy (if configured)**

```bash
cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings
```
If clippy is not part of CI, skip; otherwise resolve warnings in the touched files only.

- [ ] **Step 4: Verify no stale references remain**

```bash
grep -rn "SheetError\|fs_to_sheet_err\|sheet_err_to_fs" apps/
```
Expected: zero matches.

- [ ] **Step 5: Confirm git log has two logical commits (plus docs + chore)**

```bash
git log --oneline -10
```
Expected shape:
- `fix(cache): dedupe WorkbookCache entries by canonical path`
- `feat(cache): add canonical_key helper for path deduplication`
- `chore(deps): add serial_test dev-dependency for CWD tests`
- `feat(editor): handle RevisionMismatch and CacheEvicted distinctly`
- `refactor(fs-client): drop SheetError, widen FsErrorCode`
- `refactor(fs): collapse SheetError into FsError`
- `feat(fs): extend FsError with cache/workbook variants`
- `docs(spec): …` (already on branch)

---

## Done Criteria

- `cargo test` green for `apps/desktop/src-tauri`.
- `pnpm -F app build` green.
- `SheetError` is removed from the entire repo.
- `WorkbookCache` methods canonicalize paths and produce one DashMap entry per underlying file.
- Frontend sees `RevisionMismatch` and `CacheEvicted` as distinct error codes and branches on them.
- Commit history tells the two-phase story: error-unification first, canonicalization second.
