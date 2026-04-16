#!/usr/bin/env node
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  realpath,
} from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { homedir, hostname, networkInterfaces, tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { once } from "node:events";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { TuiHandle } from "./tui/app.js";

type ApprovalMode = "manual" | "auto";

type LogFormat = "pretty" | "json";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogAttributes = Record<string, unknown>;

type LoggerChild = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
  debug: (message: string, attributes?: LogAttributes) => void;
  info: (message: string, attributes?: LogAttributes) => void;
  warn: (message: string, attributes?: LogAttributes) => void;
  error: (message: string, attributes?: LogAttributes) => void;
};

type Logger = {
  format: LogFormat;
  output: "stdout" | "silent";
  log: (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  debug: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  info: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  warn: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  error: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  child: (component: string, attributes?: LogAttributes) => LoggerChild;
};

type LogEvent = {
  time: number;
  level: LogLevel;
  message: string;
  component?: string;
  attributes?: LogAttributes;
};

type OpencodeHotReload = {
  enabled: boolean;
  debounceMs: number;
  cooldownMs: number;
};

const FALLBACK_VERSION = "0.1.0";

declare const __AUROWORK_ORCHESTRATOR_VERSION__: string | undefined;
declare const __AUROWORK_PINNED_OPENCODE_VERSION__: string | undefined;
const DEFAULT_AUROWORK_PORT = 8787;
const DEFAULT_APPROVAL_TIMEOUT = 30000;
const MANAGED_OPENCODE_CREDENTIAL_LENGTH = 512;
const INTERNAL_OPENCODE_CREDENTIALS_ENV =
  "AUROWORK_INTERNAL_ALLOW_OPENCODE_CREDENTIALS";
const DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS = 700;
const DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS = 1500;
const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60_000;
const DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

const AUROWORK_DEV_DATA_DIR = "aurowork-dev-data";
const CLI_SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT_DIR = resolve(CLI_SOURCE_DIR, "..");
const REPO_ROOT_DIR = resolve(ORCHESTRATOR_ROOT_DIR, "..", "..");

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | boolean>;
};

type ChildHandle = {
  name: string;
  child: ReturnType<typeof spawn>;
};

type VersionInfo = {
  version: string;
  sha256: string;
};

type SidecarName = "aurowork-server" | "opencode";

type SidecarTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "windows-x64"
  | "windows-arm64";

type VersionManifest = {
  dir: string;
  entries: Record<string, VersionInfo>;
};

type RemoteSidecarAsset = {
  asset?: string;
  url?: string;
  sha256?: string;
  size?: number;
};

type RemoteSidecarEntry = {
  version: string;
  targets: Record<string, RemoteSidecarAsset>;
};

type RemoteSidecarManifest = {
  version: string;
  generatedAt?: string;
  entries: Record<string, RemoteSidecarEntry>;
};

type SidecarConfig = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
};

type BinarySource = "bundled" | "external" | "downloaded";

type BinarySourcePreference = "auto" | "bundled" | "downloaded" | "external";

type ResolvedBinary = {
  bin: string;
  source: BinarySource;
  expectedVersion?: string;
};

type BinaryDiagnostics = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

type RuntimeServiceName = "aurowork-server" | "opencode";

type RuntimeServiceSnapshot = {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  source?: BinarySource;
  path?: string;
  targetVersion?: string;
  actualVersion?: string;
  upgradeAvailable: boolean;
};

type RuntimeUpgradeState = {
  status: "idle" | "running" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  operationId: string | null;
  services: RuntimeServiceName[];
};

type SidecarDiagnostics = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

type WorkerActivityHeartbeatConfig = {
  enabled: boolean;
  workerId: string;
  url: string;
  token: string;
  intervalMs: number;
  activeWindowMs: number;
};

type RouterWorkspaceType = "local" | "remote";

type RouterWorkspace = {
  id: string;
  name: string;
  path: string;
  workspaceType: RouterWorkspaceType;
  baseUrl?: string;
  directory?: string;
  createdAt: number;
  lastUsedAt?: number;
};

type RouterDaemonState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

type RouterOpencodeState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

type RouterBinaryInfo = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

type RouterBinaryState = {
  opencode?: RouterBinaryInfo;
};

type RouterSidecarState = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

type RouterState = {
  version: number;
  daemon?: RouterDaemonState;
  opencode?: RouterOpencodeState;
  cliVersion?: string;
  sidecar?: RouterSidecarState;
  binaries?: RouterBinaryState;
  activeId: string;
  workspaces: RouterWorkspace[];
};

type OpencodeStateLayout = {
  devMode: boolean;
  rootDir: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  importConfigDir?: string;
  importDataDir?: string;
};

type FieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-v") {
      flags.set("version", true);
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    if (!trimmed) continue;

    if (trimmed.startsWith("no-")) {
      flags.set(trimmed.slice(3), false);
      continue;
    }

    const [key, inlineValue] = trimmed.split("=");
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { positionals, flags };
}

function parseList(value?: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFlag(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

function readBool(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: boolean,
  envKey?: string,
): boolean {
  const raw = flags.get(key);
  if (raw !== undefined) {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  const envValue = envKey ? process.env[envKey] : undefined;
  if (envValue) {
    const normalized = envValue.toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  return fallback;
}

function readOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function readNumber(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: number | undefined,
  envKey?: string,
): number | undefined {
  const raw = flags.get(key);
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (envKey) {
    const envValue = process.env[envKey];
    if (envValue) {
      const parsed = Number(envValue);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return fallback;
}

function readOpencodeHotReload(
  flags: Map<string, string | boolean>,
  defaults?: Partial<OpencodeHotReload>,
  env?: {
    enabled?: string;
    debounceMs?: string;
    cooldownMs?: string;
  },
): OpencodeHotReload {
  const enabled = readBool(
    flags,
    "opencode-hot-reload",
    defaults?.enabled ?? true,
    env?.enabled,
  );
  const debounceRaw = readNumber(
    flags,
    "opencode-hot-reload-debounce-ms",
    defaults?.debounceMs ?? DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
    env?.debounceMs,
  );
  const cooldownRaw = readNumber(
    flags,
    "opencode-hot-reload-cooldown-ms",
    defaults?.cooldownMs ?? DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
    env?.cooldownMs,
  );
  const debounceMs =
    typeof debounceRaw === "number" &&
    Number.isFinite(debounceRaw) &&
    debounceRaw >= 50
      ? Math.floor(debounceRaw)
      : DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS;
  const cooldownMs =
    typeof cooldownRaw === "number" &&
    Number.isFinite(cooldownRaw) &&
    cooldownRaw >= 100
      ? Math.floor(cooldownRaw)
      : DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS;
  return {
    enabled,
    debounceMs,
    cooldownMs,
  };
}

function readBinarySource(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: BinarySourcePreference,
  envKey?: string,
): BinarySourcePreference {
  const raw =
    readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "bundled" ||
    normalized === "downloaded" ||
    normalized === "external"
  ) {
    return normalized as BinarySourcePreference;
  }
  throw new Error(
    `Invalid ${key} value: ${raw}. Use auto|bundled|downloaded|external.`,
  );
}

function readLogFormat(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: LogFormat,
  envKey?: string,
): LogFormat {
  const raw =
    readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "json") return "json";
  if (
    normalized === "pretty" ||
    normalized === "text" ||
    normalized === "human"
  )
    return "pretty";
  throw new Error(`Invalid ${key} value: ${raw}. Use pretty|json.`);
}

function expandTildePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

async function isDir(input: string): Promise<boolean> {
  try {
    return (await stat(input)).isDirectory();
  } catch {
    return false;
  }
}

async function realpathOrNull(input: string): Promise<string | null> {
  try {
    return await realpath(input);
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCliVersion(): Promise<string> {
  if (
    typeof __AUROWORK_ORCHESTRATOR_VERSION__ === "string" &&
    __AUROWORK_ORCHESTRATOR_VERSION__.trim()
  ) {
    return __AUROWORK_ORCHESTRATOR_VERSION__.trim();
  }
  const candidates = [
    join(dirname(process.execPath), "..", "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        // ignore
      }
    }
  }

  return FALLBACK_VERSION;
}

async function readPinnedOpencodeVersion(): Promise<string | undefined> {
  if (
    typeof __AUROWORK_PINNED_OPENCODE_VERSION__ === "string" &&
    __AUROWORK_PINNED_OPENCODE_VERSION__.trim()
  ) {
    return __AUROWORK_PINNED_OPENCODE_VERSION__.trim();
  }

  const candidates = [
    join(dirname(process.execPath), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "constants.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { opencodeVersion?: unknown };
        const value =
          typeof parsed.opencodeVersion === "string"
            ? parsed.opencodeVersion.trim()
            : "";
        if (!value) continue;
        return value.startsWith("v") ? value.slice(1) : value;
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPathHelperPaths(): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  return await new Promise((resolve) => {
    const child = spawnProcess("/usr/libexec/path_helper", ["-s"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve([]));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      const match =
        stdout.match(/PATH="([^"]+)"/) ?? stdout.match(/PATH=([^;\n]+)/);
      if (!match) {
        resolve([]);
        return;
      }
      resolve(match[1].split(":").filter(Boolean));
    });
  });
}

async function ensureWorkspace(workspace: string): Promise<string> {
  const resolved = resolve(workspace);
  await mkdir(resolved, { recursive: true });

  const configPathJsonc = join(resolved, "opencode.jsonc");
  const configPathJson = join(resolved, "opencode.json");
  const hasJsonc = await fileExists(configPathJsonc);
  const hasJson = await fileExists(configPathJson);

  if (!hasJsonc && !hasJson) {
    const payload = JSON.stringify(
      { $schema: "https://opencode.ai/config.json" },
      null,
      2,
    );
    await writeFile(configPathJsonc, `${payload}\n`, "utf8");
  }

  return resolved;
}

async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", (err) => reject(err));
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function resolvePort(
  preferred: number | undefined,
  host: string,
  fallback?: number,
): Promise<number> {
  if (preferred && (await canBind(host, preferred))) {
    return preferred;
  }
  if (fallback && fallback !== preferred && (await canBind(host, fallback))) {
    return fallback;
  }
  return findFreePort(host);
}

function isCompiledBunBinary(): boolean {
  try {
    const entryPath = fileURLToPath(import.meta.url);
    return entryPath.startsWith("/$bunfs/");
  } catch {
    return false;
  }
}

function resolveLanIp(): string | null {
  const interfaces = networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key];
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      return entry.address;
    }
  }
  return null;
}

function resolveConnectUrl(
  port: number,
  overrideHost?: string,
): { connectUrl?: string; lanUrl?: string; mdnsUrl?: string } {
  if (overrideHost) {
    const trimmed = overrideHost.trim();
    if (trimmed) {
      const url = `http://${trimmed}:${port}`;
      return { connectUrl: url, lanUrl: url };
    }
  }

  const host = hostname().trim();
  const mdnsUrl = host
    ? `http://${host.replace(/\.local$/, "")}.local:${port}`
    : undefined;
  const lanIp = resolveLanIp();
  const lanUrl = lanIp ? `http://${lanIp}:${port}` : undefined;
  const connectUrl = lanUrl ?? mdnsUrl;
  return { connectUrl, lanUrl, mdnsUrl };
}

function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function randomCredential(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function generateManagedOpencodeCredentials(): {
  username: string;
  password: string;
} {
  return {
    username: randomCredential(MANAGED_OPENCODE_CREDENTIAL_LENGTH),
    password: randomCredential(MANAGED_OPENCODE_CREDENTIAL_LENGTH),
  };
}

function resolveManagedOpencodeCredentials(args: ParsedArgs): {
  username: string;
  password: string;
} {
  const explicitUsernameFlag = args.flags.get("opencode-username");
  const explicitPasswordFlag = args.flags.get("opencode-password");
  const requestedUsername =
    typeof explicitUsernameFlag === "string"
      ? explicitUsernameFlag
      : process.env.AUROWORK_OPENCODE_USERNAME ??
        process.env.OPENCODE_SERVER_USERNAME;
  const requestedPassword =
    typeof explicitPasswordFlag === "string"
      ? explicitPasswordFlag
      : process.env.AUROWORK_OPENCODE_PASSWORD ??
        process.env.OPENCODE_SERVER_PASSWORD;
  const allowInjectedCredentials =
    (process.env[INTERNAL_OPENCODE_CREDENTIALS_ENV] ?? "").trim() === "1";
  const hasExplicitCredentialFlags =
    typeof explicitUsernameFlag === "string" ||
    typeof explicitPasswordFlag === "string";

  if (
    hasExplicitCredentialFlags &&
    ((requestedUsername && !requestedPassword) ||
      (!requestedUsername && requestedPassword))
  ) {
    throw new Error(
      "OpenCode credentials must include both username and password.",
    );
  }

  if (requestedUsername && requestedPassword && hasExplicitCredentialFlags) {
    if (!allowInjectedCredentials) {
      throw new Error(
        "OpenCode credentials are managed by AuroWork. Custom --opencode-username/--opencode-password values are not supported.",
      );
    }
    return {
      username: requestedUsername,
      password: requestedPassword,
    };
  }

  if (requestedUsername && requestedPassword && allowInjectedCredentials) {
    return {
      username: requestedUsername,
      password: requestedPassword,
    };
  }

  return generateManagedOpencodeCredentials();
}

function assertManagedOpencodeAuth(args: ParsedArgs) {
  const authEnabled = readBool(
    args.flags,
    "opencode-auth",
    true,
    "AUROWORK_OPENCODE_AUTH",
  );
  if (!authEnabled) {
    throw new Error(
      "OpenCode basic auth is always enabled when AuroWork launches OpenCode.",
    );
  }
}

function resolveManagedOpencodeHost(requestedHost?: string): string {
  const normalized = requestedHost?.trim();
  if (!normalized) return "127.0.0.1";
  if (!isLoopbackHost(normalized)) {
    throw new Error(
      `OpenCode must stay on loopback. Unsupported --opencode-host value: ${normalized}`,
    );
  }
  return normalized === "localhost" ? "127.0.0.1" : normalized;
}

function resolveAuroworkRemoteAccess(args: ParsedArgs): boolean {
  const explicitHost =
    readFlag(args.flags, "aurowork-host") ?? process.env.AUROWORK_HOST;
  const remoteAccessRequested =
    readBool(args.flags, "remote-access", false, "AUROWORK_REMOTE_ACCESS") ||
    explicitHost?.trim() === "0.0.0.0";

  if (explicitHost) {
    const normalized = explicitHost.trim();
    if (!normalized) return remoteAccessRequested;
    if (normalized === "0.0.0.0") return true;
    if (!isLoopbackHost(normalized)) {
      throw new Error(
        `Unsupported --aurowork-host value: ${normalized}. Use loopback by default or --remote-access for shared access.`,
      );
    }
  }

  return remoteAccessRequested;
}

function unwrap<T>(result: FieldsResult<T>): T {
  if (result.data !== undefined) {
    return result.data;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

function parsePositiveNumberEnv(
  value: string | undefined,
  fallback: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseSessionActivityAt(session: unknown): number | null {
  if (!session || typeof session !== "object") return null;
  const record = session as {
    time?: { updated?: number; created?: number };
  };
  const updated = record.time?.updated;
  if (typeof updated === "number" && Number.isFinite(updated) && updated > 0) {
    return updated;
  }
  const created = record.time?.created;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    return created;
  }
  return null;
}

function resolveWorkerActivityHeartbeatConfig(): WorkerActivityHeartbeatConfig {
  const enabled = (process.env.DEN_ACTIVITY_HEARTBEAT_ENABLED ?? "")
    .trim()
    .toLowerCase();
  const provider = (process.env.DEN_RUNTIME_PROVIDER ?? "").trim().toLowerCase();
  const workerId = (process.env.DEN_WORKER_ID ?? "").trim();
  const url = (process.env.DEN_ACTIVITY_HEARTBEAT_URL ?? "").trim();
  const token = (process.env.DEN_ACTIVITY_HEARTBEAT_TOKEN ?? "").trim();

  const featureEnabled =
    enabled === "1" || enabled === "true" || enabled === "yes";

  if (!featureEnabled || provider !== "daytona" || !workerId || !url || !token) {
    return {
      enabled: false,
      workerId: "",
      url: "",
      token: "",
      intervalMs: DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS,
      activeWindowMs: DEFAULT_ACTIVITY_WINDOW_MS,
    };
  }

  const intervalSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS / 1000,
  );
  const activeWindowSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_WINDOW_SECONDS,
    DEFAULT_ACTIVITY_WINDOW_MS / 1000,
  );

  return {
    enabled: true,
    workerId,
    url,
    token,
    intervalMs: Math.round(intervalSeconds * 1000),
    activeWindowMs: Math.round(activeWindowSeconds * 1000),
  };
}

async function postWorkerActivityHeartbeat(input: {
  config: WorkerActivityHeartbeatConfig;
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  logger: Logger;
}) {
  if (!input.config.enabled) return;

  const sessions = unwrap(await input.opencodeClient.session.list({ limit: 200 }));
  let latestActivityAt = 0;
  for (const session of sessions) {
    const ts = parseSessionActivityAt(session);
    if (ts && ts > latestActivityAt) {
      latestActivityAt = ts;
    }
  }

  const now = Date.now();
  const isActiveRecently =
    latestActivityAt > 0 && now - latestActivityAt <= input.config.activeWindowMs;

  const payload = {
    sentAt: new Date(now).toISOString(),
    isActiveRecently,
    lastActivityAt:
      latestActivityAt > 0 ? new Date(latestActivityAt).toISOString() : null,
    openSessionCount: sessions.length,
  };

  const response = await fetch(input.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`heartbeat_failed:${response.status}`);
  }

  input.logger.debug(
    "Worker activity heartbeat sent",
    {
      workerId: input.config.workerId,
      isActiveRecently,
      lastActivityAt: payload.lastActivityAt,
      openSessionCount: payload.openSessionCount,
    },
    "aurowork-orchestrator",
  );
}

function prefixStream(
  stream: NodeJS.ReadableStream | null,
  label: string,
  level: "stdout" | "stderr",
  logger: Logger,
  pid?: number,
): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (
        logger.output === "stdout" &&
        logger.format === "json" &&
        looksLikeOtelLogLine(line)
      ) {
        process.stdout.write(`${line}\n`);
        continue;
      }
      const severity: LogLevel = level === "stderr" ? "error" : "info";
      logger.log(severity, line, { stream: level, pid }, label);
    }
  });
  stream.on("end", () => {
    if (!buffer.trim()) return;
    if (
      logger.output === "stdout" &&
      logger.format === "json" &&
      looksLikeOtelLogLine(buffer)
    ) {
      process.stdout.write(`${buffer}\n`);
      return;
    }
    const severity: LogLevel = level === "stderr" ? "error" : "info";
    logger.log(severity, buffer, { stream: level, pid }, label);
  });
}

function shouldUseBun(bin: string): boolean {
  if (!bin.endsWith(`${join("dist", "cli.js")}`)) return false;
  if (bin.includes("aurowork-server")) return true;
  return bin.includes(`${join("packages", "server")}`);
}

function resolveBinCommand(bin: string): {
  command: string;
  prefixArgs: string[];
} {
  if (bin.endsWith(".ts")) {
    return { command: "bun", prefixArgs: [bin, "--"] };
  }
  if (bin.endsWith(".js")) {
    if (shouldUseBun(bin)) {
      return { command: "bun", prefixArgs: [bin, "--"] };
    }
    return { command: "node", prefixArgs: [bin, "--"] };
  }
  return { command: bin, prefixArgs: [] };
}

async function readVersionManifest(): Promise<VersionManifest | null> {
  const candidates = [
    dirname(process.execPath),
    dirname(fileURLToPath(import.meta.url)),
  ];
  for (const dir of candidates) {
    const manifestPath = join(dir, "versions.json");
    if (await fileExists(manifestPath)) {
      try {
        const payload = await readFile(manifestPath, "utf8");
        const entries = JSON.parse(payload) as Record<string, VersionInfo>;
        return { dir, entries };
      } catch {
        return { dir, entries: {} };
      }
    }
  }
  return null;
}

const remoteManifestCache = new Map<
  string,
  Promise<RemoteSidecarManifest | null>
>();

let cachedExtraPathEntries: string[] | null = null;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function splitPathEntries(value?: string): string[] {
  if (!value) return [];
  return value.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function pushPath(entries: string[], path?: string | null) {
  if (!path) return;
  const candidate = resolve(path.trim());
  if (!isDirectory(candidate)) return;
  if (!entries.includes(candidate)) entries.push(candidate);
}

function nvmVersionBinPaths(home: string): string[] {
  const base = join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(base, entry.name, "bin"))
      .filter(isDirectory)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function resolveExtraPathEntries(): string[] {
  if (cachedExtraPathEntries) return cachedExtraPathEntries;

  const entries: string[] = [];
  const sidecarOverride =
    process.env.OPENWRK_SIDECAR_DIR ?? process.env.AUROWORK_SIDECAR_DIR;
  const sidecarCandidates = [
    sidecarOverride,
    dirname(process.execPath),
    join(dirname(process.execPath), "sidecars"),
    join(ORCHESTRATOR_ROOT_DIR, "dist"),
    resolve(REPO_ROOT_DIR, "apps", "desktop", "src-tauri", "sidecars"),
  ];
  for (const candidate of sidecarCandidates) {
    pushPath(entries, candidate);
  }

  const home = homedir();
  if (process.platform === "darwin") {
    for (const candidate of [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      join(home, ".fnm", "current", "bin"),
      join(home, ".volta", "bin"),
      join(home, "Library", "pnpm"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      join(home, ".pyenv", "shims"),
      join(home, ".local", "bin"),
    ]) {
      pushPath(entries, candidate);
    }
  }

  if (process.platform === "linux") {
    for (const candidate of [
      "/usr/local/bin",
      "/usr/local/sbin",
      join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      join(home, ".fnm", "current", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".local", "share", "pnpm"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      join(home, ".pyenv", "shims"),
      join(home, ".local", "bin"),
    ]) {
      pushPath(entries, candidate);
    }
  }

  if (process.platform === "win32") {
    for (const candidate of [
      join(home, ".volta", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm") : null,
    ]) {
      pushPath(entries, candidate);
    }
  }

  cachedExtraPathEntries = entries;
  return entries;
}

function buildSpawnEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = env ?? process.env;
  const pathKey =
    Object.prototype.hasOwnProperty.call(base, "PATH") ||
    !Object.prototype.hasOwnProperty.call(base, "Path")
      ? "PATH"
      : "Path";
  const currentPath = pathKey === "PATH" ? base.PATH : base.Path;
  const entries = [
    ...resolveExtraPathEntries(),
    ...splitPathEntries(currentPath),
  ];
  const deduped = entries.filter((entry, index) => entries.indexOf(entry) === index);
  if (!deduped.length) return { ...base };
  return { ...base, [pathKey]: deduped.join(delimiter) };
}

function resolveSidecarTarget(): SidecarTarget | null {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "darwin-arm64";
    if (process.arch === "x64") return "darwin-x64";
    return null;
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "linux-arm64";
    if (process.arch === "x64") return "linux-x64";
    return null;
  }
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "windows-arm64";
    if (process.arch === "x64") return "windows-x64";
    return null;
  }
  return null;
}

function resolveSidecarConfigForTarget(
  flags: Map<string, string | boolean>,
  cliVersion: string,
  targetOverride: SidecarTarget | null,
): SidecarConfig {
  const baseUrl = resolveSidecarBaseUrl(flags, cliVersion);
  return {
    dir: resolveSidecarDir(flags),
    baseUrl,
    manifestUrl: resolveSidecarManifestUrl(flags, baseUrl),
    target: targetOverride,
  };
}

function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
) {
  const env = buildSpawnEnv(options.env);
  const resolvedOptions = { ...options, env };
  if (process.platform === "win32") {
    return spawn(command, args, { ...resolvedOptions, windowsHide: true });
  }
  return spawn(command, args, resolvedOptions);
}

async function probeCommand(
  command: string,
  args: string[],
  timeoutMs = 2500,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

function shQuote(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveSidecarDir(flags: Map<string, string | boolean>): string {
  const override =
    readFlag(flags, "sidecar-dir") ?? process.env.AUROWORK_SIDECAR_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(resolveRouterDataDir(flags), "sidecars");
}

function resolveSidecarBaseUrl(
  flags: Map<string, string | boolean>,
  cliVersion: string,
): string {
  const override =
    readFlag(flags, "sidecar-base-url") ??
    process.env.AUROWORK_SIDECAR_BASE_URL;
  if (override && override.trim()) return override.trim();
  return `https://github.com/Northern-Deep-Leviathan/aurowork/releases/download/aurowork-orchestrator-v${cliVersion}`;
}

function resolveSidecarManifestUrl(
  flags: Map<string, string | boolean>,
  baseUrl: string,
): string {
  const override =
    readFlag(flags, "sidecar-manifest") ??
    process.env.AUROWORK_SIDECAR_MANIFEST_URL;
  if (override && override.trim()) return override.trim();
  return `${baseUrl.replace(/\/$/, "")}/aurowork-orchestrator-sidecars.json`;
}

function resolveSidecarConfig(
  flags: Map<string, string | boolean>,
  cliVersion: string,
): SidecarConfig {
  const baseUrl = resolveSidecarBaseUrl(flags, cliVersion);
  return {
    dir: resolveSidecarDir(flags),
    baseUrl,
    manifestUrl: resolveSidecarManifestUrl(flags, baseUrl),
    target: resolveSidecarTarget(),
  };
}

async function fetchRemoteManifest(
  url: string,
): Promise<RemoteSidecarManifest | null> {
  const cached = remoteManifestCache.get(url);
  if (cached) return cached;
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as RemoteSidecarManifest;
    } catch {
      return null;
    }
  })();
  remoteManifestCache.set(url, task);
  return task;
}

function resolveAssetUrl(
  baseUrl: string,
  asset?: string,
  url?: string,
): string | null {
  if (url && url.trim()) return url.trim();
  if (asset && asset.trim())
    return `${baseUrl.replace(/\/$/, "")}/${asset.trim()}`;
  return null;
}

function resolveAssetName(asset?: string, url?: string): string | null {
  if (asset && asset.trim()) return asset.trim();
  if (url && url.trim()) {
    try {
      return basename(new URL(url).pathname);
    } catch {
      const parts = url.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    }
  }
  return null;
}

async function downloadToPath(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  const tmpPath = `${dest}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, dest);
}

async function ensureExecutable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await chmod(path, 0o755);
  } catch {
    // ignore
  }
}

async function downloadSidecarBinary(options: {
  name: SidecarName;
  sidecar: SidecarConfig;
  expectedVersion?: string;
}): Promise<ResolvedBinary | null> {
  if (!options.sidecar.target) return null;
  const manifest = await fetchRemoteManifest(options.sidecar.manifestUrl);
  if (!manifest) return null;
  const entry = manifest.entries[options.name];
  if (!entry) return null;
  if (options.expectedVersion && entry.version !== options.expectedVersion) {
    return null;
  }
  const targetInfo = entry.targets[options.sidecar.target];
  if (!targetInfo) return null;

  const assetName = resolveAssetName(targetInfo.asset, targetInfo.url);
  const assetUrl = resolveAssetUrl(
    options.sidecar.baseUrl,
    targetInfo.asset,
    targetInfo.url,
  );
  if (!assetName || !assetUrl) return null;

  const targetDir = join(
    options.sidecar.dir,
    entry.version,
    options.sidecar.target,
  );
  const targetPath = join(targetDir, assetName);
  if (await fileExists(targetPath)) {
    if (targetInfo.sha256) {
      try {
        await verifyBinary(targetPath, {
          version: entry.version,
          sha256: targetInfo.sha256,
        });
        await ensureExecutable(targetPath);
        return {
          bin: targetPath,
          source: "downloaded",
          expectedVersion: entry.version,
        };
      } catch {
        await rm(targetPath, { force: true });
      }
    } else {
      await ensureExecutable(targetPath);
      return {
        bin: targetPath,
        source: "downloaded",
        expectedVersion: entry.version,
      };
    }
  }

  await downloadToPath(assetUrl, targetPath);
  if (targetInfo.sha256) {
    await verifyBinary(targetPath, {
      version: entry.version,
      sha256: targetInfo.sha256,
    });
  }
  await ensureExecutable(targetPath);
  return {
    bin: targetPath,
    source: "downloaded",
    expectedVersion: entry.version,
  };
}

function resolveOpencodeAsset(target: SidecarTarget): string | null {
  const assets: Record<SidecarTarget, string> = {
    "darwin-arm64": "opencode-darwin-arm64.zip",
    "darwin-x64": "opencode-darwin-x64-baseline.zip",
    "linux-x64": "opencode-linux-x64-baseline.tar.gz",
    "linux-arm64": "opencode-linux-arm64.tar.gz",
    "windows-x64": "opencode-windows-x64-baseline.zip",
    "windows-arm64": "opencode-windows-arm64.zip",
  };
  return assets[target] ?? null;
}

async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
): Promise<void> {
  const child = spawnProcess(command, args, { cwd, stdio: "inherit" });
  const result = await Promise.race([
    once(child, "exit").then(([code]) => ({ type: "exit" as const, code })),
    once(child, "error").then(([error]) => ({ type: "error" as const, error })),
  ]);
  if (result.type === "error") {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}: ${String(result.error)}`,
    );
  }
  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function resolveOpencodeDownload(
  sidecar: SidecarConfig,
  expectedVersion?: string,
): Promise<string | null> {
  if (!expectedVersion) return null;
  if (!sidecar.target) return null;

  const assetOverride =
    process.env.AUROWORK_OPENCODE_ASSET ?? process.env.OPENCODE_ASSET;
  const asset = assetOverride?.trim() || resolveOpencodeAsset(sidecar.target);
  if (!asset) return null;

  const version = expectedVersion.startsWith("v")
    ? expectedVersion.slice(1)
    : expectedVersion;
  const url = `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`;
  const targetDir = join(sidecar.dir, "opencode", version, sidecar.target);
  const targetPath = join(
    targetDir,
    process.platform === "win32" ? "opencode.exe" : "opencode",
  );

  const hostTarget = resolveSidecarTarget();
  const runnableOnHost = hostTarget !== null && sidecar.target === hostTarget;

  if (await fileExists(targetPath)) {
    if (!runnableOnHost) {
      await ensureExecutable(targetPath);
      return targetPath;
    }
    const actual = await readCliVersion(targetPath);
    if (actual === version) {
      await ensureExecutable(targetPath);
      return targetPath;
    }
  }

  await mkdir(targetDir, { recursive: true });
  const stamp = Date.now();
  const archivePath = join(
    tmpdir(),
    `aurowork-orchestrator-opencode-${stamp}-${asset}`,
  );
  const extractDir = await mkdtemp(
    join(tmpdir(), "aurowork-orchestrator-opencode-"),
  );

  try {
    await downloadToPath(url, archivePath);
    if (process.platform === "win32") {
      const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      const psScript = [
        "$ErrorActionPreference = 'Stop'",
        `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
      ].join("; ");
      await runCommand("powershell", ["-NoProfile", "-Command", psScript]);
    } else if (asset.endsWith(".zip")) {
      await runCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    } else if (asset.endsWith(".tar.gz")) {
      await runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    } else {
      throw new Error(`Unsupported opencode asset type: ${asset}`);
    }

    const entries = await readdir(extractDir, { withFileTypes: true });
    const queue = entries.map((entry) => join(extractDir, entry.name));
    let candidate: string | null = null;
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      const statInfo = await stat(current);
      if (statInfo.isDirectory()) {
        const nested = await readdir(current, { withFileTypes: true });
        queue.push(...nested.map((entry) => join(current, entry.name)));
        continue;
      }
      const base = basename(current);
      if (base === "opencode" || base === "opencode.exe") {
        candidate = current;
        break;
      }
    }

    if (!candidate) {
      throw new Error("OpenCode binary not found after extraction.");
    }

    await copyFile(candidate, targetPath);
    await ensureExecutable(targetPath);
    return targetPath;
  } finally {
    await rm(extractDir, { recursive: true, force: true });
    await rm(archivePath, { force: true });
  }
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function verifyBinary(
  path: string,
  expected?: VersionInfo,
): Promise<void> {
  if (!expected) return;
  const hash = await sha256File(path);
  if (hash !== expected.sha256) {
    throw new Error(`Integrity check failed for ${path}`);
  }
}

async function resolveBundledBinary(
  manifest: VersionManifest | null,
  name: string,
): Promise<string | null> {
  if (!manifest) return null;
  const candidates = [join(manifest.dir, name)];
  if (process.platform === "win32") {
    candidates.push(join(manifest.dir, `${name}.exe`));
  }
  for (const bundled of candidates) {
    if (!(await isExecutable(bundled))) continue;
    // Desktop bundles may be code-signed after we generate versions.json, which
    // mutates the on-disk bytes and makes a precomputed sha256 unstable.
    // Linux bundles remain byte-stable, so keep integrity verification there.
    if (process.platform === "linux") {
      await verifyBinary(bundled, manifest.entries[name]);
    }
    return bundled;
  }
  return null;
}

async function readPackageVersion(path: string): Promise<string | undefined> {
  try {
    const payload = await readFile(path, "utf8");
    const parsed = JSON.parse(payload) as { version?: string };
    if (typeof parsed.version === "string") return parsed.version;
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveExpectedVersion(
  manifest: VersionManifest | null,
  name: SidecarName,
): Promise<string | undefined> {
  if (name !== "opencode") {
    const manifestVersion = manifest?.entries[name]?.version;
    if (manifestVersion) return manifestVersion;
  }

  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    if (name === "aurowork-server") {
      const localPath = join(root, "..", "server", "package.json");
      const localVersion = await readPackageVersion(localPath);
      if (localVersion) return localVersion;
    }
    if (name === "opencode") {
      const pinnedVersion = await readPinnedOpencodeVersion();
      if (pinnedVersion) return pinnedVersion;
    }
  } catch {
    // ignore
  }

  const require = createRequire(import.meta.url);
  if (name === "aurowork-server") {
    try {
      const pkgPath = require.resolve("aurowork-server/package.json");
      const version = await readPackageVersion(pkgPath);
      if (version) return version;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/);
  return match?.[0];
}

async function readCliVersion(
  bin: string,
  timeoutMs = 4000,
): Promise<string | undefined> {
  const resolved = resolveBinCommand(bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, "--version"],
    {
      // Avoid picking up a local bunfig.toml preload from the caller's cwd.
      // (Notably, packages/orchestrator/bunfig.toml preloads @opentui/solid/preload which
      // breaks running bun-compiled binaries during version checks.)
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const result = await Promise.race([
    once(child, "close").then(() => "close"),
    once(child, "error").then(() => "error"),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout")),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    return undefined;
  }

  if (result === "error") {
    return undefined;
  }

  return parseVersion(output.trim());
}

async function captureCommandOutput(
  bin: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
  const resolved = resolveBinCommand(bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, ...args],
    {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: options?.env ?? process.env,
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  type CaptureResult =
    | "timeout"
    | "error"
    | {
        type: "close";
        code: number | null;
        signal: NodeJS.Signals | null;
      };

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const result = await Promise.race<CaptureResult>([
    once(child, "close").then(([code, signal]) => ({
      type: "close" as const,
      code: (code ?? null) as number | null,
      signal: (signal ?? null) as NodeJS.Signals | null,
    })),
    once(child, "error").then(() => "error" as const),
    new Promise<CaptureResult>((resolve) =>
      setTimeout(resolve, timeoutMs, "timeout"),
    ),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw new Error("Command timed out");
  }

  if (result === "error") {
    throw new Error("Command failed to run");
  }

  const code = result.code;
  if (code !== 0) {
    const suffix = output.trim() ? `\n${output.trim()}` : "";
    throw new Error(`Command failed: ${bin} ${args.join(" ")}${suffix}`);
  }

  return output.trim();
}

function assertVersionMatch(
  name: string,
  expected: string | undefined,
  actual: string | undefined,
  context: string,
): void {
  if (!expected) return;
  if (!actual) {
    throw new Error(
      `Unable to determine ${name} version from ${context}. Expected ${expected}.`,
    );
  }
  if (expected !== actual) {
    throw new Error(
      `${name} version mismatch: expected ${expected}, got ${actual}.`,
    );
  }
}

function resolveBinPath(bin: string): string {
  if (bin.includes("/") || bin.startsWith(".")) {
    return resolve(process.cwd(), bin);
  }
  return bin;
}

function isPathLikeBinary(bin: string): boolean {
  return bin.includes("/") || bin.startsWith(".");
}

async function resolveAuroworkServerBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("aurowork-server-bin requires --allow-external");
  }
  if (
    options.explicit &&
    options.source !== "auto" &&
    options.source !== "external"
  ) {
    throw new Error(
      "aurowork-server-bin requires --sidecar-source external or auto",
    );
  }

  const expectedVersion = await resolveExpectedVersion(
    options.manifest,
    "aurowork-server",
  );
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External aurowork-server requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if (
        (resolved.includes("/") || resolved.startsWith(".")) &&
        !(await fileExists(resolved))
      ) {
        throw new Error(`aurowork-server-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }

    const require = createRequire(import.meta.url);
    try {
      const pkgPath = require.resolve("aurowork-server/package.json");
      const pkgDir = dirname(pkgPath);
      const binaryPath = join(pkgDir, "dist", "bin", "aurowork-server");
      if (await isExecutable(binaryPath)) {
        return { bin: binaryPath, source: "external", expectedVersion };
      }
      const cliPath = join(pkgDir, "dist", "cli.js");
      if (await isExecutable(cliPath)) {
        return { bin: cliPath, source: "external", expectedVersion };
      }
    } catch {
      // ignore
    }

    return { bin: "aurowork-server", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(
      options.manifest,
      "aurowork-server",
    );
    if (!bundled) {
      throw new Error(
        "Bundled aurowork-server binary missing. Build with pnpm --filter aurowork-orchestrator build:bin:bundled.",
      );
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({
      name: "aurowork-server",
      sidecar: options.sidecar,
    });
    if (!downloaded) {
      throw new Error(
        "aurowork-server download failed. Check sidecar manifest or base URL.",
      );
    }
    return downloaded;
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(
    options.manifest,
    "aurowork-server",
  );
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({
    name: "aurowork-server",
    sidecar: options.sidecar,
  });
  if (downloaded) return downloaded;

  if (!options.allowExternal) {
    throw new Error(
      "Bundled aurowork-server binary missing and download failed. Use --allow-external or --sidecar-source external.",
    );
  }

  return resolveExternal();
}

async function resolveOpencodeBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("opencode-bin requires --allow-external");
  }
  if (
    options.explicit &&
    options.source !== "auto" &&
    options.source !== "external"
  ) {
    throw new Error("opencode-bin requires --opencode-source external or auto");
  }

  const expectedVersion = await resolveExpectedVersion(
    options.manifest,
    "opencode",
  );
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External opencode requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if (
        (resolved.includes("/") || resolved.startsWith(".")) &&
        !(await fileExists(resolved))
      ) {
        throw new Error(`opencode-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }
    return { bin: "opencode", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(options.manifest, "opencode");
    if (!bundled) {
      throw new Error(
        "Bundled opencode binary missing. Build with pnpm --filter aurowork-orchestrator build:bin:bundled.",
      );
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({
      name: "opencode",
      sidecar: options.sidecar,
      expectedVersion,
    });
    if (downloaded) return downloaded;
    const opencodeDownloaded = await resolveOpencodeDownload(
      options.sidecar,
      expectedVersion,
    );
    if (opencodeDownloaded) {
      return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
    }
    throw new Error(
      "opencode download failed. Check sidecar manifest/network access, or update constants.json.",
    );
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(options.manifest, "opencode");
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({
    name: "opencode",
    sidecar: options.sidecar,
    expectedVersion,
  });
  if (downloaded) return downloaded;

  const opencodeDownloaded = await resolveOpencodeDownload(
    options.sidecar,
    expectedVersion,
  );
  if (opencodeDownloaded) {
    return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
  }

  if (!options.allowExternal) {
    throw new Error(
      "Bundled opencode binary missing and download failed. Use --allow-external or --opencode-source external.",
    );
  }

  return resolveExternal();
}

function resolveRouterDataDir(flags: Map<string, string | boolean>): string {
  const override = readFlag(flags, "data-dir") ?? process.env.AUROWORK_DATA_DIR;
  if (override && override.trim()) {
    return resolve(override.trim());
  }
  return join(homedir(), ".aurowork", "aurowork-orchestrator");
}

function resolveWorkspaceAuroworkConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "aurowork.json");
}

function resolveInternalDevMode(flags: Map<string, string | boolean>): boolean {
  return readBool(flags, "internal-dev-mode", false, "AUROWORK_DEV_MODE");
}

function internalDevModeFromEnv(): boolean {
  const value = process.env.AUROWORK_DEV_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function resolveOpencodeStateLayout(options: {
  dataDir: string;
  workspace: string;
  devMode: boolean;
}): OpencodeStateLayout {
  if (!options.devMode) {
    return {
      devMode: false,
      rootDir: join(options.dataDir, "opencode-config"),
      configDir: join(options.dataDir, "opencode-config"),
      env: {},
    };
  }

  const rootDir = join(options.dataDir, AUROWORK_DEV_DATA_DIR);
  const homeDir = join(rootDir, "home");
  const xdgConfigHome = join(rootDir, "xdg", "config");
  const xdgDataHome = join(rootDir, "xdg", "data");
  const xdgCacheHome = join(rootDir, "xdg", "cache");
  const xdgStateHome = join(rootDir, "xdg", "state");
  const configDir = join(rootDir, "config", "opencode");

  return {
    devMode: true,
    rootDir,
    configDir,
    importConfigDir:
      process.env.AUROWORK_DEV_OPENCODE_IMPORT_CONFIG_DIR?.trim() || undefined,
    importDataDir:
      process.env.AUROWORK_DEV_OPENCODE_IMPORT_DATA_DIR?.trim() || undefined,
    env: {
      AUROWORK_DEV_MODE: "1",
      OPENCODE_TEST_HOME: homeDir,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_STATE_HOME: xdgStateHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
  };
}

async function ensureOpencodeStateLayout(
  layout: OpencodeStateLayout,
): Promise<void> {
  await mkdir(layout.configDir, { recursive: true });
  if (!layout.devMode) return;

  const homeDir = layout.env.HOME;
  const xdgConfigHome = layout.env.XDG_CONFIG_HOME;
  const xdgDataHome = layout.env.XDG_DATA_HOME;
  const xdgCacheHome = layout.env.XDG_CACHE_HOME;
  const xdgStateHome = layout.env.XDG_STATE_HOME;
  const opencodeDataDir = xdgDataHome
    ? join(xdgDataHome, "opencode")
    : undefined;

  for (const dir of [
    layout.rootDir,
    homeDir,
    xdgConfigHome,
    xdgDataHome,
    xdgCacheHome,
    xdgStateHome,
    opencodeDataDir,
  ]) {
    if (!dir) continue;
    await mkdir(dir, { recursive: true });
  }

  if (layout.importConfigDir && (await isDir(layout.importConfigDir))) {
    const entries = await readdir(layout.configDir).catch(() => [] as string[]);
    if (entries.length === 0) {
      await cp(layout.importConfigDir, layout.configDir, {
        recursive: true,
        force: false,
      }).catch(() => undefined);
    }
  }

  if (
    layout.importDataDir &&
    opencodeDataDir &&
    (await isDir(layout.importDataDir))
  ) {
    for (const file of ["auth.json", "mcp-auth.json"]) {
      const dest = join(opencodeDataDir, file);
      if (await fileExists(dest)) continue;
      const source = join(layout.importDataDir, file);
      if (await fileExists(source)) {
        await copyFile(source, dest).catch(() => undefined);
      }
    }
  }
}

function routerStatePath(dataDir: string): string {
  return join(dataDir, "aurowork-orchestrator-state.json");
}

function nowMs(): number {
  return Date.now();
}

async function loadRouterState(path: string): Promise<RouterState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as RouterState;
    if (!parsed.workspaces) parsed.workspaces = [];
    if (!parsed.activeId) parsed.activeId = "";
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return {
      version: 1,
      daemon: undefined,
      opencode: undefined,
      cliVersion: undefined,
      sidecar: undefined,
      binaries: undefined,
      activeId: "",
      workspaces: [],
    };
  }
}

async function saveRouterState(
  path: string,
  state: RouterState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify(state, null, 2);
  await writeFile(path, `${payload}\n`, "utf8");
}

function normalizeWorkspacePath(input: string): string {
  return resolve(input).replace(/[\\/]+$/, "");
}

function workspaceIdForLocal(path: string): string {
  return `ws-${createHash("sha1").update(path).digest("hex").slice(0, 12)}`;
}

function workspaceIdForRemote(
  baseUrl: string,
  directory?: string | null,
): string {
  const key = directory ? `${baseUrl}::${directory}` : baseUrl;
  return `ws-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

async function ensureOpencodeManagedTools(configDir: string): Promise<void> {
  const toolsDir = join(configDir, "tools");
  await mkdir(toolsDir, { recursive: true });
}

function findWorkspace(
  state: RouterState,
  input: string,
): RouterWorkspace | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const direct = state.workspaces.find(
    (entry) => entry.id === trimmed || entry.name === trimmed,
  );
  if (direct) return direct;
  const normalized = normalizeWorkspacePath(trimmed);
  return state.workspaces.find(
    (entry) => entry.path && normalizeWorkspacePath(entry.path) === normalized,
  );
}

function isProcessAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveSelfCommand(): { command: string; prefixArgs: string[] } {
  const arg1 = process.argv[1];
  if (!arg1) return { command: process.argv[0], prefixArgs: [] };
  if (arg1.endsWith(".js") || arg1.endsWith(".ts")) {
    return { command: process.argv[0], prefixArgs: [arg1] };
  }
  return { command: process.argv[0], prefixArgs: [] };
}

async function waitForHealthy(
  url: string,
  timeoutMs = 10_000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for health check");
}

async function waitForOpencodeHealthy(
  client: ReturnType<typeof createOpencodeClient>,
  timeoutMs = 10_000,
  pollMs = 250,
) {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const health = unwrap(await client.global.health());
      if (health?.healthy) return health;
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for OpenCode health");
}

function printHelp(): void {
  const message = [
    "aurowork",
    "",
    "Usage:",
    "  aurowork start [--workspace <path>] [options]",
    "  aurowork serve [--workspace <path>] [options]",
    "  aurowork daemon [run|start|stop|status] [options]",
    "  aurowork workspace <action> [options]",
    "  aurowork instance dispose <id> [options]",
    "  aurowork approvals list --aurowork-url <url> --host-token <token>",
    "  aurowork approvals reply <id> --allow|--deny --aurowork-url <url> --host-token <token>",
    "  aurowork files <action> [options]",
    "  aurowork status [--aurowork-url <url>] [--opencode-url <url>]",
    "",
    "Commands:",
    "  start                   Start OpenCode + AuroWork server",
    "  serve                   Start services and stream logs (no TUI)",
    "  daemon                  Run orchestrator router daemon (multi-workspace)",
    "  workspace               Manage workspaces (add/list/switch/path)",
    "  instance                Manage workspace instances (dispose)",
    "  approvals list           List pending approval requests",
    "  approvals reply <id>     Approve or deny a request",
    "  files                   Manage file sessions and batch file sync",
    "  status                  Check OpenCode/AuroWork health",
    "",
    "Options:",
    "  --workspace <path>        Workspace directory (default: cwd)",
    "  --data-dir <path>         Data dir for orchestrator router state",
    "  --daemon-host <host>      Host for orchestrator router daemon (default: 127.0.0.1)",
    "  --daemon-port <port>      Port for orchestrator router daemon (default: random)",
    "  --opencode-bin <path>     Path to opencode binary (requires --allow-external)",
    "  --opencode-host <host>    Bind host for opencode serve (loopback only, default: 127.0.0.1)",
    "  --opencode-port <port>    Port for opencode serve (default: random)",
    "  --opencode-workdir <p>    Workdir for router-managed opencode serve",
    "  --opencode-auth           OpenCode basic auth is always enabled",
    "  --opencode-hot-reload     Enable OpenCode hot reload (default: true)",
    "  --opencode-hot-reload-debounce-ms <ms>  Debounce window for hot reload triggers (default: 700)",
    "  --opencode-hot-reload-cooldown-ms <ms>  Minimum interval between hot reloads (default: 1500)",
    "  --opencode-username <u>   Internal-only override for managed OpenCode auth username",
    "  --opencode-password <p>   Internal-only override for managed OpenCode auth password",
    "  --aurowork-host <host>    Bind host for aurowork-server (default: 127.0.0.1)",
    "  --aurowork-port <port>    Port for aurowork-server (default: 8787)",
    "  --remote-access           Expose AuroWork on 0.0.0.0 for remote sharing",
    "  --aurowork-token <token>  Client token for aurowork-server",
    "  --aurowork-host-token <t> Host token for approvals",
    "  --workspace-id <id>       Workspace id for file session commands",
    "  --session-id <id>         File session id for file session commands",
    "  --path <path>             Workspace-relative file path",
    "  --paths <list>            Comma-separated list of workspace-relative file paths",
    "  --ttl-seconds <n>         File session TTL in seconds",
    "  --content <text>          Inline content for file writes",
    "  --content-base64 <b64>    Base64 content for file writes",
    "  --file <path>             Local file path for file writes",
    "  --if-match <revision>     Revision precondition for file writes",
    "  --from <path>             Source path for rename",
    "  --to <path>               Destination path for rename",
    "  --write                   Request writable file session",
    "  --force                   Force write despite revision mismatch",
    "  --recursive               Recursive delete for files delete",
    "  --approval <mode>         manual | auto (default: manual)",
    "  --approval-timeout <ms>   Approval timeout in ms",
    "  --read-only               Start AuroWork server in read-only mode",
    "  --cors <origins>          Comma-separated CORS origins or *",
    "  --connect-host <host>     Override LAN host used for pairing URLs",
    "  --aurowork-server-bin <p> Path to aurowork-server binary (requires --allow-external)",
    "  --allow-external          Allow external sidecar binaries (dev only, required for custom bins)",
    "  --sidecar-dir <path>      Cache directory for downloaded sidecars",
    "  --sidecar-base-url <url>  Base URL for sidecar downloads",
    "  --sidecar-manifest <url>  Override sidecar manifest URL",
    "  --sidecar-source <mode>   auto | bundled | downloaded | external",
    "  --opencode-source <mode>  auto | bundled | downloaded | external",
    "  --check                   Run health checks then exit",
    "  --check-events            Verify SSE events during check",
    "  --tui                     Force interactive dashboard (TTY only)",
    "  --no-tui                  Disable interactive dashboard",
    "  --detach                  Detach after start and keep services running",
    "  --json                    Output JSON when applicable",
    "  --verbose                 Print additional diagnostics",
    "  --log-format <format>     Log output format: pretty | json",
    "  --color                   Force ANSI color output",
    "  --no-color                Disable ANSI color output",
    "  --run-id <id>             Correlation id for logs (default: random UUID)",
    "  --help                    Show help",
    "  --version                 Show version",
  ].join("\n");
  console.log(message);
}

async function stopChild(
  child: ReturnType<typeof spawn>,
  timeoutMs = 2500,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
  if (exited) return;
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
}

async function startOpencode(options: {
  bin: string;
  workspace: string;
  stateLayout?: OpencodeStateLayout;
  hotReload: OpencodeHotReload;
  bindHost: string;
  port: number;
  username?: string;
  password?: string;
  corsOrigins: string[];
  logger: Logger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = [
    "serve",
    "--hostname",
    options.bindHost,
    "--port",
    String(options.port),
  ];
  for (const origin of options.corsOrigins) {
    args.push("--cors", origin);
  }

  const child = spawnProcess(options.bin, args, {
    cwd: options.workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.stateLayout?.env ?? {}),
      OPENCODE_CLIENT: "aurowork-orchestrator",
      AUROWORK: "1",
      AUROWORK_RUN_ID: options.runId,
      AUROWORK_LOG_FORMAT: options.logFormat,
      OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
        {
          "service.name": "opencode",
          "service.instance.id": options.runId,
        },
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      ...(options.username
        ? { OPENCODE_SERVER_USERNAME: options.username }
        : {}),
      ...(options.password
        ? { OPENCODE_SERVER_PASSWORD: options.password }
        : {}),
      ...(options.stateLayout?.configDir
        ? { OPENCODE_CONFIG_DIR: options.stateLayout.configDir }
        : {}),
      OPENCODE_HOT_RELOAD: options.hotReload.enabled ? "1" : "0",
      OPENCODE_HOT_RELOAD_DEBOUNCE_MS: String(options.hotReload.debounceMs),
      OPENCODE_HOT_RELOAD_COOLDOWN_MS: String(options.hotReload.cooldownMs),
    },
  });

  prefixStream(
    child.stdout,
    "opencode",
    "stdout",
    options.logger,
    child.pid ?? undefined,
  );
  prefixStream(
    child.stderr,
    "opencode",
    "stderr",
    options.logger,
    child.pid ?? undefined,
  );

  return child;
}

async function startAuroworkServer(options: {
  bin: string;
  host: string;
  port: number;
  workspace: string;
  token: string;
  hostToken: string;
  approvalMode: ApprovalMode;
  approvalTimeoutMs: number;
  readOnly: boolean;
  corsOrigins: string[];
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  controlBaseUrl?: string;
  controlToken?: string;
  logger: Logger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = [
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--token",
    options.token,
    "--host-token",
    options.hostToken,
    "--workspace",
    options.workspace,
    "--approval",
    options.approvalMode,
    "--approval-timeout",
    String(options.approvalTimeoutMs),
  ];

  if (options.readOnly) {
    args.push("--read-only");
  }

  if (options.corsOrigins.length) {
    args.push("--cors", options.corsOrigins.join(","));
  }

  if (options.opencodeBaseUrl) {
    args.push("--opencode-base-url", options.opencodeBaseUrl);
  }
  if (options.opencodeDirectory) {
    args.push("--opencode-directory", options.opencodeDirectory);
  }
  if (options.opencodeUsername) {
    args.push("--opencode-username", options.opencodeUsername);
  }
  if (options.opencodePassword) {
    args.push("--opencode-password", options.opencodePassword);
  }
  if (options.logFormat) {
    args.push("--log-format", options.logFormat);
  }

  const resolved = resolveBinCommand(options.bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, ...args],
    {
      cwd: options.workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AUROWORK_TOKEN: options.token,
        AUROWORK_HOST_TOKEN: options.hostToken,
        AUROWORK_RUN_ID: options.runId,
        AUROWORK_LOG_FORMAT: options.logFormat,
        OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
          {
            "service.name": "aurowork-server",
            "service.instance.id": options.runId,
          },
          process.env.OTEL_RESOURCE_ATTRIBUTES,
        ),
        ...(options.opencodeBaseUrl
          ? { AUROWORK_OPENCODE_BASE_URL: options.opencodeBaseUrl }
          : {}),
        ...(options.opencodeDirectory
          ? { AUROWORK_OPENCODE_DIRECTORY: options.opencodeDirectory }
          : {}),
        ...(options.opencodeUsername
          ? { AUROWORK_OPENCODE_USERNAME: options.opencodeUsername }
          : {}),
        ...(options.opencodePassword
          ? { AUROWORK_OPENCODE_PASSWORD: options.opencodePassword }
          : {}),
        ...(options.controlBaseUrl
          ? { AUROWORK_CONTROL_BASE_URL: options.controlBaseUrl }
          : {}),
        ...(options.controlToken
          ? { AUROWORK_CONTROL_TOKEN: options.controlToken }
          : {}),
      },
    },
  );

  prefixStream(
    child.stdout,
    "aurowork-server",
    "stdout",
    options.logger,
    child.pid ?? undefined,
  );
  prefixStream(
    child.stderr,
    "aurowork-server",
    "stderr",
    options.logger,
    child.pid ?? undefined,
  );

  return child;
}


async function verifyOpencodeVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  const actual = await readCliVersion(binary.bin);
  // When the binary was explicitly provided via --opencode-bin (source "external"),
  // a strict version check would break desktop app users whenever a new opencode
  // release ships on GitHub before AuroWork updates its bundled binary. Log a
  // warning instead of throwing so the caller can still proceed.
  if (
    binary.source === "external" &&
    binary.expectedVersion &&
    actual &&
    binary.expectedVersion !== actual
  ) {
    process.stderr.write(
      `[aurowork-orchestrator] Warning: opencode version mismatch (expected ${binary.expectedVersion}, got ${actual}). Proceeding with ${binary.bin}.\n`,
    );
    return actual;
  }
  assertVersionMatch("opencode", binary.expectedVersion, actual, binary.bin);
  return actual;
}

async function verifyAuroworkServer(input: {
  baseUrl: string;
  token: string;
  hostToken: string;
  expectedVersion?: string;
  expectedWorkspace: string;
  expectedOpencodeBaseUrl?: string;
  expectedOpencodeDirectory?: string;
  expectedOpencodeUsername?: string;
  expectedOpencodePassword?: string;
}): Promise<string | undefined> {
  const health = await fetchJson(`${input.baseUrl}/health`);
  const actualVersion =
    typeof health?.version === "string" ? health.version : undefined;
  assertVersionMatch(
    "aurowork-server",
    input.expectedVersion,
    actualVersion,
    `${input.baseUrl}/health`,
  );

  const headers = { Authorization: `Bearer ${input.token}` };
  const workspaces = await fetchJson(`${input.baseUrl}/workspaces`, {
    headers,
  });
  const items = Array.isArray(workspaces?.items)
    ? (workspaces.items as Array<Record<string, unknown>>)
    : [];
  if (!items.length) {
    throw new Error("AuroWork server returned no workspaces");
  }

  const expectedPath = normalizeWorkspacePath(input.expectedWorkspace);
  const matched = items.find((item) => {
    const candidate = item as { path?: string };
    const path = typeof candidate.path === "string" ? candidate.path : "";
    return path && normalizeWorkspacePath(path) === expectedPath;
  }) as
    | {
        id?: string;
        path?: string;
        opencode?: {
          baseUrl?: string;
          directory?: string;
          username?: string;
          password?: string;
        };
      }
    | undefined;

  if (!matched) {
    throw new Error(
      `AuroWork server workspace mismatch. Expected ${expectedPath}.`,
    );
  }

  const opencode = matched.opencode;
  if (
    input.expectedOpencodeBaseUrl &&
    opencode?.baseUrl !== input.expectedOpencodeBaseUrl
  ) {
    throw new Error(
      `AuroWork server OpenCode base URL mismatch: expected ${input.expectedOpencodeBaseUrl}, got ${opencode?.baseUrl ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeDirectory &&
    opencode?.directory !== input.expectedOpencodeDirectory
  ) {
    throw new Error(
      `AuroWork server OpenCode directory mismatch: expected ${input.expectedOpencodeDirectory}, got ${opencode?.directory ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeUsername &&
    opencode?.username !== input.expectedOpencodeUsername
  ) {
    throw new Error("AuroWork server OpenCode username mismatch.");
  }
  if (
    input.expectedOpencodePassword &&
    opencode?.password !== input.expectedOpencodePassword
  ) {
    throw new Error("AuroWork server OpenCode password mismatch.");
  }

  const hostHeaders = { "X-AuroWork-Host-Token": input.hostToken };
  await fetchJson(`${input.baseUrl}/approvals`, { headers: hostHeaders });

  return actualVersion;
}

async function installGlobalPackages(packages: string[]): Promise<void> {
  if (!packages.length) return;
  await captureCommandOutput("npm", ["install", "-g", ...packages], {
    timeoutMs: 5 * 60_000,
  });
}

function buildRuntimeServiceSnapshot(input: {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  binary?: ResolvedBinary | null;
  actualVersion?: string;
}): RuntimeServiceSnapshot {
  const targetVersion = input.binary?.expectedVersion;
  const actualVersion = input.actualVersion;
  return {
    name: input.name,
    enabled: input.enabled,
    running: input.enabled ? input.running : false,
    source: input.binary?.source,
    path: input.binary?.bin,
    targetVersion,
    actualVersion,
    upgradeAvailable: Boolean(
      input.enabled &&
      targetVersion &&
      actualVersion &&
      targetVersion !== actualVersion,
    ),
  };
}

async function runChecks(input: {
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  auroworkUrl: string;
  auroworkToken: string;
  hostToken: string;
  checkEvents: boolean;
}) {
  const baseUrl = input.auroworkUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${input.auroworkToken}` };
  const hostHeaders = { "X-AuroWork-Host-Token": input.hostToken };
  const workspaces = await fetchJson(`${baseUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("AuroWork server returned no workspaces");
  }

  const workspaceId = workspaces.items[0].id as string;
  await fetchJson(`${baseUrl}/workspace/${workspaceId}/config`, { headers });

  const created = await input.opencodeClient.session.create({
    title: "AuroWork headless check",
  });
  const createdSession = unwrap(created);
  unwrap(
    await input.opencodeClient.session.messages({
      sessionID: createdSession.id,
      limit: 10,
    }),
  );

  if (input.checkEvents) {
    const events: { type: string }[] = [];
    const controller = new AbortController();
    const subscription = await input.opencodeClient.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const reader = (async () => {
      try {
        for await (const raw of subscription.stream) {
          const normalized = normalizeEvent(raw);
          if (!normalized) continue;
          events.push(normalized);
          if (events.length >= 10) break;
        }
      } catch {
        // ignore
      }
    })();

    unwrap(
      await input.opencodeClient.session.create({
        title: "AuroWork headless check events",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await Promise.race([
      reader,
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);

    if (!events.length) {
      throw new Error("No SSE events observed during check");
    }
  }
}


async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.message ? ` ${payload.message}` : "";
    throw new Error(`HTTP ${response.status}${message}`);
  }
  return payload;
}

async function issueAuroworkOwnerToken(
  baseUrl: string,
  hostToken: string,
  label = "AuroWork owner token",
): Promise<string> {
  const payload = await fetchJson(`${baseUrl.replace(/\/$/, "")}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AuroWork-Host-Token": hostToken,
    },
    body: JSON.stringify({ scope: "owner", label }),
  });
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  if (!token) {
    throw new Error("AuroWork server did not return an owner token");
  }
  return token;
}

function normalizeEvent(raw: unknown): { type: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string") return { type: record.type };
  const payload = record.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.type === "string")
    return { type: payload.type };
  return null;
}

async function waitForRouterHealthy(
  baseUrl: string,
  timeoutMs = 10_000,
  pollMs = 250,
): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  const url = baseUrl.replace(/\/$/, "");
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for daemon health");
}

function outputResult(payload: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof payload === "string") {
    console.log(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function outputError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    return;
  }
  console.error(message);
}

function createVerboseLogger(
  enabled: boolean,
  logger?: Logger,
  component = "aurowork-orchestrator",
) {
  return (message: string) => {
    if (!enabled) return;
    if (logger) {
      logger.debug(message, undefined, component);
      return;
    }
    console.log(`[${component}] ${message}`);
  };
}

const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function colorize(input: string, color: string, enabled: boolean): string {
  if (!enabled) return input;
  return `${color}${input}${ANSI.reset}`;
}

function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function mergeResourceAttributes(
  additional: Record<string, string>,
  existing?: string,
): string {
  const entries = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || rest.length === 0) continue;
      entries.set(key, rest.join("=").replace(/,/g, ";"));
    }
  }
  for (const [key, value] of Object.entries(additional)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    entries.set(key, String(value).replace(/,/g, ";"));
  }
  return Array.from(entries.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function createLogger(options: {
  format: LogFormat;
  runId: string;
  serviceName: string;
  serviceVersion?: string;
  output?: "stdout" | "silent";
  color?: boolean;
  onLog?: (event: LogEvent) => void;
}): Logger {
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": options.serviceName,
    "service.instance.id": options.runId,
  };
  if (options.serviceVersion) {
    resource["service.version"] = options.serviceVersion;
  }
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": options.runId,
    "process.pid": process.pid,
  };
  const output = options.output ?? "stdout";
  const colorEnabled = options.color ?? false;
  const componentColors: Record<string, string> = {
    "aurowork-orchestrator": ANSI.gray,
    opencode: ANSI.cyan,
    "aurowork-server": ANSI.green,
  };
  const levelColors: Record<LogLevel, string> = {
    debug: ANSI.gray,
    info: ANSI.gray,
    warn: ANSI.yellow,
    error: ANSI.red,
  };

  const emit = (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => {
    const mergedAttributes: LogAttributes = {
      ...baseAttributes,
      ...(component ? { "service.component": component } : {}),
      ...(attributes ?? {}),
    };
    options.onLog?.({
      time: Date.now(),
      level,
      message,
      component,
      attributes: mergedAttributes,
    });
    if (output === "silent") return;
    if (options.format === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: message,
        attributes: mergedAttributes,
        resource,
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const label = component ?? options.serviceName;
    const tagLabel = label ? `[${label}]` : "";
    const levelTag = level === "info" ? "" : level.toUpperCase();
    const coloredLabel = tagLabel
      ? colorize(tagLabel, componentColors[label] ?? ANSI.gray, colorEnabled)
      : "";
    const coloredLevel = levelTag
      ? colorize(levelTag, levelColors[level] ?? ANSI.gray, colorEnabled)
      : "";
    const tag = [coloredLabel, coloredLevel].filter(Boolean).join(" ");
    const line = tag ? `${tag} ${message}` : message;
    process.stdout.write(`${line}\n`);
  };

  const child = (
    component: string,
    attributes?: LogAttributes,
  ): LoggerChild => ({
    log: (level, message, attrs) =>
      emit(
        level,
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    debug: (message, attrs) =>
      emit(
        "debug",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    info: (message, attrs) =>
      emit(
        "info",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    warn: (message, attrs) =>
      emit(
        "warn",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    error: (message, attrs) =>
      emit(
        "error",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
  });

  return {
    format: options.format,
    output,
    log: emit,
    debug: (message, attrs, component) =>
      emit("debug", message, attrs, component),
    info: (message, attrs, component) =>
      emit("info", message, attrs, component),
    warn: (message, attrs, component) =>
      emit("warn", message, attrs, component),
    error: (message, attrs, component) =>
      emit("error", message, attrs, component),
    child,
  };
}

function looksLikeOtelLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return false;
    return (
      typeof parsed.timeUnixNano === "string" &&
      typeof parsed.severityText === "string"
    );
  } catch {
    return false;
  }
}

function buildAttachCommand(input: {
  url: string;
  workspace: string;
  username?: string;
  password?: string;
}): string {
  const parts: string[] = [];
  if (input.username && input.password) {
    parts.push(`OPENCODE_SERVER_USERNAME=${input.username}`);
  }
  if (input.password) {
    parts.push(`OPENCODE_SERVER_PASSWORD=${input.password}`);
  }
  parts.push("opencode", "attach", input.url, "--dir", input.workspace);
  return parts.join(" ");
}

async function runClipboardCommand(
  command: string,
  args: string[],
  text: string,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.stdin?.write(text);
    child.stdin?.end();
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function copyToClipboard(
  text: string,
): Promise<{ copied: boolean; error?: string }> {
  const platform = process.platform;
  const commands: Array<{ command: string; args: string[] }> = [];
  if (platform === "darwin") {
    commands.push({ command: "pbcopy", args: [] });
  } else if (platform === "win32") {
    commands.push({ command: "clip", args: [] });
  } else {
    commands.push({ command: "wl-copy", args: [] });
    commands.push({ command: "xclip", args: ["-selection", "clipboard"] });
    commands.push({ command: "xsel", args: ["--clipboard", "--input"] });
  }
  for (const entry of commands) {
    try {
      const ok = await runClipboardCommand(entry.command, entry.args, text);
      if (ok) return { copied: true };
    } catch {
      // ignore
    }
  }
  return { copied: false, error: "Clipboard unavailable" };
}

async function spawnRouterDaemon(
  args: ParsedArgs,
  dataDir: string,
  host: string,
  port: number,
) {
  const self = resolveSelfCommand();
  const commandArgs = [
    ...self.prefixArgs,
    "daemon",
    "run",
    "--data-dir",
    dataDir,
    "--daemon-host",
    host,
    "--daemon-port",
    String(port),
  ];

  const opencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.AUROWORK_OPENCODE_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ?? process.env.AUROWORK_OPENCODE_HOST,
  );
  const opencodePort =
    readFlag(args.flags, "opencode-port") ?? process.env.AUROWORK_OPENCODE_PORT;
  const opencodeWorkdir =
    readFlag(args.flags, "opencode-workdir") ??
    process.env.AUROWORK_OPENCODE_WORKDIR;
  const opencodeHotReload =
    readFlag(args.flags, "opencode-hot-reload") ??
    process.env.AUROWORK_OPENCODE_HOT_RELOAD;
  const opencodeHotReloadDebounceMs =
    readFlag(args.flags, "opencode-hot-reload-debounce-ms") ??
    process.env.AUROWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS;
  const opencodeHotReloadCooldownMs =
    readFlag(args.flags, "opencode-hot-reload-cooldown-ms") ??
    process.env.AUROWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS;
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;
  const corsValue =
    readFlag(args.flags, "cors") ?? process.env.AUROWORK_OPENCODE_CORS;
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "AUROWORK_ALLOW_EXTERNAL",
  );
  const sidecarSource =
    readFlag(args.flags, "sidecar-source") ??
    process.env.AUROWORK_SIDECAR_SOURCE;
  const opencodeSource =
    readFlag(args.flags, "opencode-source") ??
    process.env.AUROWORK_OPENCODE_SOURCE;
  const verbose = readBool(args.flags, "verbose", false, "AUROWORK_VERBOSE");
  const logFormat =
    readFlag(args.flags, "log-format") ?? process.env.AUROWORK_LOG_FORMAT;
  const runId = readFlag(args.flags, "run-id") ?? process.env.AUROWORK_RUN_ID;

  if (opencodeBin) commandArgs.push("--opencode-bin", opencodeBin);
  if (opencodeHost) commandArgs.push("--opencode-host", opencodeHost);
  if (opencodePort) commandArgs.push("--opencode-port", String(opencodePort));
  if (opencodeWorkdir) commandArgs.push("--opencode-workdir", opencodeWorkdir);
  if (opencodeHotReload)
    commandArgs.push("--opencode-hot-reload", opencodeHotReload);
  if (opencodeHotReloadDebounceMs)
    commandArgs.push(
      "--opencode-hot-reload-debounce-ms",
      String(opencodeHotReloadDebounceMs),
    );
  if (opencodeHotReloadCooldownMs)
    commandArgs.push(
      "--opencode-hot-reload-cooldown-ms",
      String(opencodeHotReloadCooldownMs),
    );
  commandArgs.push("--opencode-username", opencodeCredentials.username);
  commandArgs.push("--opencode-password", opencodeCredentials.password);
  if (corsValue) commandArgs.push("--cors", corsValue);
  if (allowExternal) commandArgs.push("--allow-external");
  if (sidecarSource) commandArgs.push("--sidecar-source", sidecarSource);
  if (opencodeSource) commandArgs.push("--opencode-source", opencodeSource);
  if (verbose) commandArgs.push("--verbose");
  if (logFormat) commandArgs.push("--log-format", String(logFormat));
  if (runId) commandArgs.push("--run-id", String(runId));

  const child = spawnProcess(self.command, commandArgs, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
    },
  });
  child.unref();
}

async function ensureRouterDaemon(
  args: ParsedArgs,
  autoStart = true,
): Promise<{ baseUrl: string; dataDir: string }> {
  const dataDir = resolveRouterDataDir(args.flags);
  const statePath = routerStatePath(dataDir);
  const state = await loadRouterState(statePath);
  const existing = state.daemon;
  if (existing && existing.baseUrl && isProcessAlive(existing.pid)) {
    try {
      await waitForRouterHealthy(existing.baseUrl, 1500, 150);
      return { baseUrl: existing.baseUrl, dataDir };
    } catch {
      // fallthrough
    }
  }

  if (!autoStart) {
    throw new Error("orchestrator daemon is not running");
  }

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "AUROWORK_DAEMON_PORT"),
    "127.0.0.1",
  );
  const baseUrl = `http://${host}:${port}`;
  await spawnRouterDaemon(args, dataDir, host, port);
  await waitForRouterHealthy(baseUrl, 10_000, 250);
  return { baseUrl, dataDir };
}

async function requestRouter(
  args: ParsedArgs,
  method: string,
  path: string,
  body?: unknown,
  autoStart = true,
) {
  const { baseUrl } = await ensureRouterDaemon(args, autoStart);
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  return fetchJson(url, {
    method,
    headers,
    body: payload,
  });
}

async function runDaemonCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1] ?? "run";

  try {
    if (subcommand === "run" || subcommand === "foreground") {
      await runRouterDaemon(args);
      return;
    }
    if (subcommand === "start") {
      const { baseUrl } = await ensureRouterDaemon(args, true);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "status") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "stop") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      await fetchJson(`${baseUrl.replace(/\/$/, "")}/shutdown`, {
        method: "POST",
      });
      outputResult({ ok: true }, outputJson);
      return;
    }
    throw new Error("daemon requires start|stop|status|run");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runWorkspaceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "add") {
      if (!id) throw new Error("workspace path is required");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces", {
        path: id,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "add-remote") {
      if (!id) throw new Error("baseUrl is required");
      const directory = readFlag(args.flags, "directory");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces/remote", {
        baseUrl: id,
        directory: directory ?? null,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "list") {
      const result = await requestRouter(args, "GET", "/workspaces");
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "switch") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "POST",
        `/workspaces/${encodeURIComponent(id)}/activate`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "info") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "GET",
        `/workspaces/${encodeURIComponent(id)}`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "path") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "GET",
        `/workspaces/${encodeURIComponent(id)}/path`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("workspace requires add|add-remote|list|switch|info|path");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runInstanceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "dispose") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "POST",
        `/instances/${encodeURIComponent(id)}/dispose`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("instance requires dispose");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runRouterDaemon(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const verbose = readBool(args.flags, "verbose", false, "AUROWORK_VERBOSE");
  const logFormat = readLogFormat(
    args.flags,
    "log-format",
    "pretty",
    "AUROWORK_LOG_FORMAT",
  );
  const colorEnabled =
    readBool(args.flags, "color", process.stdout.isTTY, "AUROWORK_COLOR") &&
    !process.env.NO_COLOR;
  const runId =
    readFlag(args.flags, "run-id") ??
    process.env.AUROWORK_RUN_ID ??
    randomUUID();
  const cliVersion = await resolveCliVersion();
  const logger = createLogger({
    format: logFormat,
    runId,
    serviceName: "aurowork-orchestrator",
    serviceVersion: cliVersion,
    output: "stdout",
    color: colorEnabled,
  });
  const logVerbose = createVerboseLogger(
    verbose && !outputJson,
    logger,
    "aurowork-orchestrator",
  );
  const sidecarSourceInput = readBinarySource(
    args.flags,
    "sidecar-source",
    "auto",
    "AUROWORK_SIDECAR_SOURCE",
  );
  const opencodeSourceInput = readBinarySource(
    args.flags,
    "opencode-source",
    "auto",
    "AUROWORK_OPENCODE_SOURCE",
  );
  const sidecarSource = sidecarSourceInput;
  const opencodeSource = opencodeSourceInput;
  const dataDir = resolveRouterDataDir(args.flags);
  const statePath = routerStatePath(dataDir);
  let state = await loadRouterState(statePath);

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "AUROWORK_DAEMON_PORT"),
    "127.0.0.1",
  );

  const opencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.AUROWORK_OPENCODE_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ?? process.env.AUROWORK_OPENCODE_HOST,
  );
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;
  const authHeaders = {
    Authorization: `Basic ${encodeBasicAuth(opencodeCredentials.username, opencodeCredentials.password)}`,
  };
  const opencodePort = await resolvePort(
    readNumber(
      args.flags,
      "opencode-port",
      state.opencode?.port,
      "AUROWORK_OPENCODE_PORT",
    ),
    "127.0.0.1",
    state.opencode?.port,
  );
  const opencodeHotReload = readOpencodeHotReload(
    args.flags,
    {
      enabled: true,
      debounceMs: DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
      cooldownMs: DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
    },
    {
      enabled: "AUROWORK_OPENCODE_HOT_RELOAD",
      debounceMs: "AUROWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS",
      cooldownMs: "AUROWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS",
    },
  );
  const corsValue =
    readFlag(args.flags, "cors") ??
    process.env.AUROWORK_OPENCODE_CORS ??
    "http://localhost:5173,tauri://localhost,http://tauri.localhost";
  const corsOrigins = parseList(corsValue);
  const opencodeWorkdirFlag =
    readFlag(args.flags, "opencode-workdir") ??
    process.env.AUROWORK_OPENCODE_WORKDIR;
  const activeWorkspace = state.workspaces.find(
    (entry) => entry.id === state.activeId && entry.workspaceType === "local",
  );
  const opencodeWorkdir =
    opencodeWorkdirFlag ?? activeWorkspace?.path ?? process.cwd();
  const resolvedWorkdir = await ensureWorkspace(opencodeWorkdir);
  const devMode = resolveInternalDevMode(args.flags);
  const opencodeStateLayout = resolveOpencodeStateLayout({
    dataDir,
    workspace: resolvedWorkdir,
    devMode,
  });
  const opencodeConfigDir = opencodeStateLayout.configDir;
  await ensureOpencodeStateLayout(opencodeStateLayout);
  await ensureOpencodeManagedTools(opencodeConfigDir);
  logger.info(
    "Daemon starting",
    { runId, logFormat, workdir: resolvedWorkdir, host, port },
    "aurowork-orchestrator",
  );

  const sidecar = resolveSidecarConfig(args.flags, cliVersion);
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "AUROWORK_ALLOW_EXTERNAL",
  );
  const manifest = await readVersionManifest();
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(
    `opencode hot reload: ${opencodeHotReload.enabled ? "on" : "off"} (debounce=${opencodeHotReload.debounceMs}ms cooldown=${opencodeHotReload.cooldownMs}ms)`,
  );
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  let opencodeBinary = await resolveOpencodeBin({
    explicit: opencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);

  let opencodeChild: ReturnType<typeof spawn> | null = null;

  const updateDiagnostics = (actualVersion?: string) => {
    state.cliVersion = cliVersion;
    state.sidecar = {
      dir: sidecar.dir,
      baseUrl: sidecar.baseUrl,
      manifestUrl: sidecar.manifestUrl,
      target: sidecar.target,
      source: sidecarSource,
      opencodeSource,
      allowExternal,
    };
    state.binaries = {
      opencode: {
        path: opencodeBinary.bin,
        source: opencodeBinary.source,
        expectedVersion: opencodeBinary.expectedVersion,
        actualVersion,
      },
    };
  };

  const ensureOpencode = async () => {
    const existing = state.opencode;
    if (existing && isProcessAlive(existing.pid)) {
      const client = createOpencodeClient({
        baseUrl: existing.baseUrl,
        directory: resolvedWorkdir,
        headers: authHeaders,
      });
      try {
        await waitForOpencodeHealthy(client, 2000, 200);
        if (!state.sidecar || !state.cliVersion || !state.binaries?.opencode) {
          updateDiagnostics(state.binaries?.opencode?.actualVersion);
          await saveRouterState(statePath, state);
        }
        return { baseUrl: existing.baseUrl, client };
      } catch {
        // restart
      }
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
    }

    const opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    logVerbose(`opencode version: ${opencodeActualVersion ?? "unknown"}`);
    const child = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkdir,
      stateLayout: opencodeStateLayout,
      hotReload: opencodeHotReload,
      bindHost: opencodeHost,
      port: opencodePort,
      username: opencodeCredentials.username,
      password: opencodeCredentials.password,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
    });
    opencodeChild = child;
    logger.info("Process spawned", { pid: child.pid ?? 0 }, "opencode");
    const baseUrl = `http://${opencodeHost}:${opencodePort}`;
    const client = createOpencodeClient({
      baseUrl,
      directory: resolvedWorkdir,
      headers: authHeaders,
    });
    logger.info("Waiting for health", { url: baseUrl }, "opencode");
    await waitForOpencodeHealthy(client);
    logger.info("Healthy", { url: baseUrl }, "opencode");
    state.opencode = {
      pid: child.pid ?? 0,
      port: opencodePort,
      baseUrl,
      startedAt: nowMs(),
    };
    updateDiagnostics(opencodeActualVersion);
    await saveRouterState(statePath, state);
    return { baseUrl, client };
  };

  await ensureOpencode();

  const server = createHttpServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    res.on("finish", () => {
      logger.info(
        "Router request",
        {
          method,
          path: url.pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          activeId: state.activeId,
        },
        "aurowork-orchestrator-router",
      );
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean);

    const send = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (!chunks.length) return null;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    };

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        send(200, {
          ok: true,
          daemon: state.daemon ?? null,
          opencode: state.opencode ?? null,
          activeId: state.activeId,
          workspaceCount: state.workspaces.length,
          cliVersion: state.cliVersion ?? null,
          sidecar: state.sidecar ?? null,
          binaries: state.binaries ?? null,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/workspaces") {
        send(200, { activeId: state.activeId, workspaces: state.workspaces });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces") {
        const body = await readBody();
        const pathInput =
          typeof body?.path === "string" ? body.path.trim() : "";
        if (!pathInput) {
          send(400, { error: "path is required" });
          return;
        }
        const resolved = await ensureWorkspace(pathInput);
        const id = workspaceIdForLocal(resolved);
        const name =
          typeof body?.name === "string" && body.name.trim()
            ? body.name.trim()
            : (resolved.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace");
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: resolved,
          workspaceType: "local",
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces/remote") {
        const body = await readBody();
        const baseUrl =
          typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
        if (
          !baseUrl ||
          (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://"))
        ) {
          send(400, { error: "baseUrl must start with http:// or https://" });
          return;
        }
        const directory =
          typeof body?.directory === "string" ? body.directory.trim() : "";
        const id = workspaceIdForRemote(baseUrl, directory || undefined);
        const name =
          typeof body?.name === "string" && body.name.trim()
            ? body.name.trim()
            : baseUrl;
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: directory,
          workspaceType: "remote",
          baseUrl,
          directory: directory || undefined,
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 2 &&
        req.method === "GET"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        send(200, { workspace });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 3 &&
        parts[2] === "activate" &&
        req.method === "POST"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        state.activeId = workspace.id;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 3 &&
        parts[2] === "path" &&
        req.method === "GET"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote
          ? (workspace.baseUrl ?? "")
          : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote
          ? (workspace.directory ?? "")
          : workspace.path;
        const client = createOpencodeClient({
          baseUrl,
          directory: directory ? directory : undefined,
          headers: authHeaders,
        });
        const pathInfo = unwrap(await client.path.get());
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { workspace, path: pathInfo });
        return;
      }

      if (
        parts[0] === "instances" &&
        parts.length === 3 &&
        parts[2] === "dispose" &&
        req.method === "POST"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote
          ? (workspace.baseUrl ?? "")
          : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote
          ? (workspace.directory ?? "")
          : workspace.path;
        const response = await fetch(
          `${baseUrl.replace(/\/$/, "")}/instance/dispose?directory=${encodeURIComponent(directory)}`,
          { method: "POST", headers: authHeaders },
        );
        const ok = response.ok ? await response.json() : false;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { disposed: ok });
        return;
      }

      if (req.method === "POST" && url.pathname === "/shutdown") {
        send(200, { ok: true });
        await shutdown();
        return;
      }

      send(404, { error: "not found" });
    } catch (error) {
      send(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const shutdown = async () => {
    logger.info(
      "Daemon shutting down",
      { host, port },
      "aurowork-orchestrator-router",
    );
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {
      // ignore
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
      opencodeChild = null;
    }

    state.daemon = undefined;
    if (state.opencode && !isProcessAlive(state.opencode.pid)) {
      state.opencode = undefined;
    }
    await saveRouterState(statePath, state);
    process.exit(0);
  };

  server.listen(port, host, async () => {
    state.daemon = {
      pid: process.pid,
      port,
      baseUrl: `http://${host}:${port}`,
      startedAt: nowMs(),
    };
    await saveRouterState(statePath, state);
    if (outputJson) {
      outputResult({ ok: true, daemon: state.daemon }, true);
    } else {
      if (logFormat === "json") {
        logger.info(
          "Daemon running",
          { host, port },
          "aurowork-orchestrator-router",
        );
      } else {
        console.log(`orchestrator daemon running on ${host}:${port}`);
      }
    }
  });

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
  await new Promise(() => undefined);
}

function readAuroworkClientAuth(args: ParsedArgs): {
  auroworkUrl: string;
  token: string;
} {
  const auroworkUrl =
    readFlag(args.flags, "aurowork-url") ??
    process.env.AUROWORK_URL ??
    process.env.AUROWORK_SERVER_URL ??
    "";
  const token =
    readFlag(args.flags, "token") ??
    readFlag(args.flags, "aurowork-token") ??
    process.env.AUROWORK_TOKEN ??
    "";

  if (!auroworkUrl || !token) {
    throw new Error("aurowork-url and token are required");
  }

  return { auroworkUrl, token };
}

function readSessionId(args: ParsedArgs, fallbackIndex: number): string {
  const sessionId =
    readFlag(args.flags, "session-id") ?? args.positionals[fallbackIndex] ?? "";
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("session-id is required");
  }
  return trimmed;
}

async function runFiles(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1] ?? "";
  const { auroworkUrl, token } = readAuroworkClientAuth(args);
  const baseUrl = auroworkUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  try {
    if (subcommand === "session") {
      const action = args.positionals[2] ?? "create";
      if (action === "create") {
        const workspaceId =
          readFlag(args.flags, "workspace-id") ?? args.positionals[3] ?? "";
        if (!workspaceId.trim()) {
          throw new Error("workspace-id is required for files session create");
        }
        const ttlSeconds = readNumber(args.flags, "ttl-seconds", undefined);
        const writeRequested = readBool(args.flags, "write", true);
        const result = await fetchJson(
          `${baseUrl}/workspace/${encodeURIComponent(workspaceId.trim())}/files/sessions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
              write: writeRequested,
            }),
          },
        );
        outputResult(result, outputJson);
        return;
      }
      if (action === "renew") {
        const sessionId = readSessionId(args, 3);
        const ttlSeconds = readNumber(args.flags, "ttl-seconds", undefined);
        const result = await fetchJson(
          `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/renew`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
            }),
          },
        );
        outputResult(result, outputJson);
        return;
      }
      if (action === "close" || action === "delete") {
        const sessionId = readSessionId(args, 3);
        const result = await fetchJson(
          `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "DELETE",
            headers,
          },
        );
        outputResult(result, outputJson);
        return;
      }
      throw new Error("files session requires create|renew|close");
    }

    if (subcommand === "catalog") {
      const sessionId = readSessionId(args, 2);
      const params = new URLSearchParams();
      const prefix = readFlag(args.flags, "prefix");
      const after = readFlag(args.flags, "after");
      const limit = readNumber(args.flags, "limit", undefined);
      const includeDirs = readBool(args.flags, "include-dirs", true);
      if (prefix?.trim()) params.set("prefix", prefix.trim());
      if (after?.trim()) params.set("after", after.trim());
      if (typeof limit === "number") params.set("limit", String(limit));
      if (!includeDirs) params.set("includeDirs", "false");
      const query = params.toString();
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/catalog/snapshot${query ? `?${query}` : ""}`,
        {
          headers,
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "events") {
      const sessionId = readSessionId(args, 2);
      const since = readNumber(args.flags, "since", undefined);
      const query =
        typeof since === "number"
          ? `?since=${encodeURIComponent(String(since))}`
          : "";
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/catalog/events${query}`,
        {
          headers,
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "read") {
      const sessionId = readSessionId(args, 2);
      const pathsRaw = readFlag(args.flags, "paths");
      const singlePath = readFlag(args.flags, "path") ?? args.positionals[3];
      const paths = pathsRaw
        ? parseList(pathsRaw)
        : singlePath
          ? [singlePath]
          : [];
      if (!paths.length) {
        throw new Error("path or paths is required for files read");
      }
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/read-batch`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ paths }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "write") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) {
        throw new Error("path is required for files write");
      }

      let contentBase64 = readFlag(args.flags, "content-base64") ?? "";
      if (!contentBase64) {
        const inlineContent = readFlag(args.flags, "content");
        if (inlineContent !== undefined) {
          contentBase64 = Buffer.from(inlineContent, "utf8").toString("base64");
        }
      }
      if (!contentBase64) {
        const filePath = readFlag(args.flags, "file");
        if (filePath?.trim()) {
          const fileBytes = await readFile(resolve(filePath.trim()));
          contentBase64 = Buffer.from(fileBytes).toString("base64");
        }
      }
      if (!contentBase64) {
        throw new Error(
          "provide one of --content, --content-base64, or --file",
        );
      }

      const ifMatchRevision = readFlag(args.flags, "if-match");
      const force = readBool(args.flags, "force", false);
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/write-batch`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            writes: [
              {
                path: path.trim(),
                contentBase64,
                ...(ifMatchRevision?.trim()
                  ? { ifMatchRevision: ifMatchRevision.trim() }
                  : {}),
                ...(force ? { force: true } : {}),
              },
            ],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "mkdir") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) throw new Error("path is required for files mkdir");
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [{ type: "mkdir", path: path.trim() }],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "delete") {
      const sessionId = readSessionId(args, 2);
      const path = readFlag(args.flags, "path") ?? args.positionals[3] ?? "";
      if (!path.trim()) throw new Error("path is required for files delete");
      const recursive = readBool(args.flags, "recursive", false);
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [
              {
                type: "delete",
                path: path.trim(),
                ...(recursive ? { recursive: true } : {}),
              },
            ],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    if (subcommand === "rename") {
      const sessionId = readSessionId(args, 2);
      const from = readFlag(args.flags, "from") ?? args.positionals[3] ?? "";
      const to = readFlag(args.flags, "to") ?? args.positionals[4] ?? "";
      if (!from.trim() || !to.trim()) {
        throw new Error("from and to are required for files rename");
      }
      const result = await fetchJson(
        `${baseUrl}/files/sessions/${encodeURIComponent(sessionId)}/ops`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operations: [{ type: "rename", from: from.trim(), to: to.trim() }],
          }),
        },
      );
      outputResult(result, outputJson);
      return;
    }

    throw new Error(
      "files requires session|catalog|events|read|write|mkdir|delete|rename",
    );
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runApprovals(args: ParsedArgs) {
  const subcommand = args.positionals[1];
  if (!subcommand || (subcommand !== "list" && subcommand !== "reply")) {
    throw new Error("approvals requires 'list' or 'reply'");
  }

  const auroworkUrl =
    readFlag(args.flags, "aurowork-url") ??
    process.env.AUROWORK_URL ??
    process.env.AUROWORK_SERVER_URL ??
    "";
  const hostToken =
    readFlag(args.flags, "host-token") ?? process.env.AUROWORK_HOST_TOKEN ?? "";

  if (!auroworkUrl || !hostToken) {
    throw new Error("aurowork-url and host-token are required for approvals");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-AuroWork-Host-Token": hostToken,
  };

  if (subcommand === "list") {
    const response = await fetch(
      `${auroworkUrl.replace(/\/$/, "")}/approvals`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(`Failed to list approvals: ${response.status}`);
    }
    const body = await response.json();
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const approvalId = args.positionals[2];
  if (!approvalId) {
    throw new Error("approval id is required for approvals reply");
  }

  const allow = readBool(args.flags, "allow", false);
  const deny = readBool(args.flags, "deny", false);
  if (allow === deny) {
    throw new Error("use --allow or --deny");
  }

  const payload = { reply: allow ? "allow" : "deny" };
  const response = await fetch(
    `${auroworkUrl.replace(/\/$/, "")}/approvals/${approvalId}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to reply to approval: ${response.status}`);
  }
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
}

async function runStatus(args: ParsedArgs) {
  const auroworkUrl =
    readFlag(args.flags, "aurowork-url") ?? process.env.AUROWORK_URL ?? "";
  const opencodeUrl =
    readFlag(args.flags, "opencode-url") ?? process.env.OPENCODE_URL ?? "";
  const username =
    readFlag(args.flags, "opencode-username") ??
    process.env.OPENCODE_SERVER_USERNAME;
  const password =
    readFlag(args.flags, "opencode-password") ??
    process.env.OPENCODE_SERVER_PASSWORD;
  const outputJson = readBool(args.flags, "json", false);

  const status: Record<string, unknown> = {};

  if (auroworkUrl) {
    try {
      await waitForHealthy(auroworkUrl, 5000, 400);
      status.aurowork = { ok: true, url: auroworkUrl };
    } catch (error) {
      status.aurowork = { ok: false, url: auroworkUrl, error: String(error) };
    }
  }

  if (opencodeUrl) {
    try {
      const headers: Record<string, string> = {};
      if (username && password) {
        headers.Authorization = `Basic ${encodeBasicAuth(username, password)}`;
      }
      const client = createOpencodeClient({
        baseUrl: opencodeUrl,
        headers,
      });
      const health = await waitForOpencodeHealthy(client, 5000, 400);
      status.opencode = { ok: true, url: opencodeUrl, health };
    } catch (error) {
      status.opencode = { ok: false, url: opencodeUrl, error: String(error) };
    }
  }

  if (outputJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    if (status.aurowork) {
      const aurowork = status.aurowork as {
        ok: boolean;
        url: string;
        error?: string;
      };
      console.log(
        `AuroWork server: ${aurowork.ok ? "ok" : "error"} (${aurowork.url})`,
      );
      if (aurowork.error) console.log(`  ${aurowork.error}`);
    }
    if (status.opencode) {
      const opencode = status.opencode as {
        ok: boolean;
        url: string;
        error?: string;
      };
      console.log(
        `OpenCode server: ${opencode.ok ? "ok" : "error"} (${opencode.url})`,
      );
      if (opencode.error) console.log(`  ${opencode.error}`);
    }
  }
}

async function runStart(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const checkOnly = readBool(args.flags, "check", false);
  const checkEvents = readBool(args.flags, "check-events", false);
  const verbose = readBool(args.flags, "verbose", false, "AUROWORK_VERBOSE");
  const logFormat = readLogFormat(
    args.flags,
    "log-format",
    "pretty",
    "AUROWORK_LOG_FORMAT",
  );
  const detachRequested = readBool(
    args.flags,
    "detach",
    false,
    "AUROWORK_DETACH",
  );
  const defaultTui =
    process.stdout.isTTY && !outputJson && !checkOnly && !checkEvents;
  const tuiRequested = readBool(args.flags, "tui", defaultTui);
  let useTui =
    tuiRequested &&
    !detachRequested &&
    !outputJson &&
    !checkOnly &&
    !checkEvents &&
    logFormat === "pretty";
  const colorPreferred =
    readBool(args.flags, "color", process.stdout.isTTY, "AUROWORK_COLOR") &&
    !process.env.NO_COLOR;
  const runId =
    readFlag(args.flags, "run-id") ??
    process.env.AUROWORK_RUN_ID ??
    randomUUID();
  const cliVersion = await resolveCliVersion();
  const compiledBinary = isCompiledBunBinary();
  let tui: TuiHandle | undefined;
  let restoreConsoleError: (() => void) | undefined;
  const baseLoggerOptions = {
    format: logFormat,
    runId,
    serviceName: "aurowork-orchestrator",
    serviceVersion: cliVersion,
    onLog: (event: LogEvent) => {
      if (!tui) return;
      const component = event.component ?? "aurowork-orchestrator";
      tui.pushLog({
        time: event.time,
        level: event.level,
        component: component,
        message: event.message,
      });
    },
  };
  let logger = createLogger({
    ...baseLoggerOptions,
    output: useTui ? "silent" : "stdout",
    color: useTui ? false : colorPreferred,
  });
  let logVerbose = createVerboseLogger(
    verbose && !outputJson,
    logger,
    "aurowork-orchestrator",
  );
  const switchToPlainOutput = (error: string) => {
    if (!useTui) return;
    useTui = false;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    tui?.stop();
    tui = undefined;
    logger = createLogger({
      ...baseLoggerOptions,
      output: "stdout",
      color: colorPreferred,
    });
    logVerbose = createVerboseLogger(
      verbose && !outputJson,
      logger,
      "aurowork-orchestrator",
    );
    logger.warn(
      "TUI failed to start; falling back to plain output. Use `aurowork serve` for explicit non-TUI mode.",
      { error },
      "aurowork-orchestrator",
    );
  };
  const sidecarSourceInput = readBinarySource(
    args.flags,
    "sidecar-source",
    "auto",
    "AUROWORK_SIDECAR_SOURCE",
  );
  const opencodeSourceInput = readBinarySource(
    args.flags,
    "opencode-source",
    "auto",
    "AUROWORK_OPENCODE_SOURCE",
  );

  const workspace =
    readFlag(args.flags, "workspace") ??
    process.env.AUROWORK_WORKSPACE ??
    process.cwd();
  const resolvedWorkspace = await ensureWorkspace(workspace);
  logger.info(
    "Run starting",
    { workspace: resolvedWorkspace, logFormat, runId },
    "aurowork-orchestrator",
  );

  const dataDir = resolveRouterDataDir(args.flags);
  const devMode = resolveInternalDevMode(args.flags);
  const opencodeStateLayout = resolveOpencodeStateLayout({
    dataDir,
    workspace: resolvedWorkspace,
    devMode,
  });
  const opencodeConfigDir = opencodeStateLayout.configDir;
  await ensureOpencodeStateLayout(opencodeStateLayout);
  await ensureOpencodeManagedTools(opencodeConfigDir);

  const explicitOpencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.AUROWORK_OPENCODE_BIN;
  const explicitAuroworkServerBin =
    readFlag(args.flags, "aurowork-server-bin") ??
    process.env.AUROWORK_SERVER_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeBindHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ??
      process.env.AUROWORK_OPENCODE_BIND_HOST,
  );
  const opencodePort = await resolvePort(
      readNumber(
        args.flags,
        "opencode-port",
        undefined,
        "AUROWORK_OPENCODE_PORT",
      ),
      "127.0.0.1",
    );
  const opencodeHotReload = readOpencodeHotReload(
    args.flags,
    {
      enabled: true,
      debounceMs: DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
      cooldownMs: DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
    },
    {
      enabled: "AUROWORK_OPENCODE_HOT_RELOAD",
      debounceMs: "AUROWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS",
      cooldownMs: "AUROWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS",
    },
  );
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;

  const remoteAccessEnabled = resolveAuroworkRemoteAccess(args);
  const auroworkHost = remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
  const auroworkPort = await resolvePort(
    readNumber(args.flags, "aurowork-port", undefined, "AUROWORK_PORT"),
    "127.0.0.1",
  );
  const auroworkToken =
    readFlag(args.flags, "aurowork-token") ??
    process.env.AUROWORK_TOKEN ??
    randomUUID();
  const auroworkHostToken =
    readFlag(args.flags, "aurowork-host-token") ??
    process.env.AUROWORK_HOST_TOKEN ??
    randomUUID();
  const approvalMode =
    (readFlag(args.flags, "approval") as ApprovalMode | undefined) ??
    (process.env.AUROWORK_APPROVAL_MODE as ApprovalMode | undefined) ??
    "manual";
  const approvalTimeoutMs = readNumber(
    args.flags,
    "approval-timeout",
    DEFAULT_APPROVAL_TIMEOUT,
    "AUROWORK_APPROVAL_TIMEOUT_MS",
  ) as number;
  const readOnly = readBool(
    args.flags,
    "read-only",
    false,
    "AUROWORK_READONLY",
  );
  const corsValue =
    readFlag(args.flags, "cors") ?? process.env.AUROWORK_CORS_ORIGINS ?? "*";
  const corsOrigins = parseList(corsValue);
  const connectHost = readFlag(args.flags, "connect-host");

  const manifest = await readVersionManifest();
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "AUROWORK_ALLOW_EXTERNAL",
  );
  const sidecar = resolveSidecarConfigForTarget(
    args.flags,
    cliVersion,
    null,
  );

  const sidecarSource = sidecarSourceInput;
  const opencodeSource = opencodeSourceInput;
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(
    `opencode hot reload: ${opencodeHotReload.enabled ? "on" : "off"} (debounce=${opencodeHotReload.debounceMs}ms cooldown=${opencodeHotReload.cooldownMs}ms)`,
  );
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  let opencodeBinary = await resolveOpencodeBin({
    explicit: explicitOpencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });

  let auroworkServerBinary = await resolveAuroworkServerBin({
    explicit: explicitAuroworkServerBin,
    manifest,
    allowExternal,
    sidecar,
    source: sidecarSource,
  });
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);
  logVerbose(
    `aurowork-server bin: ${auroworkServerBinary.bin} (${auroworkServerBinary.source})`,
  );

  const auroworkBaseUrl = `http://127.0.0.1:${auroworkPort}`;
  const auroworkConnect = remoteAccessEnabled
    ? resolveConnectUrl(auroworkPort, connectHost)
    : {};
  const auroworkConnectUrl = auroworkConnect.connectUrl ?? auroworkBaseUrl;

  const opencodeBaseUrl = `http://127.0.0.1:${opencodePort}`;
  const opencodeConnectUrl = opencodeBaseUrl;

  const attachCommand = buildAttachCommand({
          url: opencodeConnectUrl,
          workspace: resolvedWorkspace,
          username: opencodeUsername,
          password: opencodeCredentials.password,
        });

  const children: ChildHandle[] = [];
  let shuttingDown = false;
  let detached = false;
  let opencodeChild: ChildProcess | null = null;
  let auroworkChild: ChildProcess | null = null;
  let controlServer: ReturnType<typeof createHttpServer> | null = null;
  const controlPort = await resolvePort(undefined, "127.0.0.1");
  const controlToken = randomUUID();
  const controlBaseUrl = `http://127.0.0.1:${controlPort}`;
  let opencodeActualVersion: string | undefined;
  let auroworkActualVersion: string | undefined;
  let auroworkOwnerToken: string | undefined;
  const startedAt = Date.now();
  const workerActivityHeartbeat = resolveWorkerActivityHeartbeatConfig();
  let workerActivityHeartbeatInterval: NodeJS.Timeout | null = null;
  const restartingServices = new Set<string>();
  const runtimeUpgradeState: RuntimeUpgradeState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    error: null,
    operationId: null,
    services: [],
  };
  const removeChildHandle = (name: string) => {
    const index = children.findIndex((handle) => handle.name === name);
    if (index >= 0) children.splice(index, 1);
  };
  const getRuntimeSnapshot = () => {
    const services = [
      buildRuntimeServiceSnapshot({
        name: "aurowork-server",
        enabled: true,
        running: Boolean(auroworkChild && isProcessAlive(auroworkChild.pid)),
        binary: auroworkServerBinary,
        actualVersion: auroworkActualVersion,
      }),
      buildRuntimeServiceSnapshot({
        name: "opencode",
        enabled: true,
        running: Boolean(opencodeChild && isProcessAlive(opencodeChild.pid)),
        binary: opencodeBinary,
        actualVersion: opencodeActualVersion,
      }),
    ];
    return {
      ok: true,
      orchestrator: {
        version: cliVersion,
        startedAt,
      },
      worker: {
        workspace: resolvedWorkspace,
      },
      upgrade: {
        ...runtimeUpgradeState,
      },
      services,
    };
  };
  const restartOpencode = async () => {
    if (opencodeChild) {
      restartingServices.add("opencode");
      removeChildHandle("opencode");
      await stopChild(opencodeChild);
      opencodeChild = null;
    }
    opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    const child = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkspace,
      stateLayout: opencodeStateLayout,
      hotReload: opencodeHotReload,
      bindHost: opencodeBindHost,
      port: opencodePort,
      username: opencodeUsername,
      password: opencodePassword,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
    });
    opencodeChild = child;
    children.push({ name: "opencode", child });
    logger.info(
      "Process spawned",
      { pid: child.pid ?? 0, cause: "runtime-upgrade" },
      "opencode",
    );
    child.on("exit", (code, signal) => handleExit("opencode", code, signal));
    child.on("error", (error) => handleSpawnError("opencode", error));
    await waitForOpencodeHealthy(
      createOpencodeClient({
        baseUrl: opencodeBaseUrl,
        directory: resolvedWorkspace,
        headers:
          opencodeUsername && opencodePassword
            ? {
          Authorization: `Basic ${encodeBasicAuth(opencodeCredentials.username, opencodeCredentials.password)}`,
              }
            : undefined,
      }),
    );
  };
  const restartAuroworkServer = async () => {
    if (auroworkChild) {
      restartingServices.add("aurowork-server");
      removeChildHandle("aurowork-server");
      await stopChild(auroworkChild);
      auroworkChild = null;
    }
    const child = await startAuroworkServer({
      bin: auroworkServerBinary.bin,
      host: auroworkHost,
      port: auroworkPort,
      workspace: resolvedWorkspace,
      token: auroworkToken,
      hostToken: auroworkHostToken,
      approvalMode: approvalMode === "auto" ? "auto" : "manual",
      approvalTimeoutMs,
      readOnly,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      opencodeBaseUrl: opencodeConnectUrl,
      opencodeDirectory: resolvedWorkspace,
      opencodeUsername,
      opencodePassword,
      logger,
      runId,
      logFormat,
      controlBaseUrl,
      controlToken,
    });
    auroworkChild = child;
    children.push({ name: "aurowork-server", child });
    logger.info(
      "Process spawned",
      { pid: child.pid ?? 0, cause: "runtime-upgrade" },
      "aurowork-server",
    );
    child.on("exit", (code, signal) =>
      handleExit("aurowork-server", code, signal),
    );
    child.on("error", (error) => handleSpawnError("aurowork-server", error));
    await waitForHealthy(auroworkBaseUrl);
    auroworkActualVersion = await verifyAuroworkServer({
      baseUrl: auroworkBaseUrl,
      token: auroworkToken,
      hostToken: auroworkHostToken,
      expectedVersion: auroworkServerBinary.expectedVersion,
      expectedWorkspace: resolvedWorkspace,
      expectedOpencodeBaseUrl: opencodeConnectUrl,
      expectedOpencodeDirectory: resolvedWorkspace,
      expectedOpencodeUsername: opencodeUsername,
      expectedOpencodePassword: opencodePassword,
    });
  };
  const performRuntimeUpgrade = async (services: RuntimeServiceName[]) => {
    const opId = randomUUID();
    runtimeUpgradeState.status = "running";
    runtimeUpgradeState.startedAt = Date.now();
    runtimeUpgradeState.finishedAt = null;
    runtimeUpgradeState.error = null;
    runtimeUpgradeState.operationId = opId;
    runtimeUpgradeState.services = services;
    try {
      if (
        services.includes("aurowork-server") &&
        auroworkServerBinary.source === "external" &&
        auroworkServerBinary.expectedVersion
      ) {
        await installGlobalPackages([
          `aurowork-server@${auroworkServerBinary.expectedVersion}`,
        ]);
      }
      if (services.includes("aurowork-server")) {
        auroworkServerBinary = await resolveAuroworkServerBin({
          explicit: explicitAuroworkServerBin,
          manifest,
          allowExternal,
          sidecar,
          source: sidecarSource,
        });
      }
      if (services.includes("opencode")) {
        opencodeBinary = await resolveOpencodeBin({
          explicit: explicitOpencodeBin,
          manifest,
          allowExternal,
          sidecar,
          source: opencodeSource,
        });
      }
      if (services.includes("opencode")) {
        await restartOpencode();
      }
      if (
        services.includes("aurowork-server") ||
        services.includes("opencode")
      ) {
        await restartAuroworkServer();
      }
      runtimeUpgradeState.status = "idle";
      runtimeUpgradeState.finishedAt = Date.now();
    } catch (error) {
      runtimeUpgradeState.status = "failed";
      runtimeUpgradeState.finishedAt = Date.now();
      runtimeUpgradeState.error =
        error instanceof Error ? error.message : String(error);
      logger.error(
        "Runtime upgrade failed",
        { error: runtimeUpgradeState.error, services },
        "aurowork-orchestrator",
      );
    }
  };
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    if (workerActivityHeartbeatInterval) {
      clearInterval(workerActivityHeartbeatInterval);
      workerActivityHeartbeatInterval = null;
    }
    if (controlServer) {
      await new Promise<void>((resolve) =>
        controlServer?.close(() => resolve()),
      );
      controlServer = null;
    }
    logger.info(
      "Shutting down",
      { children: children.map((handle) => handle.name) },
      "aurowork-orchestrator",
    );
    await Promise.all(children.map((handle) => stopChild(handle.child)));
  };

  const detachChildren = () => {
    detached = true;
    for (const handle of children) {
      try {
        handle.child.unref();
      } catch {
        // ignore
      }
      handle.child.stdout?.removeAllListeners();
      handle.child.stderr?.removeAllListeners();
      handle.child.stdout?.destroy();
      handle.child.stderr?.destroy();
    }
  };

  const handleQuit = async () => {
    tui?.stop();
    await shutdown();
    process.exit(0);
  };

  const handleDetach = async () => {
    if (detached) return;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    if (workerActivityHeartbeatInterval) {
      clearInterval(workerActivityHeartbeatInterval);
      workerActivityHeartbeatInterval = null;
    }
    tui?.stop();
    detachChildren();
    const summary = [
      "Detached. Services still running:",
      ...children.map(
        (handle) => `- ${handle.name} (pid ${handle.child.pid ?? "unknown"})`,
      ),
      `AuroWork URL: ${auroworkConnectUrl}`,
      `AuroWork Collaborator Token: ${auroworkToken}`,
      ...(auroworkOwnerToken
        ? [`AuroWork Owner Token: ${auroworkOwnerToken}`]
        : []),
      `OpenCode URL: ${opencodeConnectUrl}`,
      `Attach: ${attachCommand}`,
    ].join("\n");
    process.stdout.write(`${summary}\n`);
    process.exit(0);
  };

  if (useTui) {
    if (compiledBinary) {
      const originalConsoleError = console.error.bind(console);
      restoreConsoleError = () => {
        console.error = originalConsoleError;
      };
      console.error = (...items: unknown[]) => {
        const text = items
          .map((item) => {
            if (typeof item === "string") return item;
            if (item instanceof Error) return `${item.name}: ${item.message}`;
            return String(item);
          })
          .join(" ");
        if (
          text.includes("React is not defined") ||
          text.includes("/$bunfs/root/aurowork-orchestrator") ||
          text.includes("/$bunfs/root/aurowork")
        ) {
          switchToPlainOutput(text);
        }
        originalConsoleError(...items);
      };
    }
    try {
      const { startOrchestratorTui } = await import("./tui/app.js");
      tui = startOrchestratorTui({
        version: cliVersion,
        connect: {
          runId,
          workspace: resolvedWorkspace,
          auroworkUrl: auroworkConnectUrl,
          auroworkToken,
          ownerToken: auroworkOwnerToken,
          hostToken: auroworkHostToken,
          opencodeUrl: opencodeConnectUrl,
          opencodePassword: opencodePassword ?? undefined,
          opencodeUsername: opencodeUsername ?? undefined,
          attachCommand,
        },
        services: [
          {
            name: "opencode",
            label: "opencode",
            status: "starting",
            port: opencodePort,
          },
          {
            name: "aurowork-server",
            label: "aurowork-server",
            status: "starting",
            port: auroworkPort,
          },
        ],
        onQuit: handleQuit,
        onDetach: handleDetach,
        onCopyAttach: async () => {
          const result = await copyToClipboard(attachCommand);
          return { command: attachCommand, ...result };
        },
        onCopySelection: async (text) => copyToClipboard(text),
      });
      tui.setUptimeStart(startedAt);
    } catch (error) {
      switchToPlainOutput(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const handleExit = (
    name: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => {
    if (shuttingDown || detached) return;
    if (restartingServices.has(name)) {
      restartingServices.delete(name);
      return;
    }
    const reason =
      code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
    tui?.updateService(name, { status: "stopped", message: reason });
    logger.error("Process exited", { reason, code, signal }, name);
    void shutdown().then(() => process.exit(code ?? 1));
  };

  const handleSpawnError = (name: string, error: unknown) => {
    if (shuttingDown || detached) return;
    tui?.updateService(name, {
      status: "error",
      message: String(error),
    });
    logger.error("Process failed to start", { error: String(error) }, name);
    void shutdown().then(() => process.exit(1));
  };

  try {
    opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    let opencodeClient: ReturnType<typeof createOpencodeClient>;

    controlServer = createHttpServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", controlBaseUrl);
      res.setHeader("Content-Type", "application/json");
      const authHeader = req.headers.authorization ?? "";
      if (authHeader !== `Bearer ${controlToken}`) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      if (method === "GET" && url.pathname === "/runtime/versions") {
        res.statusCode = 200;
        res.end(JSON.stringify(getRuntimeSnapshot()));
        return;
      }
      if (method === "POST" && url.pathname === "/runtime/upgrade") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        let body: { services?: RuntimeServiceName[] } | null = null;
        try {
          body = chunks.length
            ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                services?: RuntimeServiceName[];
              })
            : null;
        } catch {
          body = null;
        }
        const requested = Array.isArray(body?.services)
          ? body.services
          : ["aurowork-server", "opencode"];
        const services = Array.from(
          new Set(
            requested.filter(
              (item): item is RuntimeServiceName =>
                item === "aurowork-server" ||
                item === "opencode",
            ),
          ),
        );
        if (!services.length) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "invalid_services" }));
          return;
        }
        if (runtimeUpgradeState.status === "running") {
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              ok: false,
              error: "upgrade_in_progress",
              upgrade: runtimeUpgradeState,
            }),
          );
          return;
        }
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            ok: true,
            started: true,
            services,
            upgrade: { ...runtimeUpgradeState, status: "running" },
          }),
        );
        void performRuntimeUpgrade(services);
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
    });
    await new Promise<void>((resolve, reject) => {
      controlServer?.once("error", reject);
      controlServer?.listen(controlPort, "127.0.0.1", () => resolve());
    });

    const startedOpencodeChild = await startOpencode({
        bin: opencodeBinary.bin,
        workspace: resolvedWorkspace,
        stateLayout: opencodeStateLayout,
        hotReload: opencodeHotReload,
        bindHost: opencodeBindHost,
        port: opencodePort,
        username: opencodeUsername,
        password: opencodePassword,
        corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
        logger,
        runId,
        logFormat,
      });
      opencodeChild = startedOpencodeChild;
      children.push({ name: "opencode", child: startedOpencodeChild });
      tui?.updateService("opencode", {
        status: "running",
        pid: startedOpencodeChild.pid ?? undefined,
        port: opencodePort,
      });
      logger.info(
        "Process spawned",
        { pid: startedOpencodeChild.pid ?? 0 },
        "opencode",
      );
      startedOpencodeChild.on("exit", (code, signal) =>
        handleExit("opencode", code, signal),
      );
      startedOpencodeChild.on("error", (error) =>
        handleSpawnError("opencode", error),
      );

      const authHeaders: Record<string, string> = {};
      if (opencodeUsername && opencodePassword) {
        authHeaders.Authorization = `Basic ${encodeBasicAuth(opencodeUsername, opencodePassword)}`;
      }
      opencodeClient = createOpencodeClient({
        baseUrl: opencodeBaseUrl,
        directory: resolvedWorkspace,
        headers: Object.keys(authHeaders).length ? authHeaders : undefined,
      });

      logger.info("Waiting for health", { url: opencodeBaseUrl }, "opencode");
      await waitForOpencodeHealthy(opencodeClient);
      logger.info("Healthy", { url: opencodeBaseUrl }, "opencode");
      tui?.updateService("opencode", { status: "healthy" });

      const startedAuroworkChild = await startAuroworkServer({
        bin: auroworkServerBinary.bin,
        host: auroworkHost,
        port: auroworkPort,
        workspace: resolvedWorkspace,
        token: auroworkToken,
        hostToken: auroworkHostToken,
        approvalMode: approvalMode === "auto" ? "auto" : "manual",
        approvalTimeoutMs,
        readOnly,
        corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
        opencodeBaseUrl: opencodeConnectUrl,
        opencodeDirectory: resolvedWorkspace,
        opencodeUsername,
        opencodePassword,
        logger,
        runId,
        logFormat,
        controlBaseUrl,
        controlToken,
      });
      auroworkChild = startedAuroworkChild;
      children.push({ name: "aurowork-server", child: startedAuroworkChild });
      tui?.updateService("aurowork-server", {
        status: "running",
        pid: startedAuroworkChild.pid ?? undefined,
        port: auroworkPort,
      });
      logger.info(
        "Process spawned",
        { pid: startedAuroworkChild.pid ?? 0 },
        "aurowork-server",
      );
      startedAuroworkChild.on("exit", (code, signal) =>
        handleExit("aurowork-server", code, signal),
      );
      startedAuroworkChild.on("error", (error) =>
        handleSpawnError("aurowork-server", error),
      );

      logger.info(
        "Waiting for health",
        { url: auroworkBaseUrl },
        "aurowork-server",
      );
      await waitForHealthy(auroworkBaseUrl);
      logger.info("Healthy", { url: auroworkBaseUrl }, "aurowork-server");
      tui?.updateService("aurowork-server", { status: "healthy" });

      auroworkActualVersion = await verifyAuroworkServer({
        baseUrl: auroworkBaseUrl,
        token: auroworkToken,
        hostToken: auroworkHostToken,
        expectedVersion: auroworkServerBinary.expectedVersion,
        expectedWorkspace: resolvedWorkspace,
        expectedOpencodeBaseUrl: opencodeConnectUrl,
        expectedOpencodeDirectory: resolvedWorkspace,
        expectedOpencodeUsername: opencodeUsername,
        expectedOpencodePassword: opencodePassword,
      });
      auroworkOwnerToken = await issueAuroworkOwnerToken(
        auroworkBaseUrl,
        auroworkHostToken,
        "AuroWork owner token",
      );
      tui?.setConnectInfo({ ownerToken: auroworkOwnerToken });
      logVerbose(
        `aurowork-server version: ${auroworkActualVersion ?? "unknown"}`,
      );

    if (workerActivityHeartbeat.enabled && !checkOnly) {
      logger.info(
        "Worker activity heartbeat enabled",
        {
          workerId: workerActivityHeartbeat.workerId,
          intervalMs: workerActivityHeartbeat.intervalMs,
          activeWindowMs: workerActivityHeartbeat.activeWindowMs,
        },
        "aurowork-orchestrator",
      );
      const runHeartbeat = () => {
        void postWorkerActivityHeartbeat({
          config: workerActivityHeartbeat,
          opencodeClient,
          logger,
        }).catch((error) => {
          logger.warn(
            "Worker activity heartbeat failed",
            { error: error instanceof Error ? error.message : String(error) },
            "aurowork-orchestrator",
          );
        });
      };
      runHeartbeat();
      workerActivityHeartbeatInterval = setInterval(
        runHeartbeat,
        workerActivityHeartbeat.intervalMs,
      );
    }

    const payload = {
      runId,
      workspace: resolvedWorkspace,
      approval: {
        mode: approvalMode,
        timeoutMs: approvalTimeoutMs,
        readOnly,
      },
      opencode: {
        baseUrl: opencodeBaseUrl,
        connectUrl: opencodeConnectUrl,
        username: opencodeUsername,
        password: opencodePassword,
        bindHost: opencodeBindHost,
        port: opencodePort,
        hotReload: opencodeHotReload,
        version: opencodeActualVersion,
      },
      aurowork: {
        baseUrl: auroworkBaseUrl,
        connectUrl: auroworkConnectUrl,
        host: auroworkHost,
        port: auroworkPort,
        collaboratorToken: auroworkToken,
        ownerToken: auroworkOwnerToken,
        token: auroworkToken,
        hostToken: auroworkHostToken,
        version: auroworkActualVersion,
      },
      diagnostics: {
        cliVersion,
        sidecar: {
          dir: sidecar.dir,
          baseUrl: sidecar.baseUrl,
          manifestUrl: sidecar.manifestUrl,
          target: sidecar.target,
          source: sidecarSource,
          opencodeSource,
          allowExternal,
        } as SidecarDiagnostics,
        binaries: {
          opencode: {
            path: opencodeBinary.bin,
            source: opencodeBinary.source,
            expectedVersion: opencodeBinary.expectedVersion,
            actualVersion: opencodeActualVersion,
          } as BinaryDiagnostics,
          auroworkServer: {
            path: auroworkServerBinary.bin,
            source: auroworkServerBinary.source,
            expectedVersion: auroworkServerBinary.expectedVersion,
            actualVersion: auroworkActualVersion,
          } as BinaryDiagnostics,
        },
      },
    };

    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (useTui) {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          aurowork: payload.aurowork,
        },
        "aurowork-orchestrator",
      );
    } else if (logFormat === "json") {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          aurowork: payload.aurowork,
        },
        "aurowork-orchestrator",
      );
    } else {
      console.log("AuroWork orchestrator running");
      console.log(`Run ID: ${runId}`);
      console.log(`Workspace: ${payload.workspace}`);
      console.log(`OpenCode: ${payload.opencode.baseUrl}`);
      console.log(`OpenCode connect URL: ${payload.opencode.connectUrl}`);
      if (payload.opencode.username && payload.opencode.password) {
        console.log(
          `OpenCode auth: ${payload.opencode.username} / ${payload.opencode.password}`,
        );
      }
      console.log(`AuroWork server: ${payload.aurowork.baseUrl}`);
      console.log(`AuroWork connect URL: ${payload.aurowork.connectUrl}`);
      console.log(
        `AuroWork Collaborator Token: ${payload.aurowork.collaboratorToken}`,
      );
      console.log("  Routine remote access for shared workers.");
      if (payload.aurowork.ownerToken) {
        console.log(`AuroWork Owner Token: ${payload.aurowork.ownerToken}`);
        console.log(
          "  Use this when the remote client must answer permission prompts.",
        );
      }
      console.log(`AuroWork Host Admin Token: ${payload.aurowork.hostToken}`);
      console.log(
        "  Internal host/admin token for approvals CLI and host-only APIs.",
      );
    }

    if (detachRequested) {
      await handleDetach();
    }

    if (checkOnly) {
      try {
        await runChecks({
            opencodeClient,
            auroworkUrl: auroworkBaseUrl,
            auroworkToken,
            hostToken: auroworkHostToken,
            checkEvents,
          });
        logger.info("Checks ok", { checkEvents }, "aurowork-orchestrator");
        if (!outputJson && logFormat === "pretty") {
          console.log("Checks: ok");
        }
      } catch (error) {
        logger.error(
          "Checks failed",
          { error: String(error) },
          "aurowork-orchestrator",
        );
        await shutdown();
        tui?.stop();
        process.exit(1);
      }
      await shutdown();
      tui?.stop();
      process.exit(0);
    }

    process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
    process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
    await new Promise(() => undefined);
  } catch (error) {
    await shutdown();
    tui?.stop();
    logger.error(
      "Run failed",
      { error: error instanceof Error ? error.message : String(error) },
      "aurowork-orchestrator",
    );
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (readBool(args.flags, "help", false) || args.flags.get("help") === true) {
    printHelp();
    return;
  }
  if (
    readBool(args.flags, "version", false) ||
    args.flags.get("version") === true
  ) {
    console.log(await resolveCliVersion());
    return;
  }

  const command = args.positionals[0] ?? "start";
  if (command === "start") {
    await runStart(args);
    return;
  }
  if (command === "serve") {
    args.flags.set("tui", false);
    await runStart(args);
    return;
  }
  if (command === "daemon") {
    await runDaemonCommand(args);
    return;
  }
  if (command === "workspace" || command === "workspaces") {
    await runWorkspaceCommand(args);
    return;
  }
  if (command === "instance") {
    await runInstanceCommand(args);
    return;
  }
  if (command === "approvals") {
    await runApprovals(args);
    return;
  }
  if (command === "files") {
    await runFiles(args);
    return;
  }
  if (command === "status") {
    await runStatus(args);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
