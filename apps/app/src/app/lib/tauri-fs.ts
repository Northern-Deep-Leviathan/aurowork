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
