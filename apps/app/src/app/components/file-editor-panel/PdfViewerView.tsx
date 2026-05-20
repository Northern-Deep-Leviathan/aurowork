import { convertFileSrc } from "@tauri-apps/api/core";
import type { FsEntry } from "../../lib/tauri-fs";

type PdfViewerViewProps = {
  entry: FsEntry;
  path: string;
};

export default function PdfViewerView(props: PdfViewerViewProps) {
  const src = () => convertFileSrc(props.path);

  return (
    <div class="flex h-full flex-col">
      <div class="min-h-0 flex-1 overflow-hidden bg-dls-hover/30">
        <embed
          src={src()}
          type="application/pdf"
          class="h-full w-full"
        />
      </div>
      <div class="flex shrink-0 items-center justify-between border-t border-dls-border px-3 py-1.5 text-[11px] text-dls-secondary">
        <span class="truncate">{props.entry.name}</span>
        <span class="shrink-0">PDF · {formatSize(props.entry.size)}</span>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
