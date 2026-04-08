import { Show, createEffect, createSignal } from "solid-js";

import { AlertTriangle, FolderPlus, Loader2, X } from "lucide-solid";
import { t, currentLocale } from "../../i18n";
import type { WorkspacePreset } from "../types";

export default function CreateWorkspaceModal(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: (preset: WorkspacePreset, folder: string | null) => void;
  onPickFolder: () => Promise<string | null>;
  onCheckFolder?: (folder: string) => Promise<{ writable: boolean; error: string | null }>;
  submitting?: boolean;
  inline?: boolean;
  showClose?: boolean;
  defaultPreset?: WorkspacePreset;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
}) {
  let pickFolderRef: HTMLButtonElement | undefined;
  const translate = (key: string) => t(key, currentLocale());

  const [preset, setPreset] = createSignal<WorkspacePreset>(props.defaultPreset ?? "starter");
  const [selectedFolder, setSelectedFolder] = createSignal<string | null>(null);
  const [pickingFolder, setPickingFolder] = createSignal(false);
  const [folderError, setFolderError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.open) {
      setPreset(props.defaultPreset ?? "starter");
      setSelectedFolder(null);
      setFolderError(null);
      requestAnimationFrame(() => pickFolderRef?.focus());
    }
  });

  const handlePickFolder = async () => {
    if (pickingFolder()) return;
    setPickingFolder(true);
    setFolderError(null);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const next = await props.onPickFolder();
      if (next) {
        // Check folder permissions before accepting
        if (props.onCheckFolder) {
          const check = await props.onCheckFolder(next);
          if (!check.writable) {
            setFolderError(check.error || translate("dashboard.folder_not_writable"));
            setSelectedFolder(null);
            return;
          }
        }
        setSelectedFolder(next);
      }
    } finally {
      setPickingFolder(false);
    }
  };

  const showClose = () => props.showClose ?? true;
  const title = () => props.title ?? translate("dashboard.create_workspace_title");
  const subtitle = () => props.subtitle ?? translate("dashboard.create_workspace_subtitle");
  const confirmLabel = () => props.confirmLabel ?? translate("dashboard.create_workspace_confirm");
  const isInline = () => props.inline ?? false;
  const submitting = () => props.submitting ?? false;
  const hasSelectedFolder = () => Boolean(selectedFolder()?.trim());

  const content = (
    <div class="flex max-h-[90vh] w-full max-w-[480px] flex-col overflow-hidden rounded-[24px] border border-dls-border bg-dls-surface">
      <div class="flex items-start justify-between gap-4 border-b border-dls-border bg-dls-surface px-6 py-5">
        <div class="min-w-0">
          <h3 class="text-[18px] font-semibold text-dls-text">{title()}</h3>
          <p class="mt-1 text-sm text-dls-secondary">{subtitle()}</p>
        </div>
        <Show when={showClose()}>
          <button
            onClick={props.onClose}
            disabled={submitting()}
            class={`flex h-8 w-8 items-center justify-center rounded-full text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text ${submitting() ? "cursor-not-allowed opacity-50" : ""}`.trim()}
            aria-label="Close create workspace modal"
          >
            <X size={18} />
          </button>
        </Show>
      </div>

      <div class={`flex-1 overflow-y-auto px-6 py-6 transition-opacity duration-300 ${submitting() ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        <div class="rounded-xl border border-dls-border bg-dls-sidebar px-5 py-4">
          <div class="mb-1 flex items-center justify-between gap-3">
            <div class="text-[15px] font-semibold text-dls-text">Workspace folder</div>
          </div>
          <div class="mb-4 text-[13px] text-dls-secondary">
            <Show when={hasSelectedFolder()} fallback={translate("dashboard.choose_folder_next")}>
              <span class="font-mono text-xs">{selectedFolder()}</span>
            </Show>
          </div>
          <button
            type="button"
            ref={pickFolderRef}
            onClick={handlePickFolder}
            disabled={pickingFolder() || submitting()}
            class="flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-4 py-2 text-center text-xs font-medium text-dls-text transition-colors hover:border-dls-border hover:bg-dls-hover disabled:cursor-wait disabled:opacity-70"
          >
            <Show when={pickingFolder()} fallback={<FolderPlus size={14} />}>
              <Loader2 size={14} class="animate-spin" />
            </Show>
            {hasSelectedFolder() ? translate("dashboard.change") : "Select folder"}
          </button>
          <Show when={folderError()}>
            <div class="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle size={14} class="mt-0.5 shrink-0" />
              <span>{folderError()}</span>
            </div>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-3 border-t border-dls-border bg-dls-surface px-6 py-5">
        <div class="flex justify-end gap-3">
          <Show when={showClose()}>
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitting()}
              class="rounded-full border border-dls-border bg-dls-surface px-4 py-2 text-center text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {translate("common.cancel")}
            </button>
          </Show>
          <button
            type="button"
            onClick={() => props.onConfirm(preset(), selectedFolder())}
            disabled={!selectedFolder() || submitting()}
            title={!selectedFolder() ? translate("dashboard.choose_folder_continue") : undefined}
            class="rounded-full bg-dls-accent px-6 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--dls-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Show when={submitting()} fallback={confirmLabel()}>
              <span class="inline-flex items-center gap-2">
                <Loader2 size={16} class="animate-spin" />
                Creating...
              </span>
            </Show>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Show when={props.open || isInline()}>
      <div
        class={
          isInline()
            ? "w-full"
            : "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200"
        }
      >
        {content}
      </div>
    </Show>
  );
}
