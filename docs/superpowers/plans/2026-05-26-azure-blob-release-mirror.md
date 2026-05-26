# Azure Blob Release Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror AuroWork GitHub release assets to Azure Blob Storage so users in mainland China can download installers, sidecar binaries, and the Tauri updater manifest without going through `github.com`.

**Architecture:**
- A single public-read Azure Storage Account in Japan East (Tokyo) holds three top-level virtual directories: `desktop/{tag}/...` (Tauri installers + signatures + `latest.json`), `orchestrator/{tag}/...` (sidecar manifest + binaries), `auro/{tag}/...` (auro engine release tarballs).
- GitHub Actions release workflows are extended with one extra job that uses an OIDC-federated Azure service principal and `az storage blob upload-batch` to push every released asset to Blob.
- Client code (`tauri.conf.json` updater `endpoints`, `apps/orchestrator/src/cli.ts` URL builders, `scripts/release/generate-latest-json.mjs` URL rewriter) lists the Azure URL **first** and the GitHub URL **second**, so Tauri's built-in `endpoints` fallback handles outages automatically. No client-side region detection.

**Tech Stack:** Azure Storage (Blob, public anonymous read), Azure CLI (`az`), GitHub Actions OIDC for keyless auth, Tauri 2.x updater plugin (multi-endpoint fallback), Node 20 (release scripts), Bun (orchestrator).

**Out of scope:**
- Custom domain + HTTPS for the Blob endpoint (kept on default `*.blob.core.windows.net`; decision already made)
- Azure CDN / Front Door (deferred — Blob direct works for demo scale)
- Azure China (21Vianet) — separate plan when product graduates from demo

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | Tauri updater endpoints list | Modify — add Azure URL ahead of GitHub |
| `apps/orchestrator/src/cli.ts` | Sidecar download URL builders (`resolveSidecarBaseUrl`, `resolveOpencodeDownload`) | Modify — add Azure URL with GitHub fallback |
| `scripts/release/generate-latest-json.mjs` | Generates `latest.json` consumed by Tauri updater | Modify — rewrite `platforms[].url` to Azure URLs |
| `scripts/release/sync-to-azure.mjs` | NEW — re-usable Node script that downloads a GitHub release's assets and uploads them to Blob | Create |
| `.github/workflows/sync-release-to-azure.yml` | NEW — GitHub Actions workflow triggered by `release: published` | Create |
| `.github/workflows/build-desktop.yml` (if active) | Existing desktop release workflow | Verify — confirm it triggers `release: published` so sync workflow chains |
| `docs/ops/azure-release-mirror.md` | NEW — runbook for re-bootstrapping the mirror and rotating SP credentials | Create |
| `.claude/DEV_PROGRESS.md` | Decision log entry | Modify — append decision record |

---

## Prerequisites (one-time, manual)

These are not coding steps — they happen in your Azure / GitHub web consoles. Each subtask below assumes these are done.

| # | Action | Where |
|---|---|---|
| P1 | Pick a globally-unique Storage Account name. Suggestion: `auroworkdl` (11 chars, all lowercase, no dash). If taken, append a digit. | Azure Portal or CLI |
| P2 | Confirm the Azure subscription ID you'll use (`az account show --query id -o tsv` on a machine that has `az` configured) | Local Azure CLI |
| P3 | Confirm the GitHub repo's "Settings → Actions → General → Workflow permissions" allows "Read and write permissions" (needed for OIDC) | GitHub web |

You will be prompted for these values during Task 1.

---

## Task 1: Create Azure resources (one-time bootstrap)

**Files:** None (manual Azure CLI commands)

**Outcome:** A Storage Account exists with one public-read container; you have a Service Principal that GitHub Actions can use via OIDC.

- [ ] **Step 1: Login to Azure CLI**

Run on your local machine:
```bash
az login
az account set --subscription "<YOUR_SUBSCRIPTION_ID>"
```

Expected: browser opens, you authenticate, terminal shows the active subscription.

- [ ] **Step 2: Create resource group**

```bash
az group create \
  --name aurowork-release-mirror \
  --location japaneast
```

Expected: JSON output with `"provisioningState": "Succeeded"`.

- [ ] **Step 3: Create storage account**

Replace `auroworkdl` if that name is taken globally:
```bash
az storage account create \
  --name auroworkdl \
  --resource-group aurowork-release-mirror \
  --location japaneast \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access true \
  --min-tls-version TLS1_2
```

Expected: JSON with `"provisioningState": "Succeeded"`. Note: `Standard_LRS` is the cheapest tier; sufficient for demo.

- [ ] **Step 4: Create public-read container**

```bash
az storage container create \
  --account-name auroworkdl \
  --name releases \
  --public-access blob \
  --auth-mode login
```

Expected: `{"created": true}`. The `blob` access level means individual blobs are anonymously readable, but the container itself can't be listed — exactly what we want (no directory enumeration).

- [ ] **Step 5: Verify the base URL works**

Upload a tiny test file:
```bash
echo "hello from azure mirror" > /tmp/aurowork-test.txt
az storage blob upload \
  --account-name auroworkdl \
  --container-name releases \
  --name healthcheck.txt \
  --file /tmp/aurowork-test.txt \
  --auth-mode login \
  --overwrite
```

Then `curl -i https://auroworkdl.blob.core.windows.net/releases/healthcheck.txt`

Expected: `HTTP/1.1 200 OK` and body `hello from azure mirror`.

- [ ] **Step 6: Create service principal with federated credentials for GitHub OIDC**

```bash
# Get the storage account resource ID (you'll need this for role assignment)
STORAGE_ID=$(az storage account show \
  --name auroworkdl \
  --resource-group aurowork-release-mirror \
  --query id -o tsv)

# Create the service principal (no client secret — OIDC only)
az ad sp create-for-rbac \
  --name "aurowork-release-mirror-github" \
  --role "Storage Blob Data Contributor" \
  --scopes "$STORAGE_ID" \
  --json-auth
```

Expected: JSON with `clientId`, `tenantId`, `subscriptionId`. **Save these three values** — needed in Step 8. Ignore `clientSecret` (we won't use it).

- [ ] **Step 7: Add federated credential for the GitHub repo**

Get the SP object ID:
```bash
SP_OBJECT_ID=$(az ad sp list \
  --display-name "aurowork-release-mirror-github" \
  --query "[0].id" -o tsv)
```

Then add the federated credential (allows GitHub Actions in `main` branch + tags + release events to assume this SP):
```bash
az ad app federated-credential create \
  --id "$SP_OBJECT_ID" \
  --parameters '{
    "name": "github-release-published",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Northern-Deep-Leviathan/aurowork:environment:release",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Expected: JSON confirming creation. Note we scope to a GitHub **environment** named `release` for blast-radius control (Task 4 creates this environment).

- [ ] **Step 8: Record secrets in GitHub repo**

Go to GitHub repo → Settings → Secrets and variables → Actions → **Variables** tab (not Secrets — these are non-sensitive identifiers, but using Variables makes them explicit):

| Variable name | Value (from Step 6) |
|---|---|
| `AZURE_CLIENT_ID` | `clientId` from SP creation |
| `AZURE_TENANT_ID` | `tenantId` from SP creation |
| `AZURE_SUBSCRIPTION_ID` | `subscriptionId` from SP creation |
| `AZURE_STORAGE_ACCOUNT` | `auroworkdl` (or the name you used) |
| `AZURE_BLOB_CONTAINER` | `releases` |

- [ ] **Step 9: Commit checkpoint (nothing to commit yet — just human progress marker)**

This task does not touch the repo. Move on to Task 2.

---

## Task 2: Write the Azure sync script

**Files:**
- Create: `scripts/release/sync-to-azure.mjs`

This script is invoked by both (a) the GitHub Actions workflow after a release is published, and (b) humans for one-time backfill of historical releases.

- [ ] **Step 1: Create the script file**

```javascript
#!/usr/bin/env node
// scripts/release/sync-to-azure.mjs
// Downloads all assets of a GitHub release and uploads them to Azure Blob Storage
// at: https://{ACCOUNT}.blob.core.windows.net/{CONTAINER}/{prefix}/{tag}/{filename}
//
// Required env vars (set by GitHub Actions via OIDC):
//   AZURE_STORAGE_ACCOUNT  - e.g. "auroworkdl"
//   AZURE_BLOB_CONTAINER   - e.g. "releases"
//   GITHUB_TOKEN           - for downloading release assets (rate-limit relief)
//
// Args:
//   --tag <git-tag>          required, e.g. "v0.14.5" or "aurowork-orchestrator-v0.1.0"
//   --repo <owner/name>      required, e.g. "Northern-Deep-Leviathan/aurowork"
//   --prefix <path>          required, e.g. "desktop" | "orchestrator" | "auro"
//   --dry-run                optional, lists actions without uploading

import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
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

async function main() {
  const { tag, repo, prefix, dryRun } = parseArgs(process.argv);
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_BLOB_CONTAINER;
  if (!account || !container) {
    console.error("AZURE_STORAGE_ACCOUNT and AZURE_BLOB_CONTAINER must be set.");
    process.exit(2);
  }

  console.log(`[sync] repo=${repo} tag=${tag} prefix=${prefix} dryRun=${dryRun}`);

  // 1. Fetch the release's asset list from GitHub
  const releaseJson = sh(`gh release view ${tag} --repo ${repo} --json assets,tagName`);
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
    sh(`gh release download ${tag} --repo ${repo} --dir ${tmp} --clobber`);

    const files = readdirSync(tmp).filter((f) => statSync(join(tmp, f)).isFile());
    console.log(`[sync] Downloaded ${files.length} file(s).`);

    if (dryRun) {
      console.log("[sync] DRY RUN — would upload:");
      for (const f of files) {
        console.log(`  ${prefix}/${tag}/${f}`);
      }
      return;
    }

    // 3. Upload each asset to Blob
    //    upload-batch handles the destination prefix and overwrites by default.
    const destinationPath = `${prefix}/${tag}`;
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
        "--auth-mode",
        "login",
        "--output",
        "table",
      ],
      { stdio: "inherit" },
    );
    if (azResult.status !== 0) {
      throw new Error(`az upload-batch failed with code ${azResult.status}`);
    }

    // 4. Print verification URL
    const sample = files[0];
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
```

- [ ] **Step 2: Mark script executable & verify it parses**

```bash
chmod +x scripts/release/sync-to-azure.mjs
node --check scripts/release/sync-to-azure.mjs
```

Expected: no output (syntax OK).

- [ ] **Step 3: Dry-run against the most recent existing release (sanity check)**

You need `gh` CLI logged in for this:
```bash
# Find the latest desktop release tag
LATEST_TAG=$(gh release list --repo Northern-Deep-Leviathan/aurowork --limit 5 --json tagName,name | jq -r '.[] | select(.name | test("v[0-9]")) | .tagName' | head -1)
echo "Will dry-run against: $LATEST_TAG"

AZURE_STORAGE_ACCOUNT=auroworkdl \
AZURE_BLOB_CONTAINER=releases \
node scripts/release/sync-to-azure.mjs \
  --tag "$LATEST_TAG" \
  --repo Northern-Deep-Leviathan/aurowork \
  --prefix desktop \
  --dry-run
```

Expected: prints "DRY RUN — would upload:" followed by paths like `desktop/v0.14.5/AuroWork-Dev_0.14.5_x64.msi`.

- [ ] **Step 4: Commit**

```bash
git add scripts/release/sync-to-azure.mjs
git commit -m "feat(release): add Azure Blob sync script for release mirror"
```

---

## Task 3: Backfill the latest desktop release manually

This validates the script end-to-end against a real release **before** wiring the automation. If anything is wrong, fixing it now is cheaper.

**Files:** None (manual run)

- [ ] **Step 1: Confirm you have `az` logged in with rights on the storage account**

```bash
az storage blob list \
  --account-name auroworkdl \
  --container-name releases \
  --auth-mode login \
  --output table
```

Expected: shows `healthcheck.txt` from Task 1 Step 5.

- [ ] **Step 2: Run the sync for real (no `--dry-run`)**

Use the `LATEST_TAG` from Task 2 Step 3:
```bash
AZURE_STORAGE_ACCOUNT=auroworkdl \
AZURE_BLOB_CONTAINER=releases \
node scripts/release/sync-to-azure.mjs \
  --tag "$LATEST_TAG" \
  --repo Northern-Deep-Leviathan/aurowork \
  --prefix desktop
```

Expected: progress table from `az upload-batch`, ending with a `Verify:` URL.

- [ ] **Step 3: Verify with curl**

```bash
curl -I "https://auroworkdl.blob.core.windows.net/releases/desktop/$LATEST_TAG/latest.json"
```

Expected: `HTTP/1.1 200 OK`, `Content-Type: application/json`.

- [ ] **Step 4: Verify `latest.json` content makes sense**

```bash
curl -s "https://auroworkdl.blob.core.windows.net/releases/desktop/$LATEST_TAG/latest.json" | jq '.platforms | keys'
```

Expected: a JSON array like `["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]`.

> ⚠️ **Note:** The `url` fields inside this `latest.json` still point at GitHub. We'll fix that in Task 6.

- [ ] **Step 5: No commit (this task was a manual validation)**

---

## Task 4: Create GitHub Actions sync workflow

**Files:**
- Create: `.github/workflows/sync-release-to-azure.yml`

This workflow auto-fires after any release is published in the repo.

- [ ] **Step 1: Create the `release` environment in GitHub**

In GitHub web: Settings → Environments → New environment → name it `release`.

(Optional but recommended: add a required reviewer for first runs, so the first auto-sync after merging needs human approval. Remove the reviewer once you trust the workflow.)

This matches the federated credential subject we set in Task 1 Step 7.

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/sync-release-to-azure.yml`:

```yaml
name: Sync release to Azure Blob

on:
  release:
    types: [published]
  # Manual trigger for backfills / re-runs
  workflow_dispatch:
    inputs:
      tag:
        description: "Release tag to sync (e.g. v0.14.5)"
        required: true
      prefix:
        description: "Destination prefix in blob"
        required: true
        default: "desktop"
        type: choice
        options:
          - desktop
          - orchestrator
          - auro

permissions:
  id-token: write   # required for OIDC federation
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    environment: release
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Determine tag and prefix
        id: vars
        env:
          GH_EVENT_NAME: ${{ github.event_name }}
          GH_RELEASE_TAG: ${{ github.event.release.tag_name }}
          INPUT_TAG: ${{ github.event.inputs.tag }}
          INPUT_PREFIX: ${{ github.event.inputs.prefix }}
        run: |
          set -euo pipefail
          if [ "$GH_EVENT_NAME" = "workflow_dispatch" ]; then
            echo "tag=$INPUT_TAG" >> "$GITHUB_OUTPUT"
            echo "prefix=$INPUT_PREFIX" >> "$GITHUB_OUTPUT"
          else
            echo "tag=$GH_RELEASE_TAG" >> "$GITHUB_OUTPUT"
            # Map tag pattern -> prefix
            case "$GH_RELEASE_TAG" in
              aurowork-orchestrator-v*) echo "prefix=orchestrator" >> "$GITHUB_OUTPUT" ;;
              auro-v*)                  echo "prefix=auro"         >> "$GITHUB_OUTPUT" ;;
              v*)                       echo "prefix=desktop"      >> "$GITHUB_OUTPUT" ;;
              *)
                echo "::error::Unrecognized tag pattern: $GH_RELEASE_TAG"
                exit 1
                ;;
            esac
          fi
          echo "Resolved tag=$(cat $GITHUB_OUTPUT | grep ^tag= | cut -d= -f2)"
          echo "Resolved prefix=$(cat $GITHUB_OUTPUT | grep ^prefix= | cut -d= -f2)"

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run sync script
        env:
          AZURE_STORAGE_ACCOUNT: ${{ vars.AZURE_STORAGE_ACCOUNT }}
          AZURE_BLOB_CONTAINER: ${{ vars.AZURE_BLOB_CONTAINER }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node scripts/release/sync-to-azure.mjs \
            --tag "${{ steps.vars.outputs.tag }}" \
            --repo "${{ github.repository }}" \
            --prefix "${{ steps.vars.outputs.prefix }}"

      - name: Verification curl
        env:
          ACCOUNT: ${{ vars.AZURE_STORAGE_ACCOUNT }}
          CONTAINER: ${{ vars.AZURE_BLOB_CONTAINER }}
          PREFIX: ${{ steps.vars.outputs.prefix }}
          TAG: ${{ steps.vars.outputs.tag }}
        run: |
          set -euo pipefail
          # For desktop releases, latest.json must be reachable
          if [ "$PREFIX" = "desktop" ]; then
            URL="https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}/${PREFIX}/${TAG}/latest.json"
            echo "Verifying $URL"
            curl -fsSL -I "$URL"
          fi
          echo "Sync complete."
```

- [ ] **Step 3: Lint the YAML**

```bash
# If you have yamllint:
yamllint .github/workflows/sync-release-to-azure.yml || true
# Otherwise just sanity-grep for tab characters:
grep -P '\t' .github/workflows/sync-release-to-azure.yml && echo "TABS FOUND" || echo "no tabs"
```

Expected: "no tabs" (YAML hates tabs).

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/sync-release-to-azure.yml
git commit -m "ci(release): add Azure Blob sync workflow for releases"
git push
```

- [ ] **Step 5: Trigger a manual backfill run**

In GitHub web: Actions → "Sync release to Azure Blob" → Run workflow → tag = `$LATEST_TAG`, prefix = `desktop`.

Expected: workflow succeeds (green check) within ~3 minutes. Verification step prints a `HTTP/1.1 200 OK`.

- [ ] **Step 6: If the run fails, debug in this order:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `Azure login` step fails with "AADSTS70021" | Federated credential subject mismatch | Re-check Task 1 Step 7: subject must be exactly `repo:Northern-Deep-Leviathan/aurowork:environment:release` |
| `Azure login` succeeds but `az upload-batch` fails with 403 | Missing role assignment | Verify Task 1 Step 6 assigned `Storage Blob Data Contributor` to the SP |
| `gh release download` fails | `GH_TOKEN` not in scope | Check `permissions:` block in workflow has `contents: read` |

---

## Task 5: Wire Tauri updater to prefer Azure URL

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json:53-58`

- [ ] **Step 1: Read the current updater block**

```bash
sed -n '50,65p' apps/desktop/src-tauri/tauri.conf.json
```

Expected output includes:
```json
"updater": {
  "pubkey": "...",
  "endpoints": [
    "https://github.com/Northern-Deep-Leviathan/aurowork/releases/latest/download/latest.json"
  ]
}
```

- [ ] **Step 2: Modify endpoints to prefer Azure, fall back to GitHub**

Edit `apps/desktop/src-tauri/tauri.conf.json`, replacing the `endpoints` array:

```json
"endpoints": [
  "https://auroworkdl.blob.core.windows.net/releases/desktop/latest/latest.json",
  "https://github.com/Northern-Deep-Leviathan/aurowork/releases/latest/download/latest.json"
]
```

> Note: `desktop/latest/latest.json` is a **convention** — Task 6 will make the workflow also copy `latest.json` to a `desktop/latest/` "alias" path so the Tauri client doesn't need to know the current version number. Until Task 6 is done, this endpoint will 404 and Tauri will fall back to GitHub (which is exactly the behavior we want during rollout).

- [ ] **Step 3: Verify the JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8'))" && echo "JSON OK"
```

Expected: `JSON OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json
git commit -m "feat(updater): prefer Azure Blob endpoint for updater manifest"
```

---

## Task 6: Have the workflow publish `latest/` alias for updater

The Tauri client points at a fixed `desktop/latest/latest.json` URL. We need the sync workflow to also copy each new desktop release's `latest.json` to that fixed path.

**Files:**
- Modify: `.github/workflows/sync-release-to-azure.yml` (extend the `Run sync script` step or add a new step)

- [ ] **Step 1: Add a step that copies `latest.json` to the alias path (desktop only)**

Append the following step to `.github/workflows/sync-release-to-azure.yml`, after the `Run sync script` step and before `Verification curl`:

```yaml
      - name: Publish latest.json alias (desktop only)
        if: steps.vars.outputs.prefix == 'desktop'
        env:
          ACCOUNT: ${{ vars.AZURE_STORAGE_ACCOUNT }}
          CONTAINER: ${{ vars.AZURE_BLOB_CONTAINER }}
          TAG: ${{ steps.vars.outputs.tag }}
        run: |
          set -euo pipefail
          # Server-side copy from desktop/<tag>/latest.json to desktop/latest/latest.json
          az storage blob copy start \
            --account-name "$ACCOUNT" \
            --destination-container "$CONTAINER" \
            --destination-blob "desktop/latest/latest.json" \
            --source-account-name "$ACCOUNT" \
            --source-container "$CONTAINER" \
            --source-blob "desktop/${TAG}/latest.json" \
            --auth-mode login
```

- [ ] **Step 2: Also update the verification step to check the alias URL**

Replace the existing `Verification curl` step body with:

```yaml
      - name: Verification curl
        env:
          ACCOUNT: ${{ vars.AZURE_STORAGE_ACCOUNT }}
          CONTAINER: ${{ vars.AZURE_BLOB_CONTAINER }}
          PREFIX: ${{ steps.vars.outputs.prefix }}
          TAG: ${{ steps.vars.outputs.tag }}
        run: |
          set -euo pipefail
          if [ "$PREFIX" = "desktop" ]; then
            curl -fsSL -I "https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}/${PREFIX}/${TAG}/latest.json"
            # Allow up to 30 seconds for server-side copy to finalize
            for i in 1 2 3 4 5 6; do
              if curl -fsSL -I "https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}/desktop/latest/latest.json"; then
                echo "Alias OK"
                exit 0
              fi
              sleep 5
            done
            echo "::error::Alias latest.json never appeared"
            exit 1
          fi
          echo "Sync complete."
```

- [ ] **Step 3: Commit, push, and re-trigger the workflow**

```bash
git add .github/workflows/sync-release-to-azure.yml
git commit -m "ci(release): publish desktop latest.json alias for updater endpoint"
git push
```

Then in GitHub web: Actions → "Sync release to Azure Blob" → Run workflow → tag = `$LATEST_TAG`, prefix = `desktop`.

Expected: workflow succeeds, both verification curls return `HTTP/1.1 200 OK`.

- [ ] **Step 4: Verify the alias actually serves the right content**

```bash
curl -s "https://auroworkdl.blob.core.windows.net/releases/desktop/latest/latest.json" | jq '.version'
```

Expected: prints the version from `$LATEST_TAG` (e.g. `"0.14.5"`).

---

## Task 7: Rewrite `latest.json` to point at Azure URLs

Right now `latest.json.platforms[].url` still points at `github.com/.../releases/download/...`. When a client downloads `latest.json` from Azure, then fetches the binary from GitHub, the China problem is **half solved** — we still need to rewrite those URLs too.

**Files:**
- Modify: `scripts/release/generate-latest-json.mjs`

- [ ] **Step 1: Locate the URL emission code**

```bash
grep -n "url" scripts/release/generate-latest-json.mjs
```

Expected: you'll see lines around L220-250 where `platforms[platformKey] = { signature, url: asset.browser_download_url }` (exact line numbers may differ — just find the place).

- [ ] **Step 2: Add an env-var-driven URL rewriter**

At the top of the `main()` function (or wherever the script reads its env), add:

```javascript
const azureBaseUrl = process.env.AUROWORK_AZURE_BASE_URL; // e.g. https://auroworkdl.blob.core.windows.net/releases/desktop
// If set, rewrite every platforms[].url from
//   https://github.com/<repo>/releases/download/<tag>/<asset>
// to
//   <azureBaseUrl>/<tag>/<asset>
function rewriteUrl(originalUrl, tag) {
  if (!azureBaseUrl) return originalUrl;
  const match = originalUrl.match(/\/releases\/download\/[^/]+\/(.+)$/);
  if (!match) return originalUrl;
  const assetName = match[1];
  return `${azureBaseUrl}/${tag}/${assetName}`;
}
```

Then where the script builds each platform entry, change:

```javascript
platforms[platformKey] = {
  signature,
  url: asset.browser_download_url,
};
```

to:

```javascript
platforms[platformKey] = {
  signature,
  url: rewriteUrl(asset.browser_download_url, release.tag_name),
};
```

- [ ] **Step 3: Test the rewriter locally**

```bash
AUROWORK_AZURE_BASE_URL=https://auroworkdl.blob.core.windows.net/releases/desktop \
node scripts/release/generate-latest-json.mjs --tag "$LATEST_TAG" --repo Northern-Deep-Leviathan/aurowork --output /tmp/latest-rewritten.json

jq '.platforms | to_entries[] | {key, url: .value.url}' /tmp/latest-rewritten.json
```

> Note: pass whatever args `generate-latest-json.mjs` already accepts. If you're unsure, run it with no args first and read the help/error.

Expected: every `.value.url` starts with `https://auroworkdl.blob.core.windows.net/releases/desktop/`.

- [ ] **Step 4: Test without env var (regression check)**

```bash
unset AUROWORK_AZURE_BASE_URL
node scripts/release/generate-latest-json.mjs --tag "$LATEST_TAG" --repo Northern-Deep-Leviathan/aurowork --output /tmp/latest-original.json
jq '.platforms | to_entries[0].value.url' /tmp/latest-original.json
```

Expected: URL starts with `https://github.com/Northern-Deep-Leviathan/aurowork/`.

- [ ] **Step 5: Commit**

```bash
git add scripts/release/generate-latest-json.mjs
git commit -m "feat(release): support AUROWORK_AZURE_BASE_URL to rewrite latest.json URLs"
```

---

## Task 8: Wire the rewriter into the release workflow

The release workflow that **produces** `latest.json` (separate from the sync workflow that **mirrors** it) needs to pass `AUROWORK_AZURE_BASE_URL`. Find where `generate-latest-json.mjs` is invoked.

**Files:**
- Modify: whichever workflow calls `generate-latest-json.mjs` (likely `.github/workflows/build-desktop.yml` or a `release.yml`)

- [ ] **Step 1: Locate the invocation**

```bash
grep -rn "generate-latest-json" .github/workflows/
```

Expected: one or more matches. If matches are only in `.disabled` workflows, the active release workflow may not use this script yet — in which case **stop and report this finding**: it means the current release process doesn't produce a rewritten `latest.json`, and Task 8 needs replanning (we'd add the script invocation to whichever workflow uploads `latest.json` to the GitHub release).

- [ ] **Step 2: Add env var to the relevant step**

In the step that runs `generate-latest-json.mjs`, add `env:`:

```yaml
      - name: Generate latest.json
        env:
          AUROWORK_AZURE_BASE_URL: https://${{ vars.AZURE_STORAGE_ACCOUNT }}.blob.core.windows.net/${{ vars.AZURE_BLOB_CONTAINER }}/desktop
        run: |
          node scripts/release/generate-latest-json.mjs ...existing args...
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/<file>.yml
git commit -m "ci(release): rewrite latest.json URLs to Azure Blob in release workflow"
```

- [ ] **Step 4: Cut a test release to verify the full chain end-to-end**

Manually create a pre-release tag (e.g. `v0.14.5-azuretest-1`) and push it. Watch:

1. The release build workflow produces a release with a `latest.json` whose `platforms[].url` already points at Azure.
2. The sync workflow auto-fires on `release: published`, uploads all assets, and publishes the `desktop/latest/latest.json` alias.
3. In the desktop app, force an update check; observe network calls hitting `auroworkdl.blob.core.windows.net`.

> If you don't want a noisy tag in release history, do this in a fork/branch with a draft release instead — but the OIDC federated subject restricts to `repo:.../environment:release`, so a draft release in the same repo with `environment: release` is the cleanest path.

---

## Task 9: Wire orchestrator sidecar download to prefer Azure

**Files:**
- Modify: `apps/orchestrator/src/cli.ts` — `resolveSidecarBaseUrl()` around L1360-1369, and `resolveOpencodeDownload()` around L1585-1599

- [ ] **Step 1: Read the current `resolveSidecarBaseUrl()`**

```bash
sed -n '1355,1395p' apps/orchestrator/src/cli.ts
```

Expected: function returns `https://github.com/Northern-Deep-Leviathan/aurowork/releases/download/aurowork-orchestrator-v${cliVersion}` by default, but allows override via env var `AUROWORK_SIDECAR_BASE_URL` and CLI flag `--sidecar-base-url`.

- [ ] **Step 2: Change the default to Azure URL**

Replace the default URL in `resolveSidecarBaseUrl()` with:

```typescript
// Default: Azure Blob mirror (cheaper egress, reachable from CN networks).
// Falls through to GitHub if Azure 404s (see `tryDownloadWithFallback` below).
const azureDefault = `https://auroworkdl.blob.core.windows.net/releases/orchestrator/aurowork-orchestrator-v${cliVersion}`;
const githubFallback = `https://github.com/Northern-Deep-Leviathan/aurowork/releases/download/aurowork-orchestrator-v${cliVersion}`;
return process.env.AUROWORK_SIDECAR_BASE_URL?.trim() || azureDefault;
```

Then export `githubFallback` so the download function can use it for fallback.

> Implementation note: this is the minimal change. A more correct change introduces a helper `resolveSidecarBaseUrls(): string[]` returning **both** URLs and updates `downloadSidecarBinary` to try them in order. If you want the minimal change, do that. If you have appetite, do the helper.

- [ ] **Step 3: Apply the same pattern to `resolveOpencodeDownload()`**

In `apps/orchestrator/src/cli.ts` around L1599, change:

```typescript
const url = `https://github.com/Northern-Deep-Leviathan/auro/releases/download/v${version}/${asset}`;
```

to:

```typescript
const azureUrl = `https://auroworkdl.blob.core.windows.net/releases/auro/v${version}/${asset}`;
const githubUrl = `https://github.com/Northern-Deep-Leviathan/auro/releases/download/v${version}/${asset}`;
const url = process.env.AUROWORK_AURO_BASE_URL?.trim()
  ? `${process.env.AUROWORK_AURO_BASE_URL.trim()}/v${version}/${asset}`
  : azureUrl;
// Track githubUrl for fallback in downloadToPath retry logic
```

And in the `downloadToPath(url, archivePath)` call below, wrap with a try/catch that retries on `githubUrl` if the first attempt 404s or fails network connectivity.

- [ ] **Step 4: Type-check**

```bash
pnpm --filter aurowork-orchestrator typecheck
```

Expected: no errors.

- [ ] **Step 5: Rebuild orchestrator binary**

```bash
pnpm --filter aurowork-orchestrator build:bin
```

Expected: produces `apps/orchestrator/dist/bin/aurowork.exe` (Windows) or equivalent.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/cli.ts
git commit -m "feat(orchestrator): prefer Azure Blob for sidecar and auro downloads"
```

---

## Task 10: Write the runbook

**Files:**
- Create: `docs/ops/azure-release-mirror.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Azure Release Mirror Runbook

## What this is

AuroWork mirrors all GitHub release assets to an Azure Blob Storage account so
mainland China users can download installers and updates without going through
`github.com`. This document explains how the mirror works and how to operate it.

## Architecture

- **Storage Account:** `auroworkdl` (resource group `aurowork-release-mirror`, region Japan East / Tokyo)
- **Container:** `releases` (anonymous blob read)
- **URL pattern:**
  - Desktop: `https://auroworkdl.blob.core.windows.net/releases/desktop/{tag}/{asset}`
  - Desktop updater alias: `https://auroworkdl.blob.core.windows.net/releases/desktop/latest/latest.json`
  - Orchestrator sidecars: `https://auroworkdl.blob.core.windows.net/releases/orchestrator/aurowork-orchestrator-v{ver}/{asset}`
  - Auro engine: `https://auroworkdl.blob.core.windows.net/releases/auro/v{ver}/{asset}`

## Automation

The workflow `.github/workflows/sync-release-to-azure.yml` runs on every
`release: published` event. It maps the release tag to a destination prefix
(`v*` → desktop, `aurowork-orchestrator-v*` → orchestrator, `auro-v*` → auro)
and uploads all assets via `az storage blob upload-batch`.

For desktop releases, it additionally publishes a `desktop/latest/latest.json`
alias via server-side blob copy.

Authentication uses GitHub OIDC federation against a service principal named
`aurowork-release-mirror-github`. No secrets are stored in GitHub.

## Manual backfill

Use the workflow's `workflow_dispatch` trigger:

1. GitHub → Actions → "Sync release to Azure Blob" → Run workflow
2. Enter the tag (e.g. `v0.14.5`) and prefix (`desktop` / `orchestrator` / `auro`)

Or locally:

\`\`\`bash
AZURE_STORAGE_ACCOUNT=auroworkdl AZURE_BLOB_CONTAINER=releases \\
node scripts/release/sync-to-azure.mjs \\
  --tag v0.14.5 --repo Northern-Deep-Leviathan/aurowork --prefix desktop
\`\`\`

## Verifying mirror health

\`\`\`bash
# Desktop updater alias
curl -I https://auroworkdl.blob.core.windows.net/releases/desktop/latest/latest.json

# Most recent orchestrator sidecar manifest
curl -I https://auroworkdl.blob.core.windows.net/releases/orchestrator/aurowork-orchestrator-v0.1.0/aurowork-orchestrator-sidecars.json
\`\`\`

## Rotating the service principal

If the SP credentials need rotation (annual hygiene or compromise response):

\`\`\`bash
# Delete the old SP
az ad sp delete --id $(az ad sp list --display-name "aurowork-release-mirror-github" --query "[0].id" -o tsv)

# Recreate following Task 1 Steps 6-8 from the original plan
\`\`\`

The plan lives at \`docs/superpowers/plans/2026-05-26-azure-blob-release-mirror.md\`.

## Cost monitoring

Set up an Azure Cost Management budget alert at $10/month on the
`aurowork-release-mirror` resource group. Demo-scale traffic should stay
under $2/month; an alert at $10 catches runaway download patterns early.

## Removing the mirror

If we ever need to roll back (e.g. switch entirely to Azure CDN), follow this
order to avoid breaking live clients:

1. Revert `apps/desktop/src-tauri/tauri.conf.json` endpoints order (GitHub first).
2. Revert `apps/orchestrator/src/cli.ts` default URLs to GitHub.
3. Ship a desktop release.
4. Wait two release cycles for clients to update.
5. Then it's safe to delete the storage account.
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add docs/ops/azure-release-mirror.md
git commit -m "docs(ops): add Azure release mirror runbook"
```

---

## Task 11: Update DEV_PROGRESS.md

**Files:**
- Modify: `.claude/DEV_PROGRESS.md` (decision log section)

- [ ] **Step 1: Append decision record**

Add an entry to the "决策日志" section:

```markdown
### 2026-05-26 · Azure Blob 作为 GitHub Release 镜像
- **背景**：国内大陆用户访问 github.com/releases 不稳定，更新与首次下载体验差
- **决策**：Azure Blob Storage（Japan East region）作为 demo 阶段的统一发布镜像，不开 CDN，不做自定义域名
- **方案**：GitHub Actions 在 `release: published` 时同步资产到 `auroworkdl.blob.core.windows.net/releases/{desktop,orchestrator,auro}/{tag}/*`；Tauri updater `endpoints` 数组中 Azure URL 在前、GitHub 在后，自动 fallback
- **成本**：demo 体量 <$2/月
- **未来升级路径**：流量上来后加 Azure CDN（一条 CNAME）；进入国内市场后开 Azure China 双栈
- **plan**：`docs/superpowers/plans/2026-05-26-azure-blob-release-mirror.md`
```

- [ ] **Step 2: Commit**

```bash
git add .claude/DEV_PROGRESS.md
git commit -m "docs(progress): log Azure Blob mirror decision"
```

---

## Done

After Task 11, the mirror is live, automated for future releases, and documented. Verify the loop works end-to-end:

1. New release is cut on GitHub
2. `sync-release-to-azure.yml` auto-fires, syncs assets, publishes `latest.json` alias
3. Desktop app's next update check hits Azure URL first, finds the new version
4. Download proceeds from Azure, signature verifies (Minisign pubkey unchanged), install succeeds
5. Sidecar fetch (if triggered) also goes to Azure first

If any step breaks, the GitHub URL fallback ensures users aren't blocked — they just get the slower path.
