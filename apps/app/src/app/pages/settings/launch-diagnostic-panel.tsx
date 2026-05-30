import { Show, createSignal, onMount } from "solid-js";
import { Copy, FolderOpen, RotateCw } from "lucide-solid";
import Button from "../../components/button";

const settingsPanelSoftClass =
  "rounded-2xl border border-dls-border/40 bg-dls-hover/20";
const compactOutlineActionClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-dls-border px-2.5 py-1 text-xs text-dls-secondary hover:bg-dls-hover transition";

interface LaunchLogStatusDto {
  logFilePath: string | null;
}

export interface LaunchDiagnosticPanelProps {
  translate: (key: string) => string;
}

export function LaunchDiagnosticPanel(props: LaunchDiagnosticPanelProps) {
  const [logPath, setLogPath] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<LaunchLogStatusDto>("launch_log_status");
      setLogPath(status.logFilePath);
    } catch {
      // Not in Tauri runtime or command not registered yet — silent.
      setLogPath(null);
    }
  });

  async function restartApp() {
    setErrorMsg(null);
    const ok = window.confirm(props.translate("settings.launch_diag_confirm"));
    if (!ok) return;
    setBusy(true);
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
      // On success the app process exits before this line runs.
    } catch (e) {
      setBusy(false);
      setErrorMsg(String(e));
    }
  }

  async function openFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_launch_log_folder");
    } catch (e) {
      setErrorMsg(String(e));
    }
  }

  async function copyPath() {
    const p = logPath();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      // ignore
    }
  }

  return (
    <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
      <div>
        <div class="text-sm font-medium text-dls-text">
          {props.translate("settings.launch_diag_title")}
        </div>
        <div class="text-xs text-dls-secondary">
          {props.translate("settings.launch_diag_description")}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          class="text-xs h-8 py-0 px-3"
          onClick={() => void restartApp()}
          disabled={busy()}
        >
          <RotateCw size={13} class="mr-1.5" />
          {busy()
            ? props.translate("settings.launch_diag_running")
            : props.translate("settings.launch_diag_run")}
        </Button>
        <span class="text-[11px] text-dls-secondary">
          {props.translate("settings.launch_diag_run_hint")}
        </span>
      </div>

      <div class="border-t border-dls-border/40 pt-3 space-y-2">
        <div class="text-xs font-medium text-dls-text">
          {props.translate("settings.launch_diag_last")}
        </div>
        <Show
          when={logPath()}
          fallback={
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs text-dls-secondary">
                {props.translate("settings.launch_diag_none")}
              </div>
              <button
                type="button"
                class={compactOutlineActionClass}
                onClick={() => void openFolder()}
              >
                <FolderOpen size={14} class="text-dls-secondary" />
                {props.translate("settings.launch_diag_open_folder")}
              </button>
            </div>
          }
        >
          <div class="text-xs font-mono text-dls-secondary break-all">
            {logPath()}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class={compactOutlineActionClass}
              onClick={() => void copyPath()}
            >
              <Copy size={14} class="text-dls-secondary" />
              {props.translate("settings.launch_diag_copy_path")}
            </button>
            <button
              type="button"
              class={compactOutlineActionClass}
              onClick={() => void openFolder()}
            >
              <FolderOpen size={14} class="text-dls-secondary" />
              {props.translate("settings.launch_diag_open_folder")}
            </button>
          </div>
        </Show>
      </div>

      <Show when={errorMsg()}>
        {(value) => (
          <div class="text-xs text-red-11">{value()}</div>
        )}
      </Show>
    </div>
  );
}
