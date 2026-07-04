import type { WorkspaceInfo } from "../lib/tauri";

import { ChevronDown, Folder, Globe, Loader2, Zap } from "lucide-solid";

function iconForWorkspace(preset: string) {
  if (preset === "starter") return Zap;
  if (preset === "automation") return Folder;
  if (preset === "minimal") return Globe;
  return Folder;
}

export default function WorkspaceChip(props: {
  workspace: WorkspaceInfo;
  onClick: () => void;
  connecting?: boolean;
}) {
  const Icon = iconForWorkspace(props.workspace.preset);
  const subtitle = () => props.workspace.path;

  return (
    <button
      onClick={props.onClick}
      class="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-dls-hover border border-dls-border rounded-lg hover:border-dls-border hover:bg-dls-active transition-all group"
    >
      <div
        class={`p-1 rounded ${
          props.workspace.preset === "starter"
            ? "bg-amber-7/10 text-amber-6"
            : "bg-indigo-7/10 text-indigo-6"
        }`}
      >
        <Icon size={14} />
      </div>
      <div class="flex flex-col items-start mr-2 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-dls-text leading-none truncate max-w-[9.5rem]">
            {props.workspace.name}
          </span>
        </div>
        <span class="text-[10px] text-dls-secondary font-mono leading-none max-w-[120px] truncate">
          {subtitle()}
        </span>
      </div>
      <ChevronDown size={14} class="text-dls-secondary group-hover:text-dls-secondary" />
      {props.connecting ? <Loader2 size={14} class="text-dls-secondary animate-spin" /> : null}
    </button>
  );
}
