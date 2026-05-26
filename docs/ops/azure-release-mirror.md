# Azure Release Mirror Runbook

> Status: active since 2026-05-26. Owner: release ops.

## What this is

A mirror of every published GitHub release asset of `Northern-Deep-Leviathan/aurowork` (and the upstream `Northern-Deep-Leviathan/auro` engine) into Azure Blob Storage. The mirror gives users in regions where GitHub is slow/blocked (notably mainland China) a reliable download path for:

- Desktop installers + `latest.json` consumed by the Tauri updater
- Orchestrator sidecar binaries pulled by `aurowork-orchestrator` at runtime
- Auro engine releases downloaded by the orchestrator

GitHub Releases remains the source of truth. Azure is a strict mirror, populated by GitHub Actions.

## Azure infrastructure

| Resource | Value |
|----------|-------|
| Subscription | `69464de7-5a57-4b0a-82bf-7c1368a13fdf` |
| Tenant | `67c4a6d0-4789-4891-bd48-f6a64b5b2b12` |
| Resource group | `aurowork-releases` |
| Region | Japan East (Tokyo) |
| Storage account | `auroworkdl` (StorageV2, Standard_LRS) |
| Container | `releases` (public access: blob) |
| Federated identity | `aurowork-release-sync` SP, AppId `a8cdfe76-1879-487b-a5d3-8db4521f9bf7`, App Object ID `6b10013d-4cc0-4834-9fa3-332702d2eee7` |
| RBAC | SP has `Storage Blob Data Contributor` scoped to the storage account |

No CDN, no custom domain. Direct blob URLs of the form:

```
https://auroworkdl.blob.core.windows.net/releases/<prefix>/<tag>/<file>
```

Prefixes:
- `desktop/<vX.Y.Z>/...` — Tauri desktop release for `vX.Y.Z`
- `desktop/latest/latest.json` — stable alias consumed by the updater
- `orchestrator/aurowork-orchestrator-v<X.Y.Z>/...` — orchestrator sidecar manifest + assets
- `auro/v<X.Y.Z>/...` — upstream engine sidecar binaries

## GitHub Actions: sync workflow

Workflow: `.github/workflows/sync-release-to-azure.yml`

Triggers:
- `release: published` — auto-mirrors every new release based on tag pattern
  - `v*` → `desktop`
  - `aurowork-orchestrator-v*` → `orchestrator`
  - `auro-v*` → `auro`
- `workflow_dispatch` — manual backfill, choose tag + prefix

Auth: OIDC federation (`azure/login@v2`), no long-lived secrets. Runs in the `release` GitHub Environment which requires reviewer approval.

Required GitHub repo Variables (under Settings → Secrets and variables → Actions):

| Variable | Value |
|----------|-------|
| `AZURE_CLIENT_ID` | `a8cdfe76-1879-487b-a5d3-8db4521f9bf7` |
| `AZURE_TENANT_ID` | `67c4a6d0-4789-4891-bd48-f6a64b5b2b12` |
| `AZURE_SUBSCRIPTION_ID` | `69464de7-5a57-4b0a-82bf-7c1368a13fdf` |
| `AZURE_STORAGE_ACCOUNT` | `auroworkdl` |
| `AZURE_BLOB_CONTAINER` | `releases` |
| `AUROWORK_AZURE_BASE_URL` | `https://auroworkdl.blob.core.windows.net/releases/desktop` |

The last variable is read by `build-desktop.yml` so the Tauri updater's `latest.json` lists Azure URLs in `platforms[].url`.

## How the updater + orchestrator consume the mirror

### Desktop updater

`apps/desktop/src-tauri/tauri.conf.json` lists two endpoints, tried in order:

1. `https://auroworkdl.blob.core.windows.net/releases/desktop/latest/latest.json`
2. `https://github.com/Northern-Deep-Leviathan/aurowork/releases/latest/download/latest.json`

`scripts/release/generate-latest-json.mjs` rewrites the `url` field of each platform to point at the Azure mirror whenever `AUROWORK_AZURE_BASE_URL` is set in the build environment.

The sync workflow additionally publishes `desktop/latest/latest.json` as a server-side copy of the versioned `desktop/<tag>/latest.json` so endpoint 1 always resolves to the current release.

### Orchestrator + Auro engine sidecars

`apps/orchestrator/src/cli.ts` has a `mirrorUrls(url)` helper. Any GitHub URL matching `Northern-Deep-Leviathan/(aurowork|auro)/releases/download/<tag>/<asset>` is prefixed by an Azure mirror URL. Both `downloadToPath` (binary download) and `fetchRemoteManifest` (sidecar manifest) try Azure first, then fall back to GitHub.

Override knobs:
- `AUROWORK_MIRROR_BASE_URL=""` — disable the mirror entirely
- `AUROWORK_MIRROR_BASE_URL=https://your-mirror/releases` — point at a different mirror
- `AUROWORK_SIDECAR_BASE_URL` — completely override the sidecar source URL (existing flag)

## Manual backfill

To mirror an existing release without re-running the publish event:

```bash
gh workflow run sync-release-to-azure.yml \
  --repo Northern-Deep-Leviathan/aurowork \
  --ref main \
  -f tag=v0.14.5 \
  -f prefix=desktop
```

Approve the `release` environment when prompted, then verify:

```bash
curl -I https://auroworkdl.blob.core.windows.net/releases/desktop/v0.14.5/latest.json
```

Local backfill (if CI is unavailable) — uses `az` CLI login:

```bash
az login --tenant 67c4a6d0-4789-4891-bd48-f6a64b5b2b12
node scripts/release/sync-to-azure.mjs \
  --tag v0.14.5 \
  --repo Northern-Deep-Leviathan/aurowork \
  --prefix desktop
```

Or with an account key (when you have one) — set `AZURE_STORAGE_KEY` before running.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Workflow stuck in `waiting` | `release` environment requires approval | Approve in the PR/run UI or `gh api -X POST .../pending_deployments` |
| `az login` MFA error (AADSTS50076) | Conditional access on default tenant | Pass `--tenant <tenant-id>` explicitly |
| `MissingSubscription` from `az role assignment` | Subscription not active in current context | `az account set --subscription <sub-id>` |
| Sync fails with `code: null` on Windows local run | `az` is a `.cmd` script | Already handled (`shell: true` in spawnSync), only an issue if you fork the script |
| Updater stays on GitHub URL | `AUROWORK_AZURE_BASE_URL` not set in build env | Add to repo Variables, re-run `build-desktop` |
| Orchestrator still downloads via GitHub | `AUROWORK_MIRROR_BASE_URL` set to empty | Unset the override |

## What is NOT in scope

- No CDN in front of the blob — direct blob URLs only. If hot links become a cost concern, front with Azure CDN / Front Door.
- No custom domain — direct `*.blob.core.windows.net` host is used.
- No artifact rotation policy — release tags are immutable, so old assets stay forever. Add a lifecycle rule if cost grows.
- No automatic mirroring of upstream `Northern-Deep-Leviathan/auro` releases — that repo's CI is independent. For now, mirror manually via `workflow_dispatch` with `prefix=auro`.
