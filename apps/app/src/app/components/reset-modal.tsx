import { Match, Show, Switch } from "solid-js";

import { X } from "lucide-solid";
import { t, currentLocale, type Language } from "../../i18n";

import Button from "./button";
import TextInput from "./text-input";

export type ResetModalProps = {
  open: boolean;
  mode: "onboarding" | "all";
  text: string;
  busy: boolean;
  canReset: boolean;
  hasActiveRuns: boolean;
  language: Language;
  onClose: () => void;
  onConfirm: () => void;
  onTextChange: (value: string) => void;
};

export default function ResetModal(props: ResetModalProps) {
  const translate = (key: string) => t(key, props.language);

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-dls-surface border border-dls-border w-full max-w-xl rounded-3xl shadow-[var(--dls-shell-shadow)] overflow-hidden">
          <div class="p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-lg font-semibold text-dls-text">
                  <Switch>
                    <Match when={props.mode === "onboarding"}>{translate("settings.reset_onboarding_title")}</Match>
                    <Match when={true}>{translate("settings.reset_app_data_title")}</Match>
                  </Switch>
                </h3>
                <p class="text-sm text-dls-secondary mt-1" innerHTML={translate("settings.reset_confirmation_hint")} />
              </div>
              <Button
                variant="ghost"
                class="!p-2 rounded-full"
                onClick={props.onClose}
                disabled={props.busy}
              >
                <X size={16} />
              </Button>
            </div>

            <div class="mt-6 space-y-4">
              <div class="rounded-xl bg-dls-surface/20 border border-dls-border p-3 text-xs text-dls-secondary">
                <Switch>
                  <Match when={props.mode === "onboarding"}>
                    {translate("settings.reset_onboarding_warning")}
                  </Match>
                  <Match when={true}>{translate("settings.reset_app_data_warning")}</Match>
                </Switch>
              </div>

              <Show when={props.hasActiveRuns}>
                <div class="text-xs text-red-11">{translate("settings.reset_stop_active_runs")}</div>
              </Show>

              <TextInput
                label={translate("settings.reset_confirmation_label")}
                placeholder={translate("settings.reset_confirmation_placeholder")}
                value={props.text}
                onInput={(e) => props.onTextChange(e.currentTarget.value)}
                disabled={props.busy}
              />
            </div>

            <div class="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={props.onClose} disabled={props.busy}>
                {translate("settings.reset_cancel")}
              </Button>
              <Button variant="danger" onClick={props.onConfirm} disabled={!props.canReset}>
                {translate("settings.reset_confirm_button")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
