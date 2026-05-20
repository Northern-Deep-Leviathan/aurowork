import { createSignal } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FsEntry } from "../../lib/tauri-fs";

type ImageViewerViewProps = {
  entry: FsEntry;
  path: string;
  mime: string;
};

export default function ImageViewerView(props: ImageViewerViewProps) {
  const [errored, setErrored] = createSignal(false);
  const src = () => convertFileSrc(props.path);

  return (
    <div class="flex h-full flex-col">
      <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-dls-hover/30 p-3">
        {errored() ? (
          <div class="text-xs text-dls-secondary">Failed to load image</div>
        ) : (
          <img
            src={src()}
            alt={props.entry.name}
            class="max-h-full max-w-full object-contain"
            onError={() => setErrored(true)}
          />
        )}
      </div>
      <div class="flex shrink-0 items-center justify-between border-t border-dls-border px-3 py-1.5 text-[11px] text-dls-secondary">
        <span class="truncate">{props.entry.name}</span>
        <span class="shrink-0">
          {props.mime} · {formatSize(props.entry.size)}
        </span>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
