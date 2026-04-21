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
