import { Show, type Accessor, type Setter } from "solid-js";
import Button from "../../components/button";

const settingsPanelSoftClass =
  "rounded-2xl border border-dls-border/40 bg-dls-hover/20";
const compactOutlineActionClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-dls-border px-2.5 py-1 text-xs text-dls-secondary hover:bg-dls-hover transition";

export interface OpenDeeplinkPanelProps {
  busy: boolean;
  open: Accessor<boolean>;
  setOpen: Setter<boolean>;
  input: Accessor<string>;
  setInput: Setter<string>;
  status: Accessor<string | null>;
  setStatus: Setter<string | null>;
  busyLocal: Accessor<boolean>;
  onSubmit: () => void | Promise<void>;
  translate: (key: string) => string;
}

export function OpenDeeplinkPanel(props: OpenDeeplinkPanelProps) {
  return (
    <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-dls-text">
            {props.translate("settings.open_deeplink_title")}
          </div>
          <div class="text-xs text-dls-secondary">
            {props.translate("settings.open_deeplink_description")}
          </div>
        </div>
        <button
          type="button"
          class={compactOutlineActionClass}
          onClick={() => {
            props.setOpen((value) => !value);
            props.setStatus(null);
          }}
          disabled={props.busy || props.busyLocal()}
        >
          {props.open()
            ? props.translate("settings.open_deeplink_hide")
            : props.translate("settings.open_deeplink_open")}
        </button>
      </div>

      <Show when={props.open()}>
        <div class="space-y-3">
          <textarea
            value={props.input()}
            onInput={(event) => props.setInput(event.currentTarget.value)}
            rows={3}
            placeholder="aurowork://..."
            class="w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs font-mono text-dls-text outline-none transition focus:border-blue-8"
          />
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              class="text-xs h-8 py-0 px-3"
              onClick={() => void props.onSubmit()}
              disabled={props.busy || props.busyLocal() || !props.input().trim()}
            >
              {props.busyLocal()
                ? props.translate("settings.open_deeplink_opening")
                : props.translate("settings.open_deeplink_action")}
            </Button>
            <div class="text-[11px] text-dls-secondary">
              Accepts <span class="font-mono">aurowork://</span>,{" "}
              <span class="font-mono">aurowork-dev://</span>, or a raw supported{" "}
              <span class="font-mono">https://share.example.com/b/...</span> URL.
            </div>
          </div>
        </div>
      </Show>

      <Show when={props.status()}>
        {(value) => <div class="text-xs text-dls-secondary">{value()}</div>}
      </Show>
    </div>
  );
}
