import { For, Show, createMemo, createSignal } from "solid-js";
import {
  ArrowLeft,
  ChevronDown,
  Command,
  Folder,
  Play,
  Plus,
  Server,
  Settings,
} from "lucide-solid";

import type { WorkspaceInfo } from "../lib/tauri";
import Button from "../components/button";
import AuroWorkLogo from "../components/aurowork-logo";
import WorkspaceChip from "../components/workspace-chip";

type ProtoView = "onboarding" | "dashboard" | "session";

type SessionProto = {
  id: string;
  title: string;
  slug: string;
  workspaceId: string;
  updated: string;
  status: "idle" | "running" | "failed";
};

const workspaces: WorkspaceInfo[] = [
  {
    id: "ws-01",
    name: "Finance Ops",
    path: "/Users/susan/FinanceOps",
    preset: "starter",
    workspaceType: "local",
  },
  {
    id: "ws-02",
    name: "Mobile QA Lab",
    path: "/Users/susan/MobileQA",
    preset: "automation",
    workspaceType: "local",
  },
  {
    id: "ws-03",
    name: "Shared Host",
    path: "/Users/bob/Shared",
    preset: "starter",
    workspaceType: "remote",
    baseUrl: "http://10.0.0.8:4096",
  },
];

const sessions: SessionProto[] = [
  {
    id: "s-01",
    title: "Reconcile vendor overages",
    slug: "rv",
    workspaceId: "ws-01",
    updated: "2m ago",
    status: "running",
  },
  {
    id: "s-02",
    title: "Generate QA report",
    slug: "qr",
    workspaceId: "ws-02",
    updated: "28m ago",
    status: "idle",
  },
  {
    id: "s-03",
    title: "Sync policy checklist",
    slug: "pc",
    workspaceId: "ws-01",
    updated: "2h ago",
    status: "failed",
  },
];

const statusStyles: Record<SessionProto["status"], string> = {
  idle: "text-dls-secondary",
  running: "text-emerald-11",
  failed: "text-red-11",
};

const viewLabels: Record<ProtoView, string> = {
  onboarding: "Onboarding",
  dashboard: "Dashboard",
  session: "Session",
};

const navItems: Array<{
  id: string;
  label: string;
  icon: any;
}> = [
  { id: "scheduled", label: "Schedule", icon: Command },
  { id: "sessions", label: "Sessions", icon: Play },
  { id: "skills", label: "Skills", icon: Folder },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "mcp", label: "MCPs", icon: Server },
];

export default function ProtoWorkspacesView() {
  const [view, setView] = createSignal<ProtoView>("dashboard");
  const activeWorkspace = createMemo(() => workspaces[0]);
  const activeWorkspaceName = createMemo(() => activeWorkspace().name);

  const workspaceById = (id: string) => workspaces.find((ws) => ws.id === id) ?? workspaces[0];

  return (
    <main class="min-h-screen bg-dls-surface text-dls-text">
      <div class="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <header class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-3">
            <div class="inline-flex items-center gap-2 rounded-full border border-dls-border/70 bg-dls-hover/40 px-3 py-1 text-xs text-dls-secondary">
              Prototype: multi-workspace incremental
            </div>
            <div class="space-y-2">
              <h1 class="text-3xl font-semibold text-dls-text">Multi-workspace flow preview.</h1>
              <p class="text-sm text-dls-secondary max-w-2xl">
                UI-only mock that maps to the current onboarding, dashboard, and session layouts.
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-1 rounded-full border border-dls-border/70 bg-dls-hover/50 p-1">
              <For each={("onboarding dashboard session".split(" ") as ProtoView[])}>
                {(key) => (
                  <button
                    onClick={() => setView(key)}
                    class={`rounded-full px-3 py-1 text-xs transition-colors ${
                      view() === key
                        ? "bg-dls-text text-dls-surface"
                        : "text-dls-secondary hover:text-dls-text"
                    }`}
                  >
                    {viewLabels[key]}
                  </button>
                )}
              </For>
            </div>
          </div>
        </header>

        <Show when={view() === "onboarding"}>
          <div class="min-h-[70vh] flex flex-col items-center justify-center bg-dls-surface text-dls-text p-6 relative">
            <div class="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-dls-hover to-transparent opacity-20 pointer-events-none" />
            <div class="max-w-xl w-full z-10 space-y-10">
              <div class="text-center space-y-4">
                <div class="flex items-center justify-center gap-3 mb-6">
                  <AuroWorkLogo size={48} />
                  <h2 class="text-3xl font-bold tracking-tight text-dls-text">AuroWork</h2>
                </div>
                <h3 class="text-xl text-dls-secondary">Choose how to connect</h3>
              </div>

              <div class="space-y-4">
                <button class="group w-full relative bg-dls-hover hover:bg-dls-active border border-dls-border hover:border-dls-border p-6 rounded-3xl text-left transition-all duration-300 flex items-start gap-6">
                  <div class="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-dls-border/20 to-dls-border/10 flex items-center justify-center border border-dls-border">
                    <Play size={18} class="text-dls-secondary" />
                  </div>
                  <div>
                    <h4 class="text-xl font-medium text-dls-text mb-2">Run on this machine</h4>
                    <p class="text-dls-secondary text-sm leading-relaxed">
                      Start OpenCode locally and pick a workspace folder.
                    </p>
                  </div>
                </button>

                <button class="group w-full relative bg-dls-hover hover:bg-dls-active border border-dls-border hover:border-dls-border p-6 rounded-3xl text-left transition-all duration-300 flex items-start gap-6">
                  <div class="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-dls-border/20 to-dls-border/10 flex items-center justify-center border border-dls-border">
                    <Server size={18} class="text-dls-secondary" />
                  </div>
                  <div>
                    <h4 class="text-xl font-medium text-dls-text mb-2">Connect to a host</h4>
                    <p class="text-dls-secondary text-sm leading-relaxed">
                      Pair with an existing host and select a shared workspace.
                    </p>
                  </div>
                </button>
              </div>

              <div class="rounded-2xl border border-dls-border bg-black/40 px-5 py-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold text-dls-secondary uppercase tracking-wider">Workspaces</div>
                    <div class="mt-1 text-sm text-dls-text">Add a workspace folder or import one.</div>
                  </div>
                  <div class="flex gap-2">
                    <Button variant="secondary" class="text-xs px-3 py-1.5">Pick folder</Button>
                    <Button variant="outline" class="text-xs px-3 py-1.5">Import config</Button>
                  </div>
                </div>
                <div class="mt-4 space-y-2">
                  <For each={workspaces.slice(0, 2)}>
                    {(workspace) => (
                      <div class="flex items-center justify-between gap-3 rounded-xl bg-dls-surface/40 border border-dls-border px-3 py-2">
                        <div class="min-w-0">
                          <div class="text-xs font-medium text-dls-text truncate">{workspace.name}</div>
                          <div class="text-[11px] text-dls-secondary font-mono truncate">{workspace.path}</div>
                        </div>
                        <Button variant="ghost" class="text-xs px-2 py-1">Use</Button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={view() === "dashboard"}>
          <div class="flex h-[70vh] bg-dls-surface text-dls-text overflow-hidden rounded-3xl border border-dls-border">
            <aside class="w-60 border-r border-dls-border p-6 hidden md:flex flex-col justify-between bg-dls-surface">
              <div>
                <div class="flex items-center gap-3 mb-10 px-2">
                  <AuroWorkLogo size={28} />
                  <span class="font-bold text-lg tracking-tight">AuroWork</span>
                </div>
                <nav class="space-y-1">
                  <For each={navItems}>
                    {(item) => (
                      <button
                        class={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          item.id === "scheduled"
                            ? "bg-dls-hover text-dls-text"
                            : "text-dls-secondary hover:text-dls-text hover:bg-dls-hover/50"
                        }`}
                      >
                        <item.icon size={18} />
                        {item.label}
                      </button>
                    )}
                  </For>
                </nav>
              </div>

              <div class="space-y-3">
                <Button variant="secondary" class="w-full">Connect</Button>
                <Button variant="outline" class="w-full">Settings</Button>
              </div>
            </aside>

            <main class="flex-1 overflow-y-auto relative">
              <header class="h-16 flex items-center justify-between px-6 md:px-8 border-b border-dls-border sticky top-0 bg-dls-surface/80 backdrop-blur-md z-10">
                <div class="flex items-center gap-3">
                  <WorkspaceChip
                    workspace={activeWorkspace()}
                    onClick={() => undefined}
                    connecting={false}
                  />
                  <h2 class="text-lg font-medium">Dashboard</h2>
                  <span class="text-xs text-dls-secondary">Active: {activeWorkspaceName()}</span>
                </div>
                <div class="flex items-center gap-2">
                  <Button variant="outline" class="text-xs">
                    Share config
                  </Button>
                  <Button disabled={false}>
                    <Play size={16} />
                    New Task
                  </Button>
                </div>
              </header>

              <div class="p-6 md:p-8 max-w-4xl mx-auto space-y-8">
                <section>
                  <div class="bg-gradient-to-r from-dls-hover to-dls-active rounded-3xl p-1">
                    <div class="bg-dls-surface rounded-[22px] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                      <div class="space-y-2 text-center md:text-left">
                        <h3 class="text-2xl font-semibold text-dls-text">What should we do today?</h3>
                        <p class="text-dls-secondary">Describe an outcome. AuroWork will run it and keep an audit trail.</p>
                      </div>
                      <div class="w-full md:w-[320px]">
                        <div class="flex items-center gap-2 rounded-2xl border border-dls-border/60 bg-dls-hover/50 px-4 py-3">
                          <input
                            placeholder="Draft a task to run..."
                            class="flex-1 bg-transparent border-none p-0 text-sm text-dls-text placeholder:text-dls-secondary focus:ring-0"
                          />
                          <button class="rounded-xl bg-dls-text px-3 py-1.5 text-xs font-semibold text-dls-surface">Run</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="space-y-4">
                  <div class="flex items-center justify-between">
                    <h3 class="text-sm font-medium text-dls-secondary uppercase tracking-wider">Workspaces</h3>
                    <div class="flex items-center gap-2">
                      <Button variant="outline" class="text-xs h-8 px-3">
                        Share config
                      </Button>
                      <Button variant="secondary" class="text-xs h-8 px-3">
                        <Plus size={14} />
                        Add workspace
                      </Button>
                    </div>
                  </div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <For each={workspaces}>
                      {(workspace) => (
                        <div class="rounded-2xl border border-dls-border/60 bg-dls-surface/40 p-4 space-y-3">
                          <div class="flex items-start justify-between">
                            <div class="space-y-1">
                              <div class="text-sm font-semibold text-dls-text">{workspace.name}</div>
                              <div class="text-xs text-dls-secondary font-mono truncate">{workspace.path}</div>
                            </div>
                            <span class="text-[11px] text-dls-secondary">
                              {workspace.workspaceType === "remote" ? "Remote" : "Local"}
                            </span>
                          </div>
                          <div class="flex items-center justify-between text-xs text-dls-secondary">
                            <span>Last active: 2h ago</span>
                            <Button variant="ghost" class="text-xs px-2 py-1">
                              Switch
                            </Button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </section>

                <section class="space-y-4">
                  <h3 class="text-sm font-medium text-dls-secondary uppercase tracking-wider">Recent Sessions</h3>
                  <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl overflow-hidden">
                    <For each={sessions}>
                      {(session, idx) => (
                        <button
                          class={`w-full p-4 flex items-center justify-between hover:bg-dls-active/50 transition-colors text-left ${
                            idx() !== sessions.length - 1 ? "border-b border-dls-border/50" : ""
                          }`}
                        >
                          <div class="flex items-center gap-4">
                            <div class="w-8 h-8 rounded-full bg-dls-active flex items-center justify-center text-xs text-dls-secondary font-mono">
                              #{session.slug}
                            </div>
                            <div>
                              <div class="font-medium text-sm text-dls-text">{session.title}</div>
                              <div class="text-xs text-dls-secondary flex items-center gap-2">
                                <span>{session.updated}</span>
                                <span class="text-[11px] px-2 py-0.5 rounded-full border border-dls-border/60 text-dls-secondary">
                                  {workspaceById(session.workspaceId).name}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div class="flex items-center gap-3">
                            <span class={`text-xs ${statusStyles[session.status]}`}>{session.status}</span>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </div>
            </main>
          </div>
        </Show>

        <Show when={view() === "session"}>
          <div class="h-[70vh] flex flex-col bg-dls-surface text-dls-text relative rounded-3xl border border-dls-border overflow-hidden">
            <header class="h-16 border-b border-dls-border flex items-center justify-between px-6 bg-dls-surface/80 backdrop-blur-md z-10 sticky top-0">
              <div class="flex items-center gap-3">
                <Button variant="ghost" class="!p-2 rounded-full">
                  <ArrowLeft class="w-5 h-5" />
                </Button>
                <WorkspaceChip workspace={activeWorkspace()} onClick={() => undefined} />
                <span class="text-xs text-dls-secondary">Session: Reconcile vendor overages</span>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="outline" class="text-xs">Rename</Button>
                <Button class="text-xs">New Task</Button>
              </div>
            </header>

            <div class="flex-1 flex overflow-hidden">
              <aside class="hidden lg:flex w-72 border-r border-dls-border bg-dls-surface flex-col">
                <div class="p-4 border-b border-dls-border text-xs text-dls-secondary uppercase tracking-wider">
                  Sessions
                </div>
                <div class="p-4 space-y-2">
                  <For each={sessions}>
                    {(session) => (
                      <button class="w-full text-left rounded-xl border border-dls-border/60 bg-dls-surface/40 px-3 py-2">
                        <div class="text-sm text-dls-text truncate">{session.title}</div>
                        <div class="text-xs text-dls-secondary">{workspaceById(session.workspaceId).name}</div>
                      </button>
                    )}
                  </For>
                </div>
              </aside>

              <div class="flex-1 overflow-y-auto pt-6 md:pt-10 px-6 md:px-10">
                <div class="max-w-2xl mx-auto space-y-6">
                  <div class="rounded-2xl border border-dls-border/70 bg-dls-hover/40 px-4 py-3 text-xs text-dls-secondary">
                    Thinking · Reading workspace files
                  </div>
                  <div class="space-y-4">
                    <div class="rounded-2xl border border-dls-border/60 bg-dls-surface/40 p-4">
                      <div class="text-xs text-dls-secondary">User</div>
                      <div class="text-sm text-dls-text">Please reconcile vendor overages for the last month.</div>
                    </div>
                    <div class="rounded-2xl border border-dls-border/60 bg-dls-hover/40 p-4">
                      <div class="text-xs text-dls-secondary">Assistant</div>
                      <div class="text-sm text-dls-text">
                        I matched the overages to the latest statements and flagged three anomalies.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside class="hidden lg:flex w-72 border-l border-dls-border bg-dls-surface flex-col">
                <div class="p-4 border-b border-dls-border text-xs text-dls-secondary uppercase tracking-wider">
                  Context
                </div>
                <div class="p-4 space-y-3 text-sm text-dls-secondary">
                  <div class="rounded-xl border border-dls-border/60 bg-dls-surface/40 p-3">
                    Working files: 4
                  </div>
                  <div class="rounded-xl border border-dls-border/60 bg-dls-surface/40 p-3">
                    Skills: 2
                  </div>
                  <div class="rounded-xl border border-dls-border/60 bg-dls-surface/40 p-3">
                    Plugins: 1
                  </div>
                </div>
              </aside>
            </div>

            <div class="border-t border-dls-border bg-dls-surface px-6 py-4">
              <div class="max-w-2xl mx-auto flex items-center gap-2 rounded-2xl border border-dls-border/60 bg-dls-hover/40 px-4 py-3">
                <input
                  placeholder="Describe a task..."
                  class="flex-1 bg-transparent text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none"
                />
                <button class="rounded-xl bg-dls-text px-3 py-1.5 text-xs font-semibold text-dls-surface">Send</button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </main>
  );
}
