import { createEffect, createMemo, createSignal } from "solid-js";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";

import type {
  Client,
  StartupPreference,
  OnboardingStep,
  WorkspaceDisplay,
  WorkspaceAuroworkConfig,
  WorkspacePreset,
  WorkspaceConnectionState,
  EngineRuntime,
} from "../types";
import {
  addOpencodeCacheHint,
  clearStartupPreference,
  isTauriRuntime,
  normalizeDirectoryPath,
  readStartupPreference,
  safeStringify,
  writeStartupPreference,
} from "../utils";
import { unwrap } from "../lib/auro";
import { describeDirectoryScope, resolveScopedClientDirectory } from "../lib/session-scope";
import { decideWorkspaceLanding } from "../lib/workspace-draft";
import {
  AuroworkServerError,
  type AuroworkServerClient,
  type AuroworkServerSettings,
  type AuroworkServerStatus,
} from "../lib/aurowork-server";
import { downloadDir, homeDir } from "@tauri-apps/api/path";
import {
  engineDoctor,
  engineInfo,
  auroDbMigrate,
  engineInstall,
  engineStart,
  engineStop,
  orchestratorInstanceDispose,
  orchestratorWorkspaceActivate,
  pickFile,
  pickDirectory,
  saveFile,
  workspaceBootstrap,
  workspaceCreate,
  workspaceExportConfig,
  workspaceForget,
  workspaceImportConfig,
  workspaceRegister,
  workspaceAuroworkRead,
  workspaceAuroworkWrite,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  resolveWorkspaceListSelectedId,
  type EngineDoctorResult,
  type EngineInfo,
  type WorkspaceInfo,
} from "../lib/tauri";
import { waitForHealthy, createClient, type AuroAuth } from "../lib/auro";
import type { OpencodeConnectStatus, ProviderListItem } from "../types";
import { t, currentLocale } from "../../i18n";
import { filterProviderList, mapConfigProvidersToList } from "../utils/providers";
import { launchLog } from "../../lib/launch-log";

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export type WorkspaceDebugEvent = {
  at: number;
  label: string;
  payload?: unknown;
};

export type MigrationRepairResult = {
  ok: boolean;
  message: string;
};

export function createWorkspaceStore(options: {
  startupPreference: () => StartupPreference | null;
  setStartupPreference: (value: StartupPreference | null) => void;
  onboardingStep: () => OnboardingStep;
  setOnboardingStep: (step: OnboardingStep) => void;
  rememberStartupChoice: () => boolean;
  setRememberStartupChoice: (value: boolean) => void;
  baseUrl: () => string;
  setBaseUrl: (value: string) => void;
  clientDirectory: () => string;
  setClientDirectory: (value: string) => void;
  client: () => Client | null;
  setClient: (value: Client | null) => void;
  setConnectedVersion: (value: string | null) => void;
  setSseConnected: (value: boolean) => void;
  setProviders: (value: ProviderListItem[]) => void;
  setProviderDefaults: (value: Record<string, string>) => void;
  setProviderConnectedIds: (value: string[]) => void;
  setError: (value: string | null) => void;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  loadSessions: (scopeRoot?: string) => Promise<void>;
  refreshPendingPermissions: () => Promise<void>;
  selectedSessionId: () => string | null;
  selectSession: (id: string) => Promise<void>;
  setSelectedSessionId: (value: string | null) => void;
  setMessages: (value: any[]) => void;
  setTodos: (value: any[]) => void;
  setPendingPermissions: (value: any[]) => void;
  setSessionStatusById: (value: Record<string, string>) => void;
  setSessions: (value: any[]) => void;
  modelVariant: () => string | null;
  refreshSkills: (options?: { force?: boolean }) => Promise<void>;
  refreshPlugins: () => Promise<void>;
  engineSource: () => "path" | "sidecar" | "custom";
  engineCustomBinPath?: () => string;
  auroEnableExa?: () => boolean;
  setEngineSource: (value: "path" | "sidecar" | "custom") => void;
  setView: (value: any) => void;
  setTab: (value: any) => void;
  isWindowsPlatform: () => boolean;
  auroworkServerSettings: () => AuroworkServerSettings;
  updateAuroworkServerSettings: (next: AuroworkServerSettings) => void;
  auroworkServerClient?: () => AuroworkServerClient | null;
  auroworkServerStatus?: () => AuroworkServerStatus;
  ensureLocalAuroworkServerClient?: () => Promise<AuroworkServerClient | null>;
  runtimeWorkspaceId?: () => string | null;
  setOpencodeConnectStatus?: (status: OpencodeConnectStatus | null) => void;
  onEngineStable?: () => void;
  engineRuntime?: () => EngineRuntime;
  developerMode: () => boolean;
}) {

  const wsDebugEnabled = () => options.developerMode();

  const WORKSPACE_DEBUG_EVENT_LIMIT = 200;
  const [workspaceDebugEvents, setWorkspaceDebugEvents] = createSignal<WorkspaceDebugEvent[]>([]);
  const clearWorkspaceDebugEvents = () => setWorkspaceDebugEvents([]);
  const pushWorkspaceDebugEvent = (label: string, payload?: unknown) => {
    if (!wsDebugEnabled()) return;
    const entry: WorkspaceDebugEvent = { at: Date.now(), label, payload };
    setWorkspaceDebugEvents((prev) => {
      if (!prev.length) return [entry];
      const sliceStart = Math.max(0, prev.length - WORKSPACE_DEBUG_EVENT_LIMIT + 1);
      const next = prev.slice(sliceStart);
      next.push(entry);
      return next;
    });
  };

  const wsDebug = (label: string, payload?: unknown) => {
    if (!wsDebugEnabled()) return;
    try {
      if (payload === undefined) {
        console.log(`[WSDBG] ${label}`);
      } else {
        console.log(`[WSDBG] ${label}`, payload);
      }
      pushWorkspaceDebugEvent(label, payload);
    } catch {
      // ignore
    }
  };

  const connectInFlightByKey = new Map<string, Promise<boolean>>();
  const DEFAULT_CONNECT_HEALTH_TIMEOUT_MS = 12_000;
  const LOCAL_BOOT_CONNECT_HEALTH_TIMEOUT_MS = 180_000;
  const LONG_BOOT_CONNECT_REASONS = new Set(["host-start", "bootstrap-local"]);
  const INITIAL_WORKSPACE_SETUP_COMPLETE_KEY = "aurowork.initialWorkspaceSetupComplete";
  const LEGACY_ONBOARDING_COMPLETE_KEY = "aurowork.onboardingComplete";
  const STARTER_BOOTSTRAP_STATE_KEY = "aurowork.starterBootstrapState";
  const STARTER_BOOTSTRAP_FOLDER_NAME = "AuroWork";
  const STARTER_BOOTSTRAP_WORKSPACE_NAME = "starter";
  const DB_MIGRATE_UNSUPPORTED_PATTERNS = [
    /unknown(?:\s+sub)?command\s+['"`]?db['"`]?/i,
    /unrecognized(?:\s+sub)?command\s+['"`]?db['"`]?/i,
    /no such command[:\s]+db/i,
    /found argument ['"`]db['"`] which wasn't expected/i,
  ] as const;

  const connectRequestKey = (
    nextBaseUrl: string,
    directory?: string,
    context?: {
      workspaceId?: string;
      workspaceType?: WorkspaceInfo["workspaceType"];
      targetRoot?: string;
      reason?: string;
    },
    auth?: AuroAuth,
    connectOptions?: { quiet?: boolean; navigate?: boolean },
  ) =>
    [
      nextBaseUrl.trim(),
      (directory ?? "").trim(),
      context?.workspaceId?.trim() ?? "",
      context?.workspaceType ?? "",
      context?.targetRoot?.trim() ?? "",
      context?.reason ?? "",
      auth?.mode ?? (auth ? "basic" : "none"),
      String(connectOptions?.quiet ?? false),
      String(connectOptions?.navigate ?? true),
    ].join("::");

  const resolveConnectHealthTimeoutMs = (reason?: string) => {
    const normalizedReason = reason?.trim() ?? "";
    if (LONG_BOOT_CONNECT_REASONS.has(normalizedReason)) {
      return LOCAL_BOOT_CONNECT_HEALTH_TIMEOUT_MS;
    }
    return DEFAULT_CONNECT_HEALTH_TIMEOUT_MS;
  };

  const formatExecOutput = (result: { stdout: string; stderr: string }) => {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    return [stderr, stdout].filter(Boolean).join("\n\n");
  };

  const isDbMigrateUnsupported = (output: string) => {
    const normalized = output.trim();
    if (!normalized) return false;
    return DB_MIGRATE_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(normalized));
  };

  const [engine, setEngine] = createSignal<EngineInfo | null>(null);
  const [engineAuth, setEngineAuth] = createSignal<AuroAuth | null>(null);
  const [engineDoctorResult, setEngineDoctorResult] = createSignal<EngineDoctorResult | null>(null);
  const [engineDoctorCheckedAt, setEngineDoctorCheckedAt] = createSignal<number | null>(null);
  const [engineInstallLogs, setEngineInstallLogs] = createSignal<string | null>(null);

  const makeRunId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  let lastEngineReconnectAt = 0;
  let reconnectingEngine = false;

  const readInitialWorkspaceSetupComplete = () => {
    if (typeof window === "undefined") return false;
    try {
      return (
        window.localStorage.getItem(INITIAL_WORKSPACE_SETUP_COMPLETE_KEY) === "1" ||
        window.localStorage.getItem(LEGACY_ONBOARDING_COMPLETE_KEY) === "1"
      );
    } catch {
      return false;
    }
  };

  type StarterBootstrapState = "not_started" | "in_progress" | "completed" | "failed" | "skipped";

  const readStarterBootstrapState = (): StarterBootstrapState => {
    if (typeof window === "undefined") return "not_started";
    try {
      const raw = window.localStorage.getItem(STARTER_BOOTSTRAP_STATE_KEY);
      if (raw === "in_progress" || raw === "completed" || raw === "failed" || raw === "skipped") {
        return raw;
      }
      return "not_started";
    } catch {
      return "not_started";
    }
  };

  const persistStarterBootstrapState = (next: StarterBootstrapState) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STARTER_BOOTSTRAP_STATE_KEY, next);
    } catch {
      // ignore
    }
  };

  const [projectDir, setProjectDir] = createSignal("");
  const [workspaces, setWorkspaces] = createSignal<WorkspaceInfo[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = createSignal<string>("");
  const [initialWorkspaceSetupComplete, setInitialWorkspaceSetupComplete] = createSignal(
    readInitialWorkspaceSetupComplete(),
  );
  const [starterBootstrapState, setStarterBootstrapState] = createSignal<StarterBootstrapState>(
    readStarterBootstrapState(),
  );

  const syncSelectedWorkspaceId = (id: string) => {
    setSelectedWorkspaceId(id);
  };

  const pickSelectedWorkspaceId = (
    nextWorkspaces: WorkspaceInfo[],
    preferredIds: Array<string | null | undefined> = [],
    fallbackList?: { selectedId?: string; activeId?: string | null } | null,
  ) => {
    for (const candidate of preferredIds) {
      const id = candidate?.trim() ?? "";
      if (id && nextWorkspaces.some((workspace) => workspace.id === id)) {
        return id;
      }
    }

    const responseId = resolveWorkspaceListSelectedId(fallbackList);
    if (responseId && nextWorkspaces.some((workspace) => workspace.id === responseId)) {
      return responseId;
    }

    return nextWorkspaces[0]?.id ?? "";
  };

  const applyServerLocalWorkspaces = (nextLocals: WorkspaceInfo[], nextActiveId: string | null | undefined) => {
    setWorkspaces(nextLocals);

    syncSelectedWorkspaceId(
      pickSelectedWorkspaceId(nextLocals, [selectedWorkspaceId()], { activeId: nextActiveId ?? null }),
    );
  };

  const [authorizedDirs, setAuthorizedDirs] = createSignal<string[]>([]);
  const [newAuthorizedDir, setNewAuthorizedDir] = createSignal("");

  const [workspaceConfig, setWorkspaceConfig] = createSignal<WorkspaceAuroworkConfig | null>(null);
  const [workspaceConfigLoaded, setWorkspaceConfigLoaded] = createSignal(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = createSignal(false);
  const [connectingWorkspaceId, setConnectingWorkspaceId] = createSignal<string | null>(null);
  const [connectedWorkspaceId, setConnectedWorkspaceId] = createSignal<string | null>(null);
  const [workspaceConnectionStateById, setWorkspaceConnectionStateById] = createSignal<
    Record<string, WorkspaceConnectionState>
  >({});
  const [exportingWorkspaceConfig, setExportingWorkspaceConfig] = createSignal(false);
  const [importingWorkspaceConfig, setImportingWorkspaceConfig] = createSignal(false);
  const [migrationRepairBusy, setMigrationRepairBusy] = createSignal(false);
  const [migrationRepairResult, setMigrationRepairResult] = createSignal<MigrationRepairResult | null>(null);

  const selectedWorkspaceInfo = createMemo(() => workspaces().find((w) => w.id === selectedWorkspaceId()) ?? null);
  const firstRunWorkspaceSetup = createMemo(
    () => isTauriRuntime() && !initialWorkspaceSetupComplete() && workspaces().length === 0,
  );
  const setPersistedStarterBootstrapState = (next: StarterBootstrapState) => {
    setStarterBootstrapState(next);
    persistStarterBootstrapState(next);
  };

  const selectedWorkspaceDisplay = createMemo<WorkspaceDisplay>(() => {
    const ws = selectedWorkspaceInfo();
    if (!ws) {
      return {
        id: "",
        name: "Worker",
        path: "",
        preset: "starter",
        workspaceType: "local",
        displayName: null,
      };
    }
    const displayName = ws.displayName?.trim() || ws.name || ws.path || "Worker";
    return { ...ws, name: displayName };
  });
  const selectedWorkspacePath = createMemo(() => {
    const ws = selectedWorkspaceInfo();
    if (!ws) return "";
    return ws.path ?? "";
  });
  const selectedWorkspaceRoot = createMemo(() => selectedWorkspacePath().trim());

  const resolveWorkspaceEntryId = (input: {
    workspaceId?: string | null;
    workspaceType?: WorkspaceInfo["workspaceType"];
    targetRoot?: string | null;
    directory?: string | null;
  }) => {
    const explicit = input.workspaceId?.trim() ?? "";
    if (explicit && workspaces().some((workspace) => workspace.id === explicit)) {
      return explicit;
    }

    const scope = normalizeDirectoryPath(input.targetRoot ?? input.directory ?? "");
    if (!scope) return null;

    const match = workspaces().find((workspace) => {
      const workspaceScope = normalizeDirectoryPath(workspace.path?.trim() ?? "");
      if (!workspaceScope || workspaceScope !== scope) return false;
      if (input.workspaceType && workspace.workspaceType !== input.workspaceType) return false;
      return true;
    });

    return match?.id ?? null;
  };

  const applySelectedWorkspacePresentation = async (workspace: WorkspaceInfo) => {
    syncSelectedWorkspaceId(workspace.id);

    setProjectDir(workspace.path);

    if (isTauriRuntime()) {
      setWorkspaceConfigLoaded(false);
      try {
        const cfg = await loadWorkspaceConfigFromAuroworkServer(workspace.path)
          ?? await workspaceAuroworkRead({ workspacePath: workspace.path });
        setWorkspaceConfig(cfg);
        setWorkspaceConfigLoaded(true);

        const roots = Array.isArray(cfg.authorizedRoots) ? cfg.authorizedRoots : [];
        if (roots.length) {
          setAuthorizedDirs(roots);
        } else {
          setAuthorizedDirs([workspace.path]);
        }
      } catch {
        setWorkspaceConfig(null);
        setWorkspaceConfigLoaded(true);
        setAuthorizedDirs([workspace.path]);
      }
      return;
    }

    if (!authorizedDirs().includes(workspace.path)) {
      const merged = authorizedDirs().length ? authorizedDirs().slice() : [];
      if (!merged.includes(workspace.path)) merged.push(workspace.path);
      setAuthorizedDirs(merged);
    }
  };

  async function selectWorkspace(workspaceId: string) {
    const id = workspaceId.trim();
    if (!id) return false;
    const workspace = workspaces().find((entry) => entry.id === id) ?? null;
    if (!workspace) return false;

    // Draft-session model: every workspace click unconditionally enters the
    // draft state for the target workspace. No "changed" guard — the user
    // intent is "I clicked this workspace, take me there with a clean slate".
    //
    // Clearing must happen BEFORE applySelectedWorkspacePresentation flips
    // selectedWorkspaceId, otherwise reactive consumers (route, sidebar)
    // briefly see the new workspace paired with stale session state from
    // the previous workspace and may pre-emptively redirect / select.
    const landing = decideWorkspaceLanding({
      workspaceRoot: workspace.path,
    });
    if (landing.clearSessionState) {
      options.setSelectedSessionId(null);
      options.setMessages([]);
      options.setTodos([]);
      options.setPendingPermissions([]);
      options.setSessionStatusById({});
    }

    await applySelectedWorkspacePresentation(workspace);

    // Eagerly refresh the session list for the new workspace so the sidebar
    // and route guards see an up-to-date list scoped to this root. Without
    // this, loadedSessionScopeRoot stays pinned to the previous workspace's
    // root and downstream guards (route redirect, session resolution) keep
    // refusing to redirect to the draft state.
    if (landing.loadSessionsRoot) {
      void options.loadSessions(landing.loadSessionsRoot);
    }

    if (isTauriRuntime()) {
      try {
        await workspaceSetSelected(id);
      } catch {
        // ignore
      }
    }

    return true;
  }

  async function ensureWorkspaceActivated(workspaceId: string) {
    const id = workspaceId.trim();
    if (!id) return false;
    if (selectedWorkspaceId() !== id) {
      await selectWorkspace(id);
    }
    if (connectedWorkspaceId() === id && options.client()) {
      return true;
    }
    return await activateWorkspace(id);
  }

  const updateWorkspaceConnectionState = (
    workspaceId: string,
    next: Partial<WorkspaceConnectionState>,
  ) => {
    const id = workspaceId.trim();
    if (!id) return;
    setWorkspaceConnectionStateById((prev) => {
      const current = prev[id] ?? { status: "idle", message: null, checkedAt: null };
      return {
        ...prev,
        [id]: {
          ...current,
          ...next,
          checkedAt: Date.now(),
        },
      };
    });
  };

  const clearWorkspaceConnectionState = (workspaceId: string) => {
    const id = workspaceId.trim();
    if (!id) return;
    setWorkspaceConnectionStateById((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  createEffect(() => {
    const ids = new Set(workspaces().map((workspace) => workspace.id));
    setWorkspaceConnectionStateById((prev) => {
      let changed = false;
      const next: Record<string, WorkspaceConnectionState> = {};
      for (const [id, state] of Object.entries(prev)) {
        if (!ids.has(id)) {
          changed = true;
          continue;
        }
        next[id] = state;
      }
      return changed ? next : prev;
    });
  });

  const resolveEngineRuntime = () => options.engineRuntime?.() ?? "aurowork-orchestrator";

  const resolveWorkspacePaths = () => {
    const active = selectedWorkspacePath().trim();
    const locals = workspaces()
      .filter((ws) => ws.workspaceType === "local")
      .map((ws) => ws.path)
      .filter((path): path is string => Boolean(path && path.trim()))
      .map((path) => path.trim());
    const resolved: string[] = [];
    if (active) resolved.push(active);
    for (const path of locals) {
      if (!resolved.includes(path)) resolved.push(path);
    }
    return resolved;
  };

  const resolveConnectedAuroworkServer = () => {
    const client = options.auroworkServerClient?.();
    if (!client) return null;
    if (options.auroworkServerStatus?.() !== "connected") return null;
    return client;
  };

  const resolveActiveAuroworkWorkspace = () => {
    const client = resolveConnectedAuroworkServer();
    const workspaceId = options.runtimeWorkspaceId?.()?.trim() ?? "";
    if (!client || !workspaceId) return null;
    return { client, workspaceId };
  };

  const findAuroworkWorkspaceByPath = async (workspacePath: string) => {
    const client = resolveConnectedAuroworkServer();
    const targetPath = normalizeDirectoryPath(workspacePath);
    if (!client || !targetPath) return null;

    const response = await client.listWorkspaces();
    const items = Array.isArray(response.items) ? response.items : [];
    const match = items.find((entry) => normalizeDirectoryPath(entry.path) === targetPath);
    if (!match?.id) return null;
    return { client, workspaceId: match.id, response };
  };

  const loadWorkspaceConfigFromAuroworkServer = async (workspacePath: string): Promise<WorkspaceAuroworkConfig | null> => {
    const resolved = await findAuroworkWorkspaceByPath(workspacePath);
    if (!resolved) return null;
    const config = await resolved.client.getConfig(resolved.workspaceId);
    return (config.aurowork as WorkspaceAuroworkConfig | null | undefined) ?? null;
  };

  const persistWorkspaceConfigToAuroworkServer = async (config: WorkspaceAuroworkConfig): Promise<boolean> => {
    const active = resolveActiveAuroworkWorkspace();
    if (!active) return false;
    await active.client.patchConfig(active.workspaceId, { aurowork: config as Record<string, unknown> });
    return true;
  };

  const activateAuroworkHostWorkspace = async (workspacePath: string) => {
    const resolved = await findAuroworkWorkspaceByPath(workspacePath);
    if (!resolved) return;
    try {
      if (resolved.response.activeId === resolved.workspaceId) return;
      await resolved.client.activateWorkspace(resolved.workspaceId);
    } catch {
      // ignore
    }
  };

  async function testWorkspaceConnection(workspaceId: string) {
    const id = workspaceId.trim();
    if (!id) return false;
    const workspace = workspaces().find((item) => item.id === id) ?? null;
    if (!workspace) return false;

    updateWorkspaceConnectionState(id, { status: "connecting", message: null });
    updateWorkspaceConnectionState(id, { status: "connected", message: null });
    return true;
  }

  async function refreshEngine() {
    if (!isTauriRuntime()) return;

    try {
      const info = await engineInfo();
      setEngine(info);

      const username = info.auroUsername?.trim() ?? "";
      const password = info.auroPassword?.trim() ?? "";
      const auth = username && password ? { username, password } : null;
      setEngineAuth(auth);

      if (info.projectDir) {
        setProjectDir(info.projectDir);
      }
      if (info.baseUrl) {
        options.setBaseUrl(info.baseUrl);
      }

      if (
        info.running &&
        info.baseUrl &&
        !options.client() &&
        !reconnectingEngine
      ) {
        const now = Date.now();
        if (now - lastEngineReconnectAt > 10_000) {
          const connectedWorkspace = workspaces().find((workspace) => workspace.id === connectedWorkspaceId()) ?? null;
          const reconnectRoot =
            connectedWorkspace?.path?.trim() ||
            info.projectDir?.trim() ||
            "";
          lastEngineReconnectAt = now;
          reconnectingEngine = true;
          connectToServer(
            info.baseUrl,
            reconnectRoot || undefined,
            { workspaceType: "local", targetRoot: reconnectRoot, reason: "engine-refresh" },
            auth ?? undefined,
            { quiet: true, navigate: false },
          )
            .catch(() => undefined)
            .finally(() => {
              reconnectingEngine = false;
            });
        }
      }
    } catch {
      // ignore
    }
  }

  async function refreshEngineDoctor() {
    if (!isTauriRuntime()) return;

    try {
      const source = options.engineSource();
      const result = await engineDoctor({
        preferSidecar: source === "sidecar",
        auroBinPath: source === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
      });
      setEngineDoctorResult(result);
      setEngineDoctorCheckedAt(Date.now());
    } catch (e) {
      setEngineDoctorResult(null);
      setEngineDoctorCheckedAt(Date.now());
      setEngineInstallLogs(e instanceof Error ? e.message : safeStringify(e));
    }
  }

  async function activateWorkspace(workspaceId: string) {
    const id = workspaceId.trim();
    if (!id) return false;

    const next = workspaces().find((w) => w.id === id) ?? null;
    if (!next) return false;
    if (selectedWorkspaceId() !== id) {
      await selectWorkspace(id);
    }
    console.log("[workspace] activate", { id: next.id, type: next.workspaceType });
    const activateStart = Date.now();
    wsDebug("activate:start", {
      id: next.id,
      type: next.workspaceType,
      prevActiveId: selectedWorkspaceId(),
      prevProjectDir: projectDir(),
      startupPref: options.startupPreference(),
      hasClient: Boolean(options.client()),
    });

    setConnectingWorkspaceId(id);
    updateWorkspaceConnectionState(id, { status: "connecting", message: null });

    // Allow the UI to paint the "switching" state before we kick off work that can
    // trigger expensive reactive updates (e.g. sidebar session refreshes).
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    try {
    const wasLocalConnection = options.startupPreference() === "local" && options.client();
    options.setStartupPreference("local");
    const nextRoot = next.path;
    // IMPORTANT: compare against the *actual* connected directory (clientDirectory),
    // not projectDir(). selectWorkspace eagerly calls setProjectDir(next.path) via
    // applySelectedWorkspacePresentation, so by the time we reach here projectDir()
    // already equals nextRoot and workspaceChanged would falsely read `false`, causing
    // the engine restart/reconnect below to be silently skipped. clientDirectory()
    // is only mutated inside connectToServer, so it reflects the real runtime state.
    const connectedDirectory = options.clientDirectory().trim();
    const workspaceChanged = connectedDirectory !== nextRoot;

    wsDebug("activate:local:prep", {
      id,
      nextRoot,
      workspaceChanged,
      wasLocalConnection: Boolean(wasLocalConnection),
      connectedDirectory,
    });

    syncSelectedWorkspaceId(id);
    setProjectDir(nextRoot);

    if (isTauriRuntime()) {
      setWorkspaceConfigLoaded(false);
      try {
        const cfg = await loadWorkspaceConfigFromAuroworkServer(next.path)
          ?? await workspaceAuroworkRead({ workspacePath: next.path });
        setWorkspaceConfig(cfg);
        setWorkspaceConfigLoaded(true);

        const roots = Array.isArray(cfg.authorizedRoots) ? cfg.authorizedRoots : [];
        if (roots.length) {
          setAuthorizedDirs(roots);
        } else {
          setAuthorizedDirs([next.path]);
        }
      } catch {
        setWorkspaceConfig(null);
        setWorkspaceConfigLoaded(true);
        setAuthorizedDirs([next.path]);
      }

      try {
        await activateAuroworkHostWorkspace(next.path);
        await workspaceSetRuntimeActive(id);
      } catch {
        // ignore
      }
    } else {
      if (!authorizedDirs().includes(next.path)) {
        const merged = authorizedDirs().length ? authorizedDirs().slice() : [];
        if (!merged.includes(next.path)) merged.push(next.path);
        setAuthorizedDirs(merged);
      }
    }

    // If we were previously connected to a remote engine, switching back to a local workspace
    // requires starting (or reconnecting) the local host engine.
    //
    // Without this, we end up keeping the remote client while `startupPreference` flips to
    // "local", and subsequent session/file actions behave inconsistently.
    if (options.client() && !wasLocalConnection) {
      wsDebug("activate:remote->local:reconnect", {
        id,
        nextPath: next.path,
        engine: engine()?.baseUrl ?? null,
        engineRunning: Boolean(engine()?.running),
      });
      options.setSelectedSessionId(null);
      options.setMessages([]);
      options.setTodos([]);
      options.setPendingPermissions([]);
      options.setSessionStatusById({});

      // If a local host engine is already running (common when bouncing between remote/local),
      // reuse it instead of restarting to keep switching snappy.
      let connectedToLocalHost = false;
      const existingEngine = engine();
      const runtime = existingEngine?.runtime ?? resolveEngineRuntime();
      const canReuseHost =
        isTauriRuntime() &&
        Boolean(existingEngine?.running && existingEngine.baseUrl);

      wsDebug("activate:remote->local:hostReuse", {
        canReuseHost,
        runtime,
        existingEngineBaseUrl: existingEngine?.baseUrl ?? null,
        existingEngineProjectDir: existingEngine?.projectDir ?? null,
      });

      if (canReuseHost && runtime === "aurowork-orchestrator") {
        try {
          const reuseStart = Date.now();
          await orchestratorWorkspaceActivate({
            workspacePath: next.path,
            name: next.displayName?.trim() || next.name?.trim() || null,
          });
          await activateAuroworkHostWorkspace(next.path);

          const nextInfo = await engineInfo();
          setEngine(nextInfo);

          const username = nextInfo.auroUsername?.trim() ?? "";
          const password = nextInfo.auroPassword?.trim() ?? "";
          const auth = username && password ? { username, password } : undefined;
          setEngineAuth(auth ?? null);

          if (nextInfo.baseUrl) {
            connectedToLocalHost = await connectToServer(
              nextInfo.baseUrl,
              next.path,
              { workspaceType: "local", targetRoot: next.path, reason: "workspace-attach-local" },
              auth,
              { navigate: false },
            );
          }
          wsDebug("activate:remote->local:reuseHost:done", {
            ok: connectedToLocalHost,
            ms: Date.now() - reuseStart,
          });
        } catch {
          connectedToLocalHost = false;
          wsDebug("activate:remote->local:reuseHost:error");
        }
      }

      if (!connectedToLocalHost) {
        const startHostAt = Date.now();
        const ok = await startHost({ workspacePath: next.path, navigate: false });
        wsDebug("activate:remote->local:startHost:done", { ok, ms: Date.now() - startHostAt });
        if (!ok) {
          updateWorkspaceConnectionState(id, {
            status: "error",
            message: "Failed to start local engine.",
          });
          return false;
        }
      }
    }

    // When running locally, restart the engine when workspace changes
    if (wasLocalConnection && workspaceChanged) {
      wsDebug("activate:local->local:restartEngine", { id, nextPath: next.path });
      options.setError(null);
      options.setBusy(true);
      options.setBusyLabel("status.restarting_engine");
      options.setBusyStartedAt(Date.now());

      try {
        const runtime = resolveEngineRuntime();
        if (runtime === "aurowork-orchestrator") {
          await orchestratorWorkspaceActivate({
            workspacePath: next.path,
            name: next.displayName?.trim() || next.name?.trim() || null,
          });
          await activateAuroworkHostWorkspace(next.path);

          const newInfo = await engineInfo();
          setEngine(newInfo);

          const username = newInfo.auroUsername?.trim() ?? "";
          const password = newInfo.auroPassword?.trim() ?? "";
          const auth = username && password ? { username, password } : undefined;
          setEngineAuth(auth ?? null);

            if (newInfo.baseUrl) {
              const ok = await connectToServer(
                newInfo.baseUrl,
                next.path,
                { workspaceType: "local", targetRoot: next.path, reason: "workspace-orchestrator-switch" },
                auth,
                { navigate: false },
              );
              if (!ok) {
                options.setError("Failed to reconnect after worker switch");
              }
            }
        } else {
          // Stop the current engine
          const info = await engineStop();
          setEngine(info);

          // Start engine with new workspace directory
          launchLog("info", "launch:ui", "engineStart called from activateWorkspace");
          const newInfo = await engineStart(next.path, {
            preferSidecar: options.engineSource() === "sidecar",
            auroBinPath:
              options.engineSource() === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
            auroEnableExa: options.auroEnableExa?.() ?? false,
            runtime,
            workspacePaths: resolveWorkspacePaths(),
          });
          setEngine(newInfo);

          const username = newInfo.auroUsername?.trim() ?? "";
          const password = newInfo.auroPassword?.trim() ?? "";
          const auth = username && password ? { username, password } : undefined;
          setEngineAuth(auth ?? null);

          // Reconnect to server
            if (newInfo.baseUrl) {
              const ok = await connectToServer(
                newInfo.baseUrl,
                next.path,
                { workspaceType: "local", targetRoot: next.path, reason: "workspace-restart" },
                auth,
                { navigate: false },
              );
              if (!ok) {
                options.setError("Failed to reconnect after worker switch");
              }
            }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : safeStringify(e);
        options.setError(addOpencodeCacheHint(message));
      } finally {
        options.setBusy(false);
        options.setBusyLabel(null);
        options.setBusyStartedAt(null);
      }
    }

      options.refreshSkills({ force: true }).catch(() => undefined);
      options.refreshPlugins().catch(() => undefined);
      updateWorkspaceConnectionState(id, { status: "connected", message: null });
      wsDebug("activate:local:done", { id, ms: Date.now() - activateStart });
      return true;
    } finally {
      setConnectingWorkspaceId(null);
      wsDebug("activate:finally", { id, ms: Date.now() - activateStart });
    }
  }

  async function connectToServer(
    nextBaseUrl: string,
    directory?: string,
    context?: {
      workspaceId?: string;
      workspaceType?: WorkspaceInfo["workspaceType"];
      targetRoot?: string;
      reason?: string;
    },
    auth?: AuroAuth,
    connectOptions?: { quiet?: boolean; navigate?: boolean },
  ) {
    const requestKey = connectRequestKey(nextBaseUrl, directory, context, auth, connectOptions);
    const existing = connectInFlightByKey.get(requestKey);
    if (existing) {
      wsDebug("connect:dedupe", {
        baseUrl: nextBaseUrl,
        directory: directory ?? null,
        reason: context?.reason ?? null,
        workspaceType: context?.workspaceType ?? null,
      });
      return existing;
    }

    const run = (async () => {
      console.log("[workspace] connect", {
        baseUrl: nextBaseUrl,
        directory: directory ?? null,
        workspaceType: context?.workspaceType ?? null,
      });
      const connectStart = Date.now();
      wsDebug("connect:start", {
        baseUrl: nextBaseUrl,
        directory: directory ?? null,
        directoryScope: describeDirectoryScope(directory),
        reason: context?.reason ?? null,
        workspaceType: context?.workspaceType ?? null,
        targetRoot: context?.targetRoot ?? null,
        targetRootScope: describeDirectoryScope(context?.targetRoot),
        workspaceId: context?.workspaceId ?? null,
        selectedWorkspaceId: selectedWorkspaceId() || null,
        selectedWorkspaceRoot: selectedWorkspaceRoot().trim() || null,
        activeWorkspaceScope: describeDirectoryScope(selectedWorkspaceRoot().trim()),
        projectDir: projectDir().trim() || null,
        clientDirectory: options.clientDirectory().trim() || null,
        healthTimeoutMs: resolveConnectHealthTimeoutMs(context?.reason),
        quiet: connectOptions?.quiet ?? false,
        navigate: connectOptions?.navigate ?? true,
        authMode: auth && "mode" in auth ? (auth as any).mode : auth ? "basic" : "none",
      });
      const quiet = connectOptions?.quiet ?? false;
      const navigate = connectOptions?.navigate ?? true;
      options.setError(null);
      if (!quiet) {
        options.setBusy(true);
        options.setBusyLabel("status.connecting");
        options.setBusyStartedAt(Date.now());
      }
      options.setSseConnected(false);

      const connectMeta: OpencodeConnectStatus = {
        at: Date.now(),
        baseUrl: nextBaseUrl,
        directory: directory ?? null,
        reason: context?.reason ?? null,
        status: "connecting",
        error: null,
      };
      options.setOpencodeConnectStatus?.(connectMeta);

      const connectMetrics: NonNullable<OpencodeConnectStatus["metrics"]> = {};

      try {
        let resolvedDirectory = resolveScopedClientDirectory({
          directory,
          targetRoot: context?.targetRoot,
        });
        let nextClient = createClient(nextBaseUrl, resolvedDirectory || undefined, auth);
        const healthTimeoutMs = resolveConnectHealthTimeoutMs(context?.reason);
        const health = await waitForHealthy(nextClient, { timeoutMs: healthTimeoutMs });
        connectMetrics.healthyMs = Date.now() - connectStart;
        wsDebug("connect:healthy", {
          ms: Date.now() - connectStart,
          version: health.version,
          timeoutMs: healthTimeoutMs,
          resolvedDirectory: resolvedDirectory || null,
          resolvedDirectoryScope: describeDirectoryScope(resolvedDirectory),
        });

        options.setClient(nextClient);
        options.setConnectedVersion(health.version);
        options.setBaseUrl(nextBaseUrl);
        options.setClientDirectory(resolvedDirectory);
        setConnectedWorkspaceId(
          resolveWorkspaceEntryId({
            workspaceId: context?.workspaceId ?? null,
            workspaceType: context?.workspaceType,
            targetRoot: context?.targetRoot ?? resolvedDirectory,
            directory: resolvedDirectory,
          }),
        );

        const providersPromise = (async () => {
          const providersAt = Date.now();
          wsDebug("connect:providers:start", { baseUrl: nextBaseUrl });
          let disabledProviders: string[] = [];
          try {
            const config = unwrap(await nextClient.config.get());
            disabledProviders = Array.isArray(config.disabled_providers) ? config.disabled_providers : [];
          } catch {
            // ignore config read failures and continue with provider discovery
          }
          try {
            const providerList = unwrap(await nextClient.provider.list());
              wsDebug("connect:providers:done", {
                ms: Date.now() - providersAt,
                source: "provider.list",
                available: providerList.all?.length ?? 0,
                connected: providerList.connected?.length ?? 0,
              });
              const next = filterProviderList(providerList, disabledProviders);
              return {
                providers: next.all,
                defaults: next.default,
                connectedIds: next.connected,
              };
            } catch (error) {
            const message = error instanceof Error ? error.message : safeStringify(error);
            wsDebug("connect:providers:fallback", { ms: Date.now() - providersAt, message });
            try {
              const cfg = unwrap(await nextClient.config.providers());
              const mapped = mapConfigProvidersToList(cfg.providers);
              wsDebug("connect:providers:done", {
                ms: Date.now() - providersAt,
                source: "config.providers",
                available: mapped.length,
                connected: 0,
              });
              const next = filterProviderList(
                { all: mapped, connected: [], default: cfg.default },
                disabledProviders,
              );
              return {
                providers: next.all,
                defaults: next.default,
                connectedIds: next.connected,
              };
            } catch (fallbackError) {
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : safeStringify(fallbackError);
              wsDebug("connect:providers:error", { ms: Date.now() - providersAt, message: fallbackMessage });
              return {
                providers: [],
                defaults: {},
                connectedIds: [],
              };
            }
          } finally {
            connectMetrics.providersMs = Date.now() - providersAt;
          }
        })();

        const targetRoot = context?.targetRoot ?? (resolvedDirectory || selectedWorkspaceRoot().trim());
        wsDebug("connect:loadSessions", {
          targetRoot,
          targetRootScope: describeDirectoryScope(targetRoot),
          resolvedDirectory,
          resolvedDirectoryScope: describeDirectoryScope(resolvedDirectory),
          selectedWorkspaceId: selectedWorkspaceId() || null,
          selectedWorkspaceRoot: selectedWorkspaceRoot().trim() || null,
        });
        const sessionsAt = Date.now();
        await options.loadSessions(targetRoot);
        connectMetrics.loadSessionsMs = Date.now() - sessionsAt;
        wsDebug("connect:loadSessions:done", { ms: Date.now() - sessionsAt });
        const pendingPermissionsAt = Date.now();
        await options.refreshPendingPermissions();
        connectMetrics.pendingPermissionsMs = Date.now() - pendingPermissionsAt;

        const providerState = await providersPromise;
        options.setProviders(providerState.providers);
        options.setProviderDefaults(providerState.defaults);
        options.setProviderConnectedIds(providerState.connectedIds);

        options.setSelectedSessionId(null);
        options.setMessages([]);
        options.setTodos([]);
        options.setPendingPermissions([]);
        options.setSessionStatusById({});

        options.refreshSkills({ force: true }).catch(() => undefined);
        options.refreshPlugins().catch(() => undefined);
        if (navigate && !options.selectedSessionId()) {
          options.setTab("scheduled");
          options.setView("session");
        }

        // If the user successfully connected, treat onboarding as complete so we
        // don't force the onboarding flow on subsequent launches.
        markOnboardingComplete();
        options.onEngineStable?.();
        connectMetrics.totalMs = Date.now() - connectStart;
        options.setOpencodeConnectStatus?.({ ...connectMeta, status: "connected", metrics: connectMetrics });
        wsDebug("connect:done", { ok: true, ms: Date.now() - connectStart });
        return true;
      } catch (e) {
        options.setClient(null);
        options.setConnectedVersion(null);
        setConnectedWorkspaceId(null);
        const message = e instanceof Error ? e.message : safeStringify(e);
        wsDebug("connect:error", { ms: Date.now() - connectStart, message });
        connectMetrics.totalMs = Date.now() - connectStart;
        options.setOpencodeConnectStatus?.({
          ...connectMeta,
          status: "error",
          error: addOpencodeCacheHint(message),
          metrics: connectMetrics,
        });
        if (!quiet) {
          options.setError(addOpencodeCacheHint(message));
        }
        return false;
      } finally {
        if (!quiet) {
          options.setBusy(false);
          options.setBusyLabel(null);
          options.setBusyStartedAt(null);
        }
      }
    })();

    connectInFlightByKey.set(requestKey, run);
    try {
      return await run;
    } finally {
      if (connectInFlightByKey.get(requestKey) === run) {
        connectInFlightByKey.delete(requestKey);
      }
    }
  }

  const openEmptySession = async (scopeRoot?: string) => {
    const root = (scopeRoot ?? selectedWorkspaceRoot().trim()).trim();
    wsDebug("open-empty-session:start", {
      scopeRoot: scopeRoot ?? null,
      resolvedRoot: root || null,
      selectedWorkspaceId: selectedWorkspaceId(),
      activeWorkspace: selectedWorkspaceInfo(),
      hasClient: Boolean(options.client()),
    });

    if (options.client()) {
      try {
        await options.loadSessions(root || undefined);
      } catch {
        // If session loading fails, still fall back to the draft-ready session view.
      }
    }

    options.setSelectedSessionId(null);
    options.setMessages([]);
    options.setTodos([]);
    options.setPendingPermissions([]);
    options.setSessionStatusById({});
    options.setView("session");
  };

  const activateFreshLocalWorkspace = async (workspaceId: string | null, workspacePath: string) => {
    if (!workspaceId) {
      await openEmptySession(workspacePath);
      return true;
    }

    const hasClient = Boolean(options.client());
    const ok = hasClient
      ? await activateWorkspace(workspaceId)
      : await startHost({ workspacePath, navigate: false });

    if (!ok) {
      return false;
    }

    await openEmptySession(selectedWorkspaceRoot().trim() || workspacePath);
    return true;
  };

  async function createWorkspaceFlow(preset: WorkspacePreset, folder: string | null): Promise<boolean> {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return false;
    }

    if (!folder) {
      options.setError(t("app.error.choose_folder", currentLocale()));
      return false;
    }

    options.setBusy(true);
    options.setBusyLabel("status.creating_workspace");
    options.setBusyStartedAt(Date.now());
    options.setError(null);

    try {
      const resolvedFolder = await resolveWorkspacePath(folder);
      if (!resolvedFolder) {
        options.setError(t("app.error.choose_folder", currentLocale()));
        return false;
      }

      // Fallback: if this folder is already a known workspace, just switch to it
      const existingWs = workspaces().find(
        (ws) => ws.workspaceType === "local" && normalizeDirectoryPath(ws.path) === normalizeDirectoryPath(resolvedFolder),
      );
      if (existingWs) {
        syncSelectedWorkspaceId(existingWs.id);
        updateWorkspaceConnectionState(existingWs.id, { status: "connected", message: null });
        setCreateWorkspaceOpen(false);
        await activateFreshLocalWorkspace(existingWs.id, resolvedFolder);
        markOnboardingComplete();
        return true;
      }

      // Single-workspace mode (transitional UX): "Open workspace" replaces
      // the current workspace instead of stacking another one alongside it.
      // We forget every existing workspace before creating the new one so
      // the rest of the flow (auroworkServer.createLocalWorkspace,
      // selection, activation) sees a clean slate.
      //
      // Note: forgetWorkspace already disconnects engine clients, clears
      // session/messages/todos/permissions when the list becomes empty, and
      // syncs the desktop mirror. We just await it for each existing entry.
      // (existingWs is unreachable here — the matching-folder branch above
      // returns early, so we always forget the full current list.)
      const existingToForget = workspaces().slice();
      for (const ws of existingToForget) {
        await forgetWorkspace(ws.id);
      }

      const name = deriveWorkspaceName(resolvedFolder, preset);
      const auroworkServer = resolveConnectedAuroworkServer();
      const ws = auroworkServer
        ? await auroworkServer.createLocalWorkspace({ folderPath: resolvedFolder, name, preset })
        : await workspaceCreate({ folderPath: resolvedFolder, name, preset });

      if (auroworkServer && isTauriRuntime()) {
        try {
          await workspaceCreate({ folderPath: resolvedFolder, name, preset });
        } catch {
          // keep the server result as the source of truth for this run
        }
      }

      const nextSelectedId = pickSelectedWorkspaceId(ws.workspaces, [resolveWorkspaceListSelectedId(ws)], ws);
      applyServerLocalWorkspaces(ws.workspaces, nextSelectedId);
      if (nextSelectedId) {
        syncSelectedWorkspaceId(nextSelectedId);
        updateWorkspaceConnectionState(nextSelectedId, { status: "connected", message: null });
      }

      setCreateWorkspaceOpen(false);

      const opened = await activateFreshLocalWorkspace(nextSelectedId || null, resolvedFolder);
      if (!opened) {
        return false;
      }

      markOnboardingComplete();

      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return false;
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function forgetWorkspace(workspaceId: string) {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return;
    }

    const id = workspaceId.trim();
    if (!id) return;
    const workspace = workspaces().find((entry) => entry.id === id) ?? null;

    console.log("[workspace] forget", { id });

    try {
      const previousActive = selectedWorkspaceId();
      const auroworkWorkspace = workspace?.workspaceType === "local" ? await findAuroworkWorkspaceByPath(workspace.path) : null;
      const ws = auroworkWorkspace
        ? await auroworkWorkspace.client.deleteWorkspace(auroworkWorkspace.workspaceId).then((response) => ({
            activeId: response.activeId ?? "",
            workspaces: response.workspaces ?? response.items,
          }))
        : await workspaceForget(id);

      if (auroworkWorkspace && isTauriRuntime()) {
        try {
          await workspaceForget(id);
        } catch {
          // ignore desktop mirror failures here
        }
      }

      if (auroworkWorkspace) {
        applyServerLocalWorkspaces(ws.workspaces, ws.activeId);
      } else {
        setWorkspaces(ws.workspaces);
      }
      clearWorkspaceConnectionState(id);

      // When all workspaces have been removed, clear session state and disconnect
      // the engine client so orphan sessions don't linger in the UI.
      if (ws.workspaces.length === 0) {
        options.setClient(null);
        options.setConnectedVersion(null);
        setConnectedWorkspaceId(null);
        setProjectDir("");
        options.setSelectedSessionId(null);
        options.setMessages([]);
        options.setTodos([]);
        options.setPendingPermissions([]);
        options.setSessionStatusById({});
        options.setSessions([]);
        return;
      }

      if (!auroworkWorkspace) {
        syncSelectedWorkspaceId(pickSelectedWorkspaceId(ws.workspaces, [selectedWorkspaceId()], ws));
      }

      const nextSelectedId = pickSelectedWorkspaceId(ws.workspaces, [selectedWorkspaceId()], ws);
      const selected = ws.workspaces.find((w) => w.id === nextSelectedId) ?? null;
      if (selected) {
        setProjectDir(selected.path);
      }

      if (nextSelectedId && nextSelectedId !== previousActive) {
        await activateWorkspace(nextSelectedId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    }
  }

  async function recoverWorkspace(workspaceId: string) {
    const id = workspaceId.trim();
    if (!id) return false;
    if (connectingWorkspaceId() === id) return false;

    const workspace = workspaces().find((item) => item.id === id) ?? null;
    if (!workspace) return false;

    const reconnect = async () => {
      if (connectedWorkspaceId() === id) {
        return await activateWorkspace(id);
      }
      return await testWorkspaceConnection(id);
    };

    setConnectingWorkspaceId(id);
    options.setError(null);

    try {
      updateWorkspaceConnectionState(id, { status: "connecting", message: null });

      return Boolean(await reconnect());
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      const hint = addOpencodeCacheHint(message);
      options.setError(hint);
      updateWorkspaceConnectionState(id, { status: "error", message: hint });
      return false;
    } finally {
      setConnectingWorkspaceId((current) => (current === id ? null : current));
    }
  }

  async function pickWorkspaceFolder() {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return null;
    }

    try {
      const selection = await pickDirectory({ title: t("onboarding.choose_workspace_folder", currentLocale()) });
      const folder =
        typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;

      return folder ?? null;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return null;
    }
  }

  function joinNativePath(base: string, leaf: string) {
    const trimmedBase = base.replace(/[\\/]+$/, "");
    if (!trimmedBase) return leaf;
    const separator = trimmedBase.includes("\\") ? "\\" : "/";
    return `${trimmedBase}${separator}${leaf}`;
  }

  function deriveWorkspaceName(folderPath: string, preset: WorkspacePreset) {
    const leaf = folderPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Worker";
    if (preset === "starter" && leaf.trim().toLowerCase() === STARTER_BOOTSTRAP_WORKSPACE_NAME) {
      return "Starter";
    }
    return leaf;
  }

  async function resolveStarterBootstrapFolder() {
    const base = (await homeDir()).replace(/[\\/]+$/, "");
    return joinNativePath(joinNativePath(base, STARTER_BOOTSTRAP_FOLDER_NAME), STARTER_BOOTSTRAP_WORKSPACE_NAME);
  }

  async function quickStartWorkspaceFlow() {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return false;
    }

    try {
      const server = await options.ensureLocalAuroworkServerClient?.();
      if (!server) {
        throw new Error("AuroWork server is unavailable. Restart the app and try again.");
      }
      return await createWorkspaceFlow("starter", await resolveStarterBootstrapFolder());
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return false;
    }
  }

  async function autoBootstrapStarterWorkspace() {
    if (!isTauriRuntime()) return false;

    options.setStartupPreference("local");
    options.setOnboardingStep("bootstrap");
    setPersistedStarterBootstrapState("in_progress");
    options.setError(null);

    try {
      const server = await options.ensureLocalAuroworkServerClient?.();
      if (!server) {
        throw new Error("AuroWork server is unavailable. Restart the app and try again.");
      }
      const ok = await createWorkspaceFlow("starter", await resolveStarterBootstrapFolder());
      if (!ok) {
        setPersistedStarterBootstrapState("failed");
        options.setOnboardingStep("local");
        return false;
      }

      setPersistedStarterBootstrapState("completed");
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      setPersistedStarterBootstrapState("failed");
      options.setOnboardingStep("local");
      return false;
    }
  }

  async function createWorkspaceFromPickedFolder() {
    const folder = await pickWorkspaceFolder();
    if (!folder) return false;
    return createWorkspaceFlow("minimal", folder);
  }

  async function openExistingWorkspaceFlow(): Promise<boolean> {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return false;
    }

    const folder = await pickWorkspaceFolder();
    if (!folder) return false;

    options.setBusy(true);
    options.setBusyLabel("status.creating_workspace");
    options.setBusyStartedAt(Date.now());
    options.setError(null);

    try {
      const resolvedFolder = await resolveWorkspacePath(folder);
      if (!resolvedFolder) {
        options.setError(t("app.error.choose_folder", currentLocale()));
        return false;
      }

      // Check if workspace with this path is already in the list
      const existingWs = workspaces().find(
        (ws) => ws.workspaceType === "local" && normalizeDirectoryPath(ws.path) === normalizeDirectoryPath(resolvedFolder),
      );
      if (existingWs) {
        syncSelectedWorkspaceId(existingWs.id);
        updateWorkspaceConnectionState(existingWs.id, { status: "connected", message: null });
        setCreateWorkspaceOpen(false);
        await activateFreshLocalWorkspace(existingWs.id, resolvedFolder);
        markOnboardingComplete();
        return true;
      }

      const name = deriveWorkspaceName(resolvedFolder, "minimal");
      const ws = await workspaceRegister({ folderPath: resolvedFolder, name });

      const nextSelectedId = pickSelectedWorkspaceId(ws.workspaces, [resolveWorkspaceListSelectedId(ws)], ws);
      applyServerLocalWorkspaces(ws.workspaces, nextSelectedId);
      if (nextSelectedId) {
        syncSelectedWorkspaceId(nextSelectedId);
        updateWorkspaceConnectionState(nextSelectedId, { status: "connected", message: null });
      }

      setCreateWorkspaceOpen(false);

      const opened = await activateFreshLocalWorkspace(nextSelectedId || null, resolvedFolder);
      if (!opened) {
        return false;
      }

      markOnboardingComplete();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return false;
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function exportWorkspaceConfig(workspaceId?: string) {
    if (exportingWorkspaceConfig()) return;
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return;
    }

    const targetId = workspaceId?.trim() || selectedWorkspaceInfo()?.id || "";
    if (!targetId) {
      options.setError("Select a worker to export");
      return;
    }
    const target = workspaces().find((ws) => ws.id === targetId) ?? null;
    if (!target) {
      options.setError("Unknown worker");
      return;
    }

    setExportingWorkspaceConfig(true);
    options.setError(null);

    try {
      const nameBase = (target.displayName || target.name || "worker")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `aurowork-${nameBase || "worker"}-${dateStamp}.aurowork-workspace`;
      const downloads = await downloadDir().catch(() => null);
      const defaultPath = downloads ? `${downloads}/${fileName}` : fileName;

      const outputPath = await saveFile({
        title: "Export worker config",
        defaultPath,
        filters: [{ name: "AuroWork Worker", extensions: ["aurowork-workspace", "zip"] }],
      });

      if (!outputPath) {
        return;
      }

      await workspaceExportConfig({
        workspaceId: target.id,
        outputPath,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      setExportingWorkspaceConfig(false);
    }
  }

  async function importWorkspaceConfig() {
    if (importingWorkspaceConfig()) return;
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return;
    }

    setImportingWorkspaceConfig(true);
    options.setError(null);

    try {
      const selection = await pickFile({
        title: "Import worker config",
        filters: [{ name: "AuroWork Worker", extensions: ["aurowork-workspace", "zip"] }],
      });
      const filePath =
        typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!filePath) return;

      const target = await pickDirectory({
        title: "Choose a worker folder",
      });
      const folder =
        typeof target === "string" ? target : Array.isArray(target) ? target[0] : null;
      if (!folder) return;

      const resolvedFolder = await resolveWorkspacePath(folder);
      if (!resolvedFolder) {
        options.setError(t("app.error.choose_folder", currentLocale()));
        return;
      }

      const ws = await workspaceImportConfig({
        archivePath: filePath,
        targetDir: resolvedFolder,
      });

      setWorkspaces(ws.workspaces);
      const nextSelectedId = pickSelectedWorkspaceId(ws.workspaces, [resolveWorkspaceListSelectedId(ws)], ws);
      syncSelectedWorkspaceId(nextSelectedId);
      setCreateWorkspaceOpen(false);
      markOnboardingComplete();

      const opened = await activateFreshLocalWorkspace(nextSelectedId || null, resolvedFolder);
      if (!opened) {
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      setImportingWorkspaceConfig(false);
    }
  }

  function canRepairOpencodeMigration() {
    if (!isTauriRuntime()) return false;
    const workspace = selectedWorkspaceInfo();
    if (!workspace || workspace.workspaceType !== "local") return false;
    return Boolean(selectedWorkspacePath().trim());
  }

  async function repairOpencodeMigration(optionsOverride?: { navigate?: boolean }) {
    if (!isTauriRuntime()) {
      const message = t("app.migration.desktop_required", currentLocale());
      setMigrationRepairResult({ ok: false, message });
      options.setError(message);
      return false;
    }

    if (migrationRepairBusy()) return false;

    const workspace = selectedWorkspaceInfo();
    if (!workspace || workspace.workspaceType !== "local") {
      const message = t("app.migration.local_only", currentLocale());
      setMigrationRepairResult({ ok: false, message });
      options.setError(message);
      return false;
    }

    const root = selectedWorkspacePath().trim();
    if (!root) {
      const message = t("app.migration.workspace_required", currentLocale());
      setMigrationRepairResult({ ok: false, message });
      options.setError(message);
      return false;
    }

    setMigrationRepairBusy(true);
    setMigrationRepairResult(null);
    options.setError(null);
    options.setBusy(true);
    options.setBusyLabel("status.repairing_migration");
    options.setBusyStartedAt(Date.now());

    try {
      if (engine()?.running) {
        const info = await engineStop();
        setEngine(info);
      }

      const source = options.engineSource();
      const result = await auroDbMigrate({
        projectDir: root,
        preferSidecar: source === "sidecar",
        auroBinPath: source === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
      });

      if (!result.ok) {
        const output = formatExecOutput(result);
        if (isDbMigrateUnsupported(output)) {
          const message = t("app.migration.unsupported", currentLocale());
          setMigrationRepairResult({ ok: false, message });
          options.setError(message);
          return false;
        }

        const fallback = t("app.migration.failed", currentLocale());
        const message = output ? `${fallback}\n\n${output}` : fallback;
        setMigrationRepairResult({ ok: false, message });
        options.setError(addOpencodeCacheHint(message));
        return false;
      }

      const started = await startHost({
        workspacePath: root,
        navigate: optionsOverride?.navigate ?? false,
      });
      if (!started) {
        const message = t("app.migration.restart_failed", currentLocale());
        setMigrationRepairResult({ ok: false, message });
        return false;
      }

      setMigrationRepairResult({ ok: true, message: t("app.migration.success", currentLocale()) });
      return true;
    } catch (error) {
      const message = addOpencodeCacheHint(error instanceof Error ? error.message : safeStringify(error));
      setMigrationRepairResult({ ok: false, message });
      options.setError(message);
      return false;
    } finally {
      setMigrationRepairBusy(false);
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function onRepairOpencodeMigration() {
    options.setStartupPreference("local");
    options.setOnboardingStep("connecting");
    const ok = await repairOpencodeMigration({ navigate: true });
    if (!ok) {
      options.setOnboardingStep("local");
    }
  }

  async function startHost(optionsOverride?: { workspacePath?: string; navigate?: boolean }) {
    if (!isTauriRuntime()) {
      options.setError(t("app.error.tauri_required", currentLocale()));
      return false;
    }

    const overrideWorkspacePath = optionsOverride?.workspacePath?.trim() ?? "";

    const dir = (overrideWorkspacePath || selectedWorkspacePath() || projectDir()).trim();
    if (!dir) {
      options.setError(t("app.error.pick_workspace_folder", currentLocale()));
      return false;
    }

      try {
        const source = options.engineSource();
        // Reuse the doctor result from bootstrapOnboarding if it's fresh
        // (within 60s). Each engineDoctor call forks two short-lived auro
        // subprocesses (--version and serve --help) which on Windows can
        // cost 3-5s due to Bun self-extract + Defender scan. Skipping the
        // redundant call saves that on every launch.
        const cached = engineDoctorResult();
        const checkedAt = engineDoctorCheckedAt();
        const fresh = cached && checkedAt && Date.now() - checkedAt < 60_000;
        let result: typeof cached;
        if (fresh) {
          launchLog(
            "info",
            "launch:ui",
            "bootstrap onboarding: engineDoctor #2 skipped (using cached result from #1)",
          );
          result = cached;
        } else {
          const doctor2Start = performance.now();
          result = await engineDoctor({
            preferSidecar: source === "sidecar",
            auroBinPath: source === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
          });
          launchLog(
            "info",
            "launch:ui",
            `bootstrap onboarding: engineDoctor #2 done in ${Math.round(performance.now() - doctor2Start)}ms`,
          );
          setEngineDoctorResult(result);
          setEngineDoctorCheckedAt(Date.now());
        }

        if (!result || !result.found) {
          options.setError(
            options.isWindowsPlatform()
            ? "OpenCode CLI not found. Install the AuroWork-pinned OpenCode version for Windows or bundle opencode.exe with AuroWork, then restart. If it is installed, ensure `opencode.exe` is on PATH (try `opencode --version` in PowerShell)."
            : "OpenCode CLI not found. Install the AuroWork-pinned OpenCode version, then retry.",
        );
        return false;
      }

      if (!result.supportsServe) {
        const serveDetails = [result.serveHelpStdout, result.serveHelpStderr]
          .filter((value) => value && value.trim())
          .join("\n\n");
        const suffix = serveDetails ? `\n\nServe output:\n${serveDetails}` : "";
        options.setError(
          `OpenCode CLI is installed, but \`opencode serve\` is unavailable. Update to the AuroWork-pinned OpenCode version and retry.${suffix}`
        );
        return false;
      }
    } catch (e) {
      setEngineInstallLogs(e instanceof Error ? e.message : safeStringify(e));
    }

    options.setError(null);
    setMigrationRepairResult(null);
    options.setBusy(true);
    options.setBusyLabel("status.starting_engine");
    options.setBusyStartedAt(Date.now());

    try {
      setProjectDir(dir);
      if (!authorizedDirs().length) {
        setAuthorizedDirs([dir]);
      }

      launchLog("info", "launch:ui", "engineStart called from startHost");
      const info = await engineStart(dir, {
        preferSidecar: options.engineSource() === "sidecar",
        auroBinPath:
          options.engineSource() === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
        auroEnableExa: options.auroEnableExa?.() ?? false,
        runtime: resolveEngineRuntime(),
        workspacePaths: resolveWorkspacePaths(),
      });
      setEngine(info);

      const username = info.auroUsername?.trim() ?? "";
      const password = info.auroPassword?.trim() ?? "";
      const auth = username && password ? { username, password } : undefined;
      setEngineAuth(auth ?? null);

      if (info.baseUrl) {
        const ok = await connectToServer(
          info.baseUrl,
          dir,
          { workspaceType: "local", targetRoot: dir, reason: "host-start" },
          auth,
          { navigate: optionsOverride?.navigate ?? true },
        );
        if (!ok) return false;
      }

      markOnboardingComplete();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return false;
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function updateWorkspaceDisplayName(workspaceId: string, displayName: string | null) {
    const id = workspaceId.trim();
    if (!id) return false;
    const workspace = workspaces().find((item) => item.id === id) ?? null;
    if (!workspace) return false;

    const nextDisplayName = displayName?.trim() || null;
    options.setError(null);

    const auroworkWorkspace = workspace.workspaceType === "local"
      ? await findAuroworkWorkspaceByPath(workspace.path)
      : null;

    if (auroworkWorkspace) {
      try {
        const ws = await auroworkWorkspace.client.updateWorkspaceDisplayName(auroworkWorkspace.workspaceId, nextDisplayName);
        if (isTauriRuntime()) {
          try {
            await workspaceUpdateDisplayName({ workspaceId: id, displayName: nextDisplayName });
          } catch {
            // ignore desktop mirror failures here
          }
        }
        applyServerLocalWorkspaces(ws.workspaces, ws.activeId);
        updateWorkspaceConnectionState(id, { status: "connected", message: null });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : safeStringify(e);
        options.setError(addOpencodeCacheHint(message));
        return false;
      }
    }

    if (isTauriRuntime()) {
      try {
        const ws = await workspaceUpdateDisplayName({ workspaceId: id, displayName: nextDisplayName });
        setWorkspaces(ws.workspaces);
        syncSelectedWorkspaceId(pickSelectedWorkspaceId(ws.workspaces, [id, selectedWorkspaceId()], ws));
        updateWorkspaceConnectionState(id, { status: "connected", message: null });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : safeStringify(e);
        options.setError(addOpencodeCacheHint(message));
        return false;
      }
    }

    setWorkspaces((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              displayName: nextDisplayName,
              name: nextDisplayName ?? entry.name,
            }
          : entry
      )
    );
    return true;
  }

  async function stopHost() {
    options.setError(null);
    options.setBusy(true);
    options.setBusyLabel("status.disconnecting");
    options.setBusyStartedAt(Date.now());

    try {
      if (isTauriRuntime()) {
        const info = await engineStop();
        setEngine(info);
      }

      setEngineAuth(null);

      options.setClient(null);
      options.setConnectedVersion(null);
      setConnectedWorkspaceId(null);
      if (isTauriRuntime()) {
        try {
          await workspaceSetRuntimeActive(null);
        } catch {
          // ignore
        }
      }
      options.setSelectedSessionId(null);
      options.setMessages([]);
      options.setTodos([]);
      options.setPendingPermissions([]);
      options.setSessionStatusById({});
      options.setSseConnected(false);

      options.setStartupPreference(null);
      options.setOnboardingStep("welcome");

      options.setView("session");
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function reloadWorkspaceEngine() {
    if (!isTauriRuntime()) {
      options.setError("Reloading the engine requires the desktop app.");
      return false;
    }

    if (selectedWorkspaceDisplay().workspaceType !== "local") {
      options.setError("Reload is only available for local workers.");
      return false;
    }

    const root = selectedWorkspacePath().trim();
    if (!root) {
      options.setError("Pick a worker folder first.");
      return false;
    }

    options.setError(null);
    options.setBusy(true);
    options.setBusyLabel("status.reloading_engine");
    options.setBusyStartedAt(Date.now());

    try {
      const runtime = engine()?.runtime ?? resolveEngineRuntime();
      if (runtime === "aurowork-orchestrator") {
        await orchestratorInstanceDispose(root);
        await orchestratorWorkspaceActivate({
          workspacePath: root,
          name: selectedWorkspaceInfo()?.displayName?.trim() || selectedWorkspaceInfo()?.name?.trim() || null,
        });

        const nextInfo = await engineInfo();
        setEngine(nextInfo);

        const username = nextInfo.auroUsername?.trim() ?? "";
        const password = nextInfo.auroPassword?.trim() ?? "";
        const auth = username && password ? { username, password } : undefined;
        setEngineAuth(auth ?? null);

        if (nextInfo.baseUrl) {
          const ok = await connectToServer(
            nextInfo.baseUrl,
            root,
            { workspaceType: "local", targetRoot: root, reason: "engine-reload-orchestrator" },
            auth,
          );
          if (!ok) {
            options.setError("Failed to reconnect after reload");
            return false;
          }
        }

        return true;
      }

      const info = await engineStop();
      setEngine(info);

      launchLog("info", "launch:ui", "engineStart called from reloadWorkspaceEngine");
      const nextInfo = await engineStart(root, {
        preferSidecar: options.engineSource() === "sidecar",
        auroBinPath:
          options.engineSource() === "custom" ? options.engineCustomBinPath?.().trim() || null : null,
        auroEnableExa: options.auroEnableExa?.() ?? false,
        runtime,
        workspacePaths: resolveWorkspacePaths(),
      });
      setEngine(nextInfo);

      const username = nextInfo.auroUsername?.trim() ?? "";
      const password = nextInfo.auroPassword?.trim() ?? "";
      const auth = username && password ? { username, password } : undefined;
      setEngineAuth(auth ?? null);

      if (nextInfo.baseUrl) {
        const ok = await connectToServer(
          nextInfo.baseUrl,
          root,
          { workspaceType: "local", targetRoot: root, reason: "engine-reload" },
          auth,
        );
        if (!ok) {
          options.setError("Failed to reconnect after reload");
          return false;
        }
      }

      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
      return false;
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  async function onInstallEngine() {
    options.setError(null);
    setEngineInstallLogs(null);
    options.setBusy(true);
    options.setBusyLabel("status.installing_opencode");
    options.setBusyStartedAt(Date.now());

    try {
      const result = await engineInstall();
      const combined = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
      setEngineInstallLogs(combined || null);

      if (!result.ok) {
        options.setError(result.stderr.trim() || t("app.error.install_failed", currentLocale()));
      }

      await refreshEngineDoctor();
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
      options.setBusyLabel(null);
      options.setBusyStartedAt(null);
    }
  }

  function normalizeRoots(list: string[]) {
    const out: string[] = [];
    for (const entry of list) {
      const trimmed = entry.trim().replace(/\/+$/, "");
      if (!trimmed) continue;
      if (!out.includes(trimmed)) out.push(trimmed);
    }
    return out;
  }

  async function resolveWorkspacePath(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (!isTauriRuntime()) return trimmed;

    if (trimmed === "~") {
      try {
        return (await homeDir()).replace(/[\\/]+$/, "");
      } catch {
        return trimmed;
      }
    }

    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
      try {
        const home = (await homeDir()).replace(/[\\/]+$/, "");
        return `${home}${trimmed.slice(1)}`;
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  function markOnboardingComplete() {
    setInitialWorkspaceSetupComplete(true);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(INITIAL_WORKSPACE_SETUP_COMPLETE_KEY, "1");
      window.localStorage.setItem(LEGACY_ONBOARDING_COMPLETE_KEY, "1");
    } catch {
      // ignore
    }
  }

  async function persistAuthorizedRoots(nextRoots: string[]) {
    if (!isTauriRuntime()) return;
    const root = selectedWorkspacePath().trim();
    if (!root) return;

    const existing = workspaceConfig();
    const cfg: WorkspaceAuroworkConfig = {
      version: existing?.version ?? 1,
      workspace: existing?.workspace ?? null,
      authorizedRoots: nextRoots,
      blueprint: existing?.blueprint ?? null,
      reload: existing?.reload ?? null,
    };

    const persistedViaServer = await persistWorkspaceConfigToAuroworkServer(cfg).catch(() => false);
    if (!persistedViaServer) {
      await workspaceAuroworkWrite({ workspacePath: root, config: cfg });
    }
    setWorkspaceConfig(cfg);
  }

  async function persistReloadSettings(next: { auto?: boolean; resume?: boolean }) {
    if (!isTauriRuntime()) return;
    const root = selectedWorkspacePath().trim();
    if (!root) return;

    const existing = workspaceConfig();
    const cfg: WorkspaceAuroworkConfig = {
      version: existing?.version ?? 1,
      workspace: existing?.workspace ?? null,
      authorizedRoots: Array.isArray(existing?.authorizedRoots) ? existing!.authorizedRoots : authorizedDirs(),
      blueprint: existing?.blueprint ?? null,
      reload: {
        auto: Boolean(next.auto),
        resume: Boolean(next.resume),
      },
    };

    const persistedViaServer = await persistWorkspaceConfigToAuroworkServer(cfg).catch(() => false);
    if (!persistedViaServer) {
      await workspaceAuroworkWrite({ workspacePath: root, config: cfg });
    }
    setWorkspaceConfig(cfg);
  }

  async function addAuthorizedDir() {
    const next = newAuthorizedDir().trim();
    if (!next) return;

    const roots = normalizeRoots([...authorizedDirs(), next]);
    setAuthorizedDirs(roots);
    setNewAuthorizedDir("");

    try {
      await persistAuthorizedRoots(roots);
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    }
  }

  async function addAuthorizedDirFromPicker(optionsOverride?: { persistToWorkspace?: boolean }) {
    if (!isTauriRuntime()) return;

    try {
      const selection = await pickDirectory({ title: t("onboarding.authorize_folder", currentLocale()) });
      const folder =
        typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!folder) return;

      const roots = normalizeRoots([...authorizedDirs(), folder]);
      setAuthorizedDirs(roots);

      if (optionsOverride?.persistToWorkspace) {
        await persistAuthorizedRoots(roots);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    }
  }

  async function removeAuthorizedDir(dir: string) {
    const roots = normalizeRoots(authorizedDirs().filter((root) => root !== dir));
    setAuthorizedDirs(roots);

    try {
      await persistAuthorizedRoots(roots);
    } catch (e) {
      const message = e instanceof Error ? e.message : safeStringify(e);
      options.setError(addOpencodeCacheHint(message));
    }
  }

  function removeAuthorizedDirAtIndex(index: number) {
    const roots = authorizedDirs();
    const target = roots[index];
    if (target) {
      void removeAuthorizedDir(target);
    }
  }

  async function bootstrapOnboarding() {
    const onboardStart = performance.now();
    let onboardStepStart = onboardStart;
    const onboardMark = (label: string) => {
      const now = performance.now();
      launchLog(
        "info",
        "launch:ui",
        `bootstrap onboarding: ${label} in ${Math.round(now - onboardStepStart)}ms (total ${Math.round(now - onboardStart)}ms)`,
      );
      onboardStepStart = now;
    };

    const startupPref = readStartupPreference();
    const onboardingComplete = readInitialWorkspaceSetupComplete();
    const persistedBootstrapState = readStarterBootstrapState();
    setInitialWorkspaceSetupComplete(onboardingComplete);
    setStarterBootstrapState(persistedBootstrapState);

    if (isTauriRuntime()) {
      try {
        const ws = await workspaceBootstrap();
        setWorkspaces(ws.workspaces);
        syncSelectedWorkspaceId(pickSelectedWorkspaceId(ws.workspaces, [resolveWorkspaceListSelectedId(ws)], ws));
      } catch {
        // ignore
      }
    }
    onboardMark("workspaceBootstrap done");

    if (isTauriRuntime() && persistedBootstrapState === "in_progress") {
      if (workspaces().length > 0) {
        setPersistedStarterBootstrapState("completed");
      } else {
        setPersistedStarterBootstrapState("failed");
      }
    }

    await refreshEngine();
    await refreshEngineDoctor();
    onboardMark("refreshEngine + engineDoctor #1 done");

    if (isTauriRuntime()) {
      const active = workspaces().find((w) => w.id === selectedWorkspaceId()) ?? null;
      if (active) {
        setProjectDir(active.path);
        try {
          const cfg = await workspaceAuroworkRead({ workspacePath: active.path });
          setWorkspaceConfig(cfg);
          setWorkspaceConfigLoaded(true);
          const roots = Array.isArray(cfg.authorizedRoots) ? cfg.authorizedRoots : [];
          setAuthorizedDirs(roots.length ? roots : [active.path]);
        } catch {
          setWorkspaceConfig(null);
          setWorkspaceConfigLoaded(true);
          setAuthorizedDirs([active.path]);
        }
      }
    }

    const info = engine();
    if (info?.baseUrl) {
      options.setBaseUrl(info.baseUrl);
    }

    if (startupPref) {
      options.setStartupPreference(startupPref === "server" ? "local" : startupPref);
    }

    if (selectedWorkspacePath().trim()) {
      options.setStartupPreference("local");

      if (info?.running && info.baseUrl) {
        const bootstrapRoot = selectedWorkspacePath().trim() || info.projectDir?.trim() || "";
        options.setOnboardingStep("connecting");
        const ok = await connectToServer(
          info.baseUrl,
          bootstrapRoot || undefined,
          { workspaceType: "local", targetRoot: bootstrapRoot, reason: "bootstrap-local" },
          engineAuth() ?? undefined,
        );
        if (!ok) {
          options.setStartupPreference(null);
          options.setOnboardingStep("welcome");
          return;
        }
        markOnboardingComplete();
        return;
      }

      options.setOnboardingStep("connecting");
      onboardMark(`workspaceConfig loaded, dispatching startHost (preset=${startupPref ?? "auto"})`);
      const ok = await startHost({ workspacePath: selectedWorkspacePath().trim() });
      if (!ok) {
        options.setOnboardingStep("local");
        return;
      }
      markOnboardingComplete();
      return;
    }

    if (firstRunWorkspaceSetup()) {
      markOnboardingComplete();
      options.setOnboardingStep("welcome");
      return;
    }

    if (startupPref === "local") {
      options.setOnboardingStep("local");
      return;
    }

    options.setOnboardingStep("welcome");
  }

  function onSelectStartup(nextPref: StartupPreference) {
    if (options.rememberStartupChoice()) {
      writeStartupPreference(nextPref);
    }
    options.setStartupPreference(nextPref);
    options.setOnboardingStep("local");
  }

  function onBackToWelcome() {
    if (firstRunWorkspaceSetup()) {
      markOnboardingComplete();
      clearStartupPreference();
    }
    options.setStartupPreference(null);
    options.setOnboardingStep("welcome");
  }

  async function onStartHost() {
    options.setStartupPreference("local");
    options.setOnboardingStep("connecting");
    const ok = await startHost({ workspacePath: selectedWorkspacePath().trim() });
    if (!ok) {
      options.setOnboardingStep("local");
    }
  }

  async function onAttachHost() {
    options.setStartupPreference("local");
    options.setOnboardingStep("connecting");
    const attachRoot = selectedWorkspacePath().trim() || engine()?.projectDir?.trim() || "";
    const ok = await connectToServer(
      engine()?.baseUrl ?? "",
      attachRoot || undefined,
      { workspaceType: "local", targetRoot: attachRoot, reason: "attach-local" },
      engineAuth() ?? undefined,
    );
    if (!ok) {
      options.setStartupPreference(null);
      options.setOnboardingStep("welcome");
    }
  }

  function onRememberStartupToggle() {
    if (typeof window === "undefined") return;
    const next = !options.rememberStartupChoice();
    options.setRememberStartupChoice(next);
    try {
      if (next) {
        const current = options.startupPreference();
        if (current === "local" || current === "server") {
          writeStartupPreference(current);
        }
      } else {
        clearStartupPreference();
      }
    } catch {
      // ignore
    }
  }

  return {
    engine,
    engineDoctorResult,
    engineDoctorCheckedAt,
    engineInstallLogs,
    projectDir,
    workspaces,
    selectedWorkspaceId,
    authorizedDirs,
    newAuthorizedDir,
    workspaceConfig,
    workspaceConfigLoaded,
    createWorkspaceOpen,
    connectingWorkspaceId,
    connectedWorkspaceId,
    workspaceConnectionStateById,
    exportingWorkspaceConfig,
    importingWorkspaceConfig,
    migrationRepairBusy,
    migrationRepairResult,
    selectedWorkspaceInfo,
    selectedWorkspaceDisplay,
    selectedWorkspacePath,
    selectedWorkspaceRoot,
    setCreateWorkspaceOpen,
    setProjectDir,
    setAuthorizedDirs,
    setNewAuthorizedDir,
    setWorkspaceConfig,
    setWorkspaceConfigLoaded,
    setWorkspaces,
    syncSelectedWorkspaceId: syncSelectedWorkspaceId,
    selectWorkspace,
    refreshEngine,
    refreshEngineDoctor,
    activateWorkspace,
    ensureWorkspaceActivated,
    testWorkspaceConnection,
    connectToServer,
    createWorkspaceFlow,
    quickStartWorkspaceFlow,
    createWorkspaceFromPickedFolder,
    openExistingWorkspaceFlow,
    updateWorkspaceDisplayName,
    forgetWorkspace,
    recoverWorkspace,
    pickWorkspaceFolder,
    exportWorkspaceConfig,
    importWorkspaceConfig,
    canRepairOpencodeMigration,
    repairOpencodeMigration,
    startHost,
    stopHost,
    reloadWorkspaceEngine,
    bootstrapOnboarding,
    onSelectStartup,
    onBackToWelcome,
    onStartHost,
    onRepairOpencodeMigration,
    onAttachHost,
    onRememberStartupToggle,
    onInstallEngine,
    addAuthorizedDir,
    addAuthorizedDirFromPicker,
    removeAuthorizedDir,
    removeAuthorizedDirAtIndex,
    persistReloadSettings,
    setEngineInstallLogs,
    workspaceDebugEvents,
    clearWorkspaceDebugEvents,
  };
}
