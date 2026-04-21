# File Editor Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `code-editor-panel` to `file-editor-panel`, add spreadsheet editing via Fortune-sheet + umya-spreadsheet, and unify backend file operations with typed discriminated-union APIs.

**Architecture:** Backend `fs_read_file`/`fs_write_file` commands replace text-only commands, returning a tagged enum (`Text | Sheet | Binary`). Frontend `FileEditorPanel` routes to `CodeEditorView`, `SheetEditorView`, or `UnsupportedFileView` based on response type. Sheet editing uses a React-in-Solid bridge with Fortune-sheet, delta-patch saves, and sparse cell transport.

**Tech Stack:** Rust/Tauri (backend), SolidJS (frontend), umya-spreadsheet (Rust xlsx/xlsm), Fortune-sheet + React (spreadsheet UI), CodeMirror 6 (text editing)

**Spec:** `docs/superpowers/specs/2026-04-17-file-editor-panel-design.md`

---

## File Structure

### Files to Create

| File | Responsibility |
|---|---|
| `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx` | Main panel: view routing, dirty/delta ownership, save orchestration |
| `apps/app/src/app/components/file-editor-panel/SheetEditorView.tsx` | React-in-Solid bridge for Fortune-sheet, emits delta intents |
| `apps/app/src/app/components/file-editor-panel/UnsupportedFileView.tsx` | Binary/unsupported file fallback display |
| `apps/app/src/app/components/file-editor-panel/index.ts` | Barrel export for `FileEditorPanel` |

### Files to Modify

| File | Change |
|---|---|
| `apps/desktop/src-tauri/src/commands/fs.rs` | Replace text commands with `fs_read_file`/`fs_write_file`, add all types |
| `apps/desktop/src-tauri/src/lib.rs` | Update invoke_handler registration |
| `apps/desktop/src-tauri/Cargo.toml` | Add `umya-spreadsheet = "2"` |
| `apps/app/src/app/lib/tauri-fs.ts` | Replace with new typed API |
| `apps/app/src/app/components/file-editor-panel/FileTree.tsx` | `onFileSelect` emits `FsEntry` instead of `string` |
| `apps/app/src/app/pages/session.tsx` | Update import to `FileEditorPanel` |
| `apps/app/package.json` | Add `@fortune-sheet/react`, `@fortune-sheet/core`, `react`, `react-dom` |

### Files to Move (unchanged content)

| From | To |
|---|---|
| `code-editor-panel/CodeEditorView.tsx` | `file-editor-panel/CodeEditorView.tsx` |
| `code-editor-panel/MarkdownPreview.tsx` | `file-editor-panel/MarkdownPreview.tsx` |
| `code-editor-panel/language-detection.ts` | `file-editor-panel/language-detection.ts` |

### Files to Delete

| File | Reason |
|---|---|
| `apps/app/src/app/components/code-editor-panel/` (entire directory) | Replaced by `file-editor-panel/` |

---

## Task 1: Rename directory and update imports

**Files:**
- Create: `apps/app/src/app/components/file-editor-panel/index.ts`
- Move: `code-editor-panel/*` → `file-editor-panel/`
- Modify: `apps/app/src/app/pages/session.tsx`

- [ ] **Step 1: Move the directory**

```bash
cd /workspace/aurowork
git mv apps/app/src/app/components/code-editor-panel apps/app/src/app/components/file-editor-panel
```

- [ ] **Step 2: Rename `CodeEditorPanel.tsx` to `FileEditorPanel.tsx`**

```bash
git mv apps/app/src/app/components/file-editor-panel/CodeEditorPanel.tsx \
       apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx
```

- [ ] **Step 3: Update `index.ts` barrel export**

Replace the content of `apps/app/src/app/components/file-editor-panel/index.ts`:

```ts
export { FileEditorPanel } from "./FileEditorPanel";
```

- [ ] **Step 4: Rename the component in `FileEditorPanel.tsx`**

In `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`, rename the exported function from `CodeEditorPanel` to `FileEditorPanel` and update the type from `CodeEditorPanelProps` to `FileEditorPanelProps`. The internal logic stays identical for now — later tasks will rewrite it.

Find and replace:
- `CodeEditorPanelProps` → `FileEditorPanelProps`
- `export function CodeEditorPanel` → `export function FileEditorPanel`

- [ ] **Step 5: Update `session.tsx` import**

In `apps/app/src/app/pages/session.tsx`, change:

```ts
// Before
import { CodeEditorPanel } from "../components/code-editor-panel";

// After
import { FileEditorPanel } from "../components/file-editor-panel";
```

And update the JSX usage (around line 4760):

```tsx
// Before
<CodeEditorPanel
  expanded={codeEditorExpanded()}
  onClose={() => setCodeEditorExpanded(false)}
  rootPath={currentWorkspacePath()}
  width={rightPanelWidth()}
/>

// After
<FileEditorPanel
  expanded={codeEditorExpanded()}
  onClose={() => setCodeEditorExpanded(false)}
  rootPath={currentWorkspacePath()}
  width={rightPanelWidth()}
/>
```

- [ ] **Step 6: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/app/components/file-editor-panel/ apps/app/src/app/pages/session.tsx
git commit -m "refactor: rename code-editor-panel to file-editor-panel"
```

---

## Task 2: Add `umya-spreadsheet` dependency to Cargo.toml

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
umya-spreadsheet = "2"
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles with no errors (warnings OK).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "deps: add umya-spreadsheet for xlsx/xlsm support"
```

---

## Task 3: Implement backend types and error model in `fs.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

This task adds all the type definitions. The command functions come in the next tasks.

- [ ] **Step 1: Add the type definitions**

Add the following types at the top of `apps/desktop/src-tauri/src/commands/fs.rs`, below the existing `use` statements. Keep the existing `FsEntry` struct and `fs_read_dir` function — they remain unchanged.

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

// ── Error model ──

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

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FsError::NotFound { message } => write!(f, "NotFound: {}", message),
            FsError::PermissionDenied { message } => write!(f, "PermissionDenied: {}", message),
            FsError::NotSupported { message } => write!(f, "NotSupported: {}", message),
            FsError::Conflict { message } => write!(f, "Conflict: {}", message),
            FsError::InvalidRequest { message } => write!(f, "InvalidRequest: {}", message),
            FsError::Internal { message } => write!(f, "Internal: {}", message),
        }
    }
}

// ── Revision tracking ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileRevision {
    pub mtime_ms: u64,
    pub size: u64,
}

// ── Read request/response ──

#[derive(Deserialize)]
pub struct FsReadRequest {
    pub path: String,
    pub sheet_window: Option<SheetWindowRequest>,
}

#[derive(Deserialize)]
pub struct SheetWindowRequest {
    pub start_row: u32,
    pub start_col: u32,
    pub max_rows: u32,
    pub max_cols: u32,
}

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

#[derive(Serialize, Clone)]
pub struct SheetCapabilities {
    pub can_edit_cells: bool,
    pub can_save: bool,
    pub format: String,
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

// ── Write request/response ──

#[derive(Deserialize)]
pub struct FsWriteRequest {
    pub path: String,
    pub expected_revision: Option<FileRevision>,
    pub payload: WritePayload,
}

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

#[derive(Serialize)]
pub struct FsWriteResponse {
    pub revision: FileRevision,
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles (unused warnings are fine — commands come next).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "feat(fs): add typed request/response structs and FsError enum"
```

---

## Task 4: Implement file-type detection helpers

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

- [ ] **Step 1: Add file-type detection and revision helpers**

Add these helper functions in `fs.rs`, below the type definitions and above the `fs_read_dir` command:

```rust
use std::time::UNIX_EPOCH;

/// Known text file extensions (lowercase, no dot).
const TEXT_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
    "json", "jsonc", "json5", "yaml", "yml", "toml",
    "md", "mdx", "txt", "xml", "html", "htm",
    "css", "scss", "sass", "less", "graphql", "gql", "sql",
    "ini", "cfg", "conf", "env",
    "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
    "rb", "php", "swift", "kt", "scala", "r",
    "sh", "bash", "zsh", "fish", "ps1",
    "svg", "csv", "tsv", "log",
];

/// Known text filenames (case-sensitive, no extension).
const TEXT_FILENAMES: &[&str] = &[
    "Dockerfile", "Makefile", "Vagrantfile", "Rakefile", "Gemfile",
    "Procfile", "Justfile",
    ".gitignore", ".gitattributes", ".editorconfig",
    ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc", ".env",
    ".dockerignore", ".prettierignore", ".eslintignore",
];

/// Spreadsheet extensions supported by umya-spreadsheet.
const SHEET_EXTENSIONS: &[&str] = &["xlsx", "xlsm"];

/// Spreadsheet-like extensions NOT supported in this phase.
const UNSUPPORTED_SHEET_EXTENSIONS: &[&str] = &["xls", "xlsb", "ods", "numbers"];

#[derive(Debug, PartialEq)]
enum FileType {
    Text,
    Sheet,
    UnsupportedSheet,
    Binary,
}

fn classify_file(path: &Path) -> FileType {
    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // Check extensionless known filenames
    if TEXT_FILENAMES.contains(&filename) {
        return FileType::Text;
    }

    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext.is_empty() {
        // No extension and not a known filename — treat as text (best effort)
        return FileType::Text;
    }

    if SHEET_EXTENSIONS.contains(&ext.as_str()) {
        return FileType::Sheet;
    }
    if UNSUPPORTED_SHEET_EXTENSIONS.contains(&ext.as_str()) {
        return FileType::UnsupportedSheet;
    }
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return FileType::Text;
    }

    FileType::Binary
}

fn get_revision(path: &Path) -> Result<FileRevision, FsError> {
    let meta = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FsError::NotFound { message: format!("File not found: {}", path.display()) }
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            FsError::PermissionDenied { message: format!("Permission denied: {}", path.display()) }
        } else {
            FsError::Internal { message: format!("Failed to read metadata: {}", e) }
        }
    })?;

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

fn check_revision_conflict(
    path: &Path,
    expected: &Option<FileRevision>,
) -> Result<(), FsError> {
    if let Some(expected) = expected {
        let current = get_revision(path)?;
        if current.mtime_ms != expected.mtime_ms || current.size != expected.size {
            return Err(FsError::Conflict {
                message: format!(
                    "File changed on disk. Expected mtime={} size={}, got mtime={} size={}",
                    expected.mtime_ms, expected.size, current.mtime_ms, current.size
                ),
            });
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles (unused warnings fine).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "feat(fs): add file-type classification and revision helpers"
```

---

## Task 5: Implement `translate_workbook` and `apply_deltas`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

- [ ] **Step 1: Add `translate_workbook` function**

Add below the helper functions in `fs.rs`:

```rust
fn translate_workbook(
    book: &umya_spreadsheet::Spreadsheet,
    window: Option<&SheetWindowRequest>,
) -> WorkbookData {
    let mut sheets = Vec::new();

    for sheet in book.get_sheet_collection() {
        let (max_row, max_col) = sheet.get_highest_row_and_column_index();

        // Default window: first 500 rows x 200 cols
        let start_row = window.map_or(1, |w| w.start_row.max(1));
        let start_col = window.map_or(1, |w| w.start_col.max(1));
        let end_row = window.map_or(
            max_row.min(500),
            |w| (w.start_row + w.max_rows - 1).min(max_row),
        );
        let end_col = window.map_or(
            max_col.min(200),
            |w| (w.start_col + w.max_cols - 1).min(max_col),
        );

        let mut cells = Vec::new();
        for row in start_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell) = sheet.get_cell((col, row)) {
                    let value = cell.get_value().to_string();
                    if value.is_empty() {
                        continue;
                    }
                    let cell_type = Some(
                        match cell.get_data_type() {
                            umya_spreadsheet::CellValue::String(_) => "string",
                            umya_spreadsheet::CellValue::Numeric(_) => "number",
                            umya_spreadsheet::CellValue::Bool(_) => "boolean",
                            _ => "string",
                        }
                        .to_string(),
                    );
                    cells.push(CellRef {
                        row,
                        col,
                        value,
                        cell_type,
                    });
                }
            }
        }

        sheets.push(SheetData {
            name: sheet.get_name().to_string(),
            max_row,
            max_col,
            cells,
        });
    }

    WorkbookData { sheets }
}
```

> **Note:** The umya-spreadsheet API uses `(column, row)` tuple ordering for cell access. The exact API may need minor adjustments based on the umya-spreadsheet v2 API — check `get_cell`, `get_highest_row_and_column_index`, `get_data_type` signatures and adapt accordingly during implementation. The cell type detection pattern above captures the core logic; if `CellValue` variants differ, match on the actual enum.

- [ ] **Step 2: Add `apply_deltas` function**

```rust
fn apply_deltas(
    book: &mut umya_spreadsheet::Spreadsheet,
    deltas: &[CellDelta],
) -> Result<(), FsError> {
    for delta in deltas {
        let sheet = book.get_sheet_by_name_mut(&delta.sheet).map_err(|_| {
            FsError::InvalidRequest {
                message: format!("Sheet '{}' not found in workbook", delta.sheet),
            }
        })?;

        let cell = sheet.get_cell_mut((delta.cell.col, delta.cell.row));

        // Determine type: use explicit cell_type if provided, else infer
        let cell_type = delta.cell.cell_type.as_deref().unwrap_or_else(|| {
            if delta.cell.value.parse::<f64>().is_ok() {
                "number"
            } else if delta.cell.value == "true" || delta.cell.value == "false" {
                "boolean"
            } else {
                "string"
            }
        });

        match cell_type {
            "number" => {
                if let Ok(n) = delta.cell.value.parse::<f64>() {
                    cell.set_value_number(n);
                } else {
                    cell.set_value_string(&delta.cell.value);
                }
            }
            "boolean" => {
                cell.set_value_bool(delta.cell.value == "true");
            }
            _ => {
                cell.set_value_string(&delta.cell.value);
            }
        }
    }
    Ok(())
}
```

> **Note:** Similar to `translate_workbook`, the exact umya-spreadsheet cell mutation API (`set_value_number`, `set_value_string`, `set_value_bool`, `get_cell_mut`, `get_sheet_by_name_mut`) should be verified against the v2 docs. The pattern is correct; method names may differ slightly.

- [ ] **Step 3: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "feat(fs): add translate_workbook and apply_deltas helpers"
```

---

## Task 6: Implement `fs_read_file` and `fs_write_file` commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `fs_read_file` command**

Add in `fs.rs`:

```rust
#[tauri::command]
pub async fn fs_read_file(req: FsReadRequest) -> Result<FsReadResponse, FsError> {
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

    match classify_file(path) {
        FileType::Text => {
            let revision = get_revision(path)?;
            let content = std::fs::read_to_string(path).map_err(|e| {
                // If read_to_string fails (e.g. invalid UTF-8), fall back to binary
                FsError::Internal {
                    message: format!("Failed to read as text: {}", e),
                }
            })?;
            Ok(FsReadResponse::Text { content, revision })
        }
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

- [ ] **Step 2: Add `fs_write_file` command**

```rust
#[tauri::command]
pub async fn fs_write_file(req: FsWriteRequest) -> Result<FsWriteResponse, FsError> {
    let path = Path::new(&req.path);

    // Check conflict before writing
    check_revision_conflict(path, &req.expected_revision)?;

    match req.payload {
        WritePayload::Text { content } => {
            std::fs::write(path, &content).map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    FsError::PermissionDenied {
                        message: format!("Permission denied: {}", req.path),
                    }
                } else {
                    FsError::Internal {
                        message: format!("Failed to write file: {}", e),
                    }
                }
            })?;
        }
        WritePayload::Sheet { deltas } => {
            let file_type = classify_file(path);
            if file_type != FileType::Sheet {
                return Err(FsError::NotSupported {
                    message: "This file type cannot be saved as a spreadsheet".to_string(),
                });
            }

            let mut book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to read spreadsheet for update: {}", e),
                }
            })?;

            apply_deltas(&mut book, &deltas)?;

            umya_spreadsheet::writer::xlsx::write(&book, path).map_err(|e| {
                FsError::Internal {
                    message: format!("Failed to write spreadsheet: {}", e),
                }
            })?;
        }
    }

    let revision = get_revision(path)?;
    Ok(FsWriteResponse { revision })
}
```

- [ ] **Step 3: Update `lib.rs` invoke_handler**

In `apps/desktop/src-tauri/src/lib.rs`, update the imports:

```rust
// Before
use commands::fs::{fs_read_dir, fs_read_text_file, fs_write_text_file};

// After
use commands::fs::{fs_read_dir, fs_read_file, fs_read_text_file, fs_write_file, fs_write_text_file};
```

In the `invoke_handler` macro, add the new commands alongside the old ones (keep old for backward compat during migration):

```rust
// In the generate_handler! list, add:
fs_read_file,
fs_write_file,
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(fs): implement fs_read_file and fs_write_file commands"
```

---

## Task 7: Rewrite `tauri-fs.ts` with new typed API

**Files:**
- Modify: `apps/app/src/app/lib/tauri-fs.ts`

- [ ] **Step 1: Replace the file content**

Replace the entire content of `apps/app/src/app/lib/tauri-fs.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

// ── Directory listing (unchanged) ──

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext?: string;
}

export async function fsReadDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_read_dir", { path });
}

// ── Revision tracking ──

export interface FileRevision {
  mtime_ms: number;
  size: number;
}

// ── Read API ──

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

export type FsReadResponse =
  | { type: "text"; content: string; revision: FileRevision }
  | {
      type: "sheet";
      content: WorkbookData;
      capabilities: SheetCapabilities;
      revision: FileRevision;
    }
  | { type: "binary"; mime?: string; reason: string };

export async function fsReadFile(
  path: string,
  sheetWindow?: {
    start_row: number;
    start_col: number;
    max_rows: number;
    max_cols: number;
  },
): Promise<FsReadResponse> {
  return invoke<FsReadResponse>("fs_read_file", {
    req: { path, sheet_window: sheetWindow ?? null },
  });
}

// ── Write API ──

export interface CellDelta {
  sheet: string;
  cell: CellRef;
}

export type WritePayload =
  | { type: "text"; content: string }
  | { type: "sheet"; deltas: CellDelta[] };

export interface FsWriteResponse {
  revision: FileRevision;
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

// ── Deprecated (kept for backward compat during migration) ──

export async function fsReadTextFile(path: string): Promise<string> {
  return invoke<string>("fs_read_text_file", { path });
}

export async function fsWriteTextFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("fs_write_text_file", { path, content });
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/lib/tauri-fs.ts
git commit -m "feat(tauri-fs): add typed fsReadFile/fsWriteFile API"
```

---

## Task 8: Update `FileTree.tsx` to emit `FsEntry`

**Files:**
- Modify: `apps/app/src/app/components/file-editor-panel/FileTree.tsx`

- [ ] **Step 1: Change `onFileSelect` prop type**

In `FileTree.tsx`, change the `FileTreeProps` type:

```ts
// Before
type FileTreeProps = {
  rootPath: string | null;
  onFileSelect: (path: string) => void;
  selectedPath: string | null;
};

// After
type FileTreeProps = {
  rootPath: string | null;
  onFileSelect: (entry: FsEntry) => void;
  selectedPath: string | null;
};
```

- [ ] **Step 2: Update `FileTreeNodeProps`**

```ts
// Before
onFileSelect: (path: string) => void;

// After
onFileSelect: (entry: FsEntry) => void;
```

- [ ] **Step 3: Update the click handler in `FileTreeNode`**

```ts
// Before
const handleClick = () => {
  if (props.node.entry.is_dir) {
    props.onToggle(props.indexPath);
  } else {
    props.onFileSelect(props.node.entry.path);
  }
};

// After
const handleClick = () => {
  if (props.node.entry.is_dir) {
    props.onToggle(props.indexPath);
  } else {
    props.onFileSelect(props.node.entry);
  }
};
```

- [ ] **Step 4: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: type errors in `FileEditorPanel.tsx` (which still calls `onFileSelect` with a string). This is expected — Task 9 fixes it.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/components/file-editor-panel/FileTree.tsx
git commit -m "refactor(FileTree): emit FsEntry instead of string path"
```

---

## Task 9: Create `UnsupportedFileView.tsx`

**Files:**
- Create: `apps/app/src/app/components/file-editor-panel/UnsupportedFileView.tsx`

- [ ] **Step 1: Create the component**

Create `apps/app/src/app/components/file-editor-panel/UnsupportedFileView.tsx`:

```tsx
import { File } from "lucide-solid";
import type { FsEntry } from "../../lib/tauri-fs";

type UnsupportedFileViewProps = {
  entry: FsEntry;
  reason: string;
};

export default function UnsupportedFileView(props: UnsupportedFileViewProps) {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-dls-hover">
        <File size={32} class="text-dls-secondary" />
      </div>
      <div class="space-y-1">
        <p class="text-sm font-medium text-dls-text">{props.entry.name}</p>
        <p class="text-xs text-dls-secondary">
          {props.entry.ext ? `.${props.entry.ext}` : "No extension"} ·{" "}
          {formatSize(props.entry.size)}
        </p>
      </div>
      <p class="max-w-xs text-xs text-dls-secondary">{props.reason}</p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: passes (component is standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/components/file-editor-panel/UnsupportedFileView.tsx
git commit -m "feat: add UnsupportedFileView component for binary/unsupported files"
```

---

## Task 10: Install Fortune-sheet dependencies and create `SheetEditorView.tsx`

**Files:**
- Modify: `apps/app/package.json`
- Create: `apps/app/src/app/components/file-editor-panel/SheetEditorView.tsx`

- [ ] **Step 1: Install dependencies**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app add @fortune-sheet/react @fortune-sheet/core react react-dom
```

Also install React types as devDependencies:

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app add -D @types/react @types/react-dom
```

- [ ] **Step 2: Create `SheetEditorView.tsx`**

Create `apps/app/src/app/components/file-editor-panel/SheetEditorView.tsx`:

```tsx
import { onMount, onCleanup, createEffect } from "solid-js";
import type {
  FsEntry,
  WorkbookData,
  SheetCapabilities,
  CellDelta,
  CellRef,
} from "../../lib/tauri-fs";

export interface SheetEditorViewProps {
  entry: FsEntry;
  content: WorkbookData;
  capabilities: SheetCapabilities;
  deltas: CellDelta[];
  onDeltasChange: (next: CellDelta[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaveRequested: () => void;
}

/**
 * Convert our sparse WorkbookData into Fortune-sheet's expected format.
 * Fortune-sheet expects an array of sheet objects with celldata arrays.
 */
function toFortuneCellData(
  cells: CellRef[],
): Array<{ r: number; c: number; v: { v: string | number | boolean; m: string } }> {
  return cells.map((cell) => {
    let v: string | number | boolean = cell.value;
    if (cell.cell_type === "number") {
      const n = Number(cell.value);
      if (!isNaN(n)) v = n;
    } else if (cell.cell_type === "boolean") {
      v = cell.value === "true";
    }
    return {
      r: cell.row - 1, // Fortune-sheet is 0-indexed
      c: cell.col - 1,
      v: { v, m: String(v) },
    };
  });
}

function toFortuneSheets(content: WorkbookData) {
  return content.sheets.map((sheet, idx) => ({
    name: sheet.name,
    order: idx,
    row: sheet.max_row,
    column: sheet.max_col,
    celldata: toFortuneCellData(sheet.cells),
    status: idx === 0 ? 1 : 0, // first sheet is active
  }));
}

export default function SheetEditorView(props: SheetEditorViewProps) {
  let containerRef: HTMLDivElement | undefined;
  let reactRoot: any = null;
  let mounted = false;

  onMount(async () => {
    if (!containerRef) return;

    try {
      const React = await import("react");
      const ReactDOM = await import("react-dom/client");
      const { Workbook } = await import("@fortune-sheet/react");

      // Import Fortune-sheet CSS
      await import("@fortune-sheet/react/dist/index.css");

      const sheets = toFortuneSheets(props.content);
      const readOnly = !props.capabilities.can_edit_cells;

      // Error boundary wrapper
      class ErrorBoundary extends React.Component<
        { children: React.ReactNode },
        { hasError: boolean }
      > {
        constructor(p: any) {
          super(p);
          this.state = { hasError: false };
        }
        static getDerivedStateFromError() {
          return { hasError: true };
        }
        render() {
          if (this.state.hasError) {
            return React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#888",
                  fontSize: "13px",
                },
              },
              "Spreadsheet viewer failed to load",
            );
          }
          return this.props.children;
        }
      }

      // Track the current sheet name for delta creation
      let activeSheetName = sheets[0]?.name ?? "Sheet1";

      const App = () => {
        return React.createElement(
          ErrorBoundary,
          null,
          React.createElement(Workbook, {
            data: sheets,
            onChange: (data: any[]) => {
              if (readOnly) return;

              // Fortune-sheet onChange gives us the full sheet data.
              // We need to diff to find what changed, but for simplicity
              // we can track via onCellChange if available,
              // or accumulate from the full data.
              // For now we emit the changed data as deltas.
              // This is a simplified approach — production may need
              // Fortune-sheet's onOp or more granular hooks.
            },
            onOp: (op: any[]) => {
              if (readOnly) return;

              // Fortune-sheet's onOp gives us granular operations
              // We convert these to CellDelta format
              const newDeltas: CellDelta[] = [...props.deltas];

              for (const o of op) {
                if (o.op === "replace" && o.path && o.path.length >= 4) {
                  // Path format: ["data", sheetIdx, "celldata", cellIdx, ...]
                  // We need row/col from the operation
                  if (o.value && typeof o.value === "object") {
                    const row = (o.value.r ?? 0) + 1; // back to 1-indexed
                    const col = (o.value.c ?? 0) + 1;
                    const value = o.value.v?.v ?? o.value.v?.m ?? "";
                    newDeltas.push({
                      sheet: activeSheetName,
                      cell: {
                        row,
                        col,
                        value: String(value),
                      },
                    });
                  }
                }
              }

              if (newDeltas.length !== props.deltas.length) {
                props.onDeltasChange(newDeltas);
                props.onDirtyChange(true);
              }
            },
            onActivate: (sheetName: string) => {
              activeSheetName = sheetName;
            },
            allowEdit: !readOnly,
            showToolbar: !readOnly,
            showFormulaBar: false,
            showSheetTabs: true,
          }),
        );
      };

      reactRoot = ReactDOM.createRoot(containerRef);
      reactRoot.render(React.createElement(App));
      mounted = true;
    } catch (err) {
      console.error("Failed to mount Fortune-sheet:", err);
      if (containerRef) {
        containerRef.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;">Spreadsheet viewer failed to load</div>';
      }
    }
  });

  // Handle Cmd+S for save
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (props.capabilities.can_save && props.deltas.length > 0) {
        props.onSaveRequested();
      }
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    if (reactRoot && mounted) {
      try {
        reactRoot.unmount();
      } catch {
        // ignore unmount errors
      }
      reactRoot = null;
      mounted = false;
    }
  });

  return (
    <div
      ref={(el) => (containerRef = el)}
      class="h-full w-full overflow-hidden"
    />
  );
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: may have warnings about Fortune-sheet types — acceptable.

- [ ] **Step 4: Commit**

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/src/app/components/file-editor-panel/SheetEditorView.tsx
git commit -m "feat: add SheetEditorView with Fortune-sheet React bridge"
```

---

## Task 11: Rewrite `FileEditorPanel.tsx` with view routing and delta ownership

**Files:**
- Modify: `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx`

This is the largest task. It replaces the old text-only logic with multi-type routing.

- [ ] **Step 1: Replace the entire content of `FileEditorPanel.tsx`**

```tsx
import { Show, createEffect, createSignal, on } from "solid-js";
import { X, Save, FolderOpen } from "lucide-solid";
import CodeEditorView from "./CodeEditorView";
import MarkdownPreview from "./MarkdownPreview";
import SheetEditorView from "./SheetEditorView";
import UnsupportedFileView from "./UnsupportedFileView";
import FileTree from "./FileTree";
import {
  fsReadFile,
  fsWriteFile,
  type FsEntry,
  type FsReadResponse,
  type FileRevision,
  type CellDelta,
} from "../../lib/tauri-fs";
import { isTauriRuntime } from "../../utils";
import { pickDirectory } from "../../lib/tauri";

type FileEditorPanelProps = {
  expanded: boolean;
  onClose: () => void;
  rootPath: string | null;
  width?: number;
};

export function FileEditorPanel(props: FileEditorPanelProps) {
  const [selectedEntry, setSelectedEntry] = createSignal<FsEntry | null>(null);
  const [openDoc, setOpenDoc] = createSignal<FsReadResponse | null>(null);
  const [isDirty, setIsDirty] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [splitPosition, setSplitPosition] = createSignal(280);
  const [effectiveRoot, setEffectiveRoot] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"edit" | "preview">("edit");
  const [revision, setRevision] = createSignal<FileRevision | null>(null);
  const [deltas, setDeltas] = createSignal<CellDelta[]>([]);

  // ── Derived state ──

  const selectedFilePath = () => selectedEntry()?.path ?? null;

  const isMarkdown = () => {
    const p = selectedFilePath();
    if (!p) return false;
    return /\.mdx?$/i.test(p);
  };

  const docType = () => openDoc()?.type ?? null;

  const canSave = () => {
    const doc = openDoc();
    if (!doc) return false;
    if (doc.type === "text") return true;
    if (doc.type === "sheet") return doc.capabilities.can_save;
    return false;
  };

  // ── Sync rootPath from props ──

  createEffect(() => {
    const root = props.rootPath;
    if (root) setEffectiveRoot(root);
  });

  createEffect(
    on(() => selectedFilePath(), () => setViewMode("edit"), { defer: true }),
  );

  // ── File operations ──

  const loadFile = async (entry: FsEntry) => {
    if (isDirty()) {
      const ok = window.confirm(
        "You have unsaved changes. Discard and open new file?",
      );
      if (!ok) return;
    }

    setIsLoading(true);
    setLoadError(null);
    setDeltas([]);
    setIsDirty(false);

    try {
      const response = await fsReadFile(entry.path);
      setOpenDoc(response);
      setSelectedEntry(entry);

      if (response.type === "text" || response.type === "sheet") {
        setRevision(response.revision);
      } else {
        setRevision(null);
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    const entry = selectedEntry();
    const doc = openDoc();
    if (!entry || !doc) return;

    try {
      if (doc.type === "text") {
        // Get current text content — we need to track it.
        // Text content is managed by CodeEditorView via onContentChange.
        const result = await fsWriteFile(
          entry.path,
          { type: "text", content: currentTextContent() },
          revision() ?? undefined,
        );
        setRevision(result.revision);
        setIsDirty(false);
      } else if (doc.type === "sheet") {
        const currentDeltas = deltas();
        if (currentDeltas.length === 0) return;

        const result = await fsWriteFile(
          entry.path,
          { type: "sheet", deltas: currentDeltas },
          revision() ?? undefined,
        );
        setRevision(result.revision);
        setDeltas([]);
        setIsDirty(false);
      }
    } catch (err: any) {
      const parsed = typeof err === "object" && err?.code ? err : null;
      if (parsed?.code === "Conflict") {
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
              setIsDirty(false);
            } else if (doc.type === "sheet") {
              const result = await fsWriteFile(entry.path, {
                type: "sheet",
                deltas: deltas(),
              });
              setRevision(result.revision);
              setDeltas([]);
              setIsDirty(false);
            }
          } catch (retryErr) {
            window.alert(`Failed to save: ${retryErr}`);
          }
        }
      } else {
        window.alert(`Failed to save: ${err?.message ?? err}`);
      }
    }
  };

  // ── Text content tracking ──
  // CodeEditorView manages its own editor state, but we need the current
  // text for saving. We track it via the onContentChange callback.
  const [currentTextContent, setCurrentTextContent] = createSignal("");

  // When a text file is loaded, seed the text content
  createEffect(() => {
    const doc = openDoc();
    if (doc?.type === "text") {
      setCurrentTextContent(doc.content);
    }
  });

  const handleTextContentChange = (value: string) => {
    setCurrentTextContent(value);
    setIsDirty(true);
  };

  // ── Sheet delta handling ──

  const handleDeltasChange = (next: CellDelta[]) => {
    setDeltas(next);
  };

  const handleSheetDirtyChange = (dirty: boolean) => {
    setIsDirty(dirty);
  };

  // ── Folder picker ──

  const handlePickFolder = async () => {
    try {
      const result = await pickDirectory({ title: "Open Folder" });
      if (typeof result === "string" && result) {
        setEffectiveRoot(result);
      }
    } catch {
      // user cancelled
    }
  };

  // ── Splitter drag ──

  const [dragging, setDragging] = createSignal(false);
  let panelRef: HTMLElement | undefined;

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging() || !panelRef) return;
    const rect = panelRef.getBoundingClientRect();
    const fileTreeWidth = rect.right - e.clientX;
    setSplitPosition(Math.max(160, Math.min(fileTreeWidth, rect.width - 200)));
  };

  const onPointerUp = () => setDragging(false);

  // ── Display helpers ──

  const fileName = () => {
    const entry = selectedEntry();
    return entry?.name ?? null;
  };

  const breadcrumb = () => {
    const path = selectedFilePath();
    const root = effectiveRoot();
    if (!path) return "";
    if (root && path.startsWith(root)) {
      return path.slice(root.length).replace(/^[\\/]+/, "");
    }
    return path;
  };

  // ── Non-Tauri guard ──

  if (!isTauriRuntime()) {
    return (
      <aside class="relative hidden lg:flex h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[24px] border border-dls-border bg-dls-sidebar p-8 text-center">
        <div>
          <div class="text-sm font-medium text-dls-secondary">Desktop Only</div>
          <p class="mt-2 text-xs text-dls-secondary">
            Work Files requires the AuroWork desktop app.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={(el) => (panelRef = el)}
      class="relative hidden lg:flex h-full shrink-0 flex-col overflow-hidden rounded-[24px] border border-dls-border bg-dls-sidebar"
      style={{ width: `${props.width ?? 420}px`, "min-width": "280px" }}
    >
      {/* Header */}
      <div class="flex h-12 items-center gap-2 border-b border-dls-border px-4 shrink-0">
        <span class="text-[13px] font-semibold text-dls-text shrink-0">Work Files</span>
        <div class="min-w-0 flex-1 truncate text-xs text-dls-secondary">
          <Show when={selectedFilePath()}>
            <span class="text-dls-secondary">{breadcrumb()}</span>
          </Show>
        </div>
        <Show when={isDirty()}>
          <span
            class="h-2 w-2 shrink-0 rounded-full bg-amber-9"
            title="Unsaved changes"
          />
        </Show>
        <Show when={selectedFilePath() && canSave()}>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"
            onClick={saveFile}
            disabled={!isDirty()}
            title="Save (Cmd+S)"
          >
            <Save size={12} />
            <span>Save</span>
          </button>
        </Show>
        {/* Read-only badge for sheets */}
        <Show when={docType() === "sheet" && openDoc()?.type === "sheet" && !(openDoc() as any).capabilities.can_edit_cells}>
          <span class="rounded bg-dls-hover px-1.5 py-0.5 text-[10px] font-medium text-dls-secondary">
            Read-only
          </span>
        </Show>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={props.onClose}
          title="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Editor area (left) */}
        <div class="min-w-0 flex-1 flex flex-col overflow-hidden">
          {/* Edit / Preview tabs — only for markdown text files */}
          <Show when={docType() === "text" && isMarkdown() && !isLoading() && !loadError()}>
            <div class="flex items-center gap-0.5 border-b border-dls-border px-3 shrink-0">
              <button
                type="button"
                class={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode() === "edit"
                    ? "text-dls-text border-b-2 border-dls-text"
                    : "text-dls-secondary hover:text-dls-text"
                }`}
                onClick={() => setViewMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                class={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode() === "preview"
                    ? "text-dls-text border-b-2 border-dls-text"
                    : "text-dls-secondary hover:text-dls-text"
                }`}
                onClick={() => setViewMode("preview")}
              >
                Preview
              </button>
            </div>
          </Show>

          {/* Content area */}
          <div class="min-h-0 flex-1 overflow-hidden">
            <Show when={isLoading()}>
              <div class="flex h-full items-center justify-center text-xs text-dls-secondary">
                Loading file...
              </div>
            </Show>
            <Show when={loadError()}>
              <div class="flex h-full items-center justify-center p-4 text-xs text-red-11">
                {loadError()}
              </div>
            </Show>
            <Show
              when={openDoc() && !isLoading() && !loadError()}
              fallback={
                <Show when={!isLoading() && !loadError()}>
                  <div class="flex h-full items-center justify-center text-xs text-dls-secondary">
                    Select a file to edit
                  </div>
                </Show>
              }
            >
              {/* Text view */}
              <Show when={docType() === "text"}>
                <Show
                  when={isMarkdown() && viewMode() === "preview"}
                  fallback={
                    <CodeEditorView
                      content={currentTextContent()}
                      filePath={selectedFilePath()}
                      onContentChange={handleTextContentChange}
                      onSave={saveFile}
                    />
                  }
                >
                  <MarkdownPreview content={currentTextContent()} />
                </Show>
              </Show>

              {/* Sheet view */}
              <Show when={docType() === "sheet" && openDoc()?.type === "sheet"}>
                {(() => {
                  const doc = openDoc()!;
                  if (doc.type !== "sheet") return null;
                  return (
                    <SheetEditorView
                      entry={selectedEntry()!}
                      content={doc.content}
                      capabilities={doc.capabilities}
                      deltas={deltas()}
                      onDeltasChange={handleDeltasChange}
                      onDirtyChange={handleSheetDirtyChange}
                      onSaveRequested={saveFile}
                    />
                  );
                })()}
              </Show>

              {/* Binary/unsupported view */}
              <Show when={docType() === "binary" && openDoc()?.type === "binary"}>
                {(() => {
                  const doc = openDoc()!;
                  if (doc.type !== "binary") return null;
                  return (
                    <UnsupportedFileView
                      entry={selectedEntry()!}
                      reason={doc.reason}
                    />
                  );
                })()}
              </Show>
            </Show>
          </div>
        </div>

        {/* Splitter */}
        <div
          class={`w-[3px] shrink-0 cursor-col-resize transition-colors ${
            dragging() ? "bg-blue-8" : "bg-transparent hover:bg-dls-border"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* File tree (right) */}
        <div
          class="shrink-0 overflow-hidden border-l border-dls-border"
          style={{ width: `${splitPosition()}px` }}
        >
          <Show
            when={effectiveRoot()}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                <p class="text-xs text-dls-secondary">No workspace folder</p>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md bg-dls-hover px-3 py-1.5 text-[12px] font-medium text-dls-secondary transition-colors hover:bg-dls-active"
                  onClick={handlePickFolder}
                >
                  <FolderOpen size={14} />
                  Open Folder
                </button>
              </div>
            }
          >
            <FileTree
              rootPath={effectiveRoot()}
              onFileSelect={(entry) => void loadFile(entry)}
              selectedPath={selectedFilePath()}
            />
          </Show>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx
git commit -m "feat: rewrite FileEditorPanel with multi-type view routing and delta ownership"
```

---

## Task 12: Remove deprecated commands from `lib.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Remove old imports and handlers**

In `apps/desktop/src-tauri/src/lib.rs`:

Update the import line:

```rust
// Before
use commands::fs::{fs_read_dir, fs_read_file, fs_read_text_file, fs_write_file, fs_write_text_file};

// After
use commands::fs::{fs_read_dir, fs_read_file, fs_write_file};
```

Remove `fs_read_text_file` and `fs_write_text_file` from the `generate_handler!` list.

- [ ] **Step 2: Remove deprecated functions from `fs.rs`**

In `apps/desktop/src-tauri/src/commands/fs.rs`, delete the `fs_read_text_file` and `fs_write_text_file` functions entirely.

- [ ] **Step 3: Remove deprecated exports from `tauri-fs.ts`**

In `apps/app/src/app/lib/tauri-fs.ts`, remove the `fsReadTextFile` and `fsWriteTextFile` functions (the "Deprecated" section at the bottom).

- [ ] **Step 4: Verify both compile**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
cd /workspace/aurowork && pnpm --filter @aurowork/app typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs apps/desktop/src-tauri/src/lib.rs apps/app/src/app/lib/tauri-fs.ts
git commit -m "cleanup: remove deprecated fs_read_text_file and fs_write_text_file"
```

---

## Task 13: Fix pre-existing bug in `fs_read_dir`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/fs.rs`

The existing `fs_read_dir` has two compile errors: `full_path` is a `String` so `.extension()` doesn't work, and `extention` is a typo.

- [ ] **Step 1: Fix the `ext` extraction in `fs_read_dir`**

In the `fs_read_dir` function, find the loop body and fix:

```rust
// Before (broken)
let full_path = entry.path().to_string_lossy().to_string();
let extension = full_path.extension().and_then(|ext| ext.to_string());
// ... 
ext: extention,

// After (fixed)
let entry_path = entry.path();
let full_path = entry_path.to_string_lossy().to_string();
let extension = entry_path.extension()
    .and_then(|e| e.to_str())
    .map(|e| e.to_string());

entries.push(FsEntry {
    name,
    path: full_path,
    is_dir: metadata.is_dir(),
    size: metadata.len(),
    ext: extension,
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /workspace/aurowork/apps/desktop/src-tauri && cargo check
```

Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/fs.rs
git commit -m "fix(fs): fix fs_read_dir ext extraction and typo"
```

---

## Task 14: Manual verification checklist

Since there is no unit test infrastructure (no vitest/jest for frontend, no `#[cfg(test)]` for backend), verification is manual against a running Tauri dev build.

- [ ] **Step 1: Build and launch dev app**

```bash
cd /workspace/aurowork && pnpm tauri dev
```

- [ ] **Step 2: Verify text file flow**

1. Open Work Files panel
2. Select a `.ts` or `.json` file → should show in CodeEditorView
3. Edit text → dirty dot appears
4. Cmd+S → dirty dot disappears
5. Close and reopen same file → saved content persists

- [ ] **Step 3: Verify markdown flow**

1. Open a `.md` file
2. Edit/Preview tabs appear
3. Switch between tabs — content preserved
4. Edit → save works

- [ ] **Step 4: Verify spreadsheet flow**

1. Open a `.xlsx` file → SheetEditorView renders with Fortune-sheet
2. Click a cell, type a value → dirty dot appears
3. Cmd+S → dirty dot disappears
4. Reopen the file → edited cell value persists

- [ ] **Step 5: Verify unsupported file flow**

1. Open a `.xls` or `.ods` file → UnsupportedFileView shows with reason "Unsupported spreadsheet format in this phase"
2. Open a `.png` or `.zip` → UnsupportedFileView shows with reason "Binary file"
3. No save button visible for unsupported files

- [ ] **Step 6: Verify unsaved-change guard**

1. Edit a text file (don't save)
2. Click a different file → confirmation dialog appears
3. Cancel → stays on current file
4. Confirm → switches to new file

- [ ] **Step 7: Verify extensionless files**

1. Open a `Dockerfile` or `.gitignore` → should render as text in CodeEditorView

---

## Implementation Order Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Rename directory and update imports | None |
| 2 | Add `umya-spreadsheet` to Cargo.toml | None |
| 3 | Backend types and error model | None |
| 4 | File-type detection helpers | Task 3 |
| 5 | `translate_workbook` and `apply_deltas` | Tasks 2, 3 |
| 6 | `fs_read_file` and `fs_write_file` commands | Tasks 4, 5 |
| 7 | Rewrite `tauri-fs.ts` | None |
| 8 | Update `FileTree.tsx` to emit `FsEntry` | Task 1 |
| 9 | Create `UnsupportedFileView.tsx` | Task 7 |
| 10 | Install Fortune-sheet + create `SheetEditorView.tsx` | Task 7 |
| 11 | Rewrite `FileEditorPanel.tsx` | Tasks 8, 9, 10 |
| 12 | Remove deprecated commands | Tasks 6, 11 |
| 13 | Fix pre-existing `fs_read_dir` bug | None |
| 14 | Manual verification | All |

Tasks 1, 2, 3, 7, 13 can run in parallel (no dependencies on each other).
