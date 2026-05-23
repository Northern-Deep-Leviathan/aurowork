import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { FolderOpen, X } from "lucide-solid";
import { isTauriRuntime } from "../utils";
import { t, currentLocale } from "../../i18n";

interface LaunchDiagnosticStatusDto {
  armedOnStartup: boolean;
  logFilePath: string | null;
}

const TOAST_VISIBLE_MS = 8000;

export function LaunchDiagnosticToast() {
  const [show, setShow] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<LaunchDiagnosticStatusDto>(
        "launch_diagnostic_status",
      );
      if (status.armedOnStartup) {
        setShow(true);
        dismissTimer = setTimeout(() => setShow(false), TOAST_VISIBLE_MS);
      }
    } catch {
      // Silent — command may not be registered in non-desktop runtime.
    }
  });

  onCleanup(() => {
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
  });

  function viewInSettings() {
    setShow(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aurowork:open-settings-debug"));
    }
  }

  async function openFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_launch_log_folder");
    } catch {
      // ignore
    }
  }

  return (
    <Show when={show()}>
      <div class="fixed bottom-4 right-4 z-50 max-w-sm">
        <div class="rounded-2xl border border-dls-border bg-dls-surface shadow-lg p-4 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-medium text-dls-text">
              {t("settings.launch_diag_toast_title", currentLocale())}
            </div>
            <button
              type="button"
              class="text-dls-secondary hover:text-dls-text"
              onClick={() => setShow(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              class="text-xs text-blue-11 hover:underline"
              onClick={viewInSettings}
            >
              {t("settings.launch_diag_toast_view", currentLocale())}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs text-dls-secondary hover:text-dls-text"
              onClick={() => void openFolder()}
            >
              <FolderOpen size={12} />
              {t("settings.launch_diag_open_folder", currentLocale())}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
