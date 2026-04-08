import { Show, createEffect, createSignal } from "solid-js";
import { Check, ExternalLink, Loader2, MonitorSmartphone, Settings2, X } from "lucide-solid";
import Button from "./button";
import { t, type Language } from "../../i18n";

export type ControlChromeSetupModalProps = {
  open: boolean;
  busy: boolean;
  language: Language;
  mode: "connect" | "edit";
  initialUseExistingProfile: boolean;
  onClose: () => void;
  onSave: (useExistingProfile: boolean) => void;
};

export default function ControlChromeSetupModal(props: ControlChromeSetupModalProps) {
  const tr = (key: string) => t(key, props.language);
  const [useExistingProfile, setUseExistingProfile] = createSignal(props.initialUseExistingProfile);

  createEffect(() => {
    if (!props.open) return;
    setUseExistingProfile(props.initialUseExistingProfile);
  });

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={props.onClose} />

        <div class="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-dls-border/70 bg-dls-hover shadow-[var(--dls-shell-shadow)]">
          <div class="border-b border-dls-border px-6 py-5 sm:px-7">
            <div class="flex items-start justify-between gap-4">
              <div class="space-y-2">
                <div class="inline-flex items-center gap-2 rounded-full border border-dls-border bg-dls-hover px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-dls-secondary">
                  <MonitorSmartphone size={12} />
                  Chrome DevTools MCP
                </div>
                <div>
                  <h2 class="text-xl font-semibold text-dls-text sm:text-2xl">
                    {tr("mcp.control_chrome_setup_title")}
                  </h2>
                  <p class="mt-1 max-w-xl text-sm leading-6 text-dls-secondary">
                    {tr("mcp.control_chrome_setup_subtitle")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="rounded-xl p-2 text-dls-secondary transition-colors hover:bg-dls-active hover:text-dls-text"
                onClick={props.onClose}
                aria-label={tr("common.cancel")}
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div class="space-y-5 px-6 py-6 sm:px-7">
            <div class="rounded-2xl border border-dls-border bg-dls-surface/40 p-5">
              <div class="flex items-start gap-3">
                <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-3 text-blue-11">
                  <Check size={18} />
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-dls-text">
                    {tr("mcp.control_chrome_browser_title")}
                  </h3>
                  <p class="mt-1 text-sm text-dls-secondary">
                    {tr("mcp.control_chrome_browser_hint")}
                  </p>
                  <ol class="mt-3 space-y-2 text-sm leading-6 text-dls-text">
                    <li>1. {tr("mcp.control_chrome_browser_step_one")}</li>
                    <li>2. {tr("mcp.control_chrome_browser_step_two")}</li>
                    <li>3. {tr("mcp.control_chrome_browser_step_three")}</li>
                  </ol>
                  <a
                    href="https://github.com/ChromeDevTools/chrome-devtools-mcp"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-11 transition-colors hover:text-blue-12"
                  >
                    {tr("mcp.control_chrome_docs")}
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-dls-border bg-dls-surface/40 p-5">
              <div class="flex items-start gap-3">
                <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-dls-hover text-dls-secondary">
                  <Settings2 size={18} />
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-dls-text">
                    {tr("mcp.control_chrome_profile_title")}
                  </h3>
                  <p class="mt-1 text-sm leading-6 text-dls-secondary">
                    {tr("mcp.control_chrome_profile_hint")}
                  </p>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={useExistingProfile()}
                    onClick={() => setUseExistingProfile((current) => !current)}
                    class="mt-4 flex w-full items-center justify-between gap-4 rounded-2xl border border-dls-border bg-dls-hover px-4 py-4 text-left transition-colors hover:bg-dls-hover"
                  >
                    <div class="space-y-1">
                      <div class="text-sm font-semibold text-dls-text">
                        {tr("mcp.control_chrome_toggle_label")}
                      </div>
                      <div class="text-xs leading-5 text-dls-secondary">
                        {tr("mcp.control_chrome_toggle_hint")}
                      </div>
                    </div>

                    <div class={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${useExistingProfile() ? "bg-blue-9" : "bg-dls-border"}`}>
                      <div class={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${useExistingProfile() ? "translate-x-6" : "translate-x-1"}`} />
                    </div>
                  </button>

                  <div class="mt-3 rounded-2xl border border-dashed border-dls-border bg-dls-hover/70 px-4 py-3 text-xs leading-5 text-dls-secondary">
                    {useExistingProfile()
                      ? tr("mcp.control_chrome_toggle_on")
                      : tr("mcp.control_chrome_toggle_off")}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-col-reverse gap-3 border-t border-dls-border bg-dls-hover/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
            <Button variant="ghost" onClick={props.onClose}>
              {tr("mcp.auth.cancel")}
            </Button>
            <Button variant="secondary" onClick={() => props.onSave(useExistingProfile())} disabled={props.busy}>
              <Show when={props.busy} fallback={props.mode === "edit" ? tr("mcp.control_chrome_save") : tr("mcp.control_chrome_connect")}>
                <>
                  <Loader2 size={16} class="animate-spin" />
                  {props.mode === "edit" ? tr("mcp.control_chrome_save") : tr("mcp.control_chrome_connect")}
                </>
              </Show>
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
