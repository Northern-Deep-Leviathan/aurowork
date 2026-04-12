import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { CheckCircle2, Circle, Search, X } from "lucide-solid";
import { t, currentLocale } from "../../i18n";

import Button from "./button";
import ProviderIcon from "./provider-icon";
import { modelEquals } from "../utils";
import type { ModelOption, ModelRef } from "../types";

export type ModelPickerModalProps = {
  open: boolean;
  options: ModelOption[];
  filteredOptions: ModelOption[];
  query: string;
  setQuery: (value: string) => void;
  target: "default" | "session";
  current: ModelRef;
  onSelect: (model: ModelRef) => void;
  onBehaviorChange: (model: ModelRef, value: string | null) => void;
  onOpenSettings: () => void;
  onClose: (options?: { restorePromptFocus?: boolean }) => void;
};

export default function ModelPickerModal(props: ModelPickerModalProps) {
  let searchInputRef: HTMLInputElement | undefined;
  const translate = (key: string) => t(key, currentLocale());

  type RenderedItem = { kind: "model"; opt: ModelOption };

  const [activeIndex, setActiveIndex] = createSignal(0);
  const optionRefs: HTMLButtonElement[] = [];

  const renderedItems = createMemo<RenderedItem[]>(() => {
    const models = props.filteredOptions.filter((opt) => opt.isConnected);
    return models.map((opt) => ({ kind: "model" as const, opt }));
  });

  const activeModelIndex = createMemo(() => {
    const list = renderedItems();
    return list.findIndex(
      (item) =>
        modelEquals(props.current, {
          providerID: item.opt.providerID,
          modelID: item.opt.modelID,
        }),
    );
  });

  const allConnectedOptions = createMemo(() =>
    renderedItems().map((item, index) => ({ opt: item.opt, index })),
  );

  const clampIndex = (next: number) => {
    const last = renderedItems().length - 1;
    if (last < 0) return 0;
    return Math.max(0, Math.min(next, last));
  };

  const scrollActiveIntoView = (idx: number) => {
    const el = optionRefs[idx];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  };

  createEffect(() => {
    if (!props.open) return;
    requestAnimationFrame(() => {
      searchInputRef?.focus();
      if (searchInputRef?.value) {
        searchInputRef.select();
      }
    });
  });

  createEffect(() => {
    if (!props.open) return;
    const idx = activeModelIndex();
    const next = idx >= 0 ? idx : 0;
    setActiveIndex(clampIndex(next));
    requestAnimationFrame(() => scrollActiveIntoView(clampIndex(next)));
  });

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((current) => {
          const next = clampIndex(current + 1);
          requestAnimationFrame(() => scrollActiveIntoView(next));
          return next;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((current) => {
          const next = clampIndex(current - 1);
          requestAnimationFrame(() => scrollActiveIntoView(next));
          return next;
        });
        return;
      }

      if (event.key === "Enter") {
        if (event.isComposing || event.keyCode === 229) return;
        const idx = activeIndex();
        const item = renderedItems()[idx];
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        props.onSelect({ providerID: item.opt.providerID, modelID: item.opt.modelID });
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const renderOption = (opt: ModelOption, index: number) => {
    const active = () =>
      modelEquals(props.current, {
        providerID: opt.providerID,
        modelID: opt.modelID,
      });

    return (
      <div
        role="button"
        tabIndex={0}
        ref={(el) => {
          optionRefs[index] = el as unknown as HTMLButtonElement;
        }}
        class={`group w-full text-left rounded-xl px-3 py-2.5 transition-colors cursor-pointer ${
          active()
            ? "bg-dls-hover text-dls-text"
            : index === activeIndex()
              ? "bg-dls-surface text-dls-text"
              : "text-dls-secondary hover:bg-dls-surface/70 hover:text-dls-secondary"
        }`}
        onMouseEnter={() => {
          setActiveIndex(index);
        }}
        onClick={() => {
          props.onSelect({
            providerID: opt.providerID,
            modelID: opt.modelID,
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          props.onSelect({
            providerID: opt.providerID,
            modelID: opt.modelID,
          });
        }}
      >
        <div class="flex items-start gap-3">
          <ProviderIcon providerId={opt.providerID} size={16} class={`mt-[1px] shrink-0 transition-colors ${active() ? 'text-dls-text' : 'text-dls-secondary group-hover:text-dls-secondary'}`} />
          <div class="flex-1 min-w-0">
            <div class={`text-[13px] flex items-center justify-between gap-2 ${active() ? 'font-medium text-dls-text' : 'text-current'}`}>
              <span class="truncate">{opt.title}</span>
            </div>
            <div class={`mt-0.5 flex items-center gap-3 text-[11px] ${active() ? 'text-dls-secondary' : 'text-dls-secondary group-hover:text-dls-secondary'}`}>
              <span class="truncate">{opt.description ?? opt.providerID}</span>
              <span class="ml-auto opacity-70 font-mono">
                {opt.providerID}/{opt.modelID}
              </span>
            </div>
            <Show when={opt.footer}>
              <div class={`text-[11px] mt-1 ${active() ? 'text-dls-secondary' : 'text-dls-secondary/60 group-hover:text-dls-secondary'}`}>{opt.footer}</div>
            </Show>
            <Show when={active() && (opt.behaviorOptions?.length ?? 0) > 0}>
              <div class="mt-3 flex items-center gap-2" onKeyDown={(e) => e.stopPropagation()}>
                <span class="text-[11px] font-medium text-dls-secondary mr-1">{opt.behaviorTitle}:</span>
                <div class="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <For each={opt.behaviorOptions}>
                    {(option) => (
                      <button
                        type="button"
                        class={`text-[11px] transition-colors ${
                          opt.behaviorValue === option.value
                            ? "text-dls-text font-semibold"
                            : "text-dls-secondary hover:text-dls-text"
                        }`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onBehaviorChange(
                            { providerID: opt.providerID, modelID: opt.modelID },
                            option.value,
                          );
                        }}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
        <div class="bg-dls-surface border border-dls-border w-full max-w-lg rounded-[24px] shadow-[var(--dls-shell-shadow)] overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col">
          <div class="p-6 flex flex-col min-h-0">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-lg font-semibold text-dls-text">
                  {props.target === "default" ? "Default model" : "Chat model"}
                </h3>
                <p class="text-sm text-dls-secondary mt-1">
                  {props.target === "default"
                    ? "Choose the default model for new chats. If a model supports reasoning profiles, configure them on its card. "
                    : "Choose the model for this chat. If a model supports reasoning profiles, configure them on its card. "}
                  <button
                    type="button"
                    class="text-dls-accent hover:underline cursor-pointer"
                    onClick={() => {
                      props.onClose({ restorePromptFocus: false });
                      props.onOpenSettings();
                    }}
                  >
                    Add new provider
                  </button>
                </p>
              </div>
              <Button
                variant="ghost"
                class="!p-2 rounded-full"
                onClick={() => props.onClose()}
              >
                <X size={16} />
              </Button>
            </div>

            <div class="mt-5">
              <div class="relative">
                <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-dls-secondary" />
                <input
                  ref={(el) => (searchInputRef = el)}
                  type="text"
                  value={props.query}
                  onInput={(e) => props.setQuery(e.currentTarget.value)}
                  placeholder={translate("settings.search_models")}
                  class="w-full bg-dls-surface border border-dls-border rounded-xl py-2.5 pl-9 pr-3 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-1 focus:ring-[rgba(var(--dls-accent-rgb),0.2)] focus:border-dls-accent"
                />
              </div>
              <Show when={props.query.trim()}>
                <div class="mt-2 text-xs text-dls-secondary">
                  {translate("settings.showing_models").replace("{count}", String(props.filteredOptions.filter(o => o.isConnected).length)).replace("{total}", String(props.options.filter(o => o.isConnected).length))}
                </div>
              </Show>
            </div>

            <div class="mt-4 space-y-1 overflow-y-auto pr-1 -mr-1 min-h-0">
              <Show when={allConnectedOptions().length > 0}>
                <For each={allConnectedOptions()}>{({ opt, index }) => renderOption(opt, index)}</For>
              </Show>

              {/* Disconnected providers hidden — users can connect via Settings */}

              <Show when={renderedItems().length === 0}>
                <div class="rounded-2xl border border-dls-border bg-dls-surface/40 px-4 py-6 text-sm text-dls-secondary">
                  No models match your search.
                </div>
              </Show>
            </div>

            <div class="mt-5 flex justify-end shrink-0">
              <Button variant="outline" onClick={() => props.onClose()}>
                {translate("settings.done")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
