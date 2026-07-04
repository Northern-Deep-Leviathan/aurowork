import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const json = args.has("--json");

const checks = [];

function addCheck(id, label, status, details = "", severity = "error") {
  checks.push({ id, label, status, details, severity });
}

function run(command, commandArgs = []) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error?.message,
  };
}

function commandVersion(id, label, command, commandArgs) {
  const result = run(command, commandArgs);
  addCheck(
    id,
    label,
    result.ok ? "pass" : "fail",
    result.ok ? firstLine(result.stdout || result.stderr) : result.error || firstLine(result.stderr) || "not available",
  );
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

commandVersion("node", "Node.js is available", "node", ["--version"]);
commandVersion("pnpm", "pnpm is available", "pnpm", ["--version"]);
commandVersion("bun", "Bun is available", "bun", ["--version"]);
commandVersion("rustc", "Rust compiler is available", "rustc", ["--version"]);
commandVersion("cargo", "Cargo is available", "cargo", ["--version"]);
commandVersion("tauri", "Tauri CLI is available through the desktop workspace", "pnpm", [
  "--filter",
  "@aurowork/desktop",
  "exec",
  "tauri",
  "--version",
]);

const pkgPath = resolve(root, "package.json");
const lockPath = resolve(root, "pnpm-lock.yaml");
const desktopPkgPath = resolve(root, "apps/desktop/package.json");
const desktopTauriConfig = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
const sidecarVersions = resolve(root, "apps/desktop/src-tauri/sidecars/versions.json");

if (existsSync(pkgPath)) {
  const pkg = readJson(pkgPath);
  addCheck(
    "package-manager",
    "Root package manager is pinned",
    pkg.packageManager === "pnpm@10.27.0" ? "pass" : "fail",
    pkg.packageManager || "missing packageManager",
  );
} else {
  addCheck("package-json", "Root package.json exists", "fail", "missing package.json");
}

addCheck(
  "lockfile",
  "pnpm lockfile exists",
  existsSync(lockPath) ? "pass" : "fail",
  existsSync(lockPath) ? "pnpm-lock.yaml" : "missing pnpm-lock.yaml",
);

if (existsSync(pkgPath) && existsSync(lockPath)) {
  const before = fileHash(lockPath);
  const frozenLockfile = run("pnpm", [
    "install",
    "--frozen-lockfile",
    "--lockfile-only",
    "--ignore-scripts",
    "--prefer-offline",
    "--reporter",
    "append-only",
  ]);
  const after = fileHash(lockPath);
  addCheck(
    "frozen-lockfile",
    "pnpm frozen lockfile install is ready without mutating dependencies",
    frozenLockfile.ok && before === after ? "pass" : "fail",
    frozenLockfile.ok && before === after
      ? "pnpm install --frozen-lockfile --lockfile-only --ignore-scripts"
      : before !== after
        ? "pnpm-lock.yaml changed during frozen-lockfile readiness check"
        : frozenLockfile.error || firstLine(frozenLockfile.stderr) || firstLine(frozenLockfile.stdout) || `exit ${frozenLockfile.status}`,
  );
}

addCheck(
  "desktop-package",
  "Desktop package exists",
  existsSync(desktopPkgPath) ? "pass" : "fail",
  desktopPkgPath,
);
addCheck(
  "tauri-config",
  "Tauri config exists",
  existsSync(desktopTauriConfig) ? "pass" : "fail",
  desktopTauriConfig,
);
addCheck(
  "sidecar-versions",
  "Desktop sidecar version manifest exists",
  existsSync(sidecarVersions) ? "pass" : "warn",
  existsSync(sidecarVersions)
    ? "apps/desktop/src-tauri/sidecars/versions.json"
    : "run sidecar preparation before release packaging",
  "warn",
);

const buildScriptPath = resolve(root, "scripts/build.mjs");
if (existsSync(buildScriptPath)) {
  const content = readFileSync(buildScriptPath, "utf8");
  const referencesMissingShare = content.includes("apps/share") && !existsSync(resolve(root, "apps/share"));
  addCheck(
    "default-build-target",
    "Default build path does not point at a missing app",
    referencesMissingShare ? "fail" : "pass",
    referencesMissingShare
      ? "scripts/build.mjs references apps/share, but apps/share does not exist"
      : "default build target is present",
  );
} else {
  addCheck("build-script", "Root build script exists", "fail", "missing scripts/build.mjs");
}

const rootPkg = existsSync(pkgPath) ? readJson(pkgPath) : {};
const scripts = rootPkg.scripts || {};
const localDev = String(scripts.dev || "");
addCheck(
  "local-dev-loopback",
  "Default desktop dev command is local by default",
  /@aurowork\/desktop dev/.test(localDev) && !/0\.0\.0\.0|REMOTE_ACCESS|remote-access/.test(localDev) ? "pass" : "fail",
  localDev || "missing dev script",
);

addCheck(
  "headless-web-not-exposed",
  "Headless web is not exposed as a root dev script",
  scripts["dev:headless-web"] ? "fail" : "pass",
  scripts["dev:headless-web"]
    ? "remove dev:headless-web from package.json before treating setup as local-desktop only"
    : "no headless web script exposed",
);

const failed = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const report = {
  ok: failed.length === 0,
  summary: {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: warnings.length,
    fail: failed.length,
  },
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("AuroWork setup doctor");
  for (const check of checks) {
    const marker = check.status === "pass" ? "ok" : check.status;
    console.log(`- ${marker}: ${check.label}${check.details ? ` (${check.details})` : ""}`);
  }
  console.log(`Summary: ${report.summary.pass} passed, ${report.summary.warn} warning(s), ${report.summary.fail} failure(s).`);
}

process.exit(report.ok ? 0 : 1);
