#!/usr/bin/env node
// scripts/release/sync-to-azure.mjs
// Downloads all assets of a GitHub release and uploads them to Azure Blob Storage
// at: https://{ACCOUNT}.blob.core.windows.net/{CONTAINER}/{prefix}/{tag}/{filename}
//
// Required env vars:
//   AZURE_STORAGE_ACCOUNT  - e.g. "auroworkdl"
//   AZURE_BLOB_CONTAINER   - e.g. "releases"
//
// Auth modes (auto-detected, in priority order):
//   1. If AZURE_STORAGE_KEY env var is set -> account key auth (good for local backfill)
//   2. Otherwise -> az CLI login context (good for GitHub Actions OIDC)
//
// Args:
//   --tag <git-tag>          required, e.g. "v0.14.5"
//   --repo <owner/name>      required, e.g. "Northern-Deep-Leviathan/aurowork"
//   --prefix <path>          required, e.g. "desktop" | "orchestrator" | "auro"
//   --dry-run                optional, lists actions without uploading

import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") args.tag = argv[++i];
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "--prefix") args.prefix = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: sync-to-azure.mjs --tag <tag> --repo <owner/name> --prefix <desktop|orchestrator|auro> [--dry-run]",
      );
      process.exit(0);
    }
  }
  for (const required of ["tag", "repo", "prefix"]) {
    if (!args[required]) {
      console.error(`Missing required --${required}`);
      process.exit(2);
    }
  }
  return args;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], ...opts })
    .toString("utf8")
    .trim();
}

function detectAuthArgs() {
  const key = process.env.AZURE_STORAGE_KEY?.trim();
  if (key) {
    console.log("[sync] Auth: account key (from AZURE_STORAGE_KEY)");
    return ["--account-key", key];
  }
  console.log("[sync] Auth: az CLI login (--auth-mode login)");
  return ["--auth-mode", "login"];
}

async function main() {
  const { tag, repo, prefix, dryRun } = parseArgs(process.argv);
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_BLOB_CONTAINER;
  if (!account || !container) {
    console.error(
      "AZURE_STORAGE_ACCOUNT and AZURE_BLOB_CONTAINER must be set.",
    );
    process.exit(2);
  }

  console.log(
    `[sync] repo=${repo} tag=${tag} prefix=${prefix} dryRun=${dryRun}`,
  );
  console.log(`[sync] dest=${account}/${container}/${prefix}/${tag}/`);

  // 1. Fetch the release's asset list from GitHub
  const releaseJson = sh(
    `gh release view ${tag} --repo ${repo} --json assets,tagName`,
  );
  const release = JSON.parse(releaseJson);
  if (!release.assets?.length) {
    console.log("[sync] No assets on this release. Nothing to do.");
    return;
  }
  console.log(`[sync] Found ${release.assets.length} asset(s).`);

  // 2. Download all assets to a tmp dir
  const tmp = mkdtempSync(join(tmpdir(), "aurowork-sync-"));
  try {
    console.log(`[sync] Downloading to ${tmp} ...`);
    sh(`gh release download ${tag} --repo ${repo} --dir "${tmp}" --clobber`);

    const files = readdirSync(tmp).filter((f) =>
      statSync(join(tmp, f)).isFile(),
    );
    console.log(`[sync] Downloaded ${files.length} file(s).`);

    if (dryRun) {
      console.log("[sync] DRY RUN -- would upload:");
      for (const f of files) {
        console.log(`  ${prefix}/${tag}/${f}`);
      }
      return;
    }

    // 3. Upload each asset to Blob
    const destinationPath = `${prefix}/${tag}`;
    const authArgs = detectAuthArgs();
    const azResult = spawnSync(
      "az",
      [
        "storage",
        "blob",
        "upload-batch",
        "--account-name",
        account,
        "--destination",
        container,
        "--destination-path",
        destinationPath,
        "--source",
        tmp,
        "--overwrite",
        ...authArgs,
        "--output",
        "table",
      ],
      { stdio: "inherit" },
    );
    if (azResult.status !== 0) {
      throw new Error(`az upload-batch failed with code ${azResult.status}`);
    }

    // 4. Print verification URL (pick latest.json if present, else first file)
    const sample =
      files.find((f) => f === "latest.json") ?? files[0];
    console.log(
      `[sync] Done. Verify: https://${account}.blob.core.windows.net/${container}/${destinationPath}/${sample}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[sync] FAILED:", err);
  process.exit(1);
});
