/**
 * AuroWork server connection state.
 *
 * Encapsulates all signals, effects, and helpers related to the AuroWork
 * server lifecycle: connection status, capabilities polling, host info,
 * diagnostics, audit entries, and the server client instance.
 */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import {
  createAuroworkServerClient,
  hydrateAuroworkServerSettingsFromEnv,
  normalizeAuroworkServerUrl,
  readAuroworkServerSettings,
  AuroworkServerError,
  type AuroworkServerCapabilities,
  type AuroworkServerClient,
  type AuroworkServerDiagnostics,
  type AuroworkServerSettings,
  type AuroworkServerStatus,
} from "../lib/aurowork-server";
import {
  auroworkServerInfo,
  orchestratorStatus,
  type OrchestratorStatus,
  type AuroworkServerInfo,
} from "../lib/tauri";
import { isTauriRuntime } from "../utils";
import type { StartupPreference } from "../types";

export type AuroworkServerStore = ReturnType<typeof createAuroworkServerStore>;

export function createAuroworkServerStore(options: {
  startupPreference: () => StartupPreference | null;
  developerMode: () => boolean;
  documentVisible: () => boolean;
  refreshEngine?: () => Promise<void>;
}) {
  const [settings, setSettings] = createSignal<AuroworkServerSettings>({});
  const [url, setUrl] = createSignal("");
  const [status, setStatus] = createSignal<AuroworkServerStatus>("disconnected");
  const [capabilities, setCapabilities] = createSignal<AuroworkServerCapabilities | null>(null);
  const [checkedAt, setCheckedAt] = createSignal<number | null>(null);
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  const [hostInfo, setHostInfo] = createSignal<AuroworkServerInfo | null>(null);
  const [diagnostics, setDiagnostics] = createSignal<AuroworkServerDiagnostics | null>(null);
  const [reconnectBusy, setReconnectBusy] = createSignal(false);
  const [routerInfo, setRouterInfo] = createSignal<null>(null);
  const [orchStatus, setOrchStatus] = createSignal<OrchestratorStatus | null>(null);
  const [auditEntries, setAuditEntries] = createSignal<unknown[]>([]);
  const [auditStatus, setAuditStatus] = createSignal<"idle" | "loading" | "error">("idle");
  const [auditError, setAuditError] = createSignal<string | null>(null);
  const [devtoolsWorkspaceId, setDevtoolsWorkspaceId] = createSignal<string | null>(null);

  // -- Derived --

  const baseUrl = createMemo(() => {
    const pref = options.startupPreference();
    const info = hostInfo();
    const settingsUrl = normalizeAuroworkServerUrl(settings().urlOverride ?? "") ?? "";

    if (pref === "local") return info?.baseUrl ?? "";
    if (pref === "server") return settingsUrl;
    return info?.baseUrl ?? settingsUrl;
  });

  const auth = createMemo(() => {
    const pref = options.startupPreference();
    const info = hostInfo();
    const settingsToken = settings().token?.trim() ?? "";
    const clientToken = info?.clientToken?.trim() ?? "";
    const hostToken = info?.hostToken?.trim() ?? "";

    if (pref === "local") {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    if (pref === "server") {
      return { token: settingsToken || undefined, hostToken: undefined };
    }
    if (info?.baseUrl) {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    return { token: settingsToken || undefined, hostToken: undefined };
  });

  const client = createMemo(() => {
    const base = baseUrl().trim();
    if (!base) return null;
    const a = auth();
    return createAuroworkServerClient({ baseUrl: base, token: a.token, hostToken: a.hostToken });
  });

  const devtoolsClient = createMemo(() => client());

  // -- Effects --

  // Hydrate settings from env/localStorage on mount
  createEffect(() => {
    if (typeof window === "undefined") return;
    hydrateAuroworkServerSettingsFromEnv();
    setSettings(readAuroworkServerSettings());
  });

  // Derive URL from preference + host info
  createEffect(() => {
    const pref = options.startupPreference();
    const info = hostInfo();
    const hostUrl = info?.connectUrl ?? info?.lanUrl ?? info?.mdnsUrl ?? info?.baseUrl ?? "";
    const settingsUrl = normalizeAuroworkServerUrl(settings().urlOverride ?? "") ?? "";

    if (pref === "local") {
      setUrl(hostUrl);
      return;
    }
    if (pref === "server") {
      setUrl(settingsUrl);
      return;
    }
    setUrl(hostUrl || settingsUrl);
  });

  // Poll server health + capabilities
  createEffect(() => {
    if (typeof window === "undefined") return;
    if (!options.documentVisible()) return;
    const serverUrl = baseUrl().trim();
    const a = auth();
    const token = a.token;
    const ht = a.hostToken;

    if (!serverUrl) {
      setStatus("disconnected");
      setCapabilities(null);
      setCheckedAt(Date.now());
      return;
    }

    let active = true;
    let busy = false;
    let timeoutId: number | undefined;
    let delayMs = 10_000;

    const scheduleNext = () => {
      if (!active) return;
      timeoutId = window.setTimeout(run, delayMs);
    };

    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await checkServer(serverUrl, token, ht);
        if (!active) return;
        setStatus(result.status);
        setCapabilities(result.capabilities);
        delayMs =
          result.status === "connected" || result.status === "limited"
            ? 10_000
            : Math.min(delayMs * 2, 60_000);
      } catch {
        delayMs = Math.min(delayMs * 2, 60_000);
      } finally {
        if (!active) return;
        setCheckedAt(Date.now());
        busy = false;
        scheduleNext();
      }
    };

    run();
    onCleanup(() => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    });
  });

  // Poll host info (Tauri only)
  createEffect(() => {
    if (!isTauriRuntime()) return;
    if (!options.documentVisible()) return;
    let active = true;

    const run = async () => {
      try {
        const info = await auroworkServerInfo();
        if (active) setHostInfo(info);
      } catch {
        if (active) setHostInfo(null);
      }
    };

    run();
    const interval = window.setInterval(run, 10_000);
    onCleanup(() => {
      active = false;
      window.clearInterval(interval);
    });
  });

  // Poll diagnostics (developer mode only)
  createEffect(() => {
    if (typeof window === "undefined") return;
    if (!options.documentVisible()) return;
    if (!options.developerMode()) {
      setDiagnostics(null);
      return;
    }

    const c = client();
    if (!c || status() === "disconnected") {
      setDiagnostics(null);
      return;
    }

    let active = true;
    let busy = false;

    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await c.status();
        if (active) setDiagnostics(s);
      } catch {
        if (active) setDiagnostics(null);
      } finally {
        busy = false;
      }
    };

    run();
    const interval = window.setInterval(run, 10_000);
    onCleanup(() => {
      active = false;
      window.clearInterval(interval);
    });
  });

  // Poll engine (developer mode, Tauri only)
  createEffect(() => {
    if (!isTauriRuntime()) return;
    if (!options.developerMode()) return;
    if (!options.documentVisible()) return;

    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        await options.refreshEngine?.();
      } finally {
        busy = false;
      }
    };

    run();
    const interval = window.setInterval(run, 10_000);
    onCleanup(() => {
      window.clearInterval(interval);
    });
  });

  // OpenCode Router polling removed
  createEffect(() => {
    setRouterInfo(null);
  });

  // Poll orchestrator status (developer mode, Tauri only)
  createEffect(() => {
    if (!isTauriRuntime()) return;
    if (!options.developerMode()) {
      setOrchStatus(null);
      return;
    }
    if (!options.documentVisible()) return;

    let active = true;
    const run = async () => {
      try {
        const s = await orchestratorStatus();
        if (active) setOrchStatus(s);
      } catch {
        if (active) setOrchStatus(null);
      }
    };

    run();
    const interval = window.setInterval(run, 10_000);
    onCleanup(() => {
      active = false;
      window.clearInterval(interval);
    });
  });

  return {
    // Signals (read)
    settings,
    url,
    status,
    capabilities,
    checkedAt,
    workspaceId,
    hostInfo,
    diagnostics,
    reconnectBusy,
    routerInfo,
    orchestratorStatus: orchStatus,
    auditEntries,
    auditStatus,
    auditError,
    devtoolsWorkspaceId,

    // Derived
    baseUrl,
    auth,
    client,
    devtoolsClient,

    // Setters (for external use)
    setSettings,
    setUrl,
    setStatus,
    setCapabilities,
    setCheckedAt,
    setWorkspaceId,
    setHostInfo,
    setDiagnostics,
    setReconnectBusy,
    setRouterInfo,
    setOrchestratorStatus: setOrchStatus,
    setAuditEntries,
    setAuditStatus,
    setAuditError,
    setDevtoolsWorkspaceId,
  };
}

// -- Helpers --

async function checkServer(
  url: string,
  token?: string,
  hostToken?: string,
): Promise<{ status: AuroworkServerStatus; capabilities: AuroworkServerCapabilities | null }> {
  const c = createAuroworkServerClient({ baseUrl: url, token, hostToken });
  try {
    await c.health();
  } catch (error) {
    if (error instanceof AuroworkServerError && (error.status === 401 || error.status === 403)) {
      return { status: "limited", capabilities: null };
    }
    return { status: "disconnected", capabilities: null };
  }

  if (!token) {
    return { status: "limited", capabilities: null };
  }

  try {
    const caps = await c.capabilities();
    return { status: "connected", capabilities: caps };
  } catch (error) {
    if (error instanceof AuroworkServerError && (error.status === 401 || error.status === 403)) {
      return { status: "limited", capabilities: null };
    }
    return { status: "disconnected", capabilities: null };
  }
}
