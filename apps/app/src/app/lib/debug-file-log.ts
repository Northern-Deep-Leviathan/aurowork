/**
 * Debug file logger — buffers log lines and flushes to /tmp/aurowork-debug.log
 * via the Rust `debug_log_append` command.
 *
 * Usage:
 *   import { debugLog, enableDebugFileLog, disableDebugFileLog } from "./debug-file-log";
 *   enableDebugFileLog();          // start logging
 *   debugLog("session.idle", { sessionID: "abc" });
 *   disableDebugFileLog();         // stop logging
 *
 * Read the log:  cat /tmp/aurowork-debug.log
 */

import { debugLogAppend, debugLogClear } from "./tauri";
import { isTauriRuntime } from "../utils";

let enabled = false;
let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 300; // ms

function formatLine(scope: string, event: string, payload?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${scope} | ${event}`;
  if (payload === undefined) return base;
  try {
    return `${base} | ${JSON.stringify(payload)}`;
  } catch {
    return `${base} | [unserializable]`;
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_INTERVAL);
}

function flush() {
  timer = null;
  if (buffer.length === 0) return;
  const lines = buffer;
  buffer = [];
  debugLogAppend(lines).catch(() => {
    // silently ignore — debug logging should never break the app
  });
}

/**
 * Write a debug log line. Only writes if debug file logging is enabled.
 */
export function debugFileLog(scope: string, event: string, payload?: unknown) {
  if (!enabled) return;
  buffer.push(formatLine(scope, event, payload));
  scheduleFlush();
}

/**
 * Enable debug file logging. Clears the previous log file.
 */
export function enableDebugFileLog() {
  if (!isTauriRuntime()) return;
  enabled = true;
  debugLogClear().catch(() => {});
  debugFileLog("debug", "enabled", { at: new Date().toISOString() });
}

/**
 * Disable debug file logging. Flushes remaining buffer.
 */
export function disableDebugFileLog() {
  enabled = false;
  flush();
}

/**
 * Check if debug file logging is currently enabled.
 */
export function isDebugFileLogEnabled() {
  return enabled;
}
