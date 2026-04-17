# File Editor Panel Redesign

## Summary

Rename `code-editor-panel` to `file-editor-panel`, introduce a multi-editor routing architecture, add spreadsheet viewing/editing via Fortune-sheet + umya-spreadsheet, and unify backend file operations around `FsEntry`-based APIs.

## Motivation

The current `CodeEditorPanel` only supports text files. The goal is to expand to multiple file types (starting with spreadsheets) through a pluggable editor view architecture, while cleaning up the backend API to be type-safe and extensible.

---

## 1. Renaming

| Before | After |
|---|---|
| `code-editor-panel/` directory | `file-editor-panel/` |
| `CodeEditorPanel` component | `FileEditorPanel` |
| `CodeEditorPanel.tsx` file | `FileEditorPanel.tsx` |
| `index.ts` barrel export | Updated to export `FileEditorPanel` |
| `session.tsx` import/usage | Updated to use `FileEditorPanel` |

Files that remain unchanged: `CodeEditorView.tsx`, `FileTree.tsx`, `MarkdownPreview.tsx`, `language-detection.ts`.

---

## 2. Backend API (Rust/Tauri)

### 2.1 Unified Commands

Replace `fs_read_text_file` / `fs_write_text_file` with `fs_read_file` / `fs_write_file`. Keep `fs_read_dir` as-is.

### 2.2 FsEntry as Input

Both `fs_read_file` and `fs_write_file` accept `FsEntry` as input instead of string arguments. `FsEntry` already contains `name`, `path`, `is_dir`, `size`, and `ext` — the `ext` field drives dispatch logic.

```rust
#[derive(Deserialize, Serialize, Clone)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub ext: Option<String>,
}
```

### 2.3 Response Type

```rust
#[derive(Serialize)]
#[serde(tag = "type")]
pub enum FsFileContent {
    #[serde(rename = "text")]
    Text { content: String },

    #[serde(rename = "sheet")]
    Sheet {
        content: String,   // JSON-serialized sheet data
        readonly: bool,    // true for .xls/.xlsb/.ods/.numbers
    },

    #[serde(rename = "binary")]
    Binary {},
}
```

### 2.4 Read Dispatch (`fs_read_file`)

```rust
#[tauri::command]
fn fs_read_file(entry: FsEntry) -> Result<FsFileContent, String> {
    match entry.ext.as_deref() {
        // Read-write spreadsheet formats (umya-spreadsheet)
        Some("xlsx" | "xlsm") => {
            let book = umya_spreadsheet::reader::xlsx::read(&entry.path)
                .map_err(|e| e.to_string())?;
            let json = serialize_workbook(&book);
            Ok(FsFileContent::Sheet { content: json, readonly: false })
        }

        // Read-only spreadsheet formats
        Some("xls" | "xlsb" | "ods" | "numbers") => {
            let book = umya_spreadsheet::reader::xlsx::read(&entry.path)
                .map_err(|e| e.to_string())?;
            let json = serialize_workbook(&book);
            Ok(FsFileContent::Sheet { content: json, readonly: true })
        }

        // Text files
        Some(ext) if is_text_extension(ext) => {
            let content = std::fs::read_to_string(&entry.path)
                .map_err(|e| e.to_string())?;
            Ok(FsFileContent::Text { content })
        }

        // Binary / unsupported
        _ => Ok(FsFileContent::Binary {}),
    }
}
```

Note: umya-spreadsheet natively supports `.xlsx` and `.xlsm`. For `.xls`, `.xlsb`, `.ods`, `.numbers`, a separate reader (e.g. calamine) may be needed for the read path only, with the `readonly: true` flag preventing write attempts. If umya-spreadsheet cannot read these formats, calamine should be added as a read-only fallback.

### 2.5 Write Dispatch (`fs_write_file`)

```rust
#[tauri::command]
fn fs_write_file(entry: FsEntry, content: String) -> Result<(), String> {
    match entry.ext.as_deref() {
        // Spreadsheet: apply cell delta to original file
        Some("xlsx" | "xlsm") => {
            let mut book = umya_spreadsheet::reader::xlsx::read(&entry.path)
                .map_err(|e| e.to_string())?;
            let delta: Vec<CellDelta> = serde_json::from_str(&content)
                .map_err(|e| e.to_string())?;
            apply_delta(&mut book, &delta);
            umya_spreadsheet::writer::xlsx::write(&book, &entry.path)
                .map_err(|e| e.to_string())?;
            Ok(())
        }

        // Text: direct write
        Some(ext) if is_text_extension(ext) => {
            std::fs::write(&entry.path, &content)
                .map_err(|e| e.to_string())?;
            Ok(())
        }

        _ => Err("NotSupported: cannot write this file type".into()),
    }
}
```

### 2.6 Cell Delta Format

```rust
#[derive(Deserialize)]
struct CellDelta {
    sheet: String,    // sheet name
    row: u32,         // 1-indexed
    col: u32,         // 1-indexed
    value: String,    // new cell value
}
```

### 2.7 Workbook Serialization

`serialize_workbook()` converts umya-spreadsheet's `Spreadsheet` to a JSON structure consumable by Fortune-sheet:

```json
{
  "sheets": [
    {
      "name": "Sheet1",
      "rows": [
        [
          { "value": "Hello", "type": "string" },
          { "value": "42", "type": "number" },
          null
        ]
      ]
    }
  ]
}
```

Cells are `{ value, type }` where type is `"string"`, `"number"`, `"boolean"`, `"formula"`, or `"empty"`. `null` represents empty cells. Row arrays are padded to the maximum column used in each sheet.

### 2.8 Dependencies

**Cargo.toml additions:**
- `umya-spreadsheet = "2"` — read/write xlsx/xlsm with format preservation
- Optionally `calamine = "0.26"` — read-only fallback for .xls/.xlsb/.ods/.numbers

**Remove:** `fs_read_text_file` and `fs_write_text_file` from `lib.rs` invoke_handler registration. Add `fs_read_file` and `fs_write_file`.

### 2.9 Text Extension List

Follow the pattern from `packages/opencode/src/file/index.ts` `textExtensions` set:

```
ts, tsx, mts, cts, js, jsx, mjs, cjs, sh, bash, zsh, fish, ps1,
json, jsonc, json5, yaml, yml, toml, md, mdx, txt, xml, html, htm,
css, scss, sass, less, graphql, gql, sql, ini, cfg, conf, env,
py, rs, go, java, c, cpp, h, hpp, rb, php, swift, kt, scala, r,
dockerfile, makefile, .gitignore, .editorconfig, .prettierrc, .eslintrc
```

---

## 3. Frontend

### 3.1 tauri-fs.ts

Replace the three current functions with:

```ts
export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext: string | null;
}

export interface FsFileContent {
  type: "text" | "sheet" | "binary";
  content?: string;
  readonly?: boolean;
}

export async function fsReadFile(entry: FsEntry): Promise<FsFileContent> {
  return invoke<FsFileContent>("fs_read_file", { entry });
}

export async function fsWriteFile(entry: FsEntry, content: string): Promise<void> {
  return invoke<void>("fs_write_file", { entry, content });
}

// fsReadDir stays unchanged
export async function fsReadDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_read_dir", { path });
}
```

### 3.2 FileEditorPanel.tsx

Replaces `CodeEditorPanel.tsx`. Key changes:

- **State:** `selectedFile: FsEntry | null` instead of `selectedFilePath: string | null`
- **File loading:** calls `fsReadFile(entry)` and stores the `FsFileContent` result
- **View routing** based on `FsFileContent.type`:
  - `"text"` → `<CodeEditorView />` (existing, unchanged) or `<MarkdownPreview />` for .md/.mdx
  - `"sheet"` → `<SheetEditorView />`
  - `"binary"` → `<UnsupportedFileView />`
- **File saving:** calls `fsWriteFile(entry, content)` — for text, content is the string; for sheets, content is the JSON-serialized cell delta
- **FileTree** `onFileSelect` now passes `FsEntry` instead of a path string

### 3.3 SheetEditorView.tsx (New)

**Props:**
```ts
interface SheetEditorViewProps {
  entry: FsEntry;
  content: string;      // JSON sheet data from backend
  readonly: boolean;
  onDirty: (dirty: boolean) => void;
  onSave: () => void;
}
```

**Integration approach:** Fortune-sheet is React-based. Mount it in SolidJS via:
1. Create a container `<div ref={containerRef} />` in the SolidJS component
2. Use `createRoot` from `react-dom/client` to render Fortune-sheet's `<Workbook>` into the container div
3. Pass sheet data as props; receive cell change callbacks

**Cell change tracking:**
- Fortune-sheet's `onChange` callback fires on every cell edit
- Accumulate changes as `CellDelta[]` in a signal
- On save (Cmd+S), serialize delta to JSON, call `fsWriteFile(entry, deltaJSON)`
- After successful save, clear the delta accumulator and mark clean

**Read-only mode:**
- When `readonly` is true, Fortune-sheet's editing is disabled
- A "Read-only" badge is shown in the toolbar area
- Save button/shortcut is disabled

### 3.4 UnsupportedFileView.tsx (New)

Simple component showing:
- File icon + file name
- "This file type is not supported for viewing"
- File metadata: size, extension

### 3.5 FileTree.tsx Update

Currently `onFileSelect` passes a path string. Update to pass the full `FsEntry` object instead, so `FileEditorPanel` has access to `ext`, `is_dir`, `size`, etc. without re-deriving them.

### 3.6 Package Dependencies

**Add to `apps/app/package.json`:**
- `@fortune-sheet/react` (v1.0.4) — React-based spreadsheet component
- `@fortune-sheet/core` (v1.0.4) — core logic, peer dep of `@fortune-sheet/react`
- `react` and `react-dom` (peer deps for Fortune-sheet, used only for imperative mounting in SolidJS)

---

## 4. Data Flow

### 4.1 Read Flow

```
User clicks file in FileTree
  → FileTree emits FsEntry via onFileSelect
  → FileEditorPanel calls fsReadFile(entry)
  → Tauri IPC → fs_read_file(entry: FsEntry)
    → match entry.ext:
      "xlsx"/"xlsm"              → umya-spreadsheet read → JSON → Sheet { content, readonly: false }
      "xls"/"xlsb"/"ods"/etc    → calamine read → JSON → Sheet { content, readonly: true }
      text extension             → fs::read_to_string → Text { content }
      other                      → Binary {}
  → Frontend receives FsFileContent
    → type "text"   → CodeEditorView (or MarkdownPreview for .md)
    → type "sheet"  → SheetEditorView
    → type "binary" → UnsupportedFileView
```

### 4.2 Write Flow (Text)

```
User edits in CodeEditorView → isDirty = true
  → Cmd+S
  → fsWriteFile(entry, textContent)
  → Tauri IPC → fs_write_file → fs::write(entry.path, content)
  → isDirty = false
```

### 4.3 Write Flow (Sheet)

```
User edits cell in SheetEditorView (Fortune-sheet)
  → onChange callback → accumulate CellDelta[]
  → isDirty = true
  → Cmd+S
  → fsWriteFile(entry, JSON.stringify(deltas))
  → Tauri IPC → fs_write_file
    → umya-spreadsheet opens entry.path
    → apply each CellDelta (set cell value by sheet/row/col)
    → umya-spreadsheet writes back to entry.path
  → Clear delta accumulator, isDirty = false
```

### 4.4 Read-Only Sheet Flow

```
User clicks .xls/.ods/.numbers file
  → fsReadFile(entry) → Sheet { content, readonly: true }
  → SheetEditorView renders with editing disabled
  → "Read-only" badge shown
  → Save shortcut/button disabled
```

---

## 5. Error Handling

| Scenario | Behavior |
|---|---|
| File not found | Show error toast in FileEditorPanel |
| umya-spreadsheet read fails | Fall back to `Binary {}` response, show "Cannot read this file" |
| Write to read-only format | Backend returns `Err("NotSupported")`, frontend shows error toast |
| Fortune-sheet mount fails | Show fallback "Spreadsheet viewer failed to load" message |
| Empty/corrupt spreadsheet | Show empty grid or error message depending on failure mode |

---

## 6. Files Changed Summary

| File | Change |
|---|---|
| `apps/app/src/app/components/code-editor-panel/` | Rename directory to `file-editor-panel/` |
| `FileEditorPanel.tsx` (new name) | Rewrite with FsEntry-based state, view routing |
| `SheetEditorView.tsx` (new) | Fortune-sheet wrapper component |
| `UnsupportedFileView.tsx` (new) | Binary/unsupported file display |
| `FileTree.tsx` | `onFileSelect` emits `FsEntry` instead of string |
| `index.ts` | Re-export `FileEditorPanel` |
| `tauri-fs.ts` | Replace functions with `fsReadFile`/`fsWriteFile` taking `FsEntry` |
| `session.tsx` | Update import from `CodeEditorPanel` to `FileEditorPanel` |
| `apps/desktop/src-tauri/src/commands/fs.rs` | Replace commands, add `FsFileContent` enum, sheet logic |
| `apps/desktop/src-tauri/src/lib.rs` | Update invoke_handler registration |
| `apps/desktop/src-tauri/Cargo.toml` | Add `umya-spreadsheet`, optionally `calamine` |
| `apps/app/package.json` | Add `@fortune-sheet/react`, `@fortune-sheet/core`, `react`, `react-dom` |
| `CodeEditorView.tsx` | Unchanged |
| `MarkdownPreview.tsx` | Unchanged |
| `language-detection.ts` | Unchanged |
