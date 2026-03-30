import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauriRuntime } from "../utils";
import type { ExecResult, OpencodeConfigFile, WorkspaceInfo, WorkspaceList } from "./tauri";

export type AuroworkServerCapabilities = {
  skills: { read: boolean; write: boolean; source: "aurowork" | "opencode" };
  hub?: {
    skills?: {
      read: boolean;
      install: boolean;
      repo?: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };
  sandbox?: { enabled: boolean; backend: "none" | "docker" | "container" };
  proxy?: { opencode: boolean; opencodeRouter: boolean };
  toolProviders?: {
    browser?: {
      enabled: boolean;
      placement: "in-sandbox" | "host-machine" | "client-machine" | "external";
      mode: "none" | "headless" | "interactive";
    };
    files?: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
};

export type AuroworkServerStatus = "connected" | "disconnected" | "limited";

export type AuroworkServerDiagnostics = {
  ok: boolean;
  version: string;
  uptimeMs: number;
  readOnly: boolean;
  approval: { mode: "manual" | "auto"; timeoutMs: number };
  corsOrigins: string[];
  workspaceCount: number;
  activeWorkspaceId?: string | null;
  selectedWorkspaceId?: string | null;
  workspace: AuroworkWorkspaceInfo | null;
  authorizedRoots: string[];
  server: { host: string; port: number; configPath?: string | null };
  tokenSource: { client: string; host: string };
};

export type AuroworkRuntimeServiceName = "aurowork-server" | "opencode" | "opencode-router";

export type AuroworkRuntimeServiceSnapshot = {
  name: AuroworkRuntimeServiceName;
  enabled: boolean;
  running: boolean;
  targetVersion: string | null;
  actualVersion: string | null;
  upgradeAvailable: boolean;
};

export type AuroworkRuntimeSnapshot = {
  ok: boolean;
  orchestrator?: {
    version: string;
    startedAt: number;
  };
  worker?: {
    workspace: string;
    sandboxMode: string;
  };
  upgrade?: {
    status: "idle" | "running" | "failed";
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    operationId: string | null;
    services: AuroworkRuntimeServiceName[];
  };
  services: AuroworkRuntimeServiceSnapshot[];
};

export type AuroworkServerSettings = {
  urlOverride?: string;
  portOverride?: number;
  token?: string;
  remoteAccessEnabled?: boolean;
};

export type AuroworkWorkspaceInfo = WorkspaceInfo & {
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
};

export type AuroworkWorkspaceList = {
  items: AuroworkWorkspaceInfo[];
  workspaces?: WorkspaceInfo[];
  activeId?: string | null;
};

export type AuroworkPluginItem = {
  spec: string;
  source: "config" | "dir.project" | "dir.global";
  scope: "project" | "global";
  path?: string;
};

export type AuroworkSkillItem = {
  name: string;
  path: string;
  description: string;
  scope: "project" | "global";
  trigger?: string;
};

export type AuroworkSkillContent = {
  item: AuroworkSkillItem;
  content: string;
};

export type AuroworkHubSkillItem = {
  name: string;
  description: string;
  trigger?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  };
};

export type AuroworkHubRepo = {
  owner?: string;
  repo?: string;
  ref?: string;
};

export type AuroworkWorkspaceFileContent = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};

export type AuroworkWorkspaceFileWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
  revision?: string;
};

export type AuroworkFileSession = {
  id: string;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  canWrite: boolean;
};

export type AuroworkFileCatalogEntry = {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  revision: string;
};

export type AuroworkFileSessionEvent = {
  id: string;
  seq: number;
  workspaceId: string;
  type: "write" | "delete" | "rename" | "mkdir";
  path: string;
  toPath?: string;
  revision?: string;
  timestamp: number;
};

export type AuroworkFileReadBatchResult = {
  items: Array<
    | {
        ok: true;
        path: string;
        kind: "file";
        bytes: number;
        updatedAt: number;
        revision: string;
        contentBase64: string;
      }
    | {
        ok: false;
        path: string;
        code: string;
        message: string;
        maxBytes?: number;
        size?: number;
      }
  >;
};

export type AuroworkFileWriteBatchResult = {
  items: Array<
    | {
        ok: true;
        path: string;
        bytes: number;
        updatedAt: number;
        revision: string;
        previousRevision?: string | null;
      }
    | {
        ok: false;
        path: string;
        code: string;
        message: string;
        expectedRevision?: string;
        currentRevision?: string | null;
        maxBytes?: number;
        size?: number;
      }
  >;
  cursor: number;
};

export type AuroworkFileOpsBatchResult = {
  items: Array<Record<string, unknown>>;
  cursor: number;
};

export type AuroworkCommandItem = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
  scope: "workspace" | "global";
};

export type AuroworkMcpItem = {
  name: string;
  config: Record<string, unknown>;
  source: "config.project" | "config.global" | "config.remote";
  disabledByTools?: boolean;
};

export type AuroworkWorkspaceExport = {
  workspaceId: string;
  exportedAt: number;
  opencode?: Record<string, unknown>;
  aurowork?: Record<string, unknown>;
  skills?: Array<{ name: string; description?: string; trigger?: string; content: string }>;
  commands?: Array<{ name: string; description?: string; template?: string }>;
  files?: Array<{ path: string; content: string }>;
};

export type AuroworkArtifactItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  createdAt?: number;
  updatedAt?: number;
  mime?: string;
};

export type AuroworkArtifactList = {
  items: AuroworkArtifactItem[];
};

export type AuroworkInboxItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
};

export type AuroworkInboxList = {
  items: AuroworkInboxItem[];
};

export type AuroworkInboxUploadResult = {
  ok: boolean;
  path: string;
  bytes: number;
};

type RawJsonResponse<T> = {
  ok: boolean;
  status: number;
  json: T | null;
};

export type AuroworkReloadTrigger = {
  type: "skill" | "plugin" | "config" | "mcp" | "agent" | "command";
  name?: string;
  action?: "added" | "removed" | "updated";
  path?: string;
};

export type AuroworkReloadEvent = {
  id: string;
  seq: number;
  workspaceId: string;
  reason: "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";
  trigger?: AuroworkReloadTrigger;
  timestamp: number;
};

// Fallback for explicit server-mode URL derivation. Desktop local workers replace this
// with the persisted runtime-discovered port once the host reports it.
export const DEFAULT_AUROWORK_SERVER_PORT = 8787;

const STORAGE_URL_OVERRIDE = "aurowork.server.urlOverride";
const STORAGE_PORT_OVERRIDE = "aurowork.server.port";
const STORAGE_TOKEN = "aurowork.server.token";
const STORAGE_REMOTE_ACCESS = "aurowork.server.remoteAccessEnabled";

export function normalizeAuroworkServerUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function parseAuroworkWorkspaceIdFromUrl(input: string) {
  const normalized = normalizeAuroworkServerUrl(input) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    if (prev !== "w" || !last) return null;
    return decodeURIComponent(last);
  } catch {
    const match = normalized.match(/\/w\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

export function buildAuroworkWorkspaceBaseUrl(hostUrl: string, workspaceId?: string | null) {
  const normalized = normalizeAuroworkServerUrl(hostUrl) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    const alreadyMounted = prev === "w" && Boolean(last);
    if (alreadyMounted) {
      return url.toString().replace(/\/+$/, "");
    }

    const id = (workspaceId ?? "").trim();
    if (!id) return url.toString().replace(/\/+$/, "");

    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/w/${encodeURIComponent(id)}`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    const id = (workspaceId ?? "").trim();
    if (!id) return normalized;
    return `${normalized.replace(/\/+$/, "")}/w/${encodeURIComponent(id)}`;
  }
}

export const DEFAULT_AUROWORK_CONNECT_APP_URL = "https://app.auroworklabs.com";

const AUROWORK_INVITE_PARAM_URL = "ow_url";
const AUROWORK_INVITE_PARAM_TOKEN = "ow_token";
const AUROWORK_INVITE_PARAM_STARTUP = "ow_startup";
const AUROWORK_INVITE_PARAM_AUTO_CONNECT = "ow_auto_connect";
const AUROWORK_INVITE_PARAM_BUNDLE = "ow_bundle";
const AUROWORK_INVITE_PARAM_BUNDLE_INTENT = "ow_intent";
const AUROWORK_INVITE_PARAM_BUNDLE_SOURCE = "ow_source";
const AUROWORK_INVITE_PARAM_BUNDLE_ORG = "ow_org";
const AUROWORK_INVITE_PARAM_BUNDLE_LABEL = "ow_label";

export type AuroworkConnectInvite = {
  url: string;
  token?: string;
  startup?: "server";
  autoConnect?: boolean;
};

export type AuroworkBundleInviteIntent = "new_worker" | "import_current";

export type AuroworkBundleInvite = {
  bundleUrl: string;
  intent: AuroworkBundleInviteIntent;
  source?: string;
  orgId?: string;
  label?: string;
};

function normalizeAuroworkBundleInviteIntent(value: string | null | undefined): AuroworkBundleInviteIntent {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "new_worker" || normalized === "new-worker" || normalized === "newworker") {
    return "new_worker";
  }
  return "import_current";
}

export function buildAuroworkConnectInviteUrl(input: {
  workspaceUrl: string;
  token?: string | null;
  appUrl?: string | null;
  startup?: "server";
  autoConnect?: boolean;
}) {
  const workspaceUrl = normalizeAuroworkServerUrl(input.workspaceUrl ?? "") ?? "";
  if (!workspaceUrl) return "";

  const base = normalizeAuroworkServerUrl(input.appUrl ?? "") ?? DEFAULT_AUROWORK_CONNECT_APP_URL;

  try {
    const url = new URL(base);
    const search = new URLSearchParams(url.search);
    search.set(AUROWORK_INVITE_PARAM_URL, workspaceUrl);

    const token = input.token?.trim() ?? "";
    if (token) {
      search.set(AUROWORK_INVITE_PARAM_TOKEN, token);
    }

    const startup = input.startup ?? "server";
    search.set(AUROWORK_INVITE_PARAM_STARTUP, startup);
    if (input.autoConnect) {
      search.set(AUROWORK_INVITE_PARAM_AUTO_CONNECT, "1");
    }

    url.search = search.toString();
    return url.toString();
  } catch {
    const search = new URLSearchParams();
    search.set(AUROWORK_INVITE_PARAM_URL, workspaceUrl);
    const token = input.token?.trim() ?? "";
    if (token) {
      search.set(AUROWORK_INVITE_PARAM_TOKEN, token);
    }
    search.set(AUROWORK_INVITE_PARAM_STARTUP, input.startup ?? "server");
    if (input.autoConnect) {
      search.set(AUROWORK_INVITE_PARAM_AUTO_CONNECT, "1");
    }
    return `${DEFAULT_AUROWORK_CONNECT_APP_URL}?${search.toString()}`;
  }
}

export function readAuroworkConnectInviteFromSearch(input: string | URLSearchParams) {
  const search =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;

  const rawUrl = search.get(AUROWORK_INVITE_PARAM_URL)?.trim() ?? "";
  const url = normalizeAuroworkServerUrl(rawUrl);
  if (!url) return null;

  const token = search.get(AUROWORK_INVITE_PARAM_TOKEN)?.trim() ?? "";
  const startupRaw = search.get(AUROWORK_INVITE_PARAM_STARTUP)?.trim() ?? "";
  const startup = startupRaw === "server" ? "server" : undefined;
  const autoConnect = search.get(AUROWORK_INVITE_PARAM_AUTO_CONNECT)?.trim() === "1";

  return {
    url,
    token: token || undefined,
    startup,
    autoConnect: autoConnect || undefined,
  } satisfies AuroworkConnectInvite;
}

export function buildAuroworkBundleInviteUrl(input: {
  bundleUrl: string;
  appUrl?: string | null;
  intent?: AuroworkBundleInviteIntent;
  source?: string | null;
  orgId?: string | null;
  label?: string | null;
}) {
  const rawBundleUrl = input.bundleUrl?.trim() ?? "";
  if (!rawBundleUrl) return "";

  let bundleUrl: string;
  try {
    bundleUrl = new URL(rawBundleUrl).toString();
  } catch {
    return "";
  }

  const base = normalizeAuroworkServerUrl(input.appUrl ?? "") ?? DEFAULT_AUROWORK_CONNECT_APP_URL;

  try {
    const url = new URL(base);
    const search = new URLSearchParams(url.search);
    const intent = normalizeAuroworkBundleInviteIntent(input.intent);
    search.set(AUROWORK_INVITE_PARAM_BUNDLE, bundleUrl);
    search.set(AUROWORK_INVITE_PARAM_BUNDLE_INTENT, intent);

    const source = input.source?.trim() ?? "";
    if (source) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_SOURCE, source);
    }

    const orgId = input.orgId?.trim() ?? "";
    if (orgId) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_ORG, orgId);
    }

    const label = input.label?.trim() ?? "";
    if (label) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_LABEL, label);
    }

    url.search = search.toString();
    return url.toString();
  } catch {
    const search = new URLSearchParams();
    const intent = normalizeAuroworkBundleInviteIntent(input.intent);
    search.set(AUROWORK_INVITE_PARAM_BUNDLE, bundleUrl);
    search.set(AUROWORK_INVITE_PARAM_BUNDLE_INTENT, intent);

    const source = input.source?.trim() ?? "";
    if (source) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_SOURCE, source);
    }

    const orgId = input.orgId?.trim() ?? "";
    if (orgId) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_ORG, orgId);
    }

    const label = input.label?.trim() ?? "";
    if (label) {
      search.set(AUROWORK_INVITE_PARAM_BUNDLE_LABEL, label);
    }

    return `${DEFAULT_AUROWORK_CONNECT_APP_URL}?${search.toString()}`;
  }
}

export function readAuroworkBundleInviteFromSearch(input: string | URLSearchParams) {
  const search =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;

  const rawBundleUrl = search.get(AUROWORK_INVITE_PARAM_BUNDLE)?.trim() ?? "";
  if (!rawBundleUrl) return null;

  let bundleUrl: string;
  try {
    const parsed = new URL(rawBundleUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    bundleUrl = parsed.toString();
  } catch {
    return null;
  }

  const intent = normalizeAuroworkBundleInviteIntent(search.get(AUROWORK_INVITE_PARAM_BUNDLE_INTENT));
  const source = search.get(AUROWORK_INVITE_PARAM_BUNDLE_SOURCE)?.trim() ?? "";
  const orgId = search.get(AUROWORK_INVITE_PARAM_BUNDLE_ORG)?.trim() ?? "";
  const label = search.get(AUROWORK_INVITE_PARAM_BUNDLE_LABEL)?.trim() ?? "";

  return {
    bundleUrl,
    intent,
    source: source || undefined,
    orgId: orgId || undefined,
    label: label || undefined,
  } satisfies AuroworkBundleInvite;
}

export function stripAuroworkConnectInviteFromUrl(input: string) {
  try {
    const url = new URL(input);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_URL);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_TOKEN);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_STARTUP);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_AUTO_CONNECT);
    return url.toString();
  } catch {
    return input;
  }
}

export function stripAuroworkBundleInviteFromUrl(input: string) {
  try {
    const url = new URL(input);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_BUNDLE);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_BUNDLE_INTENT);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_BUNDLE_SOURCE);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_BUNDLE_ORG);
    url.searchParams.delete(AUROWORK_INVITE_PARAM_BUNDLE_LABEL);
    return url.toString();
  } catch {
    return input;
  }
}

export function readAuroworkServerSettings(): AuroworkServerSettings {
  if (typeof window === "undefined") return {};
  try {
    const urlOverride = normalizeAuroworkServerUrl(
      window.localStorage.getItem(STORAGE_URL_OVERRIDE) ?? "",
    );
    const portRaw = window.localStorage.getItem(STORAGE_PORT_OVERRIDE) ?? "";
    const portOverride = portRaw ? Number(portRaw) : undefined;
    const token = window.localStorage.getItem(STORAGE_TOKEN) ?? undefined;
    const remoteAccessRaw = window.localStorage.getItem(STORAGE_REMOTE_ACCESS) ?? "";
    return {
      urlOverride: urlOverride ?? undefined,
      portOverride: Number.isNaN(portOverride) ? undefined : portOverride,
      token: token?.trim() || undefined,
      remoteAccessEnabled: remoteAccessRaw === "1",
    };
  } catch {
    return {};
  }
}

export function writeAuroworkServerSettings(next: AuroworkServerSettings): AuroworkServerSettings {
  if (typeof window === "undefined") return next;
  try {
    const urlOverride = normalizeAuroworkServerUrl(next.urlOverride ?? "");
    const portOverride = typeof next.portOverride === "number" ? next.portOverride : undefined;
    const token = next.token?.trim() || undefined;
    const remoteAccessEnabled = next.remoteAccessEnabled === true;

    if (urlOverride) {
      window.localStorage.setItem(STORAGE_URL_OVERRIDE, urlOverride);
    } else {
      window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    }

    if (typeof portOverride === "number" && !Number.isNaN(portOverride)) {
      window.localStorage.setItem(STORAGE_PORT_OVERRIDE, String(portOverride));
    } else {
      window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    }

    if (token) {
      window.localStorage.setItem(STORAGE_TOKEN, token);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN);
    }

    if (remoteAccessEnabled) {
      window.localStorage.setItem(STORAGE_REMOTE_ACCESS, "1");
    } else {
      window.localStorage.removeItem(STORAGE_REMOTE_ACCESS);
    }

    return readAuroworkServerSettings();
  } catch {
    return next;
  }
}

export function hydrateAuroworkServerSettingsFromEnv() {
  if (typeof window === "undefined") return;

  const envUrl = typeof import.meta.env?.VITE_AUROWORK_URL === "string"
    ? import.meta.env.VITE_AUROWORK_URL.trim()
    : "";
  const envPort = typeof import.meta.env?.VITE_AUROWORK_PORT === "string"
    ? import.meta.env.VITE_AUROWORK_PORT.trim()
    : "";
  const envToken = typeof import.meta.env?.VITE_AUROWORK_TOKEN === "string"
    ? import.meta.env.VITE_AUROWORK_TOKEN.trim()
    : "";

  if (!envUrl && !envPort && !envToken) return;

  try {
    const current = readAuroworkServerSettings();
    const next: AuroworkServerSettings = { ...current };
    let changed = false;

    if (!current.urlOverride && envUrl) {
      next.urlOverride = normalizeAuroworkServerUrl(envUrl) ?? undefined;
      changed = true;
    }

    if (!current.portOverride && envPort) {
      const parsed = Number(envPort);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.portOverride = parsed;
        changed = true;
      }
    }

    if (!current.token && envToken) {
      next.token = envToken;
      changed = true;
    }

    if (changed) {
      writeAuroworkServerSettings(next);
    }
  } catch {
    // ignore
  }
}

export function clearAuroworkServerSettings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    window.localStorage.removeItem(STORAGE_TOKEN);
    window.localStorage.removeItem(STORAGE_REMOTE_ACCESS);
  } catch {
    // ignore
  }
}

export function deriveAuroworkServerUrl(
  opencodeBaseUrl: string,
  settings?: AuroworkServerSettings,
) {
  const override = settings?.urlOverride?.trim();
  if (override) {
    return normalizeAuroworkServerUrl(override);
  }

  const base = opencodeBaseUrl.trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    const port = settings?.portOverride ?? DEFAULT_AUROWORK_SERVER_PORT;
    url.port = String(port);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}

export class AuroworkServerError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildHeaders(
  token?: string,
  hostToken?: string,
  extra?: Record<string, string>,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-AuroWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

function buildAuthHeaders(token?: string, hostToken?: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-AuroWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

// Use Tauri's fetch when running in the desktop app to avoid CORS issues
const resolveFetch = () => (isTauriRuntime() ? tauriFetch : globalThis.fetch);

const DEFAULT_AUROWORK_SERVER_TIMEOUT_MS = 10_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller?.signal;
  const initWithSignal = signal && !init.signal ? { ...init, signal } : init;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, initWithSignal), timeoutPromise]);
  } catch (error) {
    const name = (error && typeof error === "object" && "name" in error ? (error as any).name : "") as string;
    if (name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_AUROWORK_SERVER_TIMEOUT_MS,
  );

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string" ? json.message : response.statusText;
    throw new AuroworkServerError(response.status, code, message, json?.details);
  }

  return json as T;
}

async function requestJsonRaw<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<RawJsonResponse<T>> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_AUROWORK_SERVER_TIMEOUT_MS,
  );

  const text = await response.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }

  return { ok: response.ok, status: response.status, json };
}

async function requestMultipartRaw(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: FormData; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "POST",
      headers: buildAuthHeaders(options.token, options.hostToken),
      body: options.body,
    },
    options.timeoutMs ?? DEFAULT_AUROWORK_SERVER_TIMEOUT_MS,
  );
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function requestBinary(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; timeoutMs?: number } = {},
): Promise<{ data: ArrayBuffer; contentType: string | null; filename: string | null }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildAuthHeaders(options.token, options.hostToken),
    },
    options.timeoutMs ?? DEFAULT_AUROWORK_SERVER_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string" ? json.message : response.statusText;
    throw new AuroworkServerError(response.status, code, message, json?.details);
  }

  const contentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filenameRaw = filenameMatch?.[1] ?? filenameMatch?.[2] ?? null;
  const filename = filenameRaw ? decodeURIComponent(filenameRaw) : null;
  const data = await response.arrayBuffer();
  return { data, contentType, filename };
}

export function createAuroworkServerClient(options: { baseUrl: string; token?: string; hostToken?: string }) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const token = options.token;
  const hostToken = options.hostToken;

  const timeouts = {
    health: 3_000,
    capabilities: 6_000,
    listWorkspaces: 8_000,
    activateWorkspace: 10_000,
    deleteWorkspace: 10_000,
    deleteSession: 12_000,
    status: 6_000,
    config: 10_000,
    workspaceExport: 30_000,
    workspaceImport: 30_000,
    binary: 60_000,
  };

  return {
    baseUrl,
    token,
    health: () =>
      requestJson<{ ok: boolean; version: string; uptimeMs: number }>(baseUrl, "/health", { token, hostToken, timeoutMs: timeouts.health }),
    runtimeVersions: () =>
      requestJson<AuroworkRuntimeSnapshot>(baseUrl, "/runtime/versions", { token, hostToken, timeoutMs: timeouts.status }),
    status: () => requestJson<AuroworkServerDiagnostics>(baseUrl, "/status", { token, hostToken, timeoutMs: timeouts.status }),
    capabilities: () => requestJson<AuroworkServerCapabilities>(baseUrl, "/capabilities", { token, hostToken, timeoutMs: timeouts.capabilities }),
    listWorkspaces: () => requestJson<AuroworkWorkspaceList>(baseUrl, "/workspaces", { token, hostToken, timeoutMs: timeouts.listWorkspaces }),
    createLocalWorkspace: (payload: { folderPath: string; name: string; preset: string }) =>
      requestJson<WorkspaceList>(baseUrl, "/workspaces/local", {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.activateWorkspace,
      }),
    updateWorkspaceDisplayName: (workspaceId: string, displayName: string | null) =>
      requestJson<WorkspaceList>(baseUrl, `/workspaces/${encodeURIComponent(workspaceId)}/display-name`, {
        token,
        hostToken,
        method: "PATCH",
        body: { displayName },
        timeoutMs: timeouts.activateWorkspace,
      }),
    activateWorkspace: (workspaceId: string) =>
      requestJson<{ activeId: string; workspace: AuroworkWorkspaceInfo }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.activateWorkspace },
      ),
    deleteWorkspace: (workspaceId: string) =>
      requestJson<{ ok: boolean; deleted: boolean; persisted: boolean; activeId: string | null; items: AuroworkWorkspaceInfo[]; workspaces?: WorkspaceInfo[] }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteWorkspace },
      ),
    deleteSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteSession },
      ),
    exportWorkspace: (workspaceId: string) =>
      requestJson<AuroworkWorkspaceExport>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/export`, {
        token,
        hostToken,
        timeoutMs: timeouts.workspaceExport,
      }),
    importWorkspace: (workspaceId: string, payload: Record<string, unknown>) =>
      requestJson<{ ok: boolean }>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/import`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.workspaceImport,
      }),
    getConfig: (workspaceId: string) =>
      requestJson<{ opencode: Record<string, unknown>; aurowork: Record<string, unknown>; updatedAt?: number | null }>(
        baseUrl,
        `/workspace/${workspaceId}/config`,
        { token, hostToken, timeoutMs: timeouts.config },
      ),
    patchConfig: (workspaceId: string, payload: { opencode?: Record<string, unknown>; aurowork?: Record<string, unknown> }) =>
      requestJson<{ updatedAt?: number | null }>(baseUrl, `/workspace/${workspaceId}/config`, {
        token,
        hostToken,
        method: "PATCH",
        body: payload,
      }),
    readOpencodeConfigFile: (workspaceId: string, scope: "project" | "global" = "project") => {
      const query = `?scope=${scope}`;
      return requestJson<OpencodeConfigFile>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/opencode-config${query}`, {
        token,
        hostToken,
      });
    },
    writeOpencodeConfigFile: (workspaceId: string, scope: "project" | "global", content: string) =>
      requestJson<ExecResult>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/opencode-config`, {
        token,
        hostToken,
        method: "POST",
        body: { scope, content },
      }),
    listReloadEvents: (workspaceId: string, options?: { since?: number }) => {
      const query = typeof options?.since === "number" ? `?since=${options.since}` : "";
      return requestJson<{ items: AuroworkReloadEvent[]; cursor?: number }>(
        baseUrl,
        `/workspace/${workspaceId}/events${query}`,
        { token, hostToken },
      );
    },
    reloadEngine: (workspaceId: string) =>
      requestJson<{ ok: boolean; reloadedAt?: number }>(baseUrl, `/workspace/${workspaceId}/engine/reload`, {
        token,
        hostToken,
        method: "POST",
      }),
    listPlugins: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: AuroworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins${query}`,
        { token, hostToken },
      );
    },
    addPlugin: (workspaceId: string, spec: string) =>
      requestJson<{ items: AuroworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins`,
        { token, hostToken, method: "POST", body: { spec } },
      ),
    removePlugin: (workspaceId: string, name: string) =>
      requestJson<{ items: AuroworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins/${encodeURIComponent(name)}`,
        { token, hostToken, method: "DELETE" },
      ),
    listSkills: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: AuroworkSkillItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/skills${query}`,
        { token, hostToken },
      );
    },
    listHubSkills: (options?: { repo?: AuroworkHubRepo }) => {
      const params = new URLSearchParams();
      const owner = options?.repo?.owner?.trim();
      const repo = options?.repo?.repo?.trim();
      const ref = options?.repo?.ref?.trim();
      if (owner) params.set("owner", owner);
      if (repo) params.set("repo", repo);
      if (ref) params.set("ref", ref);
      const query = params.size ? `?${params.toString()}` : "";
      return requestJson<{ items: AuroworkHubSkillItem[] }>(baseUrl, `/hub/skills${query}`, {
        token,
        hostToken,
      });
    },
    installHubSkill: (
      workspaceId: string,
      name: string,
      options?: { overwrite?: boolean; repo?: { owner?: string; repo?: string; ref?: string } },
    ) =>
      requestJson<{ ok: boolean; name: string; path: string; action: "added" | "updated"; written: number; skipped: number }>(
        baseUrl,
        `/workspace/${workspaceId}/skills/hub/${encodeURIComponent(name)}`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            ...(options?.overwrite ? { overwrite: true } : {}),
            ...(options?.repo ? { repo: options.repo } : {}),
          },
        },
      ),
    getSkill: (workspaceId: string, name: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<AuroworkSkillContent>(
        baseUrl,
        `/workspace/${workspaceId}/skills/${encodeURIComponent(name)}${query}`,
        { token, hostToken },
      );
    },
    upsertSkill: (workspaceId: string, payload: { name: string; content: string; description?: string }) =>
      requestJson<AuroworkSkillItem>(baseUrl, `/workspace/${workspaceId}/skills`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    listMcp: (workspaceId: string) =>
      requestJson<{ items: AuroworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, { token, hostToken }),
    addMcp: (workspaceId: string, payload: { name: string; config: Record<string, unknown> }) =>
      requestJson<{ items: AuroworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    removeMcp: (workspaceId: string, name: string) =>
      requestJson<{ items: AuroworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),

    logoutMcpAuth: (workspaceId: string, name: string) =>
      requestJson<{ ok: true }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}/auth`, {
        token,
        hostToken,
        method: "DELETE",
      }),

    listCommands: (workspaceId: string, scope: "workspace" | "global" = "workspace") =>
      requestJson<{ items: AuroworkCommandItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/commands?scope=${scope}`,
        { token, hostToken },
      ),
    upsertCommand: (
      workspaceId: string,
      payload: { name: string; description?: string; template: string; agent?: string; model?: string | null; subtask?: boolean },
    ) =>
      requestJson<{ items: AuroworkCommandItem[] }>(baseUrl, `/workspace/${workspaceId}/commands`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    deleteCommand: (workspaceId: string, name: string) =>
      requestJson<{ ok: boolean }>(baseUrl, `/workspace/${workspaceId}/commands/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),
    uploadInbox: async (workspaceId: string, file: File, options?: { path?: string }) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      if (!file) throw new Error("file is required");
      const form = new FormData();
      form.append("file", file);
      if (options?.path?.trim()) {
        form.append("path", options.path.trim());
      }

      const result = await requestMultipartRaw(baseUrl, `/workspace/${encodeURIComponent(id)}/inbox`, {
        token,
        hostToken,
        method: "POST",
        body: form,
        timeoutMs: timeouts.binary,
      });

      if (!result.ok) {
        let message = result.text.trim();
        try {
          const json = message ? JSON.parse(message) : null;
          if (json && typeof json.message === "string") {
            message = json.message;
          }
        } catch {
          // ignore
        }
        throw new AuroworkServerError(
          result.status,
          "request_failed",
          message || "Shared folder upload failed",
        );
      }

      const body = result.text.trim();
      if (body) {
        try {
          const parsed = JSON.parse(body) as Partial<AuroworkInboxUploadResult>;
          if (typeof parsed.path === "string" && parsed.path.trim()) {
            return {
              ok: parsed.ok ?? true,
              path: parsed.path.trim(),
              bytes: typeof parsed.bytes === "number" ? parsed.bytes : file.size,
            } satisfies AuroworkInboxUploadResult;
          }
        } catch {
          // ignore invalid JSON and fall back
        }
      }

      return {
        ok: true,
        path: options?.path?.trim() || file.name,
        bytes: file.size,
      } satisfies AuroworkInboxUploadResult;
    },

    listInbox: (workspaceId: string) =>
      requestJson<AuroworkInboxList>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/inbox`, {
        token,
        hostToken,
      }),

    downloadInboxItem: (workspaceId: string, inboxId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(inboxId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    createFileSession: (workspaceId: string, options?: { ttlSeconds?: number; write?: boolean }) =>
      requestJson<{ session: AuroworkFileSession }>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/files/sessions`, {
        token,
        hostToken,
        method: "POST",
        body: {
          ...(typeof options?.ttlSeconds === "number" ? { ttlSeconds: options.ttlSeconds } : {}),
          ...(typeof options?.write === "boolean" ? { write: options.write } : {}),
        },
      }),

    renewFileSession: (sessionId: string, options?: { ttlSeconds?: number }) =>
      requestJson<{ session: AuroworkFileSession }>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}/renew`, {
        token,
        hostToken,
        method: "POST",
        body: {
          ...(typeof options?.ttlSeconds === "number" ? { ttlSeconds: options.ttlSeconds } : {}),
        },
      }),

    closeFileSession: (sessionId: string) =>
      requestJson<{ ok: boolean }>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),

    getFileCatalogSnapshot: (
      sessionId: string,
      options?: { prefix?: string; after?: string; includeDirs?: boolean; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (options?.prefix?.trim()) params.set("prefix", options.prefix.trim());
      if (options?.after?.trim()) params.set("after", options.after.trim());
      if (typeof options?.includeDirs === "boolean") params.set("includeDirs", options.includeDirs ? "true" : "false");
      if (typeof options?.limit === "number") params.set("limit", String(options.limit));
      const query = params.toString();
      return requestJson<{
        sessionId: string;
        workspaceId: string;
        generatedAt: number;
        cursor: number;
        total: number;
        truncated: boolean;
        nextAfter?: string;
        items: AuroworkFileCatalogEntry[];
      }>(
        baseUrl,
        `/files/sessions/${encodeURIComponent(sessionId)}/catalog/snapshot${query ? `?${query}` : ""}`,
        { token, hostToken },
      );
    },

    listFileSessionEvents: (sessionId: string, options?: { since?: number }) => {
      const query = typeof options?.since === "number" ? `?since=${encodeURIComponent(String(options.since))}` : "";
      return requestJson<{ items: AuroworkFileSessionEvent[]; cursor: number }>(
        baseUrl,
        `/files/sessions/${encodeURIComponent(sessionId)}/catalog/events${query}`,
        { token, hostToken },
      );
    },

    readFileBatch: (sessionId: string, paths: string[]) =>
      requestJson<AuroworkFileReadBatchResult>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}/read-batch`, {
        token,
        hostToken,
        method: "POST",
        body: { paths },
      }),

    writeFileBatch: (
      sessionId: string,
      writes: Array<{ path: string; contentBase64: string; ifMatchRevision?: string; force?: boolean }>,
    ) =>
      requestJson<AuroworkFileWriteBatchResult>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}/write-batch`, {
        token,
        hostToken,
        method: "POST",
        body: { writes },
      }),

    runFileBatchOps: (
      sessionId: string,
      operations: Array<
        | { type: "mkdir"; path: string }
        | { type: "delete"; path: string; recursive?: boolean }
        | { type: "rename"; from: string; to: string }
      >,
    ) =>
      requestJson<AuroworkFileOpsBatchResult>(baseUrl, `/files/sessions/${encodeURIComponent(sessionId)}/ops`, {
        token,
        hostToken,
        method: "POST",
        body: { operations },
      }),

    readWorkspaceFile: (workspaceId: string, path: string) =>
      requestJson<AuroworkWorkspaceFileContent>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`,
        { token, hostToken },
      ),

    writeWorkspaceFile: (
      workspaceId: string,
      payload: { path: string; content: string; baseUpdatedAt?: number | null; force?: boolean },
    ) =>
      requestJson<AuroworkWorkspaceFileWriteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),

    listArtifacts: (workspaceId: string) =>
      requestJson<AuroworkArtifactList>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/artifacts`, {
        token,
        hostToken,
      }),

    downloadArtifact: (workspaceId: string, artifactId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),
  };
}

export type AuroworkServerClient = ReturnType<typeof createAuroworkServerClient>;
