import { Show, type JSX } from "solid-js";

import { AlertTriangle } from "lucide-solid";

import Button from "./button";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string | JSX.Element;
  confirmLabel: string;
  cancelLabel: string;
  variant?: "danger" | "warning";
  confirmButtonVariant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  cancelButtonVariant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal(props: ConfirmModalProps) {
  const variant = () => props.variant ?? "warning";

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-dls-surface border border-dls-border w-full max-w-md rounded-3xl shadow-[var(--dls-shell-shadow)] overflow-hidden">
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div
                class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                classList={{
                  "bg-amber-3/50 text-amber-11": variant() === "warning",
                  "bg-red-3/50 text-red-11": variant() === "danger",
                }}
              >
                <AlertTriangle size={20} />
              </div>
              <div class="min-w-0">
                <h3 class="text-base font-semibold text-dls-text">{props.title}</h3>
                <p class="mt-2 text-sm text-dls-secondary">{props.message}</p>
              </div>
            </div>

            <div class="mt-6 flex justify-end gap-2">
              <Button variant={props.cancelButtonVariant ?? "outline"} onClick={props.onCancel}>
                {props.cancelLabel}
              </Button>
              <Button
                variant={props.confirmButtonVariant ?? (variant() === "danger" ? "danger" : "primary")}
                onClick={props.onConfirm}
              >
                {props.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
