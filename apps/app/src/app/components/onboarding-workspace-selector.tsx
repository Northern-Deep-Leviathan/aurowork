import { For, Show, createEffect, createSignal } from "solid-js";

import { CheckCircle2, FolderPlus, Loader2 } from "lucide-solid";

import Button from "./button";

export default function OnboardingWorkspaceSelector(props: {
  defaultPath: string;
  onConfirm: (preset: "starter" | "automation" | "minimal", folder: string | null) => void;
  onPickFolder: () => Promise<string | null>;
}) {
  const [preset, setPreset] = createSignal<"starter" | "automation" | "minimal">("starter");
  const [selectedFolder, setSelectedFolder] = createSignal(props.defaultPath);
  const [pickingFolder, setPickingFolder] = createSignal(false);

  const options = () => [
    {
      id: "starter" as const,
      name: "Starter worker",
      desc: "Preconfigured to show you how to use plugins, commands, and skills.",
    },
    {
      id: "minimal" as const,
      name: "Empty worker",
      desc: "Start with a blank folder and add what you need.",
    },
  ];

  const canContinue = () => Boolean(selectedFolder().trim());

  createEffect(() => {
    if (!selectedFolder().trim()) {
      setSelectedFolder(props.defaultPath);
    }
  });

  const handlePickFolder = async () => {
    if (pickingFolder()) return;
    setPickingFolder(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const next = await props.onPickFolder();
      if (next) {
        setSelectedFolder(next);
      }
    } finally {
      setPickingFolder(false);
    }
  };

  return (
    <div class="bg-dls-hover border border-dls-border rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div class="p-6 flex-1 overflow-y-auto space-y-8">
        <div class="space-y-4">
          <div class="flex items-center gap-3 text-sm font-medium text-dls-text">
            <div class="w-6 h-6 rounded-full bg-dls-active flex items-center justify-center text-xs">1</div>
            Select Folder
          </div>
          <div class="ml-9">
            <div
              class={`w-full border border-dashed border-dls-border bg-dls-surface/40 rounded-xl p-4 text-left transition ${
                pickingFolder() ? "opacity-70" : "hover:border-dls-active"
              }`.trim()}
            >
              <div class="flex items-center gap-3 text-dls-text">
                <FolderPlus size={20} class="text-dls-secondary" />
                <input
                  class="flex-1 min-w-0 bg-transparent text-sm font-medium text-dls-text placeholder:text-dls-secondary focus:outline-none"
                  value={selectedFolder()}
                  onInput={(e) => setSelectedFolder(e.currentTarget.value)}
                  placeholder={props.defaultPath}
                />
                <button
                  type="button"
                  onClick={handlePickFolder}
                  disabled={pickingFolder()}
                  class="text-xs text-dls-secondary hover:text-dls-text transition-colors"
                >
                  <Show
                    when={pickingFolder()}
                    fallback={<span>Choose</span>}
                  >
                    <span class="inline-flex items-center gap-2">
                      <Loader2 size={12} class="animate-spin" />
                      Opening...
                    </span>
                  </Show>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="flex items-center gap-3 text-sm font-medium text-dls-text">
            <div class="w-6 h-6 rounded-full bg-dls-active flex items-center justify-center text-xs">2</div>
            Choose Preset
          </div>
          <div class={`ml-9 grid gap-3 ${!canContinue() ? "opacity-50" : ""}`.trim()}>
            <For each={options()}>
              {(opt) => (
                <div
                  onClick={() => {
                    if (!canContinue()) return;
                    setPreset(opt.id);
                  }}
                  class={`p-4 rounded-xl border cursor-pointer transition-all ${
                    preset() === opt.id
                      ? "bg-[rgba(var(--dls-accent-rgb),0.08)] border-[rgba(var(--dls-accent-rgb),0.3)] ring-1 ring-[rgba(var(--dls-accent-rgb),0.2)]"
                      : "bg-dls-surface/40 border-dls-border hover:border-dls-active"
                  } ${!canContinue() ? "pointer-events-none" : ""}`.trim()}
                >
                  <div class="flex justify-between items-start">
                    <div>
                      <div
                        class={`font-medium text-sm ${
                          preset() === opt.id ? "text-dls-accent" : "text-dls-text"
                        }`}
                      >
                        {opt.name}
                      </div>
                      <div class="text-xs text-dls-secondary mt-1">{opt.desc}</div>
                    </div>
                    <Show when={preset() === opt.id}>
                      <CheckCircle2 size={16} class="text-dls-accent" />
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

    </div>
  );
}
