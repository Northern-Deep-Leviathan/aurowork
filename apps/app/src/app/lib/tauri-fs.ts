import { invoke } from "@tauri-apps/api/core";

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext: string;
}

export async function fsReadDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_read_dir", { path });
}

export async function fsReadTextFile(path: string): Promise<string> {
  return invoke<string>("fs_read_text_file", { path });
}

export async function fsWriteTextFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("fs_write_text_file", { path, content });
}
