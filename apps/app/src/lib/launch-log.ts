/**
 * Frontend client for the dev-mode-only launch log aggregator.
 *
 * Buffers entries and flushes in batches via Tauri `invoke`. When dev mode
 * is disabled (resolved on first call) every entry is dropped without an
 * IPC roundtrip.
 */

import { isTauriRuntime } from "../app/utils";

type LaunchLogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface LaunchLogEntry {
  tag: string;
  level: LaunchLogLevel;
  message: string;
  stack?: string;
  /**
   * Milliseconds since Unix epoch, captured at the moment `launchLog()` is
   * called. The aggregator buffers and flushes in batches, and JS await
   * chains can block the event loop for seconds — without this field the
   * Rust side would stamp every entry in a batch with the flush time,
   * making the log appear non-monotonic vs the Rust-side sync writes.
   */
  timestampMs: number;
}

interface DevModeInfo {
  enabled: boolean;
  logFilePath: string | null;
}

const FLUSH_INTERVAL_MS = 100;

let devModeCached: boolean | null = null;
let logFilePathCached: string | null = null;
let buffer: LaunchLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<DevModeInfo> | null = null;

async function loadDevModeInfo(): Promise<DevModeInfo> {
  if (!isTauriRuntime()) {
    return { enabled: false, logFilePath: null };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = (await invoke("dev_mode_info")) as DevModeInfo;
    return info;
  } catch {
    return { enabled: false, logFilePath: null };
  }
}

export async function initLaunchLog(): Promise<DevModeInfo> {
  if (initPromise) return initPromise;
  initPromise = loadDevModeInfo().then((info) => {
    devModeCached = info.enabled;
    logFilePathCached = info.logFilePath;
    return info;
  });
  return initPromise;
}

export function getLaunchLogPath(): string | null {
  return logFilePathCached;
}

export function isLaunchLogEnabled(): boolean {
  return devModeCached === true;
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  // If init hasn't resolved yet, wait for it before deciding whether to
  // ship or drop. Otherwise we'd clear the buffer prematurely while
  // devModeCached is still `null` and lose every early entry that
  // landed before `initLaunchLog()` returned.
  if (devModeCached === null && initPromise) {
    try {
      await initPromise;
    } catch {
      // initPromise itself never rejects (loadDevModeInfo catches), but
      // be defensive anyway.
    }
  }

  if (devModeCached !== true) {
    buffer = [];
    return;
  }
  const entries = buffer;
  buffer = [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("launch_log_append_batch", { entries });
  } catch {
    // best-effort; drop on failure
  }
}

export function launchLog(
  level: LaunchLogLevel,
  tag: string,
  message: string,
  stack?: string,
): void {
  if (devModeCached === false) {
    return;
  }
  buffer.push({ tag, level, message, stack, timestampMs: Date.now() });
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
}

/** Force flush — call after first paint to ensure early entries land. */
export async function flushLaunchLog(): Promise<void> {
  await flush();
}

let launchComplete = false;

export async function markLaunchComplete(): Promise<void> {
  if (launchComplete) return;
  launchComplete = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("launch_log_mark_complete");
  } catch {
    // Non-fatal: aggregator may not be enabled.
  }
}
