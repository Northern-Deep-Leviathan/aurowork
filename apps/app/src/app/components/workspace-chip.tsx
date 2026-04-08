import type { WorkspaceInfo } from "../lib/tauri";

import { t, currentLocale } from "../../i18n";

import { ChevronDown, Folder, Globe, Loader2, Zap } from "lucide-solid";

function iconForWorkspace(preset: string, workspaceType: string) {
  if (workspaceType === "remote") return Globe;
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
  const Icon = iconForWorkspace(props.workspace.preset, props.workspace.workspaceType);
  const subtitle = () =>
    props.workspace.workspaceType === "remote"
      ? props.workspace.baseUrl ?? props.workspace.path
      : props.workspace.path;
  const isSandboxWorkspace =
    props.workspace.workspaceType === "remote" &&
    (props.workspace.sandboxBackend === "docker" ||
      Boolean(props.workspace.sandboxRunId?.trim()) ||
      Boolean(props.workspace.sandboxContainerName?.trim()));
  const translate = (key: string) => t(key, currentLocale());

  return (
    <button
      onClick={props.onClick}
      class="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-dls-hover border border-dls-border rounded-lg hover:border-dls-border hover:bg-dls-active transition-all group"
    >
      <div
        class={`p-1 rounded ${
          props.workspace.workspaceType !== "remote" && props.workspace.preset === "starter"
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
          {props.workspace.workspaceType === "remote" ? (
            <span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-dls-active text-dls-secondary">
              {isSandboxWorkspace ? "Sandbox" : translate("dashboard.remote")}
            </span>
          ) : null}
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
