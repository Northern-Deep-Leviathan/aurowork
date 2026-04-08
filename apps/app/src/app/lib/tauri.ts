import { invoke } from "@tauri-apps/api/core";
import { validateMcpServerName } from "../mcp";

export type EngineInfo = {
  running: boolean;
  runtime: "direct" | "aurowork-orchestrator";
  baseUrl: string | null;
  projectDir: string | null;
  hostname: string | null;
  port: number | null;
  opencodeUsername: string | null;
  opencodePassword: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type AuroworkServerInfo = {
  running: boolean;
  remoteAccessEnabled: boolean;
  host: string | null;
  port: number | null;
  baseUrl: string | null;
  connectUrl: string | null;
  mdnsUrl: string | null;
  lanUrl: string | null;
  clientToken: string | null;
  ownerToken: string | null;
  hostToken: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type OrchestratorDaemonState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type OrchestratorOpencodeState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type OrchestratorBinaryInfo = {
  path: string;
  source: string;
  expectedVersion?: string | null;
  actualVersion?: string | null;
};

export type OrchestratorBinaryState = {
  opencode?: OrchestratorBinaryInfo | null;
};

export type OrchestratorSidecarInfo = {
  dir?: string | null;
  baseUrl?: string | null;
  manifestUrl?: string | null;
  target?: string | null;
  source?: string | null;
  opencodeSource?: string | null;
  allowExternal?: boolean | null;
};

export type OrchestratorWorkspace = {
  id: string;
  name: string;
  path: string;
  workspaceType: string;
  baseUrl?: string | null;
  directory?: string | null;
  createdAt?: number | null;
  lastUsedAt?: number | null;
};

export type OrchestratorStatus = {
  running: boolean;
  dataDir: string;
  daemon: OrchestratorDaemonState | null;
  opencode: OrchestratorOpencodeState | null;
  cliVersion?: string | null;
  sidecar?: OrchestratorSidecarInfo | null;
  binaries?: OrchestratorBinaryState | null;
  activeId: string | null;
  workspaceCount: number;
  workspaces: OrchestratorWorkspace[];
  lastError: string | null;
};

export type EngineDoctorResult = {
  found: boolean;
  inPath: boolean;
  resolvedPath: string | null;
  version: string | null;
  supportsServe: boolean;
  notes: string[];
  serveHelpStatus: number | null;
  serveHelpStdout: string | null;
  serveHelpStderr: string | null;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  preset: string;
  workspaceType: "local" | "remote";
  remoteType?: "aurowork" | "opencode" | null;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  auroworkHostUrl?: string | null;
  auroworkToken?: string | null;
  auroworkClientToken?: string | null;
  auroworkHostToken?: string | null;
  auroworkWorkspaceId?: string | null;
  auroworkWorkspaceName?: string | null;

  // Sandbox lifecycle metadata (desktop-managed)
  sandboxBackend?: "docker" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type WorkspaceList = {
  // UI-selected workspace persisted by the desktop shell.
  selectedId?: string;
  // Runtime/watch target currently followed by the desktop host.
  watchedId?: string | null;
  // Legacy desktop payloads used activeId for the UI-selected workspace.
  activeId?: string | null;
  workspaces: WorkspaceInfo[];
};

export function resolveWorkspaceListSelectedId(
  list: Pick<WorkspaceList, "selectedId" | "activeId"> | null | undefined,
): string {
  return list?.selectedId?.trim() || list?.activeId?.trim() || "";
}

export type WorkspaceExportSummary = {
  outputPath: string;
  included: number;
  excluded: string[];
};

export async function engineStart(
  projectDir: string,
  options?: {
    preferSidecar?: boolean;
    runtime?: "direct" | "aurowork-orchestrator";
    workspacePaths?: string[];
    opencodeBinPath?: string | null;
    opencodeEnableExa?: boolean;
    auroworkRemoteAccess?: boolean;
  },
): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_start", {
    projectDir,
    preferSidecar: options?.preferSidecar ?? false,
    opencodeBinPath: options?.opencodeBinPath ?? null,
    opencodeEnableExa: options?.opencodeEnableExa ?? null,
    auroworkRemoteAccess: options?.auroworkRemoteAccess ?? null,
    runtime: options?.runtime ?? null,
    workspacePaths: options?.workspacePaths ?? null,
  });
}

export async function workspaceBootstrap(): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_bootstrap");
}

export async function workspaceSetSelected(workspaceId: string): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_set_selected", { workspaceId });
}

export async function workspaceSetRuntimeActive(workspaceId: string | null): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_set_runtime_active", { workspaceId: workspaceId ?? "" });
}

export async function workspaceCheckFolder(folderPath: string): Promise<{
  writable: boolean;
  exists: boolean;
  error: string | null;
}> {
  return invoke<{ writable: boolean; exists: boolean; error: string | null }>("workspace_check_folder", {
    folderPath,
  });
}

export async function workspaceCreate(input: {
  folderPath: string;
  name: string;
  preset: string;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_create", {
    folderPath: input.folderPath,
    name: input.name,
    preset: input.preset,
  });
}

export async function workspaceRegister(input: {
  folderPath: string;
  name: string;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_register", {
    folderPath: input.folderPath,
    name: input.name,
  });
}

export async function workspaceCreateRemote(input: {
  baseUrl: string;
  directory?: string | null;
  displayName?: string | null;
  remoteType?: "aurowork" | "opencode" | null;
  auroworkHostUrl?: string | null;
  auroworkToken?: string | null;
  auroworkClientToken?: string | null;
  auroworkHostToken?: string | null;
  auroworkWorkspaceId?: string | null;
  auroworkWorkspaceName?: string | null;

  // Sandbox lifecycle metadata (desktop-managed)
  sandboxBackend?: "docker" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_create_remote", {
    baseUrl: input.baseUrl,
    directory: input.directory ?? null,
    displayName: input.displayName ?? null,
    remoteType: input.remoteType ?? null,
    auroworkHostUrl: input.auroworkHostUrl ?? null,
    auroworkToken: input.auroworkToken ?? null,
    auroworkClientToken: input.auroworkClientToken ?? null,
    auroworkHostToken: input.auroworkHostToken ?? null,
    auroworkWorkspaceId: input.auroworkWorkspaceId ?? null,
    auroworkWorkspaceName: input.auroworkWorkspaceName ?? null,
    sandboxBackend: input.sandboxBackend ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    sandboxContainerName: input.sandboxContainerName ?? null,
  });
}

export async function workspaceUpdateRemote(input: {
  workspaceId: string;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  remoteType?: "aurowork" | "opencode" | null;
  auroworkHostUrl?: string | null;
  auroworkToken?: string | null;
  auroworkClientToken?: string | null;
  auroworkHostToken?: string | null;
  auroworkWorkspaceId?: string | null;
  auroworkWorkspaceName?: string | null;

  // Sandbox lifecycle metadata (desktop-managed)
  sandboxBackend?: "docker" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_update_remote", {
    workspaceId: input.workspaceId,
    baseUrl: input.baseUrl ?? null,
    directory: input.directory ?? null,
    displayName: input.displayName ?? null,
    remoteType: input.remoteType ?? null,
    auroworkHostUrl: input.auroworkHostUrl ?? null,
    auroworkToken: input.auroworkToken ?? null,
    auroworkClientToken: input.auroworkClientToken ?? null,
    auroworkHostToken: input.auroworkHostToken ?? null,
    auroworkWorkspaceId: input.auroworkWorkspaceId ?? null,
    auroworkWorkspaceName: input.auroworkWorkspaceName ?? null,
    sandboxBackend: input.sandboxBackend ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    sandboxContainerName: input.sandboxContainerName ?? null,
  });
}

export async function workspaceUpdateDisplayName(input: {
  workspaceId: string;
  displayName?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_update_display_name", {
    workspaceId: input.workspaceId,
    displayName: input.displayName ?? null,
  });
}

export async function workspaceForget(workspaceId: string): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_forget", { workspaceId });
}

export async function workspaceAddAuthorizedRoot(input: {
  workspacePath: string;
  folderPath: string;
}): Promise<ExecResult> {
  return invoke<ExecResult>("workspace_add_authorized_root", {
    workspacePath: input.workspacePath,
    folderPath: input.folderPath,
  });
}

export async function workspaceExportConfig(input: {
  workspaceId: string;
  outputPath: string;
}): Promise<WorkspaceExportSummary> {
  return invoke<WorkspaceExportSummary>("workspace_export_config", {
    workspaceId: input.workspaceId,
    outputPath: input.outputPath,
  });
}

export async function workspaceImportConfig(input: {
  archivePath: string;
  targetDir: string;
  name?: string | null;
}): Promise<WorkspaceList> {
  return invoke<WorkspaceList>("workspace_import_config", {
    archivePath: input.archivePath,
    targetDir: input.targetDir,
    name: input.name ?? null,
  });
}

export type OpencodeCommandDraft = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};

export type WorkspaceAuroworkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

export async function workspaceAuroworkRead(input: {
  workspacePath: string;
}): Promise<WorkspaceAuroworkConfig> {
  return invoke<WorkspaceAuroworkConfig>("workspace_aurowork_read", {
    workspacePath: input.workspacePath,
  });
}

export async function workspaceAuroworkWrite(input: {
  workspacePath: string;
  config: WorkspaceAuroworkConfig;
}): Promise<ExecResult> {
  return invoke<ExecResult>("workspace_aurowork_write", {
    workspacePath: input.workspacePath,
    config: input.config,
  });
}

export async function opencodeCommandList(input: {
  scope: "workspace" | "global";
  projectDir: string;
}): Promise<string[]> {
  return invoke<string[]>("opencode_command_list", {
    scope: input.scope,
    projectDir: input.projectDir,
  });
}

export async function opencodeCommandWrite(input: {
  scope: "workspace" | "global";
  projectDir: string;
  command: OpencodeCommandDraft;
}): Promise<ExecResult> {
  return invoke<ExecResult>("opencode_command_write", {
    scope: input.scope,
    projectDir: input.projectDir,
    command: input.command,
  });
}

export async function opencodeCommandDelete(input: {
  scope: "workspace" | "global";
  projectDir: string;
  name: string;
}): Promise<ExecResult> {
  return invoke<ExecResult>("opencode_command_delete", {
    scope: input.scope,
    projectDir: input.projectDir,
    name: input.name,
  });
}

export async function engineStop(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_stop");
}

export async function engineRestart(options?: {
  opencodeEnableExa?: boolean;
  auroworkRemoteAccess?: boolean;
}): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_restart", {
    opencodeEnableExa: options?.opencodeEnableExa ?? null,
    auroworkRemoteAccess: options?.auroworkRemoteAccess ?? null,
  });
}

export async function orchestratorStatus(): Promise<OrchestratorStatus> {
  return invoke<OrchestratorStatus>("orchestrator_status");
}

export async function orchestratorWorkspaceActivate(input: {
  workspacePath: string;
  name?: string | null;
}): Promise<OrchestratorWorkspace> {
  return invoke<OrchestratorWorkspace>("orchestrator_workspace_activate", {
    workspacePath: input.workspacePath,
    name: input.name ?? null,
  });
}

export async function orchestratorInstanceDispose(workspacePath: string): Promise<boolean> {
  return invoke<boolean>("orchestrator_instance_dispose", { workspacePath });
}

export type AppBuildInfo = {
  version: string;
  gitSha?: string | null;
  buildEpoch?: string | null;
  auroworkDevMode?: boolean;
};

export async function appBuildInfo(): Promise<AppBuildInfo> {
  return invoke<AppBuildInfo>("app_build_info");
}

export async function nukeAuroworkAndOpencodeConfigAndExit(): Promise<void> {
  return invoke<void>("nuke_aurowork_and_opencode_config_and_exit");
}

export type OrchestratorDetachedHost = {
  auroworkUrl: string;
  token: string;
  ownerToken?: string | null;
  hostToken: string;
  port: number;
  sandboxBackend?: "docker" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export async function orchestratorStartDetached(input: {
  workspacePath: string;
  sandboxBackend?: "none" | "docker" | null;
  runId?: string | null;
  auroworkToken?: string | null;
  auroworkHostToken?: string | null;
}): Promise<OrchestratorDetachedHost> {
  return invoke<OrchestratorDetachedHost>("orchestrator_start_detached", {
    workspacePath: input.workspacePath,
    sandboxBackend: input.sandboxBackend ?? null,
    runId: input.runId ?? null,
    auroworkToken: input.auroworkToken ?? null,
    auroworkHostToken: input.auroworkHostToken ?? null,
  });
}

export async function auroworkServerInfo(): Promise<AuroworkServerInfo> {
  return invoke<AuroworkServerInfo>("aurowork_server_info");
}

export async function auroworkServerRestart(options?: {
  remoteAccessEnabled?: boolean;
}): Promise<AuroworkServerInfo> {
  return invoke<AuroworkServerInfo>("aurowork_server_restart", {
    remoteAccessEnabled: options?.remoteAccessEnabled ?? null,
  });
}

export async function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}

export async function engineDoctor(options?: {
  preferSidecar?: boolean;
  opencodeBinPath?: string | null;
}): Promise<EngineDoctorResult> {
  return invoke<EngineDoctorResult>("engine_doctor", {
    preferSidecar: options?.preferSidecar ?? false,
    opencodeBinPath: options?.opencodeBinPath ?? null,
  });
}

export async function pickDirectory(options?: {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
}): Promise<string | string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    title: options?.title,
    defaultPath: options?.defaultPath,
    directory: true,
    multiple: options?.multiple,
  });
}

export async function pickFile(options?: {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    title: options?.title,
    defaultPath: options?.defaultPath,
    directory: false,
    multiple: options?.multiple,
    filters: options?.filters,
  });
}

export async function saveFile(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    title: options?.title,
    defaultPath: options?.defaultPath,
    filters: options?.filters,
  });
}

export type ExecResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

export async function engineInstall(): Promise<ExecResult> {
  return invoke<ExecResult>("engine_install");
}

export async function opkgInstall(projectDir: string, pkg: string): Promise<ExecResult> {
  return invoke<ExecResult>("opkg_install", { projectDir, package: pkg });
}

export async function importSkill(
  projectDir: string,
  sourceDir: string,
  options?: { overwrite?: boolean },
): Promise<ExecResult> {
  return invoke<ExecResult>("import_skill", {
    projectDir,
    sourceDir,
    overwrite: options?.overwrite ?? false,
  });
}

export async function installSkillTemplate(
  projectDir: string,
  name: string,
  content: string,
  options?: { overwrite?: boolean },
): Promise<ExecResult> {
  return invoke<ExecResult>("install_skill_template", {
    projectDir,
    name,
    content,
    overwrite: options?.overwrite ?? false,
  });
}

export type LocalSkillCard = {
  name: string;
  path: string;
  description?: string;
  trigger?: string;
};

export type LocalSkillContent = {
  path: string;
  content: string;
};

export async function listLocalSkills(projectDir: string): Promise<LocalSkillCard[]> {
  return invoke<LocalSkillCard[]>("list_local_skills", { projectDir });
}

export async function readLocalSkill(projectDir: string, name: string): Promise<LocalSkillContent> {
  return invoke<LocalSkillContent>("read_local_skill", { projectDir, name });
}

export async function writeLocalSkill(projectDir: string, name: string, content: string): Promise<ExecResult> {
  return invoke<ExecResult>("write_local_skill", { projectDir, name, content });
}

export async function uninstallSkill(projectDir: string, name: string): Promise<ExecResult> {
  return invoke<ExecResult>("uninstall_skill", { projectDir, name });
}

export type OpencodeConfigFile = {
  path: string;
  exists: boolean;
  content: string | null;
};

export type UpdaterEnvironment = {
  supported: boolean;
  reason: string | null;
  executablePath: string | null;
  appBundlePath: string | null;
};

export async function updaterEnvironment(): Promise<UpdaterEnvironment> {
  return invoke<UpdaterEnvironment>("updater_environment");
}

export async function readOpencodeConfig(
  scope: "project" | "global",
  projectDir: string,
): Promise<OpencodeConfigFile> {
  return invoke<OpencodeConfigFile>("read_opencode_config", { scope, projectDir });
}

export async function writeOpencodeConfig(
  scope: "project" | "global",
  projectDir: string,
  content: string,
): Promise<ExecResult> {
  return invoke<ExecResult>("write_opencode_config", { scope, projectDir, content });
}

export async function resetAuroworkState(mode: "onboarding" | "all"): Promise<void> {
  return invoke<void>("reset_aurowork_state", { mode });
}

export type CacheResetResult = {
  removed: string[];
  missing: string[];
  errors: string[];
};

export async function resetOpencodeCache(): Promise<CacheResetResult> {
  return invoke<CacheResetResult>("reset_opencode_cache");
}

export async function opencodeDbMigrate(input: {
  projectDir: string;
  preferSidecar?: boolean;
  opencodeBinPath?: string | null;
}): Promise<ExecResult> {
  const safeProjectDir = input.projectDir.trim();
  if (!safeProjectDir) {
    throw new Error("project_dir is required");
  }

  return invoke<ExecResult>("opencode_db_migrate", {
    projectDir: safeProjectDir,
    preferSidecar: input.preferSidecar ?? false,
    opencodeBinPath: input.opencodeBinPath ?? null,
  });
}

export async function opencodeMcpAuth(
  projectDir: string,
  serverName: string,
): Promise<ExecResult> {
  const safeProjectDir = projectDir.trim();
  if (!safeProjectDir) {
    throw new Error("project_dir is required");
  }

  const safeServerName = validateMcpServerName(serverName);

  return invoke<ExecResult>("opencode_mcp_auth", {
    projectDir: safeProjectDir,
    serverName: safeServerName,
  });
}

/**
 * Set window decorations (titlebar) visibility.
 * When `decorations` is false, the native titlebar is hidden.
 * Useful for tiling window managers on Linux (e.g., Hyprland, i3, sway).
 */
export async function setWindowDecorations(decorations: boolean): Promise<void> {
  return invoke<void>("set_window_decorations", { decorations });
}

// ---------------------------------------------------------------------------
// Debug log — append lines to /tmp/aurowork-debug.log via Rust
// ---------------------------------------------------------------------------

export async function debugLogAppend(lines: string[]): Promise<void> {
  return invoke<void>("debug_log_append", { lines });
}

export async function debugLogClear(): Promise<void> {
  return invoke<void>("debug_log_clear");
}
