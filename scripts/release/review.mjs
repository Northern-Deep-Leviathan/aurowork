import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const strict = args.includes("--strict");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const readTextIfExists = (path) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

const readCargoVersion = (path) => {
  const content = readText(path);
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
};

const appPkg = readJson(resolve(root, "apps", "app", "package.json"));
const desktopPkg = readJson(resolve(root, "apps", "desktop", "package.json"));
const orchestratorPkg = readJson(
  resolve(root, "apps", "orchestrator", "package.json"),
);
const pinnedAuroVersion = String(
  readJson(resolve(root, "constants.json")).auroVersion ?? "",
)
  .trim()
  .replace(/^v/, "");
const serverPkg = readJson(resolve(root, "apps", "server", "package.json"));
const tauriConfig = readJson(
  resolve(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
);
const cargoVersion = readCargoVersion(
  resolve(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
);

const versions = {
  app: appPkg.version ?? null,
  desktop: desktopPkg.version ?? null,
  tauri: tauriConfig.version ?? null,
  cargo: cargoVersion ?? null,
  server: serverPkg.version ?? null,
  orchestrator: orchestratorPkg.version ?? null,
  auro: pinnedAuroVersion || null,
  orchestratorAuroworkServerRange:
    orchestratorPkg.dependencies?.["aurowork-server"] ?? null,
};

const checks = [];
const warnings = [];
let ok = true;

const addCheck = (label, pass, details) => {
  checks.push({ label, ok: pass, details });
  if (!pass) ok = false;
};

const addWarning = (message) => warnings.push(message);

addCheck(
  "App/desktop versions match",
  versions.app && versions.desktop && versions.app === versions.desktop,
  `${versions.app ?? "?"} vs ${versions.desktop ?? "?"}`,
);
addCheck(
  "App/aurowork-orchestrator versions match",
  versions.app &&
    versions.orchestrator &&
    versions.app === versions.orchestrator,
  `${versions.app ?? "?"} vs ${versions.orchestrator ?? "?"}`,
);
addCheck(
  "App/aurowork-server versions match",
  versions.app && versions.server && versions.app === versions.server,
  `${versions.app ?? "?"} vs ${versions.server ?? "?"}`,
);
addCheck(
  "Desktop/Tauri versions match",
  versions.desktop && versions.tauri && versions.desktop === versions.tauri,
  `${versions.desktop ?? "?"} vs ${versions.tauri ?? "?"}`,
);
addCheck(
  "Desktop/Cargo versions match",
  versions.desktop && versions.cargo && versions.desktop === versions.cargo,
  `${versions.desktop ?? "?"} vs ${versions.cargo ?? "?"}`,
);
if (versions.auro) {
  addCheck(
    "Auro engine version pin exists",
    Boolean(versions.auro),
    String(versions.auro),
  );
} else {
  addWarning(
    "Auro engine version is not pinned in constants.json (auroVersion field).",
  );
}

const auroworkServerRange = versions.orchestratorAuroworkServerRange ?? "";
const auroworkServerPinned = /^\d+\.\d+\.\d+/.test(auroworkServerRange);
if (!auroworkServerRange) {
  addWarning("aurowork-orchestrator is missing an aurowork-server dependency.");
} else if (!auroworkServerPinned) {
  addWarning(
    `aurowork-orchestrator aurowork-server dependency is not pinned (${auroworkServerRange}).`,
  );
} else {
  addCheck(
    "Aurowork-server dependency matches server version",
    versions.server && auroworkServerRange === versions.server,
    `${auroworkServerRange} vs ${versions.server ?? "?"}`,
  );
}

const sidecarManifestPath = resolve(
  root,
  "apps",
  "orchestrator",
  "dist",
  "sidecars",
  "aurowork-orchestrator-sidecars.json",
);
if (existsSync(sidecarManifestPath)) {
  const manifest = readJson(sidecarManifestPath);
  addCheck(
    "Sidecar manifest version matches aurowork-orchestrator",
    versions.orchestrator && manifest.version === versions.orchestrator,
    `${manifest.version ?? "?"} vs ${versions.orchestrator ?? "?"}`,
  );
  const serverEntry = manifest.entries?.["aurowork-server"]?.version;
  if (serverEntry) {
    addCheck(
      "Sidecar manifest aurowork-server version matches",
      versions.server && serverEntry === versions.server,
      `${serverEntry ?? "?"} vs ${versions.server ?? "?"}`,
    );
  }
} else {
  addWarning(
    "Sidecar manifest missing (run pnpm --filter aurowork-orchestrator build:sidecars).",
  );
}

if (!process.env.SOURCE_DATE_EPOCH) {
  addWarning(
    "SOURCE_DATE_EPOCH is not set (sidecar manifests will include current time).",
  );
}

const rootPkg = readJson(resolve(root, "package.json"));
const rootScripts = rootPkg.scripts ?? {};
const requiredRootScripts = [
  "setup:doctor",
  "setup:doctor:json",
  "docs:check",
  "docs:index:check",
  "docs:claims:check",
  "debug:report",
  "verify:fast",
  "verify:full",
  "verify:release",
  "test:server",
  "test:desktop",
  "test:scripts",
  "eval:local-desktop",
];

for (const scriptName of requiredRootScripts) {
  const command = rootScripts[scriptName];
  addCheck(
    `Root script exists: ${scriptName}`,
    typeof command === "string" && command.trim().length > 0,
    command ?? "missing",
  );
}

const buildScriptPath = resolve(root, "scripts", "build.mjs");
const buildScript = readTextIfExists(buildScriptPath);
addCheck(
  "Default build targets desktop package",
  buildScript.includes("@aurowork/desktop") && !buildScript.includes("apps/share"),
  "scripts/build.mjs should build @aurowork/desktop and avoid apps/share",
);

const verifyWorkflowPath = resolve(
  root,
  ".github",
  "workflows",
  "verify-local-desktop.yml",
);
const verifyWorkflow = readTextIfExists(verifyWorkflowPath);
addCheck(
  "Local desktop verification workflow exists",
  Boolean(verifyWorkflow),
  ".github/workflows/verify-local-desktop.yml",
);
if (verifyWorkflow) {
  const requiredVerifyWorkflowCommands = [
    "pnpm setup:doctor",
    "pnpm docs:check",
    "pnpm debug:report",
    "pnpm verify:fast",
    "pnpm eval:local-desktop",
  ];
  for (const command of requiredVerifyWorkflowCommands) {
    addCheck(
      `Local desktop workflow runs ${command}`,
      verifyWorkflow.includes(command),
      ".github/workflows/verify-local-desktop.yml",
    );
  }
}

const desktopReleaseWorkflowPath = resolve(
  root,
  ".github",
  "workflows",
  "build-desktop.yml",
);
const desktopReleaseWorkflow = readTextIfExists(desktopReleaseWorkflowPath);
addCheck(
  "Desktop release workflow exists",
  Boolean(desktopReleaseWorkflow),
  ".github/workflows/build-desktop.yml",
);
if (desktopReleaseWorkflow) {
  addCheck(
    "Desktop release workflow has quality job",
    /^\s{2}quality:\s*$/m.test(desktopReleaseWorkflow),
    ".github/workflows/build-desktop.yml",
  );
  addCheck(
    "Desktop release workflow runs verify:release",
    desktopReleaseWorkflow.includes("pnpm verify:release"),
    ".github/workflows/build-desktop.yml",
  );
  addCheck(
    "Desktop release creation waits for quality",
    /create-release:[\s\S]*?needs:\s*\[prepare,\s*quality\]/m.test(
      desktopReleaseWorkflow,
    ),
    ".github/workflows/build-desktop.yml",
  );
  addCheck(
    "Desktop packaging waits for quality",
    /build:[\s\S]*?needs:\s*\[prepare,\s*quality,\s*create-release\]/m.test(
      desktopReleaseWorkflow,
    ),
    ".github/workflows/build-desktop.yml",
  );
}

const report = { ok, versions, checks, warnings };

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Release review");
  for (const check of checks) {
    const status = check.ok ? "ok" : "fail";
    console.log(`- ${status}: ${check.label} (${check.details})`);
  }
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

if (strict && !ok) {
  process.exit(1);
}
