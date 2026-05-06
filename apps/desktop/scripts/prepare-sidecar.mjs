import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readArg = (name) => {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.split("=")[1];
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
};

const hasFlag = (name) => process.argv.slice(2).includes(name);
const forceBuild = hasFlag("--force") || process.env.AUROWORK_SIDECAR_FORCE_BUILD === "1";
const sidecarOverride = process.env.AUROWORK_SIDECAR_DIR?.trim() || readArg("--outdir");
const sidecarDir = sidecarOverride ? resolve(sidecarOverride) : join(__dirname, "..", "src-tauri", "sidecars");
const packageJsonPath = resolve(__dirname, "..", "package.json");
const constantsPath = resolve(__dirname, "..", "..", "..", "constants.json");

const auroGithubRepo = (() => {
  const raw =
    process.env.AURO_GITHUB_REPO?.trim() ||
    process.env.AUROWORK_AURO_GITHUB_REPO?.trim() ||
    "Northern-Deep-Leviathan/auro";
  const normalized = raw
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return "Northern-Deep-Leviathan/auro";
  }
  return normalized;
})();
const auroVersion = (() => {
  try {
    const raw = readFileSync(constantsPath, "utf8");
    const parsed = JSON.parse(raw);
    const value =
      typeof parsed.auroVersion === "string"
        ? parsed.auroVersion
        : null;
    return value ? value.trim() || null : null;
  } catch {
    return null;
  }
})();

const normalizeVersion = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "latest") return null;
  return raw.startsWith("v") ? raw.slice(1) : raw;
};

const auroAssetOverride =
  process.env.AURO_ASSET?.trim() || null;
const chromeDevtoolsMcpVersion =
  process.env.CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  process.env.AUROWORK_CHROME_DEVTOOLS_MCP_VERSION?.trim() ||
  "0.17.0";

// Target triple for native platform binaries
const resolvedTargetTriple = (() => {
  const envTarget =
    process.env.TAURI_ENV_TARGET_TRIPLE ??
    process.env.CARGO_CFG_TARGET_TRIPLE ??
    process.env.TARGET;
  if (envTarget) return envTarget;
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  return null;
})();

const bunTarget = (() => {
  switch (resolvedTargetTriple) {
    case "aarch64-apple-darwin":
      return "bun-darwin-arm64";
    case "x86_64-apple-darwin":
      return "bun-darwin-x64-baseline";
    case "aarch64-unknown-linux-gnu":
      return "bun-linux-arm64";
    case "x86_64-unknown-linux-gnu":
      return "bun-linux-x64-baseline";
    // Windows baseline artifacts intermittently fail to extract in CI
    // with Bun 1.3.6. Use the stable x64 target here for now.
    case "x86_64-pc-windows-msvc":
      return "bun-windows-x64";
    default:
      return null;
  }
})();

const auroBaseName = process.platform === "win32" ? "auro.exe" : "auro";
const auroPath = join(sidecarDir, auroBaseName);
const auroTargetName = resolvedTargetTriple
  ? `auro-${resolvedTargetTriple}${process.platform === "win32" ? ".exe" : ""}`
  : null;
const auroTargetPath = auroTargetName ? join(sidecarDir, auroTargetName) : null;

const auroCandidatePath = auroTargetPath ?? auroPath;
let existingAuroVersion = null;

// aurowork-server paths
const auroworkServerBaseName = "aurowork-server";
const auroworkServerName = process.platform === "win32" ? `${auroworkServerBaseName}.exe` : auroworkServerBaseName;
const auroworkServerPath = join(sidecarDir, auroworkServerName);
const auroworkServerBuildName = bunTarget
  ? `${auroworkServerBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : auroworkServerName;
const auroworkServerBuildPath = join(sidecarDir, auroworkServerBuildName);
const auroworkServerTargetTriple = resolvedTargetTriple;
const auroworkServerTargetName = auroworkServerTargetTriple
  ? `${auroworkServerBaseName}-${auroworkServerTargetTriple}${auroworkServerTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const auroworkServerTargetPath = auroworkServerTargetName ? join(sidecarDir, auroworkServerTargetName) : null;

const auroworkServerDir = resolve(__dirname, "..", "..", "server");

const resolveBuildScript = (dir) => {
  const scriptPath = resolve(dir, "script", "build.ts");
  if (existsSync(scriptPath)) return scriptPath;
  const scriptsPath = resolve(dir, "scripts", "build.ts");
  if (existsSync(scriptsPath)) return scriptsPath;
  return scriptPath;
};

// orchestrator paths
const orchestratorBaseName = "aurowork-orchestrator";
const orchestratorName =
  process.platform === "win32" ? `${orchestratorBaseName}.exe` : orchestratorBaseName;
const orchestratorPath = join(sidecarDir, orchestratorName);
const orchestratorBuildName = bunTarget
  ? `${orchestratorBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : orchestratorName;
const orchestratorBuildPath = join(sidecarDir, orchestratorBuildName);
const orchestratorTargetTriple = resolvedTargetTriple;
const orchestratorTargetName = orchestratorTargetTriple
  ? `${orchestratorBaseName}-${orchestratorTargetTriple}${orchestratorTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const orchestratorTargetPath = orchestratorTargetName ? join(sidecarDir, orchestratorTargetName) : null;
const orchestratorDir = resolve(__dirname, "..", "..", "orchestrator");

// chrome-devtools-mcp shim sidecar
const chromeDevtoolsBaseName = "chrome-devtools-mcp";
const chromeDevtoolsName = process.platform === "win32" ? `${chromeDevtoolsBaseName}.exe` : chromeDevtoolsBaseName;
const chromeDevtoolsPath = join(sidecarDir, chromeDevtoolsName);
const chromeDevtoolsBuildName = bunTarget
  ? `${chromeDevtoolsBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : chromeDevtoolsName;
const chromeDevtoolsBuildPath = join(sidecarDir, chromeDevtoolsBuildName);
const chromeDevtoolsTargetTriple = resolvedTargetTriple;
const chromeDevtoolsTargetName = chromeDevtoolsTargetTriple
  ? `${chromeDevtoolsBaseName}-${chromeDevtoolsTargetTriple}${chromeDevtoolsTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const chromeDevtoolsTargetPath = chromeDevtoolsTargetName ? join(sidecarDir, chromeDevtoolsTargetName) : null;
const chromeDevtoolsShimPath = resolve(__dirname, "chrome-devtools-mcp-shim.ts");

const readHeader = (filePath, length = 256) => {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

const isStubBinary = (filePath) => {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return true;
    if (stat.size < 1024) return true;
    const header = readHeader(filePath);
    if (header.startsWith("#!")) return true;
    if (header.includes("Sidecar missing") || header.includes("Bun is required")) return true;
  } catch {
    return true;
  }
  return false;
};

const readDirectory = (dir) => {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      return readDirectory(next);
    }
    if (entry.isFile()) {
      return [next];
    }
    return [];
  });
};

const findAuroBinary = (dir) => {
  const candidates = readDirectory(dir);
  return (
    candidates.find((file) => file.endsWith(`/${auroBaseName}`) || file.endsWith(`\\${auroBaseName}`)) ??
    candidates.find((file) => file.endsWith("/auro") || file.endsWith("\\auro")) ??
    null
  );
};

const readBinaryVersion = (filePath) => {
  try {
    const result = spawnSync(filePath, ["--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  } catch {
    // ignore
  }
  return null;
};

const sha256File = (filePath) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
};

const parseChecksum = (content, assetName) => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/);
    if (name === assetName) return hash.toLowerCase();
    if (trimmed.endsWith(` ${assetName}`)) {
      return trimmed.split(/\s+/)[0]?.toLowerCase() ?? null;
    }
  }
  return null;
};

let didBuildAuroworkServer = false;
const shouldBuildAuroworkServer =
  forceBuild || !existsSync(auroworkServerBuildPath) || isStubBinary(auroworkServerBuildPath);

if (shouldBuildAuroworkServer) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(auroworkServerBuildPath)) {
    try {
      unlinkSync(auroworkServerBuildPath);
    } catch {
      // ignore
    }
  }
  const auroworkServerScript = resolveBuildScript(auroworkServerDir);
  if (!existsSync(auroworkServerScript)) {
    console.error(`AuroWork server build script not found at ${auroworkServerScript}`);
    process.exit(1);
  }
  const auroworkServerArgs = [auroworkServerScript, "--outdir", sidecarDir, "--filename", "aurowork-server"];
  if (bunTarget) {
    auroworkServerArgs.push("--target", bunTarget);
  }
  const buildResult = spawnSync("bun", auroworkServerArgs, {
    cwd: auroworkServerDir,
    stdio: "inherit",
  });

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  didBuildAuroworkServer = true;
}

if (existsSync(auroworkServerBuildPath)) {
  const shouldCopyCanonical = didBuildAuroworkServer || !existsSync(auroworkServerPath) || isStubBinary(auroworkServerPath);
  if (shouldCopyCanonical && auroworkServerBuildPath !== auroworkServerPath) {
    try {
      if (existsSync(auroworkServerPath)) {
        unlinkSync(auroworkServerPath);
      }
    } catch {
      // ignore
    }
    copyFileSync(auroworkServerBuildPath, auroworkServerPath);
  }

  if (auroworkServerTargetPath) {
    const shouldCopyTarget =
      didBuildAuroworkServer || !existsSync(auroworkServerTargetPath) || isStubBinary(auroworkServerTargetPath);
    if (shouldCopyTarget && auroworkServerBuildPath !== auroworkServerTargetPath) {
      try {
        if (existsSync(auroworkServerTargetPath)) {
          unlinkSync(auroworkServerTargetPath);
        }
      } catch {
        // ignore
      }
      copyFileSync(auroworkServerBuildPath, auroworkServerTargetPath);
    }
  }
}

if (!existingAuroVersion && auroCandidatePath) {
  existingAuroVersion =
    existsSync(auroCandidatePath) && !isStubBinary(auroCandidatePath)
      ? readBinaryVersion(auroCandidatePath)
      : null;
}

const normalizedAuroVersion = normalizeVersion(auroVersion);

if (!normalizedAuroVersion) {
  console.error(
    `Auro version could not be resolved from ${constantsPath}.`
  );
  process.exit(1);
}

const auroAssetByTarget = {
  "aarch64-apple-darwin": "auro-darwin-arm64.zip",
  "x86_64-apple-darwin": "auro-darwin-x64-baseline.zip",
  "x86_64-unknown-linux-gnu": "auro-linux-x64-baseline.tar.gz",
  "aarch64-unknown-linux-gnu": "auro-linux-arm64.tar.gz",
  "x86_64-pc-windows-msvc": "auro-windows-x64-baseline.zip",
  "aarch64-pc-windows-msvc": "auro-windows-arm64.zip",
};

const auroAsset =
  auroAssetOverride ?? (resolvedTargetTriple ? auroAssetByTarget[resolvedTargetTriple] : null);

const auroUrl = auroAsset
  ? `https://github.com/${auroGithubRepo}/releases/download/v${normalizedAuroVersion}/${auroAsset}`
  : null;

const shouldDownloadAuro =
  !auroCandidatePath ||
  !existsSync(auroCandidatePath) ||
  isStubBinary(auroCandidatePath) ||
  !existingAuroVersion ||
  existingAuroVersion !== normalizedAuroVersion;

if (!shouldDownloadAuro) {
  console.log(`Auro sidecar already present (${existingAuroVersion}).`);
}

if (shouldDownloadAuro) {
  if (!auroAsset || !auroUrl) {
    console.error(
      `No Auro asset configured for target ${resolvedTargetTriple ?? "unknown"}. Set AURO_ASSET to override.`
    );
    process.exit(1);
  }

  mkdirSync(sidecarDir, { recursive: true });

  const stamp = Date.now();
  const archivePath = join(tmpdir(), `auro-${stamp}-${auroAsset}`);
  const extractDir = join(tmpdir(), `auro-${stamp}`);

  mkdirSync(extractDir, { recursive: true });

  if (process.platform === "win32") {
    const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      `Invoke-WebRequest -Uri ${psQuote(auroUrl)} -OutFile ${psQuote(archivePath)}`,
      `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
    ].join("; ");

    const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } else {
    const downloadResult = spawnSync("curl", ["-fsSL", "-o", archivePath, auroUrl], {
      stdio: "inherit",
    });
    if (downloadResult.status !== 0) {
      process.exit(downloadResult.status ?? 1);
    }

    mkdirSync(extractDir, { recursive: true });

    if (auroAsset.endsWith(".zip")) {
      const unzipResult = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], {
        stdio: "inherit",
      });
      if (unzipResult.status !== 0) {
        process.exit(unzipResult.status ?? 1);
      }
    } else if (auroAsset.endsWith(".tar.gz")) {
      const tarResult = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
        stdio: "inherit",
      });
      if (tarResult.status !== 0) {
        process.exit(tarResult.status ?? 1);
      }
    } else {
      console.error(`Unknown Auro archive type: ${auroAsset}`);
      process.exit(1);
    }
  }

  const extractedBinary = findAuroBinary(extractDir);
  if (!extractedBinary) {
    console.error("Auro binary not found after extraction.");
    process.exit(1);
  }

  const auroTargets = [auroTargetPath, auroPath].filter(Boolean);
  for (const target of auroTargets) {
    try {
      if (existsSync(target)) {
        unlinkSync(target);
      }
    } catch {
      // ignore
    }
    copyFileSync(extractedBinary, target);
    try {
      chmodSync(target, 0o755);
    } catch {
      // ignore
    }
  }

  console.log(`Auro sidecar updated to ${normalizedAuroVersion}.`);
}

// Build orchestrator sidecar
let didBuildOrchestrator = false;
const shouldBuildOrchestrator =
  forceBuild || !existsSync(orchestratorBuildPath) || isStubBinary(orchestratorBuildPath);
if (shouldBuildOrchestrator) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(orchestratorBuildPath)) {
    try {
      unlinkSync(orchestratorBuildPath);
    } catch {
      // ignore
    }
  }
  const orchestratorBuildScript = resolveBuildScript(orchestratorDir);
  if (!existsSync(orchestratorBuildScript)) {
    console.error(`Orchestrator build script not found at ${orchestratorBuildScript}`);
    process.exit(1);
  }
  const orchestratorArgs = [
    orchestratorBuildScript,
    "--outdir",
    sidecarDir,
    "--filename",
    orchestratorBaseName,
  ];
  if (bunTarget) {
    orchestratorArgs.push("--target", bunTarget);
  }
  const result = spawnSync("bun", orchestratorArgs, {
    cwd: orchestratorDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      BUN_ENV: "production",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  didBuildOrchestrator = true;
}

if (existsSync(orchestratorBuildPath)) {
  const shouldCopyCanonical =
    didBuildOrchestrator || !existsSync(orchestratorPath) || isStubBinary(orchestratorPath);
  if (shouldCopyCanonical && orchestratorBuildPath !== orchestratorPath) {
    try {
      if (existsSync(orchestratorPath)) unlinkSync(orchestratorPath);
    } catch {
      // ignore
    }
    copyFileSync(orchestratorBuildPath, orchestratorPath);
  }

  if (orchestratorTargetPath) {
    const shouldCopyTarget =
      didBuildOrchestrator ||
      !existsSync(orchestratorTargetPath) ||
      isStubBinary(orchestratorTargetPath);
    if (shouldCopyTarget && orchestratorBuildPath !== orchestratorTargetPath) {
      try {
        if (existsSync(orchestratorTargetPath)) unlinkSync(orchestratorTargetPath);
      } catch {
        // ignore
      }
      copyFileSync(orchestratorBuildPath, orchestratorTargetPath);
    }
  }
}

// Build chrome-devtools-mcp shim sidecar
let didBuildChromeDevtools = false;
const shouldBuildChromeDevtools =
  forceBuild || !existsSync(chromeDevtoolsBuildPath) || isStubBinary(chromeDevtoolsBuildPath);
if (shouldBuildChromeDevtools) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(chromeDevtoolsBuildPath)) {
    try {
      unlinkSync(chromeDevtoolsBuildPath);
    } catch {
      // ignore
    }
  }

  if (!existsSync(chromeDevtoolsShimPath)) {
    console.error(`Chrome DevTools MCP shim source not found at ${chromeDevtoolsShimPath}`);
    process.exit(1);
  }

  const chromeDevtoolsArgs = [
    "build",
    "--compile",
    chromeDevtoolsShimPath,
    "--outfile",
    chromeDevtoolsBuildPath,
  ];
  if (bunTarget) {
    chromeDevtoolsArgs.push("--target", bunTarget);
  }

  const result = spawnSync("bun", chromeDevtoolsArgs, {
    cwd: __dirname,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      BUN_ENV: "production",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  didBuildChromeDevtools = true;
}

if (existsSync(chromeDevtoolsBuildPath)) {
  const shouldCopyCanonical =
    didBuildChromeDevtools || !existsSync(chromeDevtoolsPath) || isStubBinary(chromeDevtoolsPath);
  if (shouldCopyCanonical && chromeDevtoolsBuildPath !== chromeDevtoolsPath) {
    try {
      if (existsSync(chromeDevtoolsPath)) unlinkSync(chromeDevtoolsPath);
    } catch {
      // ignore
    }
    copyFileSync(chromeDevtoolsBuildPath, chromeDevtoolsPath);
  }

  if (chromeDevtoolsTargetPath) {
    const shouldCopyTarget =
      didBuildChromeDevtools ||
      !existsSync(chromeDevtoolsTargetPath) ||
      isStubBinary(chromeDevtoolsTargetPath);
    if (shouldCopyTarget && chromeDevtoolsBuildPath !== chromeDevtoolsTargetPath) {
      try {
        if (existsSync(chromeDevtoolsTargetPath)) unlinkSync(chromeDevtoolsTargetPath);
      } catch {
        // ignore
      }
      copyFileSync(chromeDevtoolsBuildPath, chromeDevtoolsTargetPath);
    }
  }
}

const auroworkServerVersion = (() => {
  try {
    const raw = readFileSync(resolve(auroworkServerDir, "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "").trim();
  } catch {
    return null;
  }
})();

const orchestratorVersion = (() => {
  try {
    const raw = readFileSync(resolve(orchestratorDir, "package.json"), "utf8");
    return String(JSON.parse(raw).version ?? "").trim();
  } catch {
    return null;
  }
})();

const versions = {
  auro: {
    version: normalizedAuroVersion,
    sha256: auroCandidatePath && existsSync(auroCandidatePath) ? sha256File(auroCandidatePath) : null,
  },
  "aurowork-server": {
    version: auroworkServerVersion,
    sha256: existsSync(auroworkServerPath) ? sha256File(auroworkServerPath) : null,
  },
  "aurowork-orchestrator": {
    version: orchestratorVersion,
    sha256: existsSync(orchestratorPath) ? sha256File(orchestratorPath) : null,
  },
  "chrome-devtools-mcp": {
    version: chromeDevtoolsMcpVersion,
    sha256: existsSync(chromeDevtoolsPath) ? sha256File(chromeDevtoolsPath) : null,
  },
};

const missing = Object.entries(versions)
  .filter(([, info]) => !info.version || !info.sha256)
  .map(([name]) => name);

if (missing.length) {
  console.error(`Sidecar version metadata incomplete for: ${missing.join(", ")}`);
  process.exit(1);
}

const versionsPath = join(sidecarDir, "versions.json");
try {
  mkdirSync(sidecarDir, { recursive: true });
  const content = JSON.stringify(versions, null, 2) + "\n";
  writeFileSync(versionsPath, content, "utf8");
  if (resolvedTargetTriple) {
    const targetSuffix = process.platform === "win32" ? ".exe" : "";
    const targetVersionsPath = join(sidecarDir, `versions.json-${resolvedTargetTriple}${targetSuffix}`);
    writeFileSync(targetVersionsPath, content, "utf8");
  }
} catch (error) {
  console.error(`Failed to write versions.json: ${error}`);
  process.exit(1);
}
