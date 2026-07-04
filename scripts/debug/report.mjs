import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEBUG_REPORT_SCHEMA_VERSION = 1;

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SECRET_KEY_PATTERN =
  /(authorization|auth[_-]?header|token|secret|password|passwd|api[_-]?key|access[_-]?key|refresh[_-]?key|credential|client[_-]?secret)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/=._-]+/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\b/g,
];

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error?.message ?? null,
  };
}

function commandText(command, args) {
  const result = run(command, args);
  return result.ok ? firstLine(result.stdout || result.stderr) : null;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "";
}

function runSetupDoctor() {
  const result = run("node", ["scripts/setup/doctor.mjs", "--json"]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || firstLine(result.stderr) || `exit ${result.status}`,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout.trim(),
    };
  }
}

export function redact(value) {
  return redactValue(value, []);
}

function redactValue(value, path) {
  const key = path[path.length - 1] ?? "";
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, [...path, String(index)]));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, [...path, entryKey]),
      ]),
    );
  }

  if (typeof value === "string") {
    let next = value;
    const home = homedir();
    if (home) {
      next = next.split(home).join("~");
    }
    for (const pattern of SECRET_VALUE_PATTERNS) {
      next = next.replace(pattern, "[redacted]");
    }
    return next;
  }

  return value;
}

function collectEnvFlags() {
  const envNames = [
    "AUROWORK_DEV_MODE",
    "CI",
    "GITHUB_ACTIONS",
    "SOURCE_DATE_EPOCH",
    "VERCEL",
    "DAYTONA",
    "NPM_TOKEN",
    "AUR_SSH_PRIVATE_KEY",
    "AZURE_STORAGE_CONNECTION_STRING",
    "AUROWORK_DEN_TOKEN",
    "AUROWORK_SERVER_TOKEN",
  ];

  return Object.fromEntries(
    envNames.map((name) => [
      name,
      {
        present: Boolean(process.env[name]),
        value: process.env[name] ? "[redacted]" : null,
      },
    ]),
  );
}

export function buildDebugReport(options = {}) {
  const pkg = readJsonIfExists(resolve(root, "package.json"));
  const setupDoctor = options.setupDoctor ?? runSetupDoctor();
  const report = {
    schemaVersion: DEBUG_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    productScope: "local-desktop",
    repo: {
      packageName: pkg?.name ?? null,
      packageManager: pkg?.packageManager ?? null,
    },
    runtime: {
      platform: platform(),
      arch: arch(),
      node: process.version,
      pnpm: commandText("pnpm", ["--version"]),
      bun: commandText("bun", ["--version"]),
      rustc: commandText("rustc", ["--version"]),
      cargo: commandText("cargo", ["--version"]),
    },
    setupDoctor,
    env: collectEnvFlags(),
  };

  return redact(report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = buildDebugReport();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.setupDoctor?.ok === false ? 1 : 0);
}
