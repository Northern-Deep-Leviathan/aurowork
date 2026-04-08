import { Show, createEffect } from "solid-js";
import { X } from "lucide-solid";
import { t, currentLocale } from "../../i18n";

import Button from "./button";
import TextInput from "./text-input";

export type RenameSessionModalProps = {
  open: boolean;
  title: string;
  busy: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: () => void;
  onTitleChange: (value: string) => void;
};

export default function RenameSessionModal(props: RenameSessionModalProps) {
  let inputRef: HTMLInputElement | undefined;
  const translate = (key: string) => t(key, currentLocale());

  createEffect(() => {
    if (props.open) {
      requestAnimationFrame(() => {
        inputRef?.focus();
        if (inputRef) {
          inputRef.select();
        }
      });
    }
  });

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-dls-surface border border-dls-border w-full max-w-lg rounded-3xl shadow-[var(--dls-shell-shadow)] overflow-hidden">
          <div class="p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-lg font-semibold text-dls-text">{translate("session.rename_title")}</h3>
                <p class="text-sm text-dls-secondary mt-1">{translate("session.rename_description")}</p>
              </div>
              <Button variant="ghost" class="!p-2 rounded-full" onClick={props.onClose}>
                <X size={16} />
              </Button>
            </div>

            <div class="mt-6">
              <TextInput
                ref={inputRef}
                label={translate("session.rename_label")}
                value={props.title}
                onInput={(e) => props.onTitleChange(e.currentTarget.value)}
                placeholder={translate("session.rename_placeholder")}
                class="bg-dls-hover"
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
                  event.preventDefault();
                  if (props.canSave) props.onSave();
                }}
              />
            </div>

            <div class="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={props.onClose} disabled={props.busy}>
                {translate("common.cancel")}
              </Button>
              <Button onClick={props.onSave} disabled={!props.canSave}>
                {translate("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
