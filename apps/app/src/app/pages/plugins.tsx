import { For, Show } from "solid-js";

import type { PluginScope } from "../types";

import Button from "../components/button";
import TextInput from "../components/text-input";
import { Cpu } from "lucide-solid";

export type PluginsViewProps = {
  busy: boolean;
  selectedWorkspaceRoot: string;
  canEditPlugins: boolean;
  canUseGlobalScope: boolean;
  accessHint?: string | null;
  pluginScope: PluginScope;
  setPluginScope: (scope: PluginScope) => void;
  pluginConfigPath: string | null;
  pluginList: string[];
  pluginInput: string;
  setPluginInput: (value: string) => void;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  setActivePluginGuide: (value: string | null) => void;
  isPluginInstalled: (name: string, aliases?: string[]) => boolean;
  suggestedPlugins: Array<{
    name: string;
    packageName: string;
    description: string;
    tags: string[];
    aliases?: string[];
    installMode?: "simple" | "guided";
    steps?: Array<{
      title: string;
      description: string;
      command?: string;
      url?: string;
      path?: string;
      note?: string;
    }>;
  }>;
  refreshPlugins: (scopeOverride?: PluginScope) => void;
  addPlugin: (pluginNameOverride?: string) => void;
  removePlugin: (pluginName: string) => void;
};

export default function PluginsView(props: PluginsViewProps) {
  return (
    <section class="space-y-6">
      <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <div class="text-sm font-medium text-dls-text">OpenCode plugins</div>
            <div class="text-xs text-dls-secondary">Manage `opencode.json` for your project or global OpenCode plugins.</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                props.pluginScope === "project"
                  ? "bg-dls-text/10 text-dls-text border-dls-border/20"
                  : "text-dls-secondary border-dls-border hover:text-dls-text"
              }`}
              onClick={() => {
                props.setPluginScope("project");
                props.refreshPlugins("project");
              }}
            >
              Project
            </button>
            <button
              disabled={!props.canUseGlobalScope}
              class={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                props.pluginScope === "global"
                  ? "bg-dls-text/10 text-dls-text border-dls-border/20"
                  : "text-dls-secondary border-dls-border hover:text-dls-text"
              } ${!props.canUseGlobalScope ? "opacity-40 cursor-not-allowed hover:text-dls-secondary" : ""}`}
              onClick={() => {
                if (!props.canUseGlobalScope) return;
                props.setPluginScope("global");
                props.refreshPlugins("global");
              }}
            >
              Global
            </button>
            <Button variant="ghost" onClick={() => props.refreshPlugins()}>
              Refresh
            </Button>
          </div>
        </div>

        <div class="flex flex-col gap-1 text-xs text-dls-secondary">
          <div>Config</div>
          <div class="text-dls-secondary font-mono truncate">{props.pluginConfigPath ?? "Not loaded yet"}</div>
          <Show when={props.accessHint}>
            <div class="text-dls-secondary">{props.accessHint}</div>
          </Show>
        </div>

        <div class="space-y-3">
          <div class="text-xs font-medium text-dls-secondary uppercase tracking-wider">Suggested plugins</div>
          <div class="grid gap-3">
            <For each={props.suggestedPlugins}>
              {(plugin) => {
                const isGuided = () => plugin.installMode === "guided";
                const isInstalled = () => props.isPluginInstalled(plugin.packageName, plugin.aliases ?? []);
                const isGuideOpen = () => props.activePluginGuide === plugin.packageName;

                return (
                  <div class="rounded-2xl border border-dls-border/60 bg-dls-surface/40 p-4 space-y-3">
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <div class="text-sm font-medium text-dls-text font-mono">{plugin.name}</div>
                        <div class="text-xs text-dls-secondary mt-1">{plugin.description}</div>
                        <Show when={plugin.packageName !== plugin.name}>
                          <div class="text-xs text-dls-secondary font-mono mt-1">{plugin.packageName}</div>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={isGuided()}>
                          <Button
                            variant="ghost"
                            onClick={() => props.setActivePluginGuide(isGuideOpen() ? null : plugin.packageName)}
                          >
                            {isGuideOpen() ? "Hide setup" : "Setup"}
                          </Button>
                        </Show>
                        <Button
                          variant={isInstalled() ? "outline" : "secondary"}
                          onClick={() => props.addPlugin(plugin.packageName)}
                          disabled={
                            props.busy ||
                            isInstalled() ||
                            !props.canEditPlugins ||
                            (props.pluginScope === "project" && !props.selectedWorkspaceRoot.trim())
                          }
                        >
                          {isInstalled() ? "Added" : "Add"}
                        </Button>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <For each={plugin.tags}>
                        {(tag) => (
                          <span class="text-[10px] uppercase tracking-wide bg-dls-active/70 text-dls-secondary px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                    <Show when={isGuided() && isGuideOpen()}>
                      <div class="rounded-xl border border-dls-border/70 bg-black/40 p-4 space-y-3">
                        <For each={plugin.steps ?? []}>
                          {(step, idx) => (
                            <div class="space-y-1">
                              <div class="text-xs font-medium text-dls-secondary">
                                {idx() + 1}. {step.title}
                              </div>
                              <div class="text-xs text-dls-secondary">{step.description}</div>
                              <Show when={step.command}>
                                <div class="text-xs font-mono text-dls-text bg-dls-hover/60 border border-dls-border/70 rounded-lg px-3 py-2">
                                  {step.command}
                                </div>
                              </Show>
                              <Show when={step.note}>
                                <div class="text-xs text-dls-secondary">{step.note}</div>
                              </Show>
                              <Show when={step.url}>
                                <div class="text-xs text-dls-secondary">
                                  Open: <span class="font-mono text-dls-secondary">{step.url}</span>
                                </div>
                              </Show>
                              <Show when={step.path}>
                                <div class="text-xs text-dls-secondary">
                                  Path: <span class="font-mono text-dls-secondary">{step.path}</span>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <Show
          when={props.pluginList.length}
          fallback={
            <div class="rounded-xl border border-dls-border/60 bg-dls-surface/40 p-4 text-sm text-dls-secondary">
              No plugins configured yet.
            </div>
          }
        >
          <div class="grid gap-2">
            <For each={props.pluginList}>
              {(pluginName) => (
                <div class="flex items-center justify-between rounded-xl border border-dls-border/60 bg-dls-surface/40 px-4 py-2.5">
                  <div class="text-sm text-dls-text font-mono">{pluginName}</div>
                  <div class="flex items-center gap-2">
                    <div class="text-[10px] uppercase tracking-wide text-dls-secondary">Enabled</div>
                    <Button
                      variant="ghost"
                      class="h-7 px-2 text-[11px] text-red-11 hover:text-red-12"
                      onClick={() => props.removePlugin(pluginName)}
                      disabled={props.busy || !props.canEditPlugins}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="flex flex-col gap-3">
          <div class="flex flex-col md:flex-row gap-3">
            <div class="flex-1">
              <TextInput
                label="Add plugin"
                placeholder="opencode-wakatime"
                value={props.pluginInput}
                onInput={(e) => props.setPluginInput(e.currentTarget.value)}
                hint="Add npm package names, e.g. opencode-wakatime"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => props.addPlugin()}
              disabled={props.busy || !props.pluginInput.trim() || !props.canEditPlugins}
              class="md:mt-6"
            >
              Add
            </Button>
          </div>
          <Show when={props.pluginStatus}>
            <div class="text-xs text-dls-secondary">{props.pluginStatus}</div>
          </Show>
        </div>
      </div>
    </section>
  );
}
