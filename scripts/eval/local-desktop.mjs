import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const checks = [];

function pass(id, details = "") {
  checks.push({ id, ok: true, details });
}

function fail(id, details = "") {
  checks.push({ id, ok: false, details });
}

function assertInsideWorkspace(workspace, target) {
  const rel = relative(workspace, resolve(workspace, target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function runSetupDoctorJson() {
  const result = spawnSync("node", ["scripts/setup/doctor.mjs", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail("setup-doctor-json", result.stderr || result.stdout || `exit ${result.status}`);
    return;
  }
  try {
    const report = JSON.parse(result.stdout);
    report.ok ? pass("setup-doctor-json", "setup doctor is green") : fail("setup-doctor-json", "setup doctor reported failures");
  } catch (error) {
    fail("setup-doctor-json", error instanceof Error ? error.message : String(error));
  }
}

function runDebugReport() {
  const result = spawnSync("node", ["scripts/debug/report.mjs"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      AUROWORK_SERVER_TOKEN: "eval-secret-token",
      AUROWORK_DEN_TOKEN: "eval-den-token",
    },
  });
  if (result.status !== 0) {
    fail("debug-report", result.stderr || result.stdout || `exit ${result.status}`);
    return;
  }
  try {
    const report = JSON.parse(result.stdout);
    if (report.productScope !== "local-desktop") {
      fail("debug-report", `unexpected productScope: ${report.productScope}`);
      return;
    }
    if (!report.setupDoctor || typeof report.setupDoctor.ok !== "boolean") {
      fail("debug-report", "missing setupDoctor result");
      return;
    }
    const serialized = JSON.stringify(report);
    if (serialized.includes("eval-secret-token") || serialized.includes("eval-den-token")) {
      fail("debug-report-redaction", "debug report leaked injected token");
      return;
    }
    pass("debug-report", "includes setup doctor and redacts injected tokens");
  } catch (error) {
    fail("debug-report", error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  runSetupDoctorJson();
  runDebugReport();

  const buildScript = readFileSync(resolve(root, "scripts/build.mjs"), "utf8");
  if (buildScript.includes("apps/share")) {
    fail("default-build-local-desktop", "scripts/build.mjs still references apps/share");
  } else {
    pass("default-build-local-desktop", "default build targets desktop");
  }

  const workspace = await mkdtemp(join(tmpdir(), "aurowork-local-desktop-eval-"));
  try {
    await mkdir(join(workspace, ".opencode", "skills", "local-desktop-eval"), { recursive: true });
    await mkdir(join(workspace, ".opencode", "commands"), { recursive: true });
    await writeFile(
      join(workspace, ".opencode", "skills", "local-desktop-eval", "SKILL.md"),
      "---\nname: local-desktop-eval\ndescription: Local desktop eval fixture\n---\nKeep this workflow local.\n",
      "utf8",
    );
    await writeFile(join(workspace, ".opencode", "commands", "eval.md"), "Run a local desktop smoke check.\n", "utf8");
    await writeFile(join(workspace, "opencode.json"), "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n", "utf8");
    await writeFile(join(workspace, "note.txt"), "local desktop eval\n", "utf8");

    const note = await readFile(join(workspace, "note.txt"), "utf8");
    note.includes("local desktop eval") ? pass("workspace-file-read-write", workspace) : fail("workspace-file-read-write", "unexpected content");

    existsSync(join(workspace, ".opencode", "skills", "local-desktop-eval", "SKILL.md"))
      ? pass("workspace-skill-present", ".opencode/skills/local-desktop-eval/SKILL.md")
      : fail("workspace-skill-present", "missing skill fixture");

    existsSync(join(workspace, ".opencode", "commands", "eval.md"))
      ? pass("workspace-command-present", ".opencode/commands/eval.md")
      : fail("workspace-command-present", "missing command fixture");

    assertInsideWorkspace(workspace, "note.txt")
      ? pass("workspace-boundary-accepts-relative-file", "note.txt")
      : fail("workspace-boundary-accepts-relative-file", "note.txt rejected");

    assertInsideWorkspace(workspace, "../outside.txt")
      ? fail("workspace-boundary-rejects-traversal", "../outside.txt accepted")
      : pass("workspace-boundary-rejects-traversal", "../outside.txt");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log("Local desktop eval");
  for (const check of checks) {
    console.log(`- ${check.ok ? "ok" : "fail"}: ${check.id}${check.details ? ` (${check.details})` : ""}`);
  }
  if (failed.length) {
    console.error(`local desktop eval failed: ${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log("eval:local-desktop passed");
}

await main();
