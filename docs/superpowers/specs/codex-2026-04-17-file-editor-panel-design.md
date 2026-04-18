# Codex Review + Revised Spec: File Editor Panel

Date: 2026-04-17  
Source reviewed: `docs/superpowers/specs/2026-04-17-file-editor-panel-design.md`

## A. Findings Log (Critical Review)

### A.1 Critical findings

1. **Trust boundary violation on backend API input**  
   Original design passes full `FsEntry` from frontend into `fs_read_file` and `fs_write_file` and uses `entry.ext` for dispatch. This treats client-provided metadata as trusted input.
   - Risk: forged metadata (`path`, `ext`, `is_dir`, `size`) can trigger wrong behavior and weaken filesystem safety assumptions.
   - Fix: backend accepts `path` (or workspace-relative file id) only, then recomputes metadata server-side.

2. **Undefined sheet save ownership between panel and sheet view**  
   The spec says `SheetEditorView` accumulates deltas, but panel-level save API expects payload creation without a defined handoff contract.
   - Risk: save path ambiguity, duplicate state, stale deltas, and race bugs.
   - Fix: define a single owner for deltas and a typed callback contract.

### A.2 High findings

1. **Sparse workbook transport can explode memory and IPC size**  
   Full `rows: Vec<Vec<Option<SheetCell>>>` with row padding to max used column is unsafe for sparse sheets.
   - Risk: huge payloads, UI freezes, OOM on large/sparse docs.
   - Fix: use sparse cell payload + viewport/window loading.

2. **Spreadsheet format support is inconsistent**  
   The original spec mixes `umya` read path, optional `calamine`, and flow text that assumes calamine.
   - Risk: implementation drift and broken expectations.
   - Fix: use a single-library policy (`umya-spreadsheet` only) and treat non-umya spreadsheet formats as unsupported in this phase.

3. **Read-only mode not enforced in write command contract**  
   UI-only read-only flag is insufficient.
   - Risk: accidental writes to unsupported formats.
   - Fix: backend rejects write based on server-derived format capabilities.

4. **React-in-Solid embedding cost not fully specified**  
   Adding `react` + `react-dom` for one component without lifecycle/error boundaries is incomplete.
   - Risk: leaks, bundle growth, theming inconsistencies.
   - Fix: add explicit adapter lifecycle and cleanup requirements.

### A.3 Medium findings

1. Extension-only text detection misses extensionless/dotfiles (`Dockerfile`, `.gitignore`).
2. Error handling is contradictory (fallback-to-binary vs immediate `Err`).
3. No stale-write protection (`mtime` / revision preconditions).
4. Existing unsaved-change guard behavior is not explicitly preserved.

---

## B. Revised Spec (Section-by-Section)

## 1. Scope and Naming

### 1.1 Rename

- `code-editor-panel/` -> `file-editor-panel/`
- `CodeEditorPanel` -> `FileEditorPanel`
- Keep `CodeEditorView.tsx`, `MarkdownPreview.tsx`, `language-detection.ts` as reusable text/markdown surfaces.

### 1.2 Goal

Introduce a multi-editor panel that supports:
- Text editing (existing CodeMirror path)
- Spreadsheet viewing/editing (xlsx/xlsm first)
- Unsupported/binary fallback view

Non-goal in this phase:
- Advanced spreadsheet formula engine parity
- Multi-user collaborative editing

---

## 2. Design Principles (Normative)

1. **Server-owned truth**: backend derives file metadata and format capability; frontend metadata is advisory only.
2. **Single owner per state**: dirty state and deltas have one canonical owner.
3. **Bounded payloads**: avoid full-grid serialization for large/sparse sheets.
4. **Capability-driven UX**: UI save affordance is derived from backend capabilities, not extension guesses.
5. **No regression**: retain unsaved-change confirmation when switching files.

---

## 3. Backend API (Rust/Tauri)

## 3.1 Command surface

Replace text-only commands with unified file commands:

```rust
#[tauri::command]
fn fs_read_file(req: FsReadRequest) -> Result<FsReadResponse, FsError>;

#[tauri::command]
fn fs_write_file(req: FsWriteRequest) -> Result<FsWriteResponse, FsError>;
```

`fs_read_dir` remains for tree browsing.

## 3.2 Request/response contracts

```rust
#[derive(Deserialize)]
pub struct FsReadRequest {
    pub path: String,
    pub sheet_window: Option<SheetWindowRequest>,
}

#[derive(Deserialize)]
pub struct FsWriteRequest {
    pub path: String,
    pub expected_revision: Option<FileRevision>,
    pub payload: WritePayload,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileRevision {
    pub mtime_ms: u64,
    pub size: u64,
}
```

```rust
#[derive(Serialize)]
#[serde(tag = "type")]
pub enum FsReadResponse {
    Text {
        content: String,
        revision: FileRevision,
    },
    Sheet {
        content: WorkbookData,
        capabilities: SheetCapabilities,
        revision: FileRevision,
    },
    Binary {
        mime: Option<String>,
        reason: String,
    },
}
```

```rust
#[derive(Serialize)]
pub struct SheetCapabilities {
    pub can_edit_cells: bool,
    pub can_save: bool,
    pub format: String, // xlsx, xlsm
}
```

`readonly` is derived in UI from capabilities (typically `!capabilities.can_edit_cells`), while save enablement is controlled by `capabilities.can_save`; therefore `readonly` is not a separate response field.

## 3.3 Dispatch rules

- Backend canonicalizes and validates `path`.
- Backend computes extension from real path and (optionally) MIME sniffing.
- Text detection must support extensionless known filenames (`Dockerfile`, `Makefile`) and dotfiles (`.gitignore`, `.env`).
- Spreadsheet routing uses the umya-only policy below.

## 3.4 Spreadsheet format policy (umya-only)

- Supported spreadsheet formats in this phase: `.xlsx`, `.xlsm`.
- For `.xlsx`/`.xlsm`, backend returns `FsReadResponse::Sheet` with capabilities from actual runtime behavior.
- For other spreadsheet-like extensions (`.xls`, `.xlsb`, `.ods`, `.numbers`, etc.), backend returns `FsReadResponse::Binary` with reason like `Unsupported spreadsheet format in this phase`.
- No secondary spreadsheet parser is introduced in this phase.

## 3.5 Workbook transport model (bounded)

Avoid dense padded 2D arrays for all rows/cols. Use sparse + bounded window payload:

```rust
#[derive(Serialize, Clone)]
pub struct WorkbookData {
    pub sheets: Vec<SheetData>,
}

#[derive(Serialize, Clone)]
pub struct SheetData {
    pub name: String,
    pub max_row: u32,
    pub max_col: u32,
    pub cells: Vec<CellRef>, // sparse list for requested window
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CellRef {
    pub row: u32, // 1-indexed
    pub col: u32, // 1-indexed
    pub value: String,
    pub cell_type: Option<String>, // read: populated, write: optional hint/override
}
```

`SheetWindowRequest` allows initial bounded load (for example first 500x200 region) and later pagination.

## 3.6 Write payload

```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum WritePayload {
    Text { content: String },
    Sheet { deltas: Vec<CellDelta> },
}

#[derive(Deserialize)]
pub struct CellDelta {
    pub sheet: String,
    pub cell: CellRef,
}
```

`CellRef` is shared across read/write:
- Read path should populate `cell_type` for each returned cell.
- Write path may omit `cell_type`; backend infers type when absent and validates if provided.

Write enforcement:
- Reject with `FsError::NotSupported` if format is not writable in this phase.
- Reject with `FsError::Conflict` if `expected_revision` mismatches on disk.
- In this phase, only `.xlsx`/`.xlsm` sheet writes are valid.

## 3.7 Error model

```rust
#[derive(Serialize)]
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

No ambiguous silent fallback. Behavior must be deterministic per error code.

---

## 4. Frontend Architecture

## 4.1 `tauri-fs.ts`

- `fsReadFile(path, opts?)`
- `fsWriteFile(path, payload, expectedRevision?)`
- Keep `FsEntry` for directory listing only.

## 4.2 `FileEditorPanel.tsx`

Panel state:
- `selectedEntry: FsEntry | null`
- `openDoc: FsReadResponse | null`
- `dirty: boolean`
- `revision: FileRevision | null`
- `viewMode` (markdown edit/preview)

Routing:
- `Text` -> `CodeEditorView` / `MarkdownPreview`
- `Sheet` -> `SheetEditorView`
- `Binary` -> `UnsupportedFileView`

Must preserve unsaved-change confirmation before switching file.

## 4.3 `SheetEditorView.tsx`

Props:

```ts
interface SheetEditorViewProps {
  entry: FsEntry;
  content: WorkbookData;
  capabilities: SheetCapabilities;
  deltas: CellDelta[];
  onDeltasChange: (next: CellDelta[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaveRequested: () => void;
}
```

State ownership rule:
- `FileEditorPanel` owns canonical `deltas` and `dirty`.
- `SheetEditorView` emits change intents only.

React bridge requirements:
- Create root once per mount.
- Unmount root on cleanup.
- Wrap Fortune-sheet mount in error boundary fallback UI.

## 4.4 `UnsupportedFileView.tsx`

Show:
- filename
- size/extension
- reason (`Not supported`, `Cannot parse`, etc.)

## 4.5 `FileTree.tsx`

- `onFileSelect(entry: FsEntry)`
- Selection identity remains by `entry.path`

---

## 5. Data Flows

## 5.1 Read flow

1. User selects file in tree.
2. Panel checks unsaved guard.
3. Panel calls `fsReadFile({ path, sheet_window })`.
4. Backend derives type/capabilities/revision.
5. UI routes by `response.type`.

## 5.2 Save flow (text)

1. User edits text -> `dirty = true`.
2. Cmd/Ctrl+S -> `fsWriteFile(path, Text, expected_revision)`.
3. On success: refresh revision + `dirty = false`.
4. On conflict: prompt user to reload/overwrite.

## 5.3 Save flow (sheet)

1. Sheet emits cell changes.
2. Panel updates canonical `deltas`.
3. Cmd/Ctrl+S -> `fsWriteFile(path, Sheet{deltas}, expected_revision)`.
4. On success: clear deltas, update revision, clear dirty.

---

## 6. Error Handling UX

- `NotFound`, `PermissionDenied`, `Conflict`, `NotSupported` map to distinct user messages.
- Toast + inline panel state should agree on error semantics.
- Spreadsheet mount failure falls back to deterministic `UnsupportedFileView`-style error shell.

---

## 7. Dependencies

Backend:
- `umya-spreadsheet = "2"`

Frontend:
- `@fortune-sheet/react`
- `@fortune-sheet/core`
- `react`, `react-dom` (explicitly scoped to spreadsheet adapter)

Constraint:
- Track bundle delta in PR and justify added runtime weight.

---

## 8. Migration Plan

1. Rename panel directory/component and wire imports.
2. Introduce unified fs commands while keeping old commands behind temporary compatibility wrappers.
3. Migrate frontend to new API types.
4. Add sheet view and unsupported view.
5. Remove deprecated text-only commands after all call sites are switched.

---

## 9. Test Plan (Required)

Backend tests:
- text read/write
- xlsx/xlsm read/write
- unsupported spreadsheet format classification (`.xls`, `.ods`, etc. -> `Binary`)
- conflict detection
- unsupported format classification

Frontend tests/manual checks:
- unsaved guard on file switch
- markdown edit/preview unchanged
- spreadsheet dirty/save lifecycle
- fallback UI on sheet mount failure

E2E:
- open text file -> edit -> save
- open xlsx -> edit cell -> save -> reopen verify
- open xls/ods -> unsupported file view behavior
- force conflict -> conflict UX

---

## 10. Files Expected to Change

- `apps/app/src/app/components/code-editor-panel/` -> `apps/app/src/app/components/file-editor-panel/`
- `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`
- `apps/app/src/app/components/file-editor-panel/SheetEditorView.tsx`
- `apps/app/src/app/components/file-editor-panel/UnsupportedFileView.tsx`
- `apps/app/src/app/components/file-editor-panel/FileTree.tsx`
- `apps/app/src/app/components/file-editor-panel/index.ts`
- `apps/app/src/app/lib/tauri-fs.ts`
- `apps/app/src/app/pages/session.tsx`
- `apps/desktop/src-tauri/src/commands/fs.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/app/package.json`

---

## 11. Open Decisions

1. Decide initial sheet window bounds and pagination contract.
2. Decide whether save should be optimistic or strict-on-conflict by default.
