import { For, Show } from "solid-js";
import { CheckCircle2, Circle } from "lucide-solid";
import { LANGUAGE_OPTIONS, type Language, t, currentLocale } from "../../i18n";

export type LanguagePickerModalProps = {
  open: boolean;
  currentLanguage: Language;
  onSelect: (language: Language) => void;
  onClose: () => void;
};

export default function LanguagePickerModal(props: LanguagePickerModalProps) {
  const translate = (key: string) => t(key, currentLocale());

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div class="bg-dls-surface rounded-3xl p-6 w-full max-w-md border border-dls-border shadow-[var(--dls-shell-shadow)]">
          <h3 class="text-lg font-medium text-dls-text mb-4">{translate("settings.language")}</h3>

          <div class="space-y-2">
            <For each={LANGUAGE_OPTIONS}>
              {(option) => (
                <button
                  class={`w-full p-3 rounded-xl text-left transition-all ${
                    props.currentLanguage === option.value
                      ? "bg-dls-active text-dls-text border-2 border-[rgba(var(--dls-accent-rgb),0.3)]"
                      : "bg-dls-sidebar text-dls-secondary hover:bg-dls-hover border-2 border-transparent"
                  }`}
                  onClick={() => {
                    props.onSelect(option.value);
                    props.onClose();
                  }}
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex-1">
                      <div class="font-medium text-sm">{option.nativeName}</div>
                      <Show when={option.label !== option.nativeName}>
                        <div class="text-xs text-dls-secondary mt-0.5">{option.label}</div>
                      </Show>
                    </div>
                    <div class="text-dls-secondary">
                      <Show
                        when={props.currentLanguage === option.value}
                        fallback={<Circle size={14} />}
                      >
                        <CheckCircle2 size={14} class="text-emerald-400" />
                      </Show>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>

          <button
            class="mt-4 w-full py-2 text-sm text-dls-secondary hover:text-dls-text transition-colors"
            onClick={props.onClose}
          >
            {translate("common.cancel")}
          </button>
        </div>
      </div>
    </Show>
  );
}
