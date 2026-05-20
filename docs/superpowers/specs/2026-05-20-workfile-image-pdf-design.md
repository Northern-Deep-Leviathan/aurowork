# Work Files: Image & PDF Viewer Support

**Date**: 2026-05-20
**Status**: Approved (user: "你先开始做，做完创建PR提交线上")
**Scope**: Desktop only (Web mode not yet shipped)

## Problem

The Work Files panel (`apps/app/src/app/components/file-editor-panel/`) currently
classifies all non-text, non-spreadsheet files as `Binary` and shows a generic
"unsupported" placeholder. Images (`.png`, `.jpg`, …) and PDF files — both extremely
common workspace artifacts — cannot be previewed in-app, breaking the "open any
workspace file" expectation users have.

## Goals

1. Click a `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.avif` / `.ico`
   in the file tree → image renders inline.
2. Click a `.pdf` → PDF renders inline (scroll, zoom via native WebView2 controls).
3. Zero new heavy dependencies (no pdfjs-dist for v1).
4. No regression for existing text / sheet / markdown / unsupported flows.

## Non-Goals

- Web-mode parity (deferred — no users, no shipping target)
- Image editing / annotation
- PDF text extraction / search beyond what WebView2's built-in viewer provides
- Lazy / paginated PDF loading (rely on WebView2 streaming via `asset://`)
- Animation controls for GIF (rely on browser default)

## Architecture

### Read-path classification

`detect_file_type()` in `apps/desktop/src-tauri/src/commands/fs.rs` returns a
new enum:

```rust
enum FileType {
    Text,
    Sheet,
    UnsupportedSheet,
    Image,   // NEW
    Pdf,     // NEW
    Binary,
}
```

`fs_read_file()` for `Image` / `Pdf` does **not** read file bytes. It returns
metadata only:

```rust
FsReadResponse::Image { path: String, mime: String, revision: FileRevision }
FsReadResponse::Pdf   { path: String,                 revision: FileRevision }
```

The frontend uses `convertFileSrc(path)` to obtain an `asset://` URL that
WebView2/WebKit can fetch directly — zero IPC payload, zero base64, supports
HTTP range requests for large PDFs.

### Frontend

Two new viewer components:

- `ImageViewerView.tsx` — `<img src={convertFileSrc(path)}>` centered with
  `object-fit: contain`. Filename + size shown in a small overlay footer.
- `PdfViewerView.tsx` — `<embed type="application/pdf" src={...}>` filling the
  panel. Falls back to a download/open-externally button if `<embed>` returns
  no readable size (WebView2 always renders PDFs; this fallback is defensive
  only).

`FileEditorPanel.tsx` gets two new `<Show>` branches paralleling the existing
`text` / `sheet` / `binary` branches.

`tauri-fs.ts` extends the `FsReadResponse` discriminated union:

```ts
export type FsReadResponse =
  | { type: "text"; ... }
  | { type: "sheet"; ... }
  | { type: "image"; path: string; mime: string; revision: FileRevision }
  | { type: "pdf";   path: string;               revision: FileRevision }
  | { type: "binary"; mime?: string; reason: string };
```

### Tauri permissions

Add `"core:asset:default"` (or the equivalent fs/asset-protocol permission)
to `apps/desktop/src-tauri/capabilities/default.json` and enable
`app.security.assetProtocol` in `tauri.conf.json` with a scope restricted to
authorized workspace roots.

For v1: scope is `"**/*"` to match the current behavior of `fs_read_file`
(which already serves any path with no scope check). Tightening the scope to
workspace roots is tracked as a follow-up — it requires the same change
in the existing `fs_read_file`, so it doesn't belong in this PR.

## Data Flow

```
User clicks foo.pdf in FileTree
  → FileEditorPanel.loadFile(entry)
  → fsReadFile(path)                       // Tauri IPC
  → fs_read_file()                         // Rust
  → detect_file_type() => Pdf
  → returns { type: "pdf", path, revision } // no body
  → openDoc() updated
  → <Show when={docType() === "pdf"}>
      <PdfViewerView path={...} />
      → <embed src={convertFileSrc(path)} />
      → WebView2 streams the file via asset:// protocol
```

## Save / Dirty

Images and PDFs are read-only. `canSave()` returns `false` for both. No
dirty state, no save button.

## Error Handling

- File not found / permission denied → existing `FsError` plumbing handles it,
  shown in `loadError()`.
- `convertFileSrc` returns a string regardless of file existence; if the
  underlying asset protocol fails to load the image, `<img onerror>` shows
  a small "Failed to load image" placeholder.
- Corrupted PDF → WebView2 shows its own error UI inside `<embed>`. We don't
  intercept.

## Testing

- Rust unit tests for `detect_file_type` extension matrix (add `.png`,
  `.pdf`, etc. → expected enum variant).
- Manual smoke test: open a PNG, JPG, GIF, PDF from a workspace; close panel;
  switch between an image and a text file in succession (cache eviction path).

## Out of Scope (Tracked Separately)

- Web mode HTTP fallback for `asset://` (`/files/raw` endpoint on
  `aurowork-server`).
- Workspace-root path scoping on `fs_read_file` and asset protocol.
- pdfjs-dist for cross-platform PDF rendering parity (only needed if
  WebKit/WebView2 PDF support diverges visibly).
