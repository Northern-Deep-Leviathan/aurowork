# File Editor Panel Redesign

## Summary

Rename `code-editor-panel` to `file-editor-panel`, introduce a multi-editor routing architecture, add spreadsheet viewing/editing via Fortune-sheet + umya-spreadsheet, and unify backend file operations with server-owned metadata and structured typed APIs.

## Motivation

The current `CodeEditorPanel` only supports text files. The goal is to expand to multiple file types (starting with spreadsheets) through a pluggable editor view architecture, while cleaning up the backend API to be type-safe, secure, and extensible.

---

## 1. Scope and Naming

### 1.1 Rename

| Before | After |
|---|---|
| `code-editor-panel/` directory | `file-editor-panel/` |
| `CodeEditorPanel` component | `FileEditorPanel` |
| `CodeEditorPanel.tsx` file | `FileEditorPanel.tsx` |
| `index.ts` barrel export | Updated to export `FileEditorPanel` |
| `session.tsx` import/usage | Updated to use `FileEditorPanel` |

Files that remain unchanged: `CodeEditorView.tsx`, `MarkdownPreview.tsx`, `language-detection.ts`.

### 1.2 Goal

Introduce a multi-editor panel that supports:
- Text editing (existing CodeMirror path)
- Spreadsheet viewing/editing (xlsx/xlsm first)
- Unsupported/binary fallback view

Non-goals in this phase:
- Advanced spreadsheet formula engine parity
- Multi-user collaborative editing
- Support for non-umya formats (.xls, .xlsb, .ods, .numbers)

---

## 2. Design Principles (Normative)

1. **Server-owned truth**: backend derives file metadata (extension, type, capabilities) from the real path; frontend-provided metadata is advisory only.
2. **Single owner per state**: dirty state and deltas have one canonical owner (`FileEditorPanel`).
3. **Bounded payloads**: use sparse cell representation to avoid memory/IPC explosion on large/sparse sheets.
4. **Capability-driven UX**: UI save affordance is derived from backend-reported capabilities, not frontend extension guesses.
5. **No regression**: retain unsaved-change confirmation when switching files.
6. **Deterministic errors**: no ambiguous silent fallbacks; every error maps to a specific user-visible behavior.

---

## 3. Backend API (Rust/Tauri)

### 3.1 Command Surface

Replace `fs_read_text_file` / `fs_write_text_file` with unified commands. Keep `fs_read_dir` as-is.

```rust
#[tauri::command]
fn fs_read_file(req: FsReadRequest) -> Result<FsReadResponse, FsError>;

#[tauri::command]
fn fs_write_file(req: FsWriteRequest) -> Result<FsWriteResponse, FsError>;
```

### 3.2 Request/Response Contracts

**Read request** — accepts `path` only (not full `FsEntry`). Backend derives extension, type, and capabilities server-side to prevent trust boundary violations from forged frontend metadata.

```rust
#[derive(Deserialize)]
pub struct FsReadRequest {
    pub path: String,
    pub sheet_window: Option<SheetWindowRequest>,
}

#[derive(Deserialize)]
pub struct SheetWindowRequest {
    pub start_row: u32,     // 1-indexed
    pub start_col: u32,     // 1-indexed
    pub max_rows: u32,      // e.g. 500
    pub max_cols: u32,      // e.g. 200
}
```

**Read response** — discriminated union with revision tracking:

```rust
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

#[derive(Serialize, Deserialize, Clone)]
pub struct FileRevision {
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Serialize, Clone)]
pub struct SheetCapabilities {
    pub can_edit_cells: bool,
    pub can_save: bool,
    pub format: String,  // "xlsx", "xlsm"
}
```

`readonly` in the UI is derived from `!capabilities.can_edit_cells`; save enablement from `capabilities.can_save`. No separate `readonly` field needed.

**Write request** — includes revision for conflict detection:

```rust
#[derive(Deserialize)]
pub struct FsWriteRequest {
    pub path: String,
    pub expected_revision: Option<FileRevision>,
    pub payload: WritePayload,
}

#[derive(Serialize)]
pub struct FsWriteResponse {
    pub revision: FileRevision,  // new revision after write
}
```

### 3.3 Dispatch Rules

- Backend canonicalizes and validates `path` (prevent directory traversal, symlink escape).
- Backend computes extension from the real filesystem path.
- Text detection supports both extension-based and name-based matching:
  - **Extensions:** ts, tsx, mts, cts, js, jsx, mjs, cjs, json, jsonc, json5, yaml, yml, toml, md, mdx, txt, xml, html, htm, css, scss, sass, less, graphql, gql, sql, ini, cfg, conf, env, py, rs, go, java, c, cpp, h, hpp, rb, php, swift, kt, scala, r, sh, bash, zsh, fish, ps1
  - **Extensionless filenames:** Dockerfile, Makefile, .gitignore, .gitattributes, .editorconfig, .npmrc, .nvmrc, .prettierrc, .eslintrc, .env
- Spreadsheet routing uses the umya-only policy (section 3.4).

### 3.4 Spreadsheet Format Policy (umya-only)

- Supported spreadsheet formats in this phase: `.xlsx`, `.xlsm` only.
- Backend returns `FsReadResponse::Sheet` with capabilities derived from actual runtime behavior.
- For other spreadsheet-like extensions (`.xls`, `.xlsb`, `.ods`, `.numbers`, etc.), backend returns `FsReadResponse::Binary` with reason `"Unsupported spreadsheet format in this phase"`.
- No secondary spreadsheet parser (calamine) is introduced in this phase.

### 3.5 Workbook Transport Model (Sparse + Bounded)

Avoid dense padded 2D arrays. Use sparse cell list with bounded window loading:

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
    pub cells: Vec<CellRef>,  // sparse list for requested window
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CellRef {
    pub row: u32,                  // 1-indexed
    pub col: u32,                  // 1-indexed
    pub value: String,
    pub cell_type: Option<String>, // read: populated; write: optional hint
}
```

`SheetWindowRequest` allows initial bounded load (e.g. first 500 rows x 200 cols) and later pagination for large sheets.

`translate_workbook()` converts umya-spreadsheet's `Spreadsheet` into a `WorkbookData` struct. Tauri's serde layer handles JSON serialization in a single pass — no double-encoding.

```rust
fn translate_workbook(
    book: &umya_spreadsheet::Spreadsheet,
    window: Option<&SheetWindowRequest>,
) -> WorkbookData {
    // Iterate sheets → SheetData { name, max_row, max_col, cells }
    // Only emit CellRef for non-empty cells within the window bounds
    // cell_type: "string", "number", "boolean", "formula"
}
```

The frontend receives this as a native JS object — zero `JSON.parse()` calls:

```ts
content.sheets[0].name                    // "Sheet1"
content.sheets[0].max_row                 // 1000
content.sheets[0].cells[0]               // { row: 1, col: 1, value: "Hello", cell_type: "string" }
```

### 3.6 Write Payload

```rust
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
```

`CellRef` is shared across read/write:
- Read path populates `cell_type` for each returned cell.
- Write path may omit `cell_type`; backend infers type when absent.

Write enforcement:
- Reject with `FsError::NotSupported` if format is not writable (backend checks server-derived extension, not client input).
- Reject with `FsError::Conflict` if `expected_revision` doesn't match file's current mtime/size on disk.
- In this phase, only `.xlsx`/`.xlsm` sheet writes are valid.

### 3.7 Error Model

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

No ambiguous silent fallbacks. Each error code maps to a deterministic frontend behavior.

### 3.8 Dependencies

**Cargo.toml additions:**
- `umya-spreadsheet = "2"` — read/write xlsx/xlsm with format preservation

**Remove:** `fs_read_text_file` and `fs_write_text_file` from `lib.rs` invoke_handler registration. Add `fs_read_file` and `fs_write_file`.

---

## 4. Frontend Architecture

### 4.1 tauri-fs.ts

```ts
// FsEntry remains for directory listing only (fs_read_dir)
export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext?: string;
}

export interface FileRevision {
  mtime_ms: number;
  size: number;
}

export interface SheetCapabilities {
  can_edit_cells: boolean;
  can_save: boolean;
  format: string;
}

export interface CellRef {
  row: number;
  col: number;
  value: string;
  cell_type?: string;
}

export interface SheetData {
  name: string;
  max_row: number;
  max_col: number;
  cells: CellRef[];
}

export interface WorkbookData {
  sheets: SheetData[];
}

export interface CellDelta {
  sheet: string;
  cell: CellRef;
}

export type FsReadResponse =
  | { type: "text"; content: string; revision: FileRevision }
  | { type: "sheet"; content: WorkbookData; capabilities: SheetCapabilities; revision: FileRevision }
  | { type: "binary"; mime?: string; reason: string };

export type WritePayload =
  | { type: "text"; content: string }
  | { type: "sheet"; deltas: CellDelta[] };

export interface FsWriteResponse {
  revision: FileRevision;
}

export async function fsReadFile(
  path: string,
  sheetWindow?: { start_row: number; start_col: number; max_rows: number; max_cols: number },
): Promise<FsReadResponse> {
  return invoke<FsReadResponse>("fs_read_file", {
    req: { path, sheet_window: sheetWindow ?? null },
  });
}

export async function fsWriteFile(
  path: string,
  payload: WritePayload,
  expectedRevision?: FileRevision,
): Promise<FsWriteResponse> {
  return invoke<FsWriteResponse>("fs_write_file", {
    req: { path, payload, expected_revision: expectedRevision ?? null },
  });
}

// fsReadDir stays unchanged
export async function fsReadDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_read_dir", { path });
}
```

Note: `fsReadFile` and `fsWriteFile` now accept `path: string` (not `FsEntry`), matching the server-owned-truth principle. `FsEntry` remains for directory listing only.

### 4.2 FileEditorPanel.tsx

Replaces `CodeEditorPanel.tsx`. Key changes:

**State:**
- `selectedEntry: FsEntry | null` — from FileTree (used for display, path extraction)
- `openDoc: FsReadResponse | null` — the full server response
- `dirty: boolean` — canonical dirty flag (single owner)
- `revision: FileRevision | null` — for conflict detection on save
- `deltas: CellDelta[]` — canonical delta accumulator for sheet edits (single owner)
- `viewMode: "edit" | "preview"` — for markdown files

**View routing** based on `openDoc.type`:
- `"text"` → `<CodeEditorView />` (existing, unchanged) or `<MarkdownPreview />` for .md/.mdx
- `"sheet"` → `<SheetEditorView />`
- `"binary"` → `<UnsupportedFileView />`

**File loading:** calls `fsReadFile(entry.path)` and stores the `FsReadResponse`

**File saving:**
- Text: `fsWriteFile(path, { type: "text", content }, revision)`
- Sheet: `fsWriteFile(path, { type: "sheet", deltas }, revision)`
- On success: update `revision` from response, clear `dirty` and `deltas`
- On `Conflict`: prompt user to reload or overwrite

**Unsaved-change guard:** Before switching files, check `dirty` and prompt confirmation if true.

### 4.3 SheetEditorView.tsx (New)

**Props:**

```ts
interface SheetEditorViewProps {
  entry: FsEntry;
  content: WorkbookData;
  capabilities: SheetCapabilities;
  deltas: CellDelta[];                     // owned by parent
  onDeltasChange: (next: CellDelta[]) => void;  // emit intent only
  onDirtyChange: (dirty: boolean) => void;       // emit intent only
  onSaveRequested: () => void;
}
```

**State ownership rule:**
- `FileEditorPanel` owns canonical `deltas` and `dirty`.
- `SheetEditorView` emits change intents only — it does not hold its own delta state.

**React bridge requirements:**
- Create `ReactDOM.createRoot()` once per mount in `onMount()`.
- Call `root.unmount()` in `onCleanup()` to prevent leaks.
- Wrap Fortune-sheet render in a React error boundary with fallback UI ("Spreadsheet viewer failed to load").

**Read-only mode:**
- When `!capabilities.can_edit_cells`, Fortune-sheet's editing is disabled.
- A "Read-only" badge is shown in the toolbar area.
- Save button/shortcut is disabled when `!capabilities.can_save`.

### 4.4 UnsupportedFileView.tsx (New)

Show:
- File icon + file name
- File metadata: size, extension
- Reason string from `FsReadResponse::Binary.reason` (e.g. "Unsupported spreadsheet format in this phase", "Binary file", etc.)

### 4.5 FileTree.tsx Update

- `onFileSelect(entry: FsEntry)` — passes full entry for display/path extraction.
- Selection identity remains by `entry.path`.

### 4.6 Package Dependencies

**Add to `apps/app/package.json`:**
- `@fortune-sheet/react` (v1.0.4) — React-based spreadsheet component
- `@fortune-sheet/core` (v1.0.4) — core logic, peer dep of `@fortune-sheet/react`
- `react` and `react-dom` — peer deps for Fortune-sheet (explicitly scoped to spreadsheet adapter; not used elsewhere in the SolidJS app)

Constraint: track bundle size delta in PR and justify added runtime weight.

---

## 5. Data Flows

### 5.1 Read Flow

```
User clicks file in FileTree
  → FileTree emits FsEntry via onFileSelect
  → FileEditorPanel checks unsaved-change guard (prompt if dirty)
  → FileEditorPanel calls fsReadFile(entry.path, sheetWindow?)
  → Tauri IPC → fs_read_file(FsReadRequest)
    → Backend derives extension from path:
      "xlsx"/"xlsm"  → umya-spreadsheet read → Sheet { content, capabilities, revision }
      text ext/name   → fs::read_to_string → Text { content, revision }
      other           → Binary { mime, reason }
  → Frontend receives FsReadResponse, stores as openDoc
    → type "text"   → CodeEditorView (or MarkdownPreview for .md)
    → type "sheet"  → SheetEditorView
    → type "binary" → UnsupportedFileView
```

### 5.2 Write Flow (Text)

```
User edits in CodeEditorView → dirty = true
  → Cmd+S
  → fsWriteFile(path, { type: "text", content }, expectedRevision)
  → Backend validates revision → fs::write
  → On success: update revision from response, dirty = false
  → On Conflict: prompt user to reload or overwrite
```

### 5.3 Write Flow (Sheet)

```
User edits cell in SheetEditorView (Fortune-sheet)
  → onChange → SheetEditorView calls onDeltasChange([...deltas, newDelta])
  → FileEditorPanel updates canonical deltas, dirty = true
  → Cmd+S
  → fsWriteFile(path, { type: "sheet", deltas }, expectedRevision)
  → Backend validates revision → umya-spreadsheet open → apply deltas → write
  → On success: clear deltas, update revision, dirty = false
  → On Conflict: prompt user to reload or overwrite
```

---

## 6. Error Handling UX

| Error Code | Behavior |
|---|---|
| `NotFound` | Toast: "File not found" + clear editor area |
| `PermissionDenied` | Toast: "Permission denied" |
| `NotSupported` | Toast: "This file type cannot be saved" |
| `Conflict` | Modal: "File changed on disk. Reload or overwrite?" |
| `InvalidRequest` | Toast: "Invalid request" (developer error) |
| `Internal` | Toast: "An error occurred" with details |
| Fortune-sheet mount failure | Error boundary fallback: "Spreadsheet viewer failed to load" |

No ambiguous silent fallbacks. Toast and inline panel state must agree on error semantics.

---

## 7. Dependencies

**Backend (Cargo.toml):**
- `umya-spreadsheet = "2"`

**Frontend (package.json):**
- `@fortune-sheet/react`
- `@fortune-sheet/core`
- `react`, `react-dom` (explicitly scoped to spreadsheet adapter)

---

## 8. Migration Plan

1. Rename panel directory/component and wire imports.
2. Introduce unified fs commands (`fs_read_file`/`fs_write_file`) while keeping old commands (`fs_read_text_file`/`fs_write_text_file`) behind temporary compatibility wrappers.
3. Migrate frontend to new API types (`FsReadResponse`, `WritePayload`, `FileRevision`).
4. Add `SheetEditorView` and `UnsupportedFileView`.
5. Remove deprecated text-only commands after all call sites are switched.

---

## 9. Test Plan

**Backend tests:**
- Text read/write round-trip
- xlsx/xlsm read/write round-trip with format preservation
- Unsupported spreadsheet format classification (`.xls`, `.ods`, etc. → `Binary`)
- Conflict detection (mismatched `expected_revision`)
- Path validation (directory traversal rejection)
- Extensionless filename detection (Dockerfile, .gitignore)

**Frontend tests/manual checks:**
- Unsaved-change guard on file switch
- Markdown edit/preview unchanged
- Spreadsheet dirty/save lifecycle (delta accumulation, clear on save)
- Fallback UI on Fortune-sheet mount failure (error boundary)
- Capabilities-driven UI (read-only badge, save disabled)

**E2E:**
- Open text file → edit → save → reopen verify
- Open xlsx → edit cell → save → reopen verify cell changed
- Open xls/ods → unsupported file view with reason message
- Force conflict (external edit during session) → conflict modal UX

---

## 10. Files Expected to Change

| File | Change |
|---|---|
| `apps/app/src/app/components/code-editor-panel/` | Rename directory to `file-editor-panel/` |
| `FileEditorPanel.tsx` (new name) | Rewrite: path-based API, view routing, delta/dirty ownership |
| `SheetEditorView.tsx` (new) | Fortune-sheet wrapper with React bridge + error boundary |
| `UnsupportedFileView.tsx` (new) | Binary/unsupported file display with reason |
| `FileTree.tsx` | `onFileSelect` emits `FsEntry` instead of string |
| `index.ts` | Re-export `FileEditorPanel` |
| `tauri-fs.ts` | Replace with `fsReadFile(path)`/`fsWriteFile(path, payload, revision)` |
| `session.tsx` | Update import from `CodeEditorPanel` to `FileEditorPanel` |
| `apps/desktop/src-tauri/src/commands/fs.rs` | New commands, `FsReadResponse`/`FsError` enums, sparse workbook model |
| `apps/desktop/src-tauri/src/lib.rs` | Update invoke_handler registration |
| `apps/desktop/src-tauri/Cargo.toml` | Add `umya-spreadsheet` |
| `apps/app/package.json` | Add `@fortune-sheet/react`, `@fortune-sheet/core`, `react`, `react-dom` |
| `CodeEditorView.tsx` | Unchanged |
| `MarkdownPreview.tsx` | Unchanged |
| `language-detection.ts` | Unchanged |

---

## 11. Open Decisions

1. **Initial sheet window bounds**: what default `max_rows`/`max_cols` for the first load, and pagination trigger (scroll-based? explicit button?).
2. **Conflict resolution default**: optimistic (warn only) or strict (block save on mismatch)?
