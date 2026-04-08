import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";

import {
  formatBytes,
  formatRelativeTime,
  isTauriRuntime,
  isWindowsPlatform,
} from "../utils";

import Button from "../components/button";
import ProviderIcon from "../components/provider-icon";
import DenSettingsPanel from "../components/den-settings-panel";
import TextInput from "../components/text-input";
import WebUnavailableSurface from "../components/web-unavailable-surface";
import type { McpDirectoryInfo } from "../constants";
import { usePlatform } from "../context/platform";
import { buildFeedbackUrl } from "../lib/feedback";
import { getAuroWorkDeployment } from "../lib/aurowork-deployment";
import ExtensionsView from "./extensions";
import SkillsView from "./skills";
import {
  ArrowUpRight,
  CircleAlert,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  FolderLock,
  FolderSearch,
  Folder,
  HardDrive,
  LifeBuoy,
  MessageCircle,
  PlugZap,
  RefreshCcw,
  Server,
  Smartphone,
  X,
  Zap,
} from "lucide-solid";
import type {
  HubSkillCard,
  HubSkillRepo,
  McpServerEntry,
  McpStatusMap,
  OpencodeConnectStatus,
  PluginScope,
  ProviderListItem,
  SettingsTab,
  SkillCard,
  StartupPreference,
  SuggestedPlugin,
} from "../types";
import type {
  AuroworkServerClient,
  AuroworkServerCapabilities,
  AuroworkServerDiagnostics,
  AuroworkServerSettings,
  AuroworkServerStatus,
} from "../lib/aurowork-server";
import type {
  EngineInfo,
  OrchestratorBinaryInfo,
  OrchestratorStatus,
  AuroworkServerInfo,
  AppBuildInfo,
} from "../lib/tauri";
import {
  appBuildInfo,
  engineRestart,
  nukeAuroworkAndOpencodeConfigAndExit,
  auroworkServerRestart,
  pickFile,
} from "../lib/tauri";
import { currentLocale, LANGUAGE_OPTIONS, t, type Language } from "../../i18n";

export type SettingsViewProps = {
  startupPreference: StartupPreference | null;
  baseUrl: string;
  headerStatus: string;
  busy: boolean;
  clientConnected: boolean;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  providers: ProviderListItem[];
  providerConnectedIds: string[];
  providerAuthBusy: boolean;
  openProviderAuthModal: (options?: {
    returnFocusTarget?: "none" | "composer";
    preferredProviderId?: string;
  }) => Promise<void>;
  disconnectProvider: (providerId: string) => Promise<string | void>;
  auroworkServerStatus: AuroworkServerStatus;
  auroworkServerUrl: string;
  auroworkServerClient: AuroworkServerClient | null;
  auroworkReconnectBusy: boolean;
  reconnectAuroworkServer: () => Promise<boolean>;
  auroworkServerSettings: AuroworkServerSettings;
  auroworkServerHostInfo: AuroworkServerInfo | null;
  auroworkServerCapabilities: AuroworkServerCapabilities | null;
  auroworkServerDiagnostics: AuroworkServerDiagnostics | null;
  runtimeWorkspaceId: string | null;
  selectedWorkspaceRoot: string;
  activeWorkspaceType: "local" | "remote";
  auroworkAuditEntries: unknown[];
  auroworkAuditStatus: "idle" | "loading" | "error";
  auroworkAuditError: string | null;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  engineInfo: EngineInfo | null;
  orchestratorStatus: OrchestratorStatus | null;
  opencodeRouterInfo: null;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  stopHost: () => void;
  restartLocalServer: () => Promise<boolean>;
  engineSource: "path" | "sidecar" | "custom";
  setEngineSource: (value: "path" | "sidecar" | "custom") => void;
  engineCustomBinPath: string;
  setEngineCustomBinPath: (value: string) => void;
  engineRuntime: "direct" | "aurowork-orchestrator";
  setEngineRuntime: (value: "direct" | "aurowork-orchestrator") => void;
  opencodeEnableExa: boolean;
  toggleOpencodeEnableExa: () => void;
  isWindows: boolean;
  defaultModelLabel: string;
  defaultModelRef: string;
  openDefaultModelPicker: () => void;
  showThinking: boolean;
  toggleShowThinking: () => void;
  hideTitlebar: boolean;
  toggleHideTitlebar: () => void;
  modelVariantLabel: string;
  editModelVariant: () => void;
  language: Language;
  setLanguage: (value: Language) => void;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  updateAutoCheck: boolean;
  toggleUpdateAutoCheck: () => void;
  updateAutoDownload: boolean;
  toggleUpdateAutoDownload: () => void;
  updateStatus: {
    state: string;
    lastCheckedAt?: number | null;
    version?: string;
    date?: string;
    notes?: string;
    totalBytes?: number | null;
    downloadedBytes?: number;
    message?: string;
  } | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  appVersion: string | null;
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdateAndRestart: () => void;
  anyActiveRuns: boolean;
  canReloadWorkspace: boolean;
  reloadWorkspaceEngine: () => Promise<void>;
  reloadBusy: boolean;
  onResetStartupPreference: () => void;
  openResetModal: (mode: "onboarding" | "all") => void;
  resetModalBusy: boolean;
  pendingPermissions: unknown;
  events: unknown;
  workspaceDebugEvents: unknown;
  sandboxCreateProgress: unknown;
  sandboxCreateProgressLast: unknown;
  clearWorkspaceDebugEvents: () => void;
  safeStringify: (value: unknown) => string;
  repairOpencodeMigration: () => void;
  migrationRepairBusy: boolean;
  migrationRepairResult: { ok: boolean; message: string } | null;
  migrationRepairAvailable: boolean;
  migrationRepairUnavailableReason: string | null;
  repairOpencodeCache: () => void;
  cacheRepairBusy: boolean;
  cacheRepairResult: string | null;
  cleanupAuroworkDockerContainers: () => void;
  dockerCleanupBusy: boolean;
  dockerCleanupResult: string | null;
  authorizedFolders: string[];
  authorizedFolderDraft: string;
  setAuthorizedFolderDraft: (value: string) => void;
  authorizedFoldersLoading: boolean;
  authorizedFoldersSaving: boolean;
  authorizedFoldersError: string | null;
  authorizedFoldersStatus: string | null;
  authorizedFoldersAvailable: boolean;
  authorizedFoldersEditable: boolean;
  authorizedFoldersHint: string | null;
  addAuthorizedFolder: () => Promise<void>;
  pickAuthorizedFolder: () => Promise<void>;
  removeAuthorizedFolder: (folder: string) => Promise<void>;
  resetAppConfigDefaults: () => Promise<{ ok: boolean; message: string }>;
  notionStatus: "disconnected" | "connecting" | "connected" | "error";
  notionStatusDetail: string | null;
  notionError: string | null;
  notionBusy: boolean;
  connectNotion: () => void;
  engineDoctorVersion: string | null;
  openDebugDeepLink: (
    rawUrl: string,
  ) => Promise<{ ok: boolean; message: string }>;
  scheduledJobs: unknown[];
  scheduledJobsSource: "local" | "remote";
  scheduledJobsSourceReady: boolean;
  scheduledJobsStatus: string | null;
  scheduledJobsBusy: boolean;
  scheduledJobsUpdatedAt: number | null;
  refreshScheduledJobs: (options?: { force?: boolean }) => void;
  deleteScheduledJob: (name: string) => Promise<void> | void;
  newTaskDisabled: boolean;
  schedulerPluginInstalled: boolean;
  refreshSkills: (options?: { force?: boolean }) => void;
  refreshHubSkills: (options?: { force?: boolean }) => void;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
  skillsAccessHint?: string | null;
  canInstallSkillCreator: boolean;
  canUseDesktopTools: boolean;
  importLocalSkill: () => void;
  installSkillCreator: () => Promise<{ ok: boolean; message: string }>;
  installHubSkill: (name: string) => Promise<{ ok: boolean; message: string }>;
  setHubRepo: (repo: Partial<HubSkillRepo> | null) => void;
  addHubRepo: (repo: Partial<HubSkillRepo>) => void;
  removeHubRepo: (repo: Partial<HubSkillRepo>) => void;
  revealSkillsFolder: () => void;
  uninstallSkill: (name: string) => void;
  readSkill: (name: string) => Promise<{ name: string; path: string; content: string } | null>;
  saveSkill: (input: { name: string; content: string; description?: string }) => void;
  refreshPlugins: (scopeOverride?: PluginScope) => void;
  refreshMcpServers: () => void;
  pluginsAccessHint?: string | null;
  canEditPlugins: boolean;
  canUseGlobalPluginScope: boolean;
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
  suggestedPlugins: SuggestedPlugin[];
  addPlugin: (pluginNameOverride?: string) => void;
  removePlugin: (pluginName: string) => void;
  mcpServers: McpServerEntry[];
  mcpStatus: string | null;
  mcpLastUpdatedAt: number | null;
  mcpStatuses: McpStatusMap;
  mcpConnectingName: string | null;
  selectedMcp: string | null;
  setSelectedMcp: (value: string | null) => void;
  quickConnect: McpDirectoryInfo[];
  connectMcp: (entry: McpDirectoryInfo) => void;
  authorizeMcp: (entry: McpServerEntry) => void;
  logoutMcpAuth: (name: string) => Promise<void> | void;
  removeMcp: (name: string) => void;
  showMcpReloadBanner: boolean;
  mcpReloadBlocked: boolean;
  reloadMcpEngine: () => void;
  createSessionAndOpen: () => void;
  setPrompt: (value: string) => void;
  connectRemoteWorkspace: (input: {
    auroworkHostUrl?: string | null;
    auroworkToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => Promise<boolean>;
  openCloudTemplate: (input: {
    templateId: string;
    name: string;
    templateData: unknown;
    organizationName?: string | null;
  }) => Promise<void> | void;
};

const DISCORD_INVITE_URL = "https://discord.gg/VEhNQXxYMB";
const BUG_REPORT_URL =
  "https://github.com/different-ai/aurowork/issues/new?template=bug.yml";

export default function SettingsView(props: SettingsViewProps) {
  const platform = usePlatform();
  const webDeployment = createMemo(() => getAuroWorkDeployment() === "web");
  const translate = (key: string) => t(key, currentLocale());
  const engineCustomBinPathLabel = () =>
    props.engineCustomBinPath.trim() || "No binary selected.";
  const canPickAuthorizedFolder = createMemo(
    () => isTauriRuntime() && props.authorizedFoldersEditable && props.activeWorkspaceType === "local",
  );
  const workspaceRootFolder = createMemo(() => props.selectedWorkspaceRoot.trim());
  const visibleAuthorizedFolders = createMemo(() => {
    const root = workspaceRootFolder();
    return root ? [root, ...props.authorizedFolders] : props.authorizedFolders;
  });

  const openExternalLink = (url: string) => {
    const resolved = url.trim();
    if (!resolved) return;
    platform.openLink(resolved);
  };

  const handlePickEngineBinary = async () => {
    if (!isTauriRuntime()) return;
    try {
      const selected = await pickFile({ title: "Select OpenCode binary" });
      const path = Array.isArray(selected) ? selected[0] : selected;
      const trimmed = (path ?? "").trim();
      if (!trimmed) return;
      props.setEngineCustomBinPath(trimmed);
      props.setEngineSource("custom");
    } catch {
      // ignore
    }
  };
  const [buildInfo, setBuildInfo] = createSignal<AppBuildInfo | null>(null);
  const updateState = () => props.updateStatus?.state ?? "idle";
  const updateNotes = () => props.updateStatus?.notes ?? null;
  const updateVersion = () => props.updateStatus?.version ?? null;
  const updateDate = () => props.updateStatus?.date ?? null;
  const updateLastCheckedAt = () => props.updateStatus?.lastCheckedAt ?? null;
  const updateDownloadedBytes = () =>
    props.updateStatus?.downloadedBytes ?? null;
  const updateTotalBytes = () => props.updateStatus?.totalBytes ?? null;
  const updateErrorMessage = () => props.updateStatus?.message ?? null;

  const updateDownloadPercent = createMemo<number | null>(() => {
    const total = updateTotalBytes();
    if (total == null || total <= 0) return null;
    const downloaded = updateDownloadedBytes() ?? 0;
    const clamped = Math.max(0, Math.min(1, downloaded / total));
    return Math.floor(clamped * 100);
  });

  const isMacToolbar = createMemo(() => {
    if (props.isWindows) return false;
    if (typeof navigator === "undefined") return false;
    const platform =
      typeof (navigator as any).userAgentData?.platform === "string"
        ? (navigator as any).userAgentData.platform
        : typeof navigator.platform === "string"
          ? navigator.platform
          : "";
    const ua =
      typeof navigator.userAgent === "string" ? navigator.userAgent : "";
    return /mac/i.test(platform) || /mac/i.test(ua);
  });

  const showUpdateToolbar = createMemo(() => {
    if (!isTauriRuntime()) return false;
    if (props.updateEnv && props.updateEnv.supported === false) return false;
    return isMacToolbar();
  });

  const updateToolbarTone = createMemo(() => {
    switch (updateState()) {
      case "available":
        return "bg-amber-7/10 text-amber-11 border-amber-7/20";
      case "ready":
        return "bg-green-7/10 text-green-11 border-green-7/20";
      case "error":
        return "bg-red-7/10 text-red-11 border-red-7/20";
      case "checking":
      case "downloading":
        return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
      default:
        return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    }
  });

  const updateToolbarSpinning = createMemo(
    () => updateState() === "checking" || updateState() === "downloading",
  );

  const updateToolbarLabel = createMemo(() => {
    const state = updateState();
    const version = updateVersion();
    if (state === "available") {
      return `${translate("settings.toolbar_update_available")}${version ? ` · v${version}` : ""}`;
    }
    if (state === "ready") {
      return `${translate("settings.toolbar_ready_to_install")}${version ? ` · v${version}` : ""}`;
    }
    if (state === "downloading") {
      const downloaded = updateDownloadedBytes() ?? 0;
      const percent = updateDownloadPercent();
      if (percent != null) return `${translate("settings.toolbar_downloading")} ${percent}%`;
      return `${translate("settings.toolbar_downloading")} ${formatBytes(downloaded)}`;
    }
    if (state === "checking") {
      return translate("settings.toolbar_checking");
    }
    if (state === "error") {
      return translate("settings.toolbar_error");
    }
    return translate("settings.toolbar_uptodate");
  });

  const updateToolbarTitle = createMemo(() => {
    const state = updateState();
    const version = updateVersion();
    if (state !== "downloading") return updateToolbarLabel();

    const downloaded = updateDownloadedBytes() ?? 0;
    const total = updateTotalBytes();
    const percent = updateDownloadPercent();

    if (total != null && percent != null) {
      return `Downloading ${formatBytes(downloaded)} / ${formatBytes(total)} (${percent}%)${version ? ` · v${version}` : ""}`;
    }

    return `Downloading ${formatBytes(downloaded)}${version ? ` · v${version}` : ""}`;
  });

  const updateToolbarActionLabel = createMemo(() => {
    const state = updateState();
    if (state === "available") return translate("settings.toolbar_action_download");
    if (state === "ready") return translate("settings.toolbar_action_install");
    if (state === "error") return translate("settings.toolbar_action_retry");
    if (state === "idle") return translate("settings.toolbar_action_check");
    return null;
  });

  const updateToolbarDisabled = createMemo(() => {
    const state = updateState();
    if (state === "checking" || state === "downloading") return true;
    if (state === "ready" && props.anyActiveRuns) return true;
    return props.busy;
  });

  const updateRestartBlockedMessage = createMemo(() => {
    if (updateState() !== "ready" || !props.anyActiveRuns) return null;
    return translate("settings.update_restart_blocked");
  });

  const handleUpdateToolbarAction = () => {
    if (updateToolbarDisabled()) return;
    const state = updateState();
    if (state === "available") {
      props.downloadUpdate();
      return;
    }
    if (state === "ready") {
      props.installUpdateAndRestart();
      return;
    }
    props.checkForUpdates();
  };

  const notionStatusLabel = () => {
    switch (props.notionStatus) {
      case "connected":
        return translate("settings.notion_status_connected");
      case "connecting":
        return translate("settings.notion_status_reload_required");
      case "error":
        return translate("settings.notion_status_connection_failed");
      default:
        return translate("settings.notion_status_not_connected");
    }
  };

  const notionStatusStyle = () => {
    if (props.notionStatus === "connected") {
      return "bg-green-7/10 text-green-11 border-green-7/20";
    }
    if (props.notionStatus === "error") {
      return "bg-red-7/10 text-red-11 border-red-7/20";
    }
    if (props.notionStatus === "connecting") {
      return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    }
    return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
  };

  const [providerConnectError, setProviderConnectError] = createSignal<
    string | null
  >(null);
  const [providerDisconnectStatus, setProviderDisconnectStatus] = createSignal<
    string | null
  >(null);
  const [providerDisconnectError, setProviderDisconnectError] = createSignal<
    string | null
  >(null);
  const [providerDisconnectingId, setProviderDisconnectingId] = createSignal<
    string | null
  >(null);
  const [auroworkReconnectStatus, setAuroworkReconnectStatus] = createSignal<
    string | null
  >(null);
  const [auroworkReconnectError, setAuroworkReconnectError] = createSignal<
    string | null
  >(null);
  const [auroworkRestartBusy, setAuroworkRestartBusy] = createSignal(false);
  const [auroworkRestartStatus, setAuroworkRestartStatus] = createSignal<
    string | null
  >(null);
  const [auroworkRestartError, setAuroworkRestartError] = createSignal<
    string | null
  >(null);
  const providerAvailableCount = createMemo(
    () => (props.providers ?? []).length,
  );
  const connectedProviders = createMemo(() => {
    const connected = new Set(props.providerConnectedIds ?? []);
    return (props.providers ?? [])
      .filter((provider) => connected.has(provider.id))
      .map((provider) => ({
        id: provider.id,
        name: provider.name?.trim() || provider.id.trim() || provider.id,
        source: (provider as ProviderListItem & {
          source?: "env" | "api" | "config" | "custom";
        }).source,
      }))
      .filter((entry) => entry.id.trim());
  });
  const providerConnectedCount = createMemo(() => connectedProviders().length);
  const providerSourceLabel = (source?: "env" | "api" | "config" | "custom") => {
    if (source === "env") return translate("settings.providers_source_env");
    if (source === "api") return translate("settings.providers_source_api");
    if (source === "config") return translate("settings.providers_source_config");
    if (source === "custom") return translate("settings.providers_source_custom");
    return null;
  };
  const canDisconnectProvider = (source?: "env" | "api" | "config" | "custom") =>
    source !== "env";
  const providerStatusLabel = createMemo(() => {
    if (!providerAvailableCount()) return translate("settings.providers_unavailable");
    if (!providerConnectedCount()) return translate("settings.providers_not_connected");
    return `${providerConnectedCount()} ${translate("settings.status_connected").toLowerCase()}`;
  });
  const providerStatusStyle = createMemo(() => {
    if (!providerAvailableCount())
      return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    if (!providerConnectedCount())
      return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    return "bg-green-7/10 text-green-11 border-green-7/20";
  });
  const providerSummary = createMemo(() => {
    if (!providerAvailableCount())
      return translate("settings.providers_connect_opencode");
    const connected = providerConnectedCount();
    const available = providerAvailableCount();
    if (!connected) return `${available} ${translate("settings.providers_available_count").replace("{count}", String(available)).replace(/^\d+\s*/, "")}`;
    return `${connected} ${translate("settings.status_connected").toLowerCase()} · ${available} ${translate("settings.providers_available_count").replace("{count}", String(available)).replace(/^\d+\s*/, "")}`;
  });

  const handleOpenProviderAuth = async () => {
    if (props.busy || props.providerAuthBusy) return;
    setProviderConnectError(null);
    setProviderDisconnectError(null);
    setProviderDisconnectStatus(null);
    try {
      await props.openProviderAuthModal();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : translate("settings.error_open_providers");
      setProviderConnectError(message);
    }
  };

  const handleDisconnectProvider = async (providerId: string) => {
    const resolved = providerId.trim();
    if (
      !resolved ||
      props.busy ||
      props.providerAuthBusy ||
      providerDisconnectingId()
    )
      return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            translate("settings.confirm_disconnect_provider").replace("{id}", resolved),
          );
    if (!confirmed) return;
    setProviderDisconnectError(null);
    setProviderDisconnectStatus(null);
    setProviderDisconnectingId(resolved);
    try {
      const result = await props.disconnectProvider(resolved);
      setProviderDisconnectStatus(result || translate("settings.disconnected_provider").replace("{id}", resolved));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : translate("settings.error_disconnect_provider");
      setProviderDisconnectError(message);
    } finally {
      setProviderDisconnectingId(null);
    }
  };

  const handleReconnectAuroworkServer = async () => {
    if (props.busy || props.auroworkReconnectBusy) return;
    if (!props.auroworkServerUrl.trim()) return;
    setAuroworkReconnectStatus(null);
    setAuroworkReconnectError(null);
    try {
      const ok = await props.reconnectAuroworkServer();
      if (!ok) {
        setAuroworkReconnectError(
          translate("settings.reconnect_failed"),
        );
        return;
      }
      setAuroworkReconnectStatus(translate("settings.reconnected_server"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuroworkReconnectError(
        message || translate("settings.error_reconnect_server"),
      );
    }
  };

  const handleRestartLocalServer = async () => {
    if (props.busy || auroworkRestartBusy()) return;
    setAuroworkRestartStatus(null);
    setAuroworkRestartError(null);
    setAuroworkRestartBusy(true);
    try {
      const ok = await props.restartLocalServer();
      if (!ok) {
        setAuroworkRestartError(translate("settings.restart_failed"));
        return;
      }
      setAuroworkRestartStatus(translate("settings.restarted_local_server"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuroworkRestartError(message || translate("settings.error_restart_local_server"));
    } finally {
      setAuroworkRestartBusy(false);
    }
  };

  const auroworkStatusLabel = createMemo(() => {
    switch (props.auroworkServerStatus) {
      case "connected":
        return translate("settings.status_connected");
      case "limited":
        return translate("settings.status_limited");
      default:
        return translate("settings.status_not_connected");
    }
  });

  const auroworkStatusStyle = createMemo(() => {
    switch (props.auroworkServerStatus) {
      case "connected":
        return "bg-green-7/10 text-green-11 border-green-7/20";
      case "limited":
        return "bg-amber-7/10 text-amber-11 border-amber-7/20";
      default:
        return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    }
  });

  const auroworkStatusDot = createMemo(() => {
    switch (props.auroworkServerStatus) {
      case "connected":
        return "bg-green-9";
      case "limited":
        return "bg-amber-9";
      default:
        return "bg-dls-border";
    }
  });

  const clientStatusLabel = createMemo(() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return translate("settings.status_connecting");
    if (status === "error") return translate("settings.status_connection_failed");
    return props.clientConnected ? translate("settings.status_connected") : translate("settings.status_not_connected");
  });

  const clientStatusStyle = createMemo(() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting")
      return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    if (status === "error") return "bg-red-7/10 text-red-11 border-red-7/20";
    return props.clientConnected
      ? "bg-green-7/10 text-green-11 border-green-7/20"
      : "bg-dls-active/60 text-dls-secondary border-dls-border/50";
  });

  const clientStatusDot = createMemo(() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return "bg-amber-9";
    if (status === "error") return "bg-red-9";
    return props.clientConnected ? "bg-green-9" : "bg-dls-border";
  });

  const engineStatusLabel = createMemo(() => {
    if (!isTauriRuntime()) return translate("settings.status_unavailable");
    return props.engineInfo?.running ? translate("settings.status_running") : translate("settings.status_offline");
  });

  const engineStatusStyle = createMemo(() => {
    if (!isTauriRuntime()) return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    return props.engineInfo?.running
      ? "bg-green-7/10 text-green-11 border-green-7/20"
      : "bg-dls-active/60 text-dls-secondary border-dls-border/50";
  });

  const opencodeConnectStatusLabel = createMemo(() => {
    const status = props.opencodeConnectStatus?.status;
    if (!status) return translate("settings.status_idle");
    if (status === "connected") return translate("settings.status_connected");
    if (status === "connecting") return translate("settings.status_connecting");
    return translate("settings.status_failed");
  });

  const opencodeConnectStatusStyle = createMemo(() => {
    const status = props.opencodeConnectStatus?.status;
    if (!status) return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    if (status === "connected")
      return "bg-green-7/10 text-green-11 border-green-7/20";
    if (status === "connecting")
      return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    return "bg-red-7/10 text-red-11 border-red-7/20";
  });

  const opencodeConnectTimestamp = createMemo(() => {
    const at = props.opencodeConnectStatus?.at;
    if (!at) return null;
    return formatRelativeTime(at);
  });

  const opencodeRouterStatusLabel = createMemo(() => {
    if (!isTauriRuntime()) return translate("settings.status_unavailable");
    return props.opencodeRouterInfo?.running ? translate("settings.status_running") : translate("settings.status_offline");
  });

  const opencodeRouterStatusStyle = createMemo(() => {
    if (!isTauriRuntime()) return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    return props.opencodeRouterInfo?.running
      ? "bg-green-7/10 text-green-11 border-green-7/20"
      : "bg-dls-active/60 text-dls-secondary border-dls-border/50";
  });

  const [opencodeRouterRestarting, setOpenCodeRouterRestarting] =
    createSignal(false);
  const [opencodeRouterRestartError, setOpenCodeRouterRestartError] =
    createSignal<string | null>(null);
  const [auroworkServerRestarting, setAuroworkServerRestarting] =
    createSignal(false);
  const [auroworkServerRestartError, setAuroworkServerRestartError] =
    createSignal<string | null>(null);
  const [opencodeRestarting, setOpencodeRestarting] = createSignal(false);
  const [opencodeRestartError, setOpencodeRestartError] = createSignal<
    string | null
  >(null);

  const handleOpenCodeRouterRestart = async () => {
    // OpenCode Router removed
  };

  const handleOpenCodeRouterStop = async () => {
    // OpenCode Router removed
  };

  const handleAuroworkServerRestart = async () => {
    if (auroworkServerRestarting() || !isTauriRuntime()) return;
    setAuroworkServerRestarting(true);
    setAuroworkServerRestartError(null);
    try {
      await auroworkServerRestart({
        remoteAccessEnabled:
          props.auroworkServerSettings.remoteAccessEnabled === true,
      });
      await props.reconnectAuroworkServer();
    } catch (e) {
      setAuroworkServerRestartError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuroworkServerRestarting(false);
    }
  };

  const handleOpenCodeRestart = async () => {
    if (opencodeRestarting() || !isTauriRuntime()) return;
    setOpencodeRestarting(true);
    setOpencodeRestartError(null);
    try {
      await engineRestart({
        opencodeEnableExa: props.opencodeEnableExa,
        auroworkRemoteAccess:
          props.auroworkServerSettings.remoteAccessEnabled === true,
      });
      await props.reconnectAuroworkServer();
    } catch (e) {
      setOpencodeRestartError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpencodeRestarting(false);
    }
  };

  const orchestratorStatusLabel = createMemo(() => {
    if (!props.orchestratorStatus) return translate("settings.status_unavailable");
    return props.orchestratorStatus.running ? translate("settings.status_running") : translate("settings.status_offline");
  });

  const orchestratorStatusStyle = createMemo(() => {
    if (!props.orchestratorStatus)
      return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    return props.orchestratorStatus.running
      ? "bg-green-7/10 text-green-11 border-green-7/20"
      : "bg-dls-active/60 text-dls-secondary border-dls-border/50";
  });

  const auroworkAuditStatusLabel = createMemo(() => {
    if (!props.runtimeWorkspaceId) return translate("settings.status_unavailable");
    if (props.auroworkAuditStatus === "loading") return translate("settings.status_loading");
    if (props.auroworkAuditStatus === "error") return translate("settings.status_error");
    return translate("settings.status_ready");
  });

  const auroworkAuditStatusStyle = createMemo(() => {
    if (!props.runtimeWorkspaceId)
      return "bg-dls-active/60 text-dls-secondary border-dls-border/50";
    if (props.auroworkAuditStatus === "loading")
      return "bg-amber-7/10 text-amber-11 border-amber-7/20";
    if (props.auroworkAuditStatus === "error")
      return "bg-red-7/10 text-red-11 border-red-7/20";
    return "bg-green-7/10 text-green-11 border-green-7/20";
  });

  const isLocalEngineRunning = createMemo(() =>
    Boolean(props.engineInfo?.running),
  );
  const isLocalPreference = createMemo(
    () => props.startupPreference === "local",
  );
  const startupLabel = createMemo(() => {
    if (props.startupPreference === "local") return translate("settings.debug_startup_local");
    if (props.startupPreference === "server") return translate("settings.debug_startup_server");
    return translate("settings.debug_startup_not_set");
  });

  const tabLabel = (tab: SettingsTab) => {
    switch (tab) {
      case "den":
        return translate("settings.tab_cloud");
      case "model":
        return translate("settings.tab_model");
      case "skills":
        return translate("settings.tab_skills");
      case "extensions":
        return translate("settings.tab_extensions");
      case "advanced":
        return translate("settings.tab_advanced");
      case "appearance":
        return translate("settings.tab_appearance");
      case "updates":
        return translate("settings.tab_updates");
      case "recovery":
        return translate("settings.tab_recovery");
      case "debug":
        return translate("settings.tab_debug");
      default:
        return translate("settings.tab_general");
    }
  };

  const workspaceTabs = createMemo<SettingsTab[]>(() => [
    "general",
    "skills",
    "extensions",
    "advanced",
  ]);

  const globalTabs = createMemo<SettingsTab[]>(() => {
    const tabs: SettingsTab[] = ["appearance", "updates", "recovery"];
    if (props.developerMode) tabs.push("debug");
    return tabs;
  });

  const availableTabs = createMemo<SettingsTab[]>(() => {
    return [...workspaceTabs(), ...globalTabs()];
  });

  const activeTab = createMemo<SettingsTab>(() => {
    const tabs = availableTabs();
    return tabs.includes(props.settingsTab) ? props.settingsTab : "general";
  });

  createEffect(() => {
    if (props.settingsTab !== activeTab()) {
      props.setSettingsTab(activeTab());
    }
  });

  const formatActor = (entry: AuroworkAuditEntry) => {
    const actor = entry.actor;
    if (!actor) return "unknown";
    if (actor.type === "host") return "host";
    if (actor.type === "remote") {
      return actor.clientId ? `remote:${actor.clientId}` : "remote";
    }
    return "unknown";
  };

  const formatCapability = (cap?: {
    read?: boolean;
    write?: boolean;
    source?: string;
  }) => {
    if (!cap) return translate("settings.capability_unavailable");
    const parts = [cap.read ? translate("settings.capability_read") : null, cap.write ? translate("settings.capability_write") : null]
      .filter(Boolean)
      .join(" / ");
    const label = parts || translate("settings.capability_no_access");
    return cap.source ? `${label} · ${cap.source}` : label;
  };

  const engineStdout = () => {
    if (!isTauriRuntime()) return translate("settings.available_in_desktop");
    return props.engineInfo?.lastStdout?.trim() || translate("settings.no_stdout_yet");
  };

  const engineStderr = () => {
    if (!isTauriRuntime()) return translate("settings.available_in_desktop");
    return props.engineInfo?.lastStderr?.trim() || translate("settings.no_stderr_yet");
  };

  const auroworkStdout = () => {
    if (!props.auroworkServerHostInfo) return translate("settings.logs_on_host");
    return (
      props.auroworkServerHostInfo.lastStdout?.trim() ||
      translate("settings.no_stdout_yet")
    );
  };

  const auroworkStderr = () => {
    if (!props.auroworkServerHostInfo) return translate("settings.logs_on_host");
    return (
      props.auroworkServerHostInfo.lastStderr?.trim() ||
      translate("settings.no_stderr_yet")
    );
  };

  const opencodeRouterStdout = () => {
    if (!isTauriRuntime()) return translate("settings.available_in_desktop");
    return (
      props.opencodeRouterInfo?.lastStdout?.trim() || translate("settings.no_stdout_yet")
    );
  };

  const opencodeRouterStderr = () => {
    if (!isTauriRuntime()) return translate("settings.available_in_desktop");
    return (
      props.opencodeRouterInfo?.lastStderr?.trim() || translate("settings.no_stderr_yet")
    );
  };

  const formatOrchestratorBinary = (binary?: OrchestratorBinaryInfo | null) => {
    if (!binary) return translate("settings.binary_unavailable");
    const version = binary.actualVersion || binary.expectedVersion || "unknown";
    return `${binary.source} · ${version}`;
  };

  const formatOrchestratorBinaryVersion = (
    binary?: OrchestratorBinaryInfo | null,
  ) => {
    if (!binary) return "—";
    return binary.actualVersion || binary.expectedVersion || "—";
  };

  const orchestratorBinaryPath = () =>
    props.orchestratorStatus?.binaries?.opencode?.path ?? "—";
  const orchestratorSidecarSummary = () => {
    const info = props.orchestratorStatus?.sidecar;
    if (!info) return translate("settings.sidecar_config_unavailable");
    const source = info.source ?? "auto";
    const target = info.target ?? "unknown";
    return `${source} · ${target}`;
  };

  const appVersionLabel = () =>
    props.appVersion ? `v${props.appVersion}` : "—";
  const appCommitLabel = () => {
    const sha = buildInfo()?.gitSha?.trim();
    if (!sha) return "—";
    return sha.length > 12 ? sha.slice(0, 12) : sha;
  };
  const opencodeVersionLabel = () => {
    const binary = props.orchestratorStatus?.binaries?.opencode ?? null;
    if (binary) return formatOrchestratorBinary(binary);
    return props.engineDoctorVersion ?? "—";
  };
  const auroworkServerVersionLabel = () =>
    props.auroworkServerDiagnostics?.version ?? "—";
  const opencodeRouterVersionLabel = () =>
    props.opencodeRouterInfo?.version ?? "—";
  const orchestratorVersionLabel = () =>
    props.orchestratorStatus?.cliVersion ?? "—";

  onMount(() => {
    if (!isTauriRuntime()) return;
    void appBuildInfo()
      .then((info) => setBuildInfo(info))
      .catch(() => setBuildInfo(null));
  });

  const formatUptime = (uptimeMs?: number | null) => {
    if (!uptimeMs) return "—";
    return formatRelativeTime(Date.now() - uptimeMs);
  };

  const [debugReportStatus, setDebugReportStatus] = createSignal<string | null>(
    null,
  );
  const [configActionStatus, setConfigActionStatus] = createSignal<
    string | null
  >(null);
  const [revealConfigBusy, setRevealConfigBusy] = createSignal(false);
  const [resetConfigBusy, setResetConfigBusy] = createSignal(false);
  const [sandboxProbeBusy, setSandboxProbeBusy] = createSignal(false);
  const [sandboxProbeStatus, setSandboxProbeStatus] = createSignal<
    string | null
  >(null);
  const [sandboxProbeResult, setSandboxProbeResult] =
    createSignal<unknown>(null);
  const [nukeConfigBusy, setNukeConfigBusy] = createSignal(false);
  const [nukeConfigStatus, setNukeConfigStatus] = createSignal<
    string | null
  >(null);
  const [debugDeepLinkOpen, setDebugDeepLinkOpen] = createSignal(false);
  const [debugDeepLinkInput, setDebugDeepLinkInput] = createSignal("");
  const [debugDeepLinkBusy, setDebugDeepLinkBusy] = createSignal(false);
  const [debugDeepLinkStatus, setDebugDeepLinkStatus] = createSignal<
    string | null
  >(null);
  const opencodeDevModeEnabled = createMemo(() =>
    Boolean(buildInfo()?.auroworkDevMode),
  );

  const sandboxCreateSummary = createMemo(() => {
    const raw = (props.sandboxCreateProgress ??
      props.sandboxCreateProgressLast) as
      | {
          runId?: string;
          stage?: string;
          error?: string | null;
          logs?: string[];
          startedAt?: number;
        }
      | null
      | undefined;
    if (!raw || typeof raw !== "object") {
      return {
        runId: null,
        stage: null,
        error: null,
        logs: [] as string[],
        startedAt: null,
      };
    }
    return {
      runId:
        typeof raw.runId === "string" && raw.runId.trim() ? raw.runId : null,
      stage:
        typeof raw.stage === "string" && raw.stage.trim() ? raw.stage : null,
      error:
        typeof raw.error === "string" && raw.error.trim() ? raw.error : null,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
      logs: Array.isArray(raw.logs)
        ? raw.logs
            .filter((line) => typeof line === "string" && line.trim())
            .slice(-400)
        : [],
    };
  });

  const workspaceConfigPath = createMemo(() => {
    const root = props.selectedWorkspaceRoot.trim();
    if (!root) return "";
    const normalized = root.replace(/[\\/]+$/, "");
    const separator = props.isWindows ? "\\" : "/";
    return `${normalized}${separator}.opencode${separator}aurowork.json`;
  });

  const runtimeDebugReport = createMemo(() => ({
    generatedAt: new Date().toISOString(),
    app: {
      version: appVersionLabel(),
      commit: appCommitLabel(),
      startupPreference: props.startupPreference ?? "unset",
      workspaceRoot: props.selectedWorkspaceRoot.trim() || null,
      workspaceConfigPath: workspaceConfigPath() || null,
    },
    versions: {
      orchestrator: orchestratorVersionLabel(),
      opencode: opencodeVersionLabel(),
      auroworkServer: auroworkServerVersionLabel(),
      opencodeRouter: opencodeRouterVersionLabel(),
    },
    services: {
      engine: {
        scope: props.startupPreference === "server" ? "local-desktop" : "local-host",
        status: engineStatusLabel(),
        baseUrl: props.engineInfo?.baseUrl ?? null,
        pid: props.engineInfo?.pid ?? null,
        stdout: engineStdout(),
        stderr: engineStderr(),
      },
      orchestrator: {
        scope: props.startupPreference === "server" ? "local-desktop" : "local-host",
        status: orchestratorStatusLabel(),
        dataDir: props.orchestratorStatus?.dataDir ?? null,
        activeWorkspace: props.orchestratorStatus?.activeId ?? null,
        sidecar: orchestratorSidecarSummary(),
      },
      auroworkServer: {
        scope: props.startupPreference === "server" ? "connected-worker" : "local-host",
        status: auroworkStatusLabel(),
        baseUrl:
          (props.auroworkServerHostInfo?.baseUrl ?? props.auroworkServerUrl) ||
          null,
        pid: props.auroworkServerHostInfo?.pid ?? null,
        stdout: auroworkStdout(),
        stderr: auroworkStderr(),
      },
      opencodeRouter: {
        scope: props.startupPreference === "server" ? "local-desktop" : "local-host",
        note:
          props.startupPreference === "server"
            ? translate("settings.router_desktop_note")
            : null,
        status: opencodeRouterStatusLabel(),
        healthPort: props.opencodeRouterInfo?.healthPort ?? null,
        pid: props.opencodeRouterInfo?.pid ?? null,
        stdout: opencodeRouterStdout(),
        stderr: opencodeRouterStderr(),
      },
    },
    diagnostics: props.auroworkServerDiagnostics,
    capabilities: props.auroworkServerCapabilities,
    pendingPermissions: props.pendingPermissions,
    recentEvents: props.events,
    workspaceDebugEvents: props.workspaceDebugEvents,
    sandboxCreateProgress: {
      ...sandboxCreateSummary(),
      lastRunAt: sandboxCreateSummary().startedAt
        ? new Date(sandboxCreateSummary().startedAt!).toISOString()
        : null,
    },
    sandboxProbe: sandboxProbeResult(),
  }));

  const runtimeDebugReportJson = createMemo(
    () => `${JSON.stringify(runtimeDebugReport(), null, 2)}\n`,
  );

  const copyRuntimeDebugReport = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setDebugReportStatus(translate("settings.clipboard_unavailable"));
      return;
    }
    try {
      await navigator.clipboard.writeText(runtimeDebugReportJson());
      setDebugReportStatus(translate("settings.copied_runtime_report"));
    } catch (error) {
      setDebugReportStatus(
        error instanceof Error
          ? error.message
          : translate("settings.error_copy_runtime_report"),
      );
    }
  };

  const exportRuntimeDebugReport = () => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      setDebugReportStatus(translate("settings.export_unavailable"));
      return;
    }
    try {
      const stamp = new Date()
        .toISOString()
        .replace(/[:]/g, "-")
        .replace(/\..+$/, "");
      const blob = new Blob([runtimeDebugReportJson()], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aurowork-debug-report-${stamp}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);
      setDebugReportStatus(translate("settings.exported_runtime_report"));
    } catch (error) {
      setDebugReportStatus(
        error instanceof Error
          ? error.message
          : translate("settings.error_export_runtime_report"),
      );
    }
  };

  const revealWorkspaceConfig = async () => {
    if (!isTauriRuntime() || revealConfigBusy()) return;
    const path = workspaceConfigPath();
    if (!path) {
      setConfigActionStatus(
        translate("settings.select_workspace_before_reveal"),
      );
      return;
    }
    setRevealConfigBusy(true);
    setConfigActionStatus(null);
    try {
      const { openPath, revealItemInDir } =
        await import("@tauri-apps/plugin-opener");
      if (isWindowsPlatform()) {
        await openPath(path);
      } else {
        await revealItemInDir(path);
      }
      setConfigActionStatus(translate("settings.revealed_workspace_config"));
    } catch (error) {
      setConfigActionStatus(
        error instanceof Error
          ? error.message
          : translate("settings.error_reveal_workspace_config"),
      );
    } finally {
      setRevealConfigBusy(false);
    }
  };

  const resetAppConfigDefaults = async () => {
    if (resetConfigBusy()) return;
    setResetConfigBusy(true);
    setConfigActionStatus(null);
    try {
      const result = await props.resetAppConfigDefaults();
      setConfigActionStatus(result.message);
    } catch (error) {
      setConfigActionStatus(
        error instanceof Error ? error.message : translate("settings.error_reset_app_config"),
      );
    } finally {
      setResetConfigBusy(false);
    }
  };

  const handleNukeAuroworkAndOpencodeConfig = async () => {
    if (!isTauriRuntime() || nukeConfigBusy()) return;
    const devMode = opencodeDevModeEnabled();
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            devMode
              ? translate("settings.nuke_confirm_dev")
              : translate("settings.nuke_confirm_prod"),
          );
    if (!confirmed) return;
    setNukeConfigBusy(true);
    setNukeConfigStatus(null);
    try {
      if (typeof window !== "undefined") {
        try {
          window.localStorage.clear();
        } catch {
          // ignore
        }
      }

      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });

      await nukeAuroworkAndOpencodeConfigAndExit();
      setNukeConfigStatus(
        translate("settings.nuke_success"),
      );
    } catch (error) {
      setNukeConfigStatus(
        error instanceof Error
          ? error.message
          : translate("settings.error_nuke"),
      );
      setNukeConfigBusy(false);
    }
  };

  const runSandboxDebugProbe = async () => {
    // Sandbox debug probe removed
    setSandboxProbeStatus(translate("settings.sandbox_not_available"));
  };

  const submitDebugDeepLink = async () => {
    if (debugDeepLinkBusy()) return;
    setDebugDeepLinkBusy(true);
    setDebugDeepLinkStatus(null);
    try {
      const result = await props.openDebugDeepLink(debugDeepLinkInput());
      setDebugDeepLinkStatus(result.message);
    } catch (error) {
      setDebugDeepLinkStatus(
        error instanceof Error ? error.message : translate("settings.error_open_deep_link"),
      );
    } finally {
      setDebugDeepLinkBusy(false);
    }
  };

  const compactOutlineActionClass =
    "inline-flex items-center gap-1.5 rounded-md border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-secondary shadow-sm transition-colors duration-150 hover:bg-dls-hover hover:text-dls-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--dls-accent-rgb),0.25)] disabled:cursor-not-allowed disabled:opacity-60";
  const compactDangerActionClass =
    "inline-flex items-center gap-1.5 rounded-md border border-red-7/35 bg-red-3/25 px-3 py-1.5 text-xs font-medium text-red-11 transition-colors duration-150 hover:border-red-7/50 hover:bg-red-3/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-7/35 disabled:cursor-not-allowed disabled:opacity-60";
  const settingsRailClass =
    "rounded-[24px] border border-dls-border bg-dls-sidebar p-3";
  const settingsPanelClass =
    "rounded-[28px] border border-dls-border bg-dls-surface p-5 md:p-6";
  const settingsPanelSoftClass =
    "rounded-2xl border border-dls-border/60 bg-dls-surface/40 p-4";

  const tabDescription = (tab: SettingsTab) => {
    switch (tab) {
      case "den":
        return translate("settings.tab_desc_den");
      case "model":
        return translate("settings.tab_desc_model");
      case "skills":
        return translate("settings.tab_desc_skills");
      case "extensions":
        return translate("settings.tab_desc_extensions");
      case "advanced":
        return translate("settings.tab_desc_advanced");
      case "appearance":
        return translate("settings.tab_desc_appearance");
      case "updates":
        return translate("settings.tab_desc_updates");
      case "recovery":
        return translate("settings.tab_desc_recovery");
      case "debug":
        return translate("settings.tab_desc_debug");
      default:
        return translate("settings.tab_desc_general");
    }
  };

  const activeTabGroup = createMemo(() =>
    workspaceTabs().includes(activeTab()) ? translate("settings.tab_workspace") : translate("settings.tab_global"),
  );

  return (
    <section class="space-y-6 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-8 md:space-y-0">
      <aside class="space-y-6 md:sticky md:top-4 md:self-start">
        <div class={settingsRailClass}>
          <div class="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-dls-secondary">
            {translate("settings.tab_workspace")}
          </div>
          <div class="space-y-1">
            <For each={workspaceTabs()}>
              {(tab) => (
                <button
                  type="button"
                  class={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    activeTab() === tab
                      ? "bg-dls-surface text-dls-text shadow-sm"
                      : "text-dls-secondary hover:bg-dls-surface/50 hover:text-dls-text"
                  }`}
                  onClick={() => props.setSettingsTab(tab)}
                >
                  <span>{tabLabel(tab)}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class={settingsRailClass}>
          <div class="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-dls-secondary">
            {translate("settings.tab_global")}
          </div>
          <div class="space-y-1">
            <For each={globalTabs()}>
              {(tab) => (
                <button
                  type="button"
                  class={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    activeTab() === tab
                      ? "bg-dls-surface text-dls-text shadow-sm"
                      : "text-dls-secondary hover:bg-dls-surface/50 hover:text-dls-text"
                  }`}
                  onClick={() => props.setSettingsTab(tab)}
                >
                  <span>{tabLabel(tab)}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </aside>

      <div class="min-w-0 space-y-6">
        <div class={`${settingsPanelClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
          <div class="space-y-1">
            <h2 class="text-lg font-semibold tracking-tight text-dls-text">
              {tabLabel(activeTab())}
            </h2>
            <p class="text-sm text-dls-secondary">
              {tabDescription(activeTab())}
            </p>
          </div>
          <Show when={showUpdateToolbar() && activeTab() === "general"}>
            <div class="mt-4 space-y-2 md:mt-0 md:max-w-sm md:text-right">
              <div class="flex flex-wrap items-center gap-2 md:justify-end">
                <div
                  class={`rounded-full border px-3 py-1.5 text-xs shadow-sm flex items-center gap-2 ${updateToolbarTone()}`}
                  title={updateToolbarTitle()}
                >
                  <Show when={updateToolbarSpinning()}>
                    <RefreshCcw size={12} class="animate-spin" />
                  </Show>
                  <span class="tabular-nums whitespace-nowrap">
                    {updateToolbarLabel()}
                  </span>
                </div>
                <Show when={updateToolbarActionLabel()}>
                  <Button
                    variant="outline"
                    class="text-xs h-8 py-0 px-3 rounded-full border-dls-border/60 bg-dls-surface/70 hover:bg-dls-hover/70"
                    onClick={handleUpdateToolbarAction}
                    disabled={updateToolbarDisabled()}
                    title={updateRestartBlockedMessage() ?? ""}
                  >
                    {updateToolbarActionLabel()}
                  </Button>
                </Show>
              </div>
              <Show when={updateRestartBlockedMessage()}>
                <div class="text-xs leading-relaxed text-amber-11/90 md:max-w-sm">
                  {updateRestartBlockedMessage()}
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <Switch>
        <Match when={activeTab() === "general"}>
          <div class="space-y-6">
            <div class={`${settingsPanelClass} space-y-4`}>
              <div class="space-y-1">
                <div class="flex items-center gap-2 text-sm font-semibold text-dls-text">
                    <FolderLock size={16} class="text-dls-secondary" />
                    {translate("settings.authorized_folders_title")}
                  </div>
                  <div class="text-xs text-dls-secondary leading-relaxed max-w-[65ch]">
                    {translate("settings.authorized_folders_description")}
                  </div>
                </div>

                <Show
                  when={props.authorizedFoldersAvailable}
                  fallback={
                    <div class={`${settingsPanelSoftClass} px-3 py-3 text-xs text-dls-secondary`}>
                      {props.authorizedFoldersHint ??
                        translate("settings.authorized_folders_fallback_hint")}
                    </div>
                  }
                >
                  <div class="flex flex-col overflow-hidden rounded-xl border border-dls-border/60 bg-dls-surface/50 shadow-sm">
                    <Show when={props.authorizedFoldersHint}>
                      {(hint) => (
                        <div class="bg-dls-hover/60 px-3 py-2 text-[11px] text-dls-secondary border-b border-dls-border/40">
                          {hint()}
                        </div>
                      )}
                    </Show>

                    <Show
                      when={visibleAuthorizedFolders().length > 0}
                      fallback={
                        <div class="flex flex-col items-center justify-center p-6 text-center">
                          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-3/30 text-blue-11 mb-3">
                            <Folder size={20} />
                          </div>
                          <div class="text-sm font-medium text-dls-secondary">{translate("settings.authorized_folders_empty_title")}</div>
                          <div class="text-[11px] text-dls-secondary mt-1 max-w-[40ch]">
                            {translate("settings.authorized_folders_empty_hint")}
                          </div>
                        </div>
                      }
                    >
                      <div class="flex flex-col divide-y divide-dls-border/40 max-h-[300px] overflow-y-auto">
                        <For each={visibleAuthorizedFolders()}>
                          {(folder) => {
                            const isWorkspaceRoot = folder === workspaceRootFolder();
                            const folderName = folder.split(/[/\\]/).filter(Boolean).pop() || folder;
                            return (
                              <div class={`flex items-center justify-between px-3 py-2.5 transition-colors ${
                                isWorkspaceRoot ? "bg-blue-2/20" : "hover:bg-dls-hover/50"
                              }`}>
                                <div class="flex items-center gap-3 overflow-hidden">
                                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-3/30 text-blue-11">
                                    <Folder size={15} />
                                  </div>
                                  <div class="flex min-w-0 flex-col">
                                    <div class="flex items-center gap-2">
                                      <span class="truncate text-sm font-medium text-dls-text">{folderName}</span>
                                      <Show when={isWorkspaceRoot}>
                                        <span class="rounded-full border border-blue-7/30 bg-blue-3/25 px-2 py-0.5 text-[10px] font-medium text-blue-11">
                                          {translate("settings.authorized_folders_workspace_root")}
                                        </span>
                                      </Show>
                                    </div>
                                    <span class="truncate font-mono text-[10px] text-dls-secondary">{folder}</span>
                                  </div>
                                </div>
                                <Show
                                  when={!isWorkspaceRoot}
                                  fallback={
                                    <span class="shrink-0 text-[10px] font-medium text-dls-secondary">
                                      {translate("settings.authorized_folders_always_available")}
                                    </span>
                                  }
                                >
                                  <Button
                                    variant="ghost"
                                    class="h-6 w-6 shrink-0 !rounded-full !p-0 border-0 bg-transparent text-red-10 shadow-none hover:bg-red-3/15 hover:text-red-11 focus:ring-red-7/25"
                                    onClick={() => void props.removeAuthorizedFolder(folder)}
                                    disabled={
                                      props.authorizedFoldersLoading ||
                                      props.authorizedFoldersSaving ||
                                      !props.authorizedFoldersEditable
                                    }
                                    aria-label={`Remove ${folderName}`}
                                  >
                                    <X size={16} class="text-current" />
                                  </Button>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>

                    <Show when={props.authorizedFoldersStatus}>
                      {(status) => (
                        <div class="bg-blue-2/30 px-3 py-2 text-[11px] text-blue-11 border-t border-dls-border/40">
                          {status()}
                        </div>
                      )}
                    </Show>
                    <Show when={props.authorizedFoldersError}>
                      {(error) => (
                        <div class="bg-red-2/30 px-3 py-2 text-[11px] text-red-11 border-t border-dls-border/40">
                          {error()}
                        </div>
                      )}
                    </Show>

                    <form
                      class="flex items-center gap-2 bg-dls-hover/60 border-t border-dls-border/60 p-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void props.addAuthorizedFolder();
                      }}
                    >
                      <div class="relative flex-1">
                        <input
                          class="w-full rounded-lg border border-dls-border/60 bg-dls-surface px-3 py-1.5 text-xs text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-blue-7/30 disabled:opacity-50"
                          value={props.authorizedFolderDraft}
                          onInput={(event) =>
                            props.setAuthorizedFolderDraft(event.currentTarget.value)
                          }
                          onPaste={(event) => {
                            event.preventDefault();
                          }}
                          placeholder={translate("settings.authorized_folders_placeholder")}
                          disabled={
                            props.authorizedFoldersLoading ||
                            props.authorizedFoldersSaving ||
                            !props.authorizedFoldersEditable
                          }
                        />
                      </div>
                      
                      <Show when={canPickAuthorizedFolder()}>
                        <Button
                          type="button"
                          variant="outline"
                          class="h-8 px-3 text-xs bg-dls-surface hover:bg-dls-hover"
                          onClick={() => void props.pickAuthorizedFolder()}
                          disabled={
                            props.authorizedFoldersLoading ||
                            props.authorizedFoldersSaving ||
                            !props.authorizedFoldersEditable
                          }
                        >
                          <FolderSearch size={13} class="mr-1.5" /> {translate("settings.authorized_folders_browse")}
                        </Button>
                      </Show>
                      
                      <Button
                        type="submit"
                        variant="primary"
                        class="h-8 px-3 text-xs bg-dls-active text-dls-text hover:bg-dls-active border border-dls-border/60"
                        disabled={
                          props.authorizedFoldersLoading ||
                          props.authorizedFoldersSaving ||
                          !props.authorizedFoldersEditable ||
                          !props.authorizedFolderDraft.trim()
                        }
                      >
                        {props.authorizedFoldersSaving ? translate("settings.authorized_folders_adding") : translate("settings.authorized_folders_add")}
                      </Button>
                    </form>
                  </div>
                </Show>
              </div>

            <div class={`${settingsPanelClass} space-y-4`}>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2">
                    <PlugZap size={16} class="text-dls-secondary" />
                    <div class="text-sm font-medium text-dls-text">
                      {translate("settings.providers_title")}
                    </div>
                  </div>
                  <div class="text-xs text-dls-secondary mt-1">
                    {translate("settings.providers_description")}
                  </div>
                </div>
                <div
                  class={`text-xs px-2 py-1 rounded-full border ${providerStatusStyle()}`}
                >
                  {providerStatusLabel()}
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={handleOpenProviderAuth}
                  disabled={props.busy || props.providerAuthBusy}
                >
                  {props.providerAuthBusy
                    ? translate("settings.providers_loading")
                    : translate("settings.providers_connect")}
                </Button>
                <div class="text-xs text-dls-secondary">{providerSummary()}</div>
              </div>

              <Show when={connectedProviders().length > 0}>
                <div class="space-y-2">
                  <For each={connectedProviders()}>
                    {(provider) => (
                      <div class={`${settingsPanelSoftClass} flex flex-wrap items-center justify-between gap-3 px-3 py-2`}>
                        <div class="min-w-0 flex items-center gap-3">
                          <ProviderIcon providerId={provider.id} size={18} class="text-dls-text" />
                          <div class="min-w-0">
                            <div class="text-sm font-medium text-dls-text truncate">
                              {provider.name}
                            </div>
                            <div class="text-[11px] text-dls-secondary font-mono truncate">
                              {provider.id}
                            </div>
                            <Show when={providerSourceLabel(provider.source)}>
                              {(label) => (
                                <div class="mt-1 text-[11px] text-dls-secondary truncate">{label()}</div>
                              )}
                            </Show>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          class="text-xs h-8 py-0 px-3"
                          onClick={() =>
                            void handleDisconnectProvider(provider.id)
                          }
                          disabled={
                            props.busy ||
                            props.providerAuthBusy ||
                            providerDisconnectingId() !== null ||
                            !canDisconnectProvider(provider.source)
                          }
                        >
                          {providerDisconnectingId() === provider.id
                            ? translate("settings.providers_disconnecting")
                            : canDisconnectProvider(provider.source)
                              ? translate("settings.providers_disconnect")
                              : translate("settings.providers_managed_by_env")}
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={providerConnectError()}>
                <div class="rounded-xl border border-red-7/30 bg-red-1/40 px-3 py-2 text-xs text-red-11">
                  {providerConnectError()}
                </div>
              </Show>
              <Show when={providerDisconnectStatus()}>
                <div class={`${settingsPanelSoftClass} px-3 py-2 text-xs text-dls-secondary`}>
                  {providerDisconnectStatus()}
                </div>
              </Show>
              <Show when={providerDisconnectError()}>
                <div class="rounded-xl border border-red-7/30 bg-red-1/40 px-3 py-2 text-xs text-red-11">
                  {providerDisconnectError()}
                </div>
              </Show>

              <div class="text-[11px] text-dls-secondary">
                {translate("settings.providers_api_keys_hint")}
              </div>
            </div>

            <div class={`${settingsPanelClass} space-y-4`}>
              <div>
                <div class="text-sm font-medium text-dls-text">{translate("settings.model_section_title")}</div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.model_section_description")}
                </div>
              </div>

              <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-dls-text truncate">
                    {props.defaultModelLabel}
                  </div>
                  <div class="text-xs text-dls-secondary font-mono truncate">
                    {props.defaultModelRef}
                  </div>
                </div>
                <Button
                  variant="outline"
                  class="text-xs h-8 py-0 px-3 shrink-0"
                  onClick={props.openDefaultModelPicker}
                  disabled={props.busy}
                >
                  {translate("settings.change")}
                </Button>
              </div>

              <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-dls-text">{translate("settings.show_model_reasoning")}</div>
                  <div class="text-xs text-dls-secondary">
                    {translate("settings.show_model_reasoning_hint")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  class="text-xs h-8 py-0 px-3 shrink-0"
                  onClick={props.toggleShowThinking}
                  disabled={props.busy}
                >
                  {props.showThinking ? translate("settings.status_on") : translate("settings.status_off")}
                </Button>
              </div>

              <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-dls-text">{translate("settings.model_behavior_title")}</div>
                  <div class="text-xs text-dls-secondary truncate">
                    {translate("settings.model_behavior_hint")}
                  </div>
                  <div class="mt-1 text-xs text-dls-secondary font-medium truncate">
                    {props.modelVariantLabel}
                  </div>
                </div>
                <Button
                  variant="outline"
                  class="text-xs h-8 py-0 px-3 shrink-0"
                  onClick={props.editModelVariant}
                  disabled={props.busy}
                >
                  {translate("settings.configure")}
                </Button>
              </div>
            </div>

              {/* TODO: feedback card hidden — pending feedback system redesign */}
          </div>
        </Match>

        <Match when={activeTab() === "appearance"}>
          <div class="space-y-6">
              <div class={`${settingsPanelClass} space-y-4`}>
                <div>
                  <div class="text-sm font-medium text-dls-text">{translate("settings.appearance_section_title")}</div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.appearance_section_hint")}
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <Button
                  variant={
                    props.themeMode === "system" ? "secondary" : "outline"
                  }
                  class="text-xs h-8 py-0 px-3"
                  onClick={() => props.setThemeMode("system")}
                  disabled={props.busy}
                >
                  {translate("settings.theme_system_label")}
                </Button>
                <Button
                  variant={
                    props.themeMode === "light" ? "secondary" : "outline"
                  }
                  class="text-xs h-8 py-0 px-3"
                  onClick={() => props.setThemeMode("light")}
                  disabled={props.busy}
                >
                  {translate("settings.theme_light_label")}
                </Button>
                <Button
                  variant={props.themeMode === "dark" ? "secondary" : "outline"}
                  class="text-xs h-8 py-0 px-3"
                  onClick={() => props.setThemeMode("dark")}
                  disabled={props.busy}
                >
                  {translate("settings.theme_dark_label")}
                </Button>
              </div>

              <div class="space-y-2">
                <div class="text-xs font-medium text-dls-secondary">
                  {translate("settings.language")}
                </div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.language.description")}
                </div>
                <div class="flex flex-wrap gap-2">
                  <For each={LANGUAGE_OPTIONS}>
                    {(option) => (
                      <Button
                        variant={
                          props.language === option.value
                            ? "secondary"
                            : "outline"
                        }
                        class="text-xs h-8 py-0 px-3"
                        onClick={() => props.setLanguage(option.value)}
                        disabled={props.busy}
                      >
                        {option.nativeName}
                      </Button>
                    )}
                  </For>
                </div>
              </div>

                <div class="text-xs text-dls-secondary">
                  {translate("settings.theme_system_auto_hint")}
                </div>
              </div>
            <Show when={isTauriRuntime()}>
              <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-3">
                <div>
                  <div class="text-sm font-medium text-dls-text">{translate("settings.appearance_window_title")}</div>
                  <div class="text-xs text-dls-secondary">
                    {translate("settings.appearance_window_hint")}
                  </div>
                </div>

                <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                  <div class="min-w-0">
                    <div class="text-sm text-dls-text">{translate("settings.hide_titlebar_title")}</div>
                    <div class="text-xs text-dls-secondary">
                      {translate("settings.hide_titlebar_hint")}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    class="text-xs h-8 py-0 px-3 shrink-0"
                    onClick={props.toggleHideTitlebar}
                    disabled={props.busy}
                  >
                    {props.hideTitlebar ? translate("settings.status_on") : translate("settings.status_off")}
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "skills"}>
          <WebUnavailableSurface unavailable={webDeployment()}>
            <SkillsView
              workspaceName={props.selectedWorkspaceRoot.trim() || translate("settings.workspace_fallback")}
              busy={props.busy}
              showHeader={false}
              canInstallSkillCreator={props.canInstallSkillCreator}
              canUseDesktopTools={props.canUseDesktopTools}
              accessHint={props.skillsAccessHint}
              refreshSkills={props.refreshSkills}
              refreshHubSkills={props.refreshHubSkills}
              skills={props.skills}
              skillsStatus={props.skillsStatus}
              hubSkills={props.hubSkills}
              hubSkillsStatus={props.hubSkillsStatus}
              hubRepo={props.hubRepo}
              hubRepos={props.hubRepos}
              importLocalSkill={props.importLocalSkill}
              installSkillCreator={props.installSkillCreator}
              installHubSkill={props.installHubSkill}
              setHubRepo={props.setHubRepo}
              addHubRepo={props.addHubRepo}
              removeHubRepo={props.removeHubRepo}
              revealSkillsFolder={props.revealSkillsFolder}
              uninstallSkill={props.uninstallSkill}
              readSkill={props.readSkill}
              saveSkill={props.saveSkill}
              createSessionAndOpen={props.createSessionAndOpen}
              setPrompt={props.setPrompt}
            />
          </WebUnavailableSurface>
        </Match>

        <Match when={activeTab() === "extensions"}>
          <WebUnavailableSurface unavailable={webDeployment()}>
            <ExtensionsView
              initialSection="all"
              showHeader={false}
              busy={props.busy}
              selectedWorkspaceRoot={props.selectedWorkspaceRoot}
              isRemoteWorkspace={props.activeWorkspaceType === "remote"}
              refreshMcpServers={props.refreshMcpServers}
              mcpServers={props.mcpServers}
              mcpStatus={props.mcpStatus}
              mcpLastUpdatedAt={props.mcpLastUpdatedAt}
              mcpStatuses={props.mcpStatuses}
              mcpConnectingName={props.mcpConnectingName}
              selectedMcp={props.selectedMcp}
              setSelectedMcp={props.setSelectedMcp}
              quickConnect={props.quickConnect}
              connectMcp={props.connectMcp}
              authorizeMcp={props.authorizeMcp}
              logoutMcpAuth={props.logoutMcpAuth}
              removeMcp={props.removeMcp}
              showMcpReloadBanner={props.showMcpReloadBanner}
              reloadBlocked={props.mcpReloadBlocked}
              reloadMcpEngine={props.reloadMcpEngine}
              canEditPlugins={props.canEditPlugins}
              canUseGlobalScope={props.canUseGlobalPluginScope}
              accessHint={props.pluginsAccessHint}
              pluginScope={props.pluginScope}
              setPluginScope={props.setPluginScope}
              pluginConfigPath={props.pluginConfigPath}
              pluginList={props.pluginList}
              pluginInput={props.pluginInput}
              setPluginInput={props.setPluginInput}
              pluginStatus={props.pluginStatus}
              activePluginGuide={props.activePluginGuide}
              setActivePluginGuide={props.setActivePluginGuide}
              isPluginInstalled={props.isPluginInstalled}
              suggestedPlugins={props.suggestedPlugins}
              refreshPlugins={props.refreshPlugins}
              addPlugin={props.addPlugin}
              removePlugin={props.removePlugin}
            />
          </WebUnavailableSurface>
        </Match>

        <Match when={activeTab() === "den"}>
          <DenSettingsPanel
            developerMode={props.developerMode}
            connectRemoteWorkspace={props.connectRemoteWorkspace}
            openCloudTemplate={props.openCloudTemplate}
          />
        </Match>

        <Match when={activeTab() === "advanced"}>
          <div class="space-y-6">
            <div class={`${settingsPanelClass} space-y-4`}>
              <div>
                <div class="text-sm font-medium text-dls-text">{translate("settings.runtime_title")}</div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.runtime_description")}
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dls-border/60 bg-dls-surface/70 text-dls-text">
                      <Cpu size={18} />
                    </div>
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.opencode_engine_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.opencode_engine_description")}
                      </div>
                    </div>
                  </div>
                  <div
                    class={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${clientStatusStyle()}`}
                  >
                    <span class={`h-2 w-2 rounded-full ${clientStatusDot()}`} />
                    {clientStatusLabel()}
                  </div>
                </div>

                <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dls-border/60 bg-dls-surface/70 text-dls-text">
                      <Server size={18} />
                    </div>
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.aurowork_server_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.aurowork_server_description")}
                      </div>
                    </div>
                  </div>
                  <div
                    class={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${auroworkStatusStyle()}`}
                  >
                    <span
                      class={`h-2 w-2 rounded-full ${auroworkStatusDot()}`}
                    />
                    {auroworkStatusLabel()}
                  </div>
                </div>
              </div>
            </div>

            <div class={`${settingsPanelClass} space-y-3`}>
              <div>
                <div class="text-sm font-medium text-dls-text">{translate("settings.opencode_title")}</div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.opencode_description")}
                </div>
              </div>

              <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-dls-text">{translate("settings.enable_exa_title")}</div>
                  <div class="text-xs text-dls-secondary">
                    {translate("settings.enable_exa_hint")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  class="text-xs h-8 py-0 px-3 shrink-0"
                  onClick={props.toggleOpencodeEnableExa}
                  disabled={props.busy}
                >
                  {props.opencodeEnableExa ? translate("settings.status_on") : translate("settings.status_off")}
                </Button>
              </div>

              <div class="text-[11px] text-dls-secondary">
                {translate("settings.opencode_restart_hint")}
              </div>
            </div>

            <div class={`${settingsPanelClass} space-y-3`}>
              <div class="text-sm font-medium text-dls-text">{translate("settings.developer_mode_title")}</div>
              <div class="text-xs text-dls-secondary">
                {translate("settings.developer_mode_description")}
              </div>
              <div class="pt-1 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  class={`${compactOutlineActionClass} ${
                    props.developerMode
                      ? "border-blue-7/35 bg-blue-3/20 text-blue-11 hover:bg-blue-3/35 hover:text-blue-11"
                      : ""
                  }`}
                  onClick={props.toggleDeveloperMode}
                >
                  <Zap
                    size={14}
                    class={
                      props.developerMode
                        ? "text-blue-10"
                        : "text-dls-secondary"
                    }
                  />
                  {props.developerMode
                    ? translate("settings.disable_developer_mode")
                    : translate("settings.enable_developer_mode")}
                </button>
                <div class="text-xs text-dls-secondary">
                  {props.developerMode
                    ? translate("settings.developer_panel_enabled")
                    : translate("settings.developer_panel_enable_hint")}
                </div>
              </div>
              <Show when={isTauriRuntime() && opencodeDevModeEnabled() && props.developerMode}>
                <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.open_deeplink_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.open_deeplink_description")}
                      </div>
                    </div>
                    <button
                      type="button"
                      class={compactOutlineActionClass}
                      onClick={() => {
                        setDebugDeepLinkOpen((value) => !value);
                        setDebugDeepLinkStatus(null);
                      }}
                      disabled={props.busy || debugDeepLinkBusy()}
                    >
                      {debugDeepLinkOpen() ? translate("settings.open_deeplink_hide") : translate("settings.open_deeplink_open")}
                    </button>
                  </div>

                  <Show when={debugDeepLinkOpen()}>
                    <div class="space-y-3">
                      <textarea
                        value={debugDeepLinkInput()}
                        onInput={(event) =>
                          setDebugDeepLinkInput(event.currentTarget.value)
                        }
                        rows={3}
                        placeholder="aurowork://..."
                        class="w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs font-mono text-dls-text outline-none transition focus:border-blue-8"
                      />
                      <div class="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          class="text-xs h-8 py-0 px-3"
                          onClick={() => void submitDebugDeepLink()}
                          disabled={
                            props.busy ||
                            debugDeepLinkBusy() ||
                            !debugDeepLinkInput().trim()
                          }
                        >
                          {debugDeepLinkBusy() ? translate("settings.open_deeplink_opening") : translate("settings.open_deeplink_action")}
                        </Button>
                        <div class="text-[11px] text-dls-secondary">
                          Accepts <span class="font-mono">aurowork://</span>,{" "}
                          <span class="font-mono">aurowork-dev://</span>, or a
                          raw supported{" "}
                          <span class="font-mono">
                            https://share.auroworklabs.com/b/...
                          </span>{" "}
                          URL.
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={debugDeepLinkStatus()}>
                    {(value) => (
                      <div class="text-xs text-dls-secondary">{value()}</div>
                    )}
                  </Show>
                </div>
              </Show>
            </div>

            <div class={`${settingsPanelClass} space-y-3`}>
              <div class="text-sm font-medium text-dls-text">{translate("settings.connection_section_title")}</div>
              <div class="text-xs text-dls-secondary">{props.headerStatus}</div>
              <div class="text-xs text-dls-secondary font-mono break-all">
                {props.baseUrl}
              </div>
              <div class="pt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class={compactOutlineActionClass}
                  onClick={handleReconnectAuroworkServer}
                  disabled={
                    props.busy ||
                    props.auroworkReconnectBusy ||
                    !props.auroworkServerUrl.trim()
                  }
                >
                  <RefreshCcw
                    size={14}
                    class={`text-dls-secondary ${props.auroworkReconnectBusy ? "animate-spin" : ""}`}
                  />
                  {props.auroworkReconnectBusy
                    ? translate("settings.reconnecting")
                    : translate("settings.reconnect_server")}
                </button>
                <Show when={isLocalEngineRunning()}>
                  <button
                    type="button"
                    class={compactOutlineActionClass}
                    onClick={handleRestartLocalServer}
                    disabled={props.busy || auroworkRestartBusy()}
                  >
                    <RefreshCcw
                      size={14}
                      class={`text-dls-secondary ${auroworkRestartBusy() ? "animate-spin" : ""}`}
                    />
                    {auroworkRestartBusy()
                      ? translate("settings.restarting")
                      : translate("settings.restart_local_server")}
                  </button>
                </Show>
                <Show when={isLocalEngineRunning()}>
                  <button
                    type="button"
                    class={compactDangerActionClass}
                    onClick={props.stopHost}
                    disabled={props.busy}
                  >
                    <CircleAlert size={14} />
                    {translate("settings.stop_local_server")}
                  </button>
                </Show>
                <Show
                  when={
                    !isLocalEngineRunning() &&
                    props.auroworkServerStatus === "connected"
                  }
                >
                  <button
                    type="button"
                    class={compactOutlineActionClass}
                    onClick={props.stopHost}
                    disabled={props.busy}
                  >
                    {translate("settings.disconnect_server")}
                  </button>
                </Show>
              </div>
              <Show when={auroworkReconnectStatus()}>
                {(value) => <div class="text-xs text-dls-secondary">{value()}</div>}
              </Show>
              <Show when={auroworkReconnectError()}>
                {(value) => <div class="text-xs text-red-11">{value()}</div>}
              </Show>
              <Show when={auroworkRestartStatus()}>
                {(value) => <div class="text-xs text-dls-secondary">{value()}</div>}
              </Show>
              <Show when={auroworkRestartError()}>
                {(value) => <div class="text-xs text-red-11">{value()}</div>}
              </Show>
            </div>



          </div>
        </Match>

        <Match when={activeTab() === "updates"}>
          <div class="space-y-6">
            <div class={`${settingsPanelClass} space-y-3`}>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-medium text-dls-text">{translate("settings.updates_section_title")}</div>
                  <div class="text-xs text-dls-secondary">
                    {translate("settings.updates_section_description")}
                  </div>
                </div>
                <div class="text-xs text-dls-secondary font-mono">
                  {props.appVersion ? `v${props.appVersion}` : ""}
                </div>
              </div>

              <Show
                when={webDeployment()}
                fallback={
                  <Show
                    when={
                      props.updateEnv && props.updateEnv.supported === false
                    }
                    fallback={
                      <>
                        <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border">
                          <div class="space-y-0.5">
                            <div class="text-sm text-dls-text">
                              {translate("settings.background_checks_title")}
                            </div>
                            <div class="text-xs text-dls-secondary">
                              {translate("settings.background_checks_hint")}
                            </div>
                          </div>
                          <button
                            class={`min-w-[70px] px-4 py-1.5 rounded-full text-xs font-medium border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors ${
                              props.updateAutoCheck
                                ? "bg-dls-text/12 text-dls-text border-dls-border/30"
                                : "bg-dls-surface/70 text-dls-secondary border-dls-border/60 hover:text-dls-text hover:bg-dls-hover/70"
                            }`}
                            onClick={props.toggleUpdateAutoCheck}
                          >
                            {props.updateAutoCheck ? translate("settings.status_on") : translate("settings.status_off")}
                          </button>
                        </div>

                        <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border">
                          <div class="space-y-0.5">
                            <div class="text-sm text-dls-text">{translate("settings.auto_update_title")}</div>
                            <div class="text-xs text-dls-secondary">
                              {translate("settings.auto_update_hint")}
                            </div>
                          </div>
                          <button
                            class={`min-w-[70px] px-4 py-1.5 rounded-full text-xs font-medium border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors ${
                              props.updateAutoDownload
                                ? "bg-dls-text/12 text-dls-text border-dls-border/30"
                                : "bg-dls-surface/70 text-dls-secondary border-dls-border/60 hover:text-dls-text hover:bg-dls-hover/70"
                            }`}
                            onClick={props.toggleUpdateAutoDownload}
                          >
                            {props.updateAutoDownload ? translate("settings.status_on") : translate("settings.status_off")}
                          </button>
                        </div>

                        <div class="bg-dls-surface p-3 rounded-xl border border-dls-border space-y-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="space-y-0.5">
                              <div class="text-sm text-dls-text">
                                <Switch>
                                  <Match when={updateState() === "checking"}>
                                    {translate("settings.update_checking")}
                                  </Match>
                                  <Match when={updateState() === "available"}>
                                    {translate("settings.update_available")}{" v"}{updateVersion()}
                                  </Match>
                                  <Match when={updateState() === "downloading"}>
                                    {translate("settings.update_downloading")}
                                  </Match>
                                  <Match when={updateState() === "ready"}>
                                    {translate("settings.update_ready")}{" v"}{updateVersion()}
                                  </Match>
                                  <Match when={updateState() === "error"}>
                                    {translate("settings.update_error")}
                                  </Match>
                                  <Match when={true}>{translate("settings.update_uptodate")}</Match>
                                </Switch>
                              </div>
                              <Show
                                when={
                                  updateState() === "idle" &&
                                  updateLastCheckedAt()
                                }
                              >
                                <div class="text-xs text-dls-secondary">
                                  {translate("settings.last_checked")}{" "}
                                  {formatRelativeTime(
                                    updateLastCheckedAt() as number,
                                  )}
                                </div>
                              </Show>
                              <Show
                                when={
                                  updateState() === "available" && updateDate()
                                }
                              >
                                <div class="text-xs text-dls-secondary">
                                  {translate("settings.published")} {updateDate()}
                                </div>
                              </Show>
                              <Show when={updateState() === "downloading"}>
                                <div class="text-xs text-dls-secondary">
                                  {formatBytes(
                                    (updateDownloadedBytes() as number) ?? 0,
                                  )}
                                  <Show when={updateTotalBytes() != null}>
                                    {` / ${formatBytes(updateTotalBytes() as number)}`}
                                  </Show>
                                </div>
                              </Show>
                              <Show when={updateState() === "error"}>
                                <div class="text-xs text-red-11">
                                  {updateErrorMessage()}
                                </div>
                              </Show>
                            </div>

                            <div class="flex items-center gap-2">
                              <Button
                                variant="outline"
                                class="text-xs h-9 py-0 px-4 rounded-full border-dls-border/60 bg-dls-surface/70 hover:bg-dls-hover/70"
                                onClick={props.checkForUpdates}
                                disabled={
                                  props.busy ||
                                  updateState() === "checking" ||
                                  updateState() === "downloading"
                                }
                              >
                                {translate("settings.check_update")}
                              </Button>

                              <Show when={updateState() === "available"}>
                                <Button
                                  variant="secondary"
                                  class="text-xs h-9 py-0 px-4 rounded-full"
                                  onClick={props.downloadUpdate}
                                  disabled={
                                    props.busy || updateState() === "downloading"
                                  }
                                >
                                  {translate("settings.update_download_button")}
                                </Button>
                              </Show>

                              <Show when={updateState() === "ready"}>
                                <Button
                                  variant="secondary"
                                  class="text-xs h-9 py-0 px-4 rounded-full"
                                  onClick={props.installUpdateAndRestart}
                                  disabled={props.busy || props.anyActiveRuns}
                                  title={updateRestartBlockedMessage() ?? ""}
                                >
                                  {translate("settings.install_restart")}
                                </Button>
                              </Show>
                            </div>
                          </div>

                          <Show when={updateRestartBlockedMessage()}>
                            <div class="rounded-xl border border-amber-7/25 bg-amber-3/10 px-3 py-2 text-xs leading-relaxed text-amber-11">
                              {updateRestartBlockedMessage()}
                            </div>
                          </Show>
                        </div>

                        <Show
                          when={updateState() === "available" && updateNotes()}
                        >
                          <div class="rounded-xl bg-dls-surface/20 border border-dls-border p-3 text-xs text-dls-secondary whitespace-pre-wrap max-h-40 overflow-auto">
                            {updateNotes()}
                          </div>
                        </Show>
                      </>
                    }
                  >
                    <div class="rounded-xl bg-dls-surface/20 border border-dls-border p-3 text-sm text-dls-secondary">
                      {props.updateEnv?.reason ??
                        translate("settings.updates_not_supported_reason")}
                    </div>
                  </Show>
                }
              >
                <div class="rounded-xl bg-dls-surface/20 border border-dls-border p-3 text-sm text-dls-secondary">
                  {translate("settings.updates_desktop_only_reason")}
                </div>
              </Show>
            </div>
          </div>
        </Match>

        <Match when={activeTab() === "recovery"}>
          <div class="space-y-6">
            <div class={`${settingsPanelClass} space-y-4`}>
              <div>
                <div class="text-sm font-medium text-dls-text">
                  {translate("settings.migration_recovery_label")}
                </div>
                <div class="text-xs text-dls-secondary">
                  {translate("settings.migration_recovery_hint")}
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  class="text-xs h-8 py-0 px-3"
                  onClick={props.repairOpencodeMigration}
                  disabled={
                    webDeployment() ||
                    props.busy ||
                    props.migrationRepairBusy ||
                    !props.migrationRepairAvailable
                  }
                  title={
                    webDeployment()
                      ? translate("settings.migration_repair_requires_desktop")
                      : (props.migrationRepairUnavailableReason ?? "")
                  }
                >
                  {props.migrationRepairBusy
                    ? translate("settings.fixing_migration")
                    : translate("settings.fix_migration")}
                </Button>
              </div>

              <Show when={props.migrationRepairUnavailableReason}>
                {(reason) => (
                  <div class="text-xs text-amber-11">{reason()}</div>
                )}
              </Show>
              <Show when={props.migrationRepairBusy}>
                <div class="text-xs text-dls-secondary">
                  {translate("status.repairing_migration")}
                </div>
              </Show>
              <Show when={props.migrationRepairResult}>
                {(result) => (
                  <div
                    class={`rounded-xl border px-3 py-2 text-xs ${
                      result().ok
                        ? "border-green-7/30 bg-green-2/30 text-green-12"
                        : "border-red-7/30 bg-red-2/30 text-red-12"
                    }`}
                  >
                    {result().message}
                  </div>
                )}
              </Show>
            </div>
                <div class={`${settingsPanelClass} space-y-3`}>
                  <div class="text-sm font-medium text-dls-text">
                    {translate("settings.workspace_config_title")}
                  </div>
                  <div class="text-xs text-dls-secondary">
                    {translate("settings.workspace_config_description")}
                  </div>
                  <div class="text-[11px] text-dls-secondary font-mono break-all">
                    {workspaceConfigPath() || translate("settings.workspace_config_no_local")}
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      class="text-xs h-8 py-0 px-3"
                      onClick={revealWorkspaceConfig}
                      disabled={
                        !isTauriRuntime() ||
                        revealConfigBusy() ||
                        !workspaceConfigPath()
                      }
                      title={
                        !isTauriRuntime()
                          ? translate("settings.workspace_config_reveal_desktop")
                          : ""
                      }
                    >
                      <FolderOpen size={13} class="mr-1.5" />
                      {revealConfigBusy() ? translate("settings.workspace_config_reveal_busy") : translate("settings.workspace_config_reveal")}
                    </Button>
                    <Button
                      variant="danger"
                      class="text-xs h-8 py-0 px-3"
                      onClick={resetAppConfigDefaults}
                      disabled={resetConfigBusy() || props.anyActiveRuns}
                      title={
                        props.anyActiveRuns
                          ? translate("settings.workspace_config_stop_hint")
                          : ""
                      }
                    >
                      {resetConfigBusy()
                        ? translate("settings.workspace_config_resetting")
                        : translate("settings.workspace_config_reset")}
                    </Button>
                  </div>
                  <Show when={configActionStatus()}>
                    {(status) => (
                      <div class="text-xs text-dls-secondary">{status()}</div>
                    )}
                  </Show>
                </div>
                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-sm text-dls-text">{translate("settings.opencode_cache_title")}</div>
                    <div class="text-xs text-dls-secondary">
                      {translate("settings.opencode_cache_description_recovery")}
                    </div>
                    <Show when={props.cacheRepairResult}>
                      <div class="text-xs text-dls-secondary mt-2">
                        {props.cacheRepairResult}
                      </div>
                    </Show>
                  </div>
                  <Button
                    variant="secondary"
                    class="text-xs h-8 py-0 px-3 shrink-0"
                    onClick={props.repairOpencodeCache}
                    disabled={props.cacheRepairBusy || !isTauriRuntime()}
                    title={
                      isTauriRuntime()
                        ? ""
                        : translate("settings.cache_repair_desktop_hint")
                    }
                  >
                    {props.cacheRepairBusy ? translate("settings.cache_repairing") : translate("settings.cache_repair_button")}
                  </Button>
                </div>
                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-sm text-dls-text">
                      {translate("settings.docker_containers_title")}
                    </div>
                    <div class="text-xs text-dls-secondary">
                      {translate("settings.docker_containers_description")}
                    </div>
                    <Show when={props.dockerCleanupResult}>
                      <div class="text-xs text-dls-secondary mt-2">
                        {props.dockerCleanupResult}
                      </div>
                    </Show>
                  </div>
                  <Button
                    variant="danger"
                    class="text-xs h-8 py-0 px-3 shrink-0"
                    onClick={props.cleanupAuroworkDockerContainers}
                    disabled={
                      props.dockerCleanupBusy ||
                      props.anyActiveRuns ||
                      !isTauriRuntime()
                    }
                    title={
                      !isTauriRuntime()
                        ? translate("settings.docker_desktop_hint")
                        : props.anyActiveRuns
                          ? translate("settings.docker_stop_hint")
                          : ""
                    }
                  >
                    {props.dockerCleanupBusy
                      ? translate("settings.docker_removing")
                      : translate("settings.docker_delete")}
                  </Button>
                </div>
          </div>
        </Match>

        <Match when={activeTab() === "debug"}>
          <Show when={props.developerMode}>
            <section>
              <h3 class="text-sm font-medium text-dls-secondary uppercase tracking-wider mb-4">
                {translate("settings.debug_developer_title")}
              </h3>

              <div class="space-y-4">
                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_report_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_report_description")}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        class="text-xs h-8 py-0 px-3"
                        onClick={copyRuntimeDebugReport}
                      >
                        <Copy size={13} class="mr-1.5" />
                        {translate("settings.debug_copy_json")}
                      </Button>
                      <Button
                        variant="secondary"
                        class="text-xs h-8 py-0 px-3"
                        onClick={exportRuntimeDebugReport}
                      >
                        <Download size={13} class="mr-1.5" />
                        {translate("settings.debug_export")}
                      </Button>
                    </div>
                  </div>
                  <div class="grid gap-2 md:grid-cols-2 text-xs text-dls-secondary">
                    <div>{translate("settings.debug_desktop_app_label")}: {appVersionLabel()}</div>
                    <div>{translate("settings.debug_commit_label")}: {appCommitLabel()}</div>
                    <div>{translate("settings.debug_orchestrator_label")}: {orchestratorVersionLabel()}</div>
                    <div>{translate("settings.debug_opencode_label")}: {opencodeVersionLabel()}</div>
                    <div>{translate("settings.debug_aurowork_server_label")}: {auroworkServerVersionLabel()}</div>
                    <div>{translate("settings.debug_opencode_router_label")}: {opencodeRouterVersionLabel()}</div>
                  </div>
                  <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-64 overflow-auto bg-dls-surface border border-dls-border rounded-lg p-3">
                    {runtimeDebugReportJson()}
                  </pre>
                  <Show when={debugReportStatus()}>
                    {(status) => (
                      <div class="text-xs text-dls-secondary">{status()}</div>
                    )}
                  </Show>
                </div>

                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_sandbox_probe_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_sandbox_probe_description")}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      class="text-xs h-8 py-0 px-3"
                      onClick={runSandboxDebugProbe}
                      disabled={
                        !isTauriRuntime() ||
                        sandboxProbeBusy() ||
                        props.anyActiveRuns
                      }
                      title={
                        !isTauriRuntime()
                          ? translate("settings.debug_sandbox_probe_desktop_hint")
                          : props.anyActiveRuns
                            ? translate("settings.debug_sandbox_probe_stop_hint")
                            : ""
                      }
                    >
                      {sandboxProbeBusy()
                        ? translate("settings.debug_sandbox_probe_running")
                        : translate("settings.debug_sandbox_probe_run")}
                    </Button>
                  </div>
                  <Show when={sandboxProbeResult()}>
                    {(result) => (
                      <div class="text-xs text-dls-secondary space-y-1">
                        <div>
                          {translate("settings.sandbox_run_id")}:{" "}
                          <span class="font-mono">{result().runId}</span>
                        </div>
                        <div>{translate("settings.sandbox_result")}: {result().ready ? translate("settings.sandbox_ready") : translate("settings.sandbox_error")}</div>
                        <Show when={result().error}>
                          {(err) => <div class="text-red-11">{err()}</div>}
                        </Show>
                      </div>
                    )}
                  </Show>
                  <Show when={sandboxProbeStatus()}>
                    {(status) => (
                      <div class="text-xs text-dls-secondary">{status()}</div>
                    )}
                  </Show>
                  <div class="text-[11px] text-dls-secondary">
                    {translate("settings.debug_sandbox_probe_export_hint")}
                  </div>
                </div>




                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-3">
                  <div class="text-sm font-medium text-dls-text">{translate("settings.debug_startup_title")}</div>

                  <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border">
                    <div class="flex items-center gap-3">
                      <div
                        class={`p-2 rounded-lg ${
                          isLocalPreference()
                            ? "bg-indigo-7/10 text-indigo-11"
                            : "bg-green-7/10 text-green-11"
                        }`}
                      >
                        <Show
                          when={isLocalPreference()}
                          fallback={<Smartphone size={18} />}
                        >
                          <HardDrive size={18} />
                        </Show>
                      </div>
                      <span class="text-sm font-medium text-dls-text">
                        {startupLabel()}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      class="text-xs h-8 py-0 px-3"
                      onClick={props.stopHost}
                      disabled={props.busy}
                    >
                      {translate("settings.debug_switch")}
                    </Button>
                  </div>

                  <Button
                    variant="secondary"
                    class="w-full justify-between group"
                    onClick={props.onResetStartupPreference}
                  >
                    <span>{translate("settings.debug_reset_startup")}</span>
                    <RefreshCcw
                      size={14}
                      class="opacity-80 group-hover:rotate-180 transition-transform"
                    />
                  </Button>

                  <p class="text-xs text-dls-secondary">
                    {translate("settings.debug_reset_startup_hint")}
                  </p>
                </div>

                <Show
                  when={
                    isTauriRuntime() &&
                    (isLocalPreference() || props.developerMode)
                  }
                >
                  <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-4">
                    <div>
                      <div class="text-sm font-medium text-dls-text">{translate("settings.debug_engine_title")}</div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_engine_description")}
                      </div>
                    </div>

                    <Show when={!isLocalPreference()}>
                      <div class="text-[11px] text-amber-11 bg-amber-3/40 border border-amber-7/40 rounded-lg px-3 py-2">
                        {translate("settings.debug_engine_remote_hint")}
                      </div>
                    </Show>

                    <div class="space-y-3">
                      <div class="text-xs text-dls-secondary">{translate("settings.debug_engine_source")}</div>
                      <div
                        class={
                          props.developerMode
                            ? "grid grid-cols-3 gap-2"
                            : "grid grid-cols-2 gap-2"
                        }
                      >
                        <Button
                          variant={
                            props.engineSource === "sidecar"
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => props.setEngineSource("sidecar")}
                          disabled={props.busy}
                        >
                          {translate("settings.debug_engine_bundled")}
                        </Button>
                        <Button
                          variant={
                            props.engineSource === "path"
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => props.setEngineSource("path")}
                          disabled={props.busy}
                        >
                          {translate("settings.debug_engine_system")}
                        </Button>
                        <Show when={props.developerMode}>
                          <Button
                            variant={
                              props.engineSource === "custom"
                                ? "secondary"
                                : "outline"
                            }
                            onClick={() => props.setEngineSource("custom")}
                            disabled={props.busy}
                          >
                            {translate("settings.debug_engine_custom")}
                          </Button>
                        </Show>
                      </div>
                      <div class="text-[11px] text-dls-secondary">
                        {translate("settings.debug_engine_bundled_hint")}
                      </div>
                    </div>

                    <Show
                      when={
                        props.developerMode && props.engineSource === "custom"
                      }
                    >
                      <div class="space-y-2">
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_engine_custom_binary")}
                        </div>
                        <div class="flex items-center gap-2">
                          <div
                            class="flex-1 min-w-0 text-[11px] text-dls-secondary font-mono truncate bg-dls-surface p-3 rounded-xl border border-dls-border"
                            title={engineCustomBinPathLabel()}
                          >
                            {engineCustomBinPathLabel()}
                          </div>
                          <Button
                            variant="outline"
                            class="text-xs h-10 px-3 shrink-0"
                            onClick={handlePickEngineBinary}
                            disabled={props.busy}
                          >
                            {translate("settings.debug_engine_choose")}
                          </Button>
                          <Button
                            variant="outline"
                            class="text-xs h-10 px-3 shrink-0"
                            onClick={() => props.setEngineCustomBinPath("")}
                            disabled={
                              props.busy || !props.engineCustomBinPath.trim()
                            }
                            title={
                              !props.engineCustomBinPath.trim()
                                ? translate("settings.no_custom_path_set")
                                : translate("settings.debug_engine_clear")
                            }
                          >
                            {translate("settings.debug_engine_clear")}
                          </Button>
                        </div>
                        <div class="text-[11px] text-dls-secondary">
                          {translate("settings.debug_engine_custom_hint")}
                        </div>
                      </div>
                    </Show>

                    <Show when={props.developerMode}>
                      <div class="space-y-3">
                        <div class="text-xs text-dls-secondary">{translate("settings.debug_engine_runtime")}</div>
                        <div class="grid grid-cols-2 gap-2">
                          <Button
                            variant={
                              props.engineRuntime === "direct"
                                ? "secondary"
                                : "outline"
                            }
                            onClick={() => props.setEngineRuntime("direct")}
                            disabled={props.busy}
                          >
                            {translate("settings.debug_engine_direct")}
                          </Button>
                          <Button
                            variant={
                              props.engineRuntime === "aurowork-orchestrator"
                                ? "secondary"
                                : "outline"
                            }
                            onClick={() =>
                              props.setEngineRuntime("aurowork-orchestrator")
                            }
                            disabled={props.busy}
                          >
                            {translate("settings.debug_engine_orchestrator")}
                          </Button>
                        </div>
                        <div class="text-[11px] text-dls-secondary">
                          {translate("settings.debug_engine_applies_hint")}
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-4">
                  <div>
                    <div class="text-sm font-medium text-dls-text">
                      {translate("settings.debug_reset_recovery_title")}
                    </div>
                    <div class="text-xs text-dls-secondary">
                      {translate("settings.debug_reset_recovery_description")}
                    </div>
                  </div>

                  <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                    <div class="min-w-0">
                      <div class="text-sm text-dls-text">{translate("settings.debug_reset_onboarding")}</div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_reset_onboarding_hint")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      class="text-xs h-8 py-0 px-3 shrink-0"
                      onClick={() => props.openResetModal("onboarding")}
                      disabled={
                        props.busy ||
                        props.resetModalBusy ||
                        props.anyActiveRuns
                      }
                      title={
                        props.anyActiveRuns ? translate("settings.stop_runs_to_reset") : ""
                      }
                    >
                      {translate("settings.reset")}
                    </Button>
                  </div>

                  <div class="flex items-center justify-between bg-dls-surface p-3 rounded-xl border border-dls-border gap-3">
                    <div class="min-w-0">
                      <div class="text-sm text-dls-text">{translate("settings.debug_reset_app_data")}</div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_reset_app_data_hint")}
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      class="text-xs h-8 py-0 px-3 shrink-0"
                      onClick={() => props.openResetModal("all")}
                      disabled={
                        props.busy ||
                        props.resetModalBusy ||
                        props.anyActiveRuns
                      }
                      title={
                        props.anyActiveRuns ? translate("settings.stop_runs_to_reset") : ""
                      }
                    >
                      {translate("settings.reset")}
                    </Button>
                  </div>

                  <div class="text-xs text-dls-secondary">
                    {translate("settings.debug_reset_requires_hint")}
                  </div>
                </div>

                <div class="bg-dls-hover/30 border border-dls-border/50 rounded-2xl p-5 space-y-4">
                  <div>
                    <div class="text-sm font-medium text-dls-text">{translate("settings.debug_devtools_title")}</div>
                    <div class="text-xs text-dls-secondary">
                      {translate("settings.debug_devtools_description")}
                    </div>
                  </div>

                  <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                    <div>
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_service_restarts_title")}
                      </div>
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_service_restarts_description")}
                      </div>
                    </div>
                    <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <Button
                        variant="secondary"
                        onClick={handleRestartLocalServer}
                        disabled={
                          props.busy ||
                          auroworkRestartBusy() ||
                          !isTauriRuntime()
                        }
                        class="text-xs px-3 py-1.5 justify-center"
                      >
                        <RefreshCcw
                          class={`w-3.5 h-3.5 mr-1.5 ${auroworkRestartBusy() ? "animate-spin" : ""}`}
                        />
                        {auroworkRestartBusy()
                          ? translate("settings.restarting")
                          : translate("settings.debug_restart_orchestrator")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleOpenCodeRestart}
                        disabled={opencodeRestarting() || !isTauriRuntime()}
                        class="text-xs px-3 py-1.5 justify-center"
                      >
                        <RefreshCcw
                          class={`w-3.5 h-3.5 mr-1.5 ${opencodeRestarting() ? "animate-spin" : ""}`}
                        />
                        {opencodeRestarting()
                          ? translate("settings.restarting")
                          : translate("settings.debug_restart_opencode")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleAuroworkServerRestart}
                        disabled={
                          auroworkServerRestarting() || !isTauriRuntime()
                        }
                        class="text-xs px-3 py-1.5 justify-center"
                      >
                        <RefreshCcw
                          class={`w-3.5 h-3.5 mr-1.5 ${auroworkServerRestarting() ? "animate-spin" : ""}`}
                        />
                        {auroworkServerRestarting()
                          ? translate("settings.restarting")
                          : translate("settings.debug_restart_aurowork_server")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleOpenCodeRouterRestart}
                        disabled={
                          opencodeRouterRestarting() || !isTauriRuntime()
                        }
                        class="text-xs px-3 py-1.5 justify-center"
                      >
                        <RefreshCcw
                          class={`w-3.5 h-3.5 mr-1.5 ${opencodeRouterRestarting() ? "animate-spin" : ""}`}
                        />
                        {opencodeRouterRestarting()
                          ? translate("settings.restarting")
                          : translate("settings.debug_restart_opencode_router")}
                      </Button>
                    </div>
                    <Show when={auroworkRestartStatus()}>
                      <div class="text-xs text-green-11 bg-green-3/50 border border-green-6 rounded-lg p-2">
                        {auroworkRestartStatus()}
                      </div>
                    </Show>
                    <Show
                      when={
                        auroworkRestartError() ||
                        opencodeRestartError() ||
                        auroworkServerRestartError() ||
                        opencodeRouterRestartError()
                      }
                    >
                      <div class="text-xs text-red-11 bg-red-3/50 border border-red-6 rounded-lg p-2">
                        {auroworkRestartError() ||
                          opencodeRestartError() ||
                          auroworkServerRestartError() ||
                          opencodeRouterRestartError()}
                      </div>
                    </Show>
                  </div>

                  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div>
                        <div class="text-sm font-medium text-dls-text">
                          {translate("settings.debug_versions_title")}
                        </div>
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_versions_description")}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_desktop_app_label")}: {appVersionLabel()}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_commit_label")}: {appCommitLabel()}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_orchestrator_label")}: {orchestratorVersionLabel()}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_opencode_label")}: {opencodeVersionLabel()}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_aurowork_server_label")}: {auroworkServerVersionLabel()}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.debug_opencode_router_label")}: {opencodeRouterVersionLabel()}
                        </div>
                      </div>
                    </div>

                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_opencode_engine_card_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_opencode_engine_card_description")}
                          </div>
                        </div>
                        <div
                          class={`text-xs px-2 py-1 rounded-full border ${engineStatusStyle()}`}
                        >
                          {engineStatusLabel()}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.engineInfo?.baseUrl ?? translate("settings.base_url_unavailable")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.engineInfo?.projectDir ??
                            translate("settings.no_project_directory")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_pid")}: {props.engineInfo?.pid ?? "—"}
                        </div>
                      </div>
                      <div class="grid gap-2">
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stdout")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {engineStdout()}
                          </pre>
                        </div>
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stderr")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {engineStderr()}
                          </pre>
                        </div>
                      </div>
                    </div>

                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_orchestrator_card_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_orchestrator_card_description")}
                          </div>
                        </div>
                        <div
                          class={`text-xs px-2 py-1 rounded-full border ${orchestratorStatusStyle()}`}
                        >
                          {orchestratorStatusLabel()}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.orchestratorStatus?.dataDir ??
                            translate("settings.data_directory_unavailable")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_daemon")}:{" "}
                          {props.orchestratorStatus?.daemon?.baseUrl ?? "—"}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_opencode")}:{" "}
                          {props.orchestratorStatus?.opencode?.baseUrl ?? "—"}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_version")}: {props.orchestratorStatus?.cliVersion ?? "—"}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_sidecar")}: {orchestratorSidecarSummary()}
                        </div>
                        <div
                          class="text-[11px] text-dls-secondary font-mono truncate"
                          title={orchestratorBinaryPath()}
                        >
                          {translate("settings.label_opencode_binary")}:{" "}
                          {formatOrchestratorBinary(
                            props.orchestratorStatus?.binaries?.opencode ??
                              null,
                          )}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_runtime_workspace")}:{" "}
                          {props.orchestratorStatus?.activeId ?? "—"}
                        </div>
                      </div>
                      <Show when={props.orchestratorStatus?.lastError}>
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_error")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {props.orchestratorStatus?.lastError}
                          </pre>
                        </div>
                      </Show>
                    </div>

                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_opencode_sdk_card_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_opencode_sdk_card_description")}
                          </div>
                        </div>
                        <div
                          class={`text-xs px-2 py-1 rounded-full border ${opencodeConnectStatusStyle()}`}
                        >
                          {opencodeConnectStatusLabel()}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.opencodeConnectStatus?.baseUrl ??
                            translate("settings.base_url_unavailable")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.opencodeConnectStatus?.directory ??
                            translate("settings.no_project_directory")}
                        </div>
                        <div class="text-[11px] text-dls-secondary">
                          {translate("settings.sdk_last_attempt")}: {opencodeConnectTimestamp() ?? "—"}
                        </div>
                        <Show when={props.opencodeConnectStatus?.reason}>
                          <div class="text-[11px] text-dls-secondary">
                            {translate("settings.sdk_reason")}: {props.opencodeConnectStatus?.reason}
                          </div>
                        </Show>
                        <Show when={props.opencodeConnectStatus?.metrics}>
                          {(metrics) => (
                            <div class="pt-1 space-y-1 text-[11px] text-dls-secondary">
                              <Show when={metrics().healthyMs != null}>
                                <div>
                                  {translate("settings.sdk_healthy")}:{" "}
                                  {Math.round(metrics().healthyMs as number)}ms
                                </div>
                              </Show>
                              <Show when={metrics().loadSessionsMs != null}>
                                <div>
                                  {translate("settings.sdk_load_sessions")}:{" "}
                                  {Math.round(
                                    metrics().loadSessionsMs as number,
                                  )}
                                  ms
                                </div>
                              </Show>
                              <Show
                                when={metrics().pendingPermissionsMs != null}
                              >
                                <div>
                                  {translate("settings.sdk_pending_permissions")}:{" "}
                                  {Math.round(
                                    metrics().pendingPermissionsMs as number,
                                  )}
                                  ms
                                </div>
                              </Show>
                              <Show when={metrics().providersMs != null}>
                                <div>
                                  {translate("settings.sdk_providers")}:{" "}
                                  {Math.round(metrics().providersMs as number)}
                                  ms
                                </div>
                              </Show>
                              <Show when={metrics().totalMs != null}>
                                <div>
                                  {translate("settings.sdk_total")}:{" "}
                                  {Math.round(metrics().totalMs as number)}ms
                                </div>
                              </Show>
                            </div>
                          )}
                        </Show>
                      </div>
                      <Show when={props.opencodeConnectStatus?.error}>
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_error")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {props.opencodeConnectStatus?.error}
                          </pre>
                        </div>
                      </Show>
                    </div>

                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_aurowork_server_card_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_aurowork_server_card_description")}
                          </div>
                        </div>
                        <div
                          class={`text-xs px-2 py-1 rounded-full border ${auroworkStatusStyle()}`}
                        >
                          {auroworkStatusLabel()}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {(props.auroworkServerHostInfo?.baseUrl ??
                            props.auroworkServerUrl) ||
                            translate("settings.base_url_unavailable")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_pid")}: {props.auroworkServerHostInfo?.pid ?? "—"}
                        </div>
                      </div>
                      <div class="grid gap-2">
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stdout")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {auroworkStdout()}
                          </pre>
                        </div>
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stderr")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {auroworkStderr()}
                          </pre>
                        </div>
                      </div>
                    </div>

                    <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_opencode_router_card_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_opencode_router_card_description")}
                          </div>
                        </div>
                        <div
                          class={`text-xs px-2 py-1 rounded-full border ${opencodeRouterStatusStyle()}`}
                        >
                          {opencodeRouterStatusLabel()}
                        </div>
                      </div>
                      <div class="space-y-1">
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.opencodeRouterInfo?.opencodeUrl?.trim() ||
                            translate("settings.opencode_url_unavailable")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {props.opencodeRouterInfo?.workspacePath?.trim() ||
                            translate("settings.no_worker_directory")}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_health_port")}:{" "}
                          {props.opencodeRouterInfo?.healthPort ?? "—"}
                        </div>
                        <div class="text-[11px] text-dls-secondary font-mono truncate">
                          {translate("settings.label_pid")}: {props.opencodeRouterInfo?.pid ?? "—"}
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          onClick={handleOpenCodeRouterRestart}
                          disabled={
                            opencodeRouterRestarting() || !isTauriRuntime()
                          }
                          class="text-xs px-3 py-1.5"
                        >
                          <RefreshCcw
                            class={`w-3.5 h-3.5 mr-1.5 ${opencodeRouterRestarting() ? "animate-spin" : ""}`}
                          />
                          {opencodeRouterRestarting()
                            ? translate("settings.restarting")
                            : translate("settings.debug_restart")}
                        </Button>
                        <Show when={props.opencodeRouterInfo?.running}>
                          <Button
                            variant="ghost"
                            onClick={handleOpenCodeRouterStop}
                            disabled={opencodeRouterRestarting()}
                            class="text-xs px-3 py-1.5"
                          >
                            {translate("settings.debug_stop")}
                          </Button>
                        </Show>
                      </div>
                      <Show when={opencodeRouterRestartError()}>
                        <div class="text-xs text-red-11 bg-red-3/50 border border-red-6 rounded-lg p-2">
                          {opencodeRouterRestartError()}
                        </div>
                      </Show>
                      <div class="grid gap-2">
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stdout")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {opencodeRouterStdout()}
                          </pre>
                        </div>
                        <div>
                          <div class="text-[11px] text-dls-secondary mb-1">
                            {translate("settings.last_stderr")}
                          </div>
                          <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-24 overflow-auto bg-dls-hover/50 border border-dls-border rounded-lg p-2">
                            {opencodeRouterStderr()}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_diagnostics_title")}
                      </div>
                      <div class="text-[11px] text-dls-secondary font-mono truncate">
                        {props.auroworkServerDiagnostics?.version ?? "—"}
                      </div>
                    </div>
                    <Show
                      when={props.auroworkServerDiagnostics}
                      fallback={
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_diagnostics_unavailable")}
                        </div>
                      }
                    >
                      {(diag) => (
                        <div class="grid md:grid-cols-2 gap-2 text-xs text-dls-secondary">
                          <div>{translate("settings.diag_started")}: {formatUptime(diag().uptimeMs)}</div>
                          <div>
                            {translate("settings.diag_read_only")}: {diag().readOnly ? "true" : "false"}
                          </div>
                          <div>
                            {translate("settings.diag_approval")}: {diag().approval.mode} (
                            {diag().approval.timeoutMs}ms)
                          </div>
                          <div>{translate("settings.diag_workspaces")}: {diag().workspaceCount}</div>
                          <div>
                            {translate("settings.diag_selected_workspace")}: {diag().selectedWorkspaceId ?? "—"}
                          </div>
                          <div>
                            {translate("settings.diag_runtime_workspace")}: {diag().activeWorkspaceId ?? "—"}
                          </div>
                          <div>
                            {translate("settings.diag_config_path")}: {diag().server.configPath ?? "default"}
                          </div>
                          <div>{translate("settings.diag_token_source")}: {diag().tokenSource.client}</div>
                          <div>
                            {translate("settings.diag_host_token_source")}: {diag().tokenSource.host}
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>

                  <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_capabilities_title")}
                      </div>
                      <div class="text-[11px] text-dls-secondary font-mono truncate">
                        {props.runtimeWorkspaceId
                          ? `Worker ${props.runtimeWorkspaceId}`
                          : translate("settings.worker_unresolved")}
                      </div>
                    </div>
                    <Show
                      when={props.auroworkServerCapabilities}
                      fallback={
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_capabilities_unavailable")}
                        </div>
                      }
                    >
                      {(caps) => (
                        <div class="grid md:grid-cols-2 gap-2 text-xs text-dls-secondary">
                          <div>{translate("settings.cap_skills")}: {formatCapability(caps().skills)}</div>
                          <div>{translate("settings.cap_plugins")}: {formatCapability(caps().plugins)}</div>
                          <div>{translate("settings.cap_mcp")}: {formatCapability(caps().mcp)}</div>
                          <div>
                            {translate("settings.cap_commands")}: {formatCapability(caps().commands)}
                          </div>
                          <div>{translate("settings.cap_config")}: {formatCapability(caps().config)}</div>
                          <div>
                            {translate("settings.cap_proxy")}:{" "}
                            {caps().proxy?.opencodeRouter
                              ? translate("settings.cap_enabled")
                              : translate("settings.cap_disabled")}
                          </div>
                          <div>
                            {translate("settings.cap_browser_tools")}:{" "}
                            {(() => {
                              const browser = caps().toolProviders?.browser;
                              if (!browser?.enabled) return translate("settings.cap_disabled");
                              return `${browser.mode} · ${browser.placement}`;
                            })()}
                          </div>
                          <div>
                            {translate("settings.cap_file_tools")}:{" "}
                            {(() => {
                              const files = caps().toolProviders?.files;
                              if (!files) return translate("settings.capability_unavailable");
                              const parts = [
                                files.injection ? translate("settings.cap_inbox_on") : translate("settings.cap_inbox_off"),
                                files.outbox ? translate("settings.cap_outbox_on") : translate("settings.cap_outbox_off"),
                              ];
                              return parts.join(" · ");
                            })()}
                          </div>
                          <div>
                            {translate("settings.cap_sandbox")}:{" "}
                            {(() => {
                              const sandbox = caps().sandbox;
                              return sandbox
                                ? `${sandbox.backend} (${sandbox.enabled ? translate("settings.cap_on") : translate("settings.cap_off")})`
                                : translate("settings.capability_unavailable");
                            })()}
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>

                  <div class="grid md:grid-cols-2 gap-4">
                    <div class="bg-dls-surface border border-dls-border rounded-xl p-4">
                      <div class="text-xs text-dls-secondary mb-2">
                        {translate("settings.debug_pending_permissions")}
                      </div>
                      <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-64 overflow-auto">
                        {props.safeStringify(props.pendingPermissions)}
                      </pre>
                    </div>
                    <div class="bg-dls-surface border border-dls-border rounded-xl p-4">
                      <div class="text-xs text-dls-secondary mb-2">{translate("settings.debug_recent_events")}</div>
                      <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-64 overflow-auto">
                        {props.safeStringify(props.events)}
                      </pre>
                    </div>
                  </div>

                  <div class="bg-dls-surface border border-dls-border rounded-xl p-4">
                    <div class="flex items-center justify-between gap-3 mb-2">
                      <div class="text-xs text-dls-secondary">
                        {translate("settings.debug_workspace_events")}
                      </div>
                      <Button
                        variant="outline"
                        class="text-xs h-7 py-0 px-2 shrink-0"
                        onClick={props.clearWorkspaceDebugEvents}
                        disabled={props.busy}
                      >
                        {translate("settings.debug_clear")}
                      </Button>
                    </div>
                    <pre class="text-xs text-dls-text whitespace-pre-wrap break-words max-h-64 overflow-auto">
                      {props.safeStringify(props.workspaceDebugEvents)}
                    </pre>
                  </div>

                  <div class="bg-dls-surface p-4 rounded-xl border border-dls-border space-y-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-sm font-medium text-dls-text">
                        {translate("settings.debug_audit_log")}
                      </div>
                      <div
                        class={`text-xs px-2 py-1 rounded-full border ${auroworkAuditStatusStyle()}`}
                      >
                        {auroworkAuditStatusLabel()}
                      </div>
                    </div>
                    <Show when={props.auroworkAuditError}>
                      <div class="text-xs text-red-11">
                        {props.auroworkAuditError}
                      </div>
                    </Show>
                    <Show
                      when={props.auroworkAuditEntries.length > 0}
                      fallback={
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_no_audit")}
                        </div>
                      }
                    >
                      <div class="divide-y divide-dls-border/50">
                        <For each={props.auroworkAuditEntries}>
                          {(entry) => (
                            <div class="flex items-start justify-between gap-4 py-2">
                              <div class="min-w-0">
                                <div class="text-sm text-dls-text truncate">
                                  {entry.summary}
                                </div>
                                <div class="text-[11px] text-dls-secondary truncate">
                                  {entry.action} · {entry.target} ·{" "}
                                  {formatActor(entry)}
                                </div>
                              </div>
                              <div class="text-[11px] text-dls-secondary whitespace-nowrap">
                                {entry.timestamp
                                  ? formatRelativeTime(entry.timestamp)
                                  : "—"}
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <Show when={isTauriRuntime()}>
                    <div class="rounded-2xl border border-red-7/30 bg-red-3/10 p-5 space-y-4">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-dls-text">
                            {translate("settings.debug_nuke_title")}
                          </div>
                          <div class="text-xs text-dls-secondary">
                            {translate("settings.debug_nuke_description")} {opencodeDevModeEnabled()
                              ? translate("settings.debug_nuke_dev_hint")
                              : translate("settings.debug_nuke_prod_hint")}
                          </div>
                        </div>
                        <div
                          class={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${opencodeDevModeEnabled()
                            ? "border-blue-7/35 bg-blue-3/25 text-blue-11"
                            : "border-dls-border bg-dls-hover text-dls-secondary"}`}
                        >
                          {opencodeDevModeEnabled()
                            ? translate("settings.debug_nuke_dev_mode_label")
                            : translate("settings.debug_nuke_prod_mode_label")}
                        </div>
                      </div>

                      <div class="text-[11px] text-dls-secondary">
                        {translate("settings.debug_nuke_quit_hint")}
                      </div>

                      <div class="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          class={compactDangerActionClass}
                          onClick={() =>
                            void handleNukeAuroworkAndOpencodeConfig()
                          }
                          disabled={props.busy || nukeConfigBusy()}
                        >
                          <CircleAlert size={14} />
                          {nukeConfigBusy()
                            ? translate("settings.debug_nuke_busy")
                            : translate("settings.debug_nuke_action")}
                        </button>
                        <div class="text-xs text-dls-secondary">
                          {translate("settings.debug_nuke_use_hint")}
                        </div>
                      </div>

                      <Show when={nukeConfigStatus()}>
                        {(value) => (
                          <div class="text-xs text-red-11">{value()}</div>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </section>
          </Show>
        </Match>
      </Switch>
      </div>
    </section>
  );
}
