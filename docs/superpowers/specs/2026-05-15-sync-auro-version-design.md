# Sync Auro Version — Design Spec

**Date:** 2026-05-15
**Status:** Approved for implementation planning
**Owner:** AuroWork maintainers

## Goal

Provide a manually-triggered GitHub Actions workflow that updates the
`auroVersion` field in the repo-root `constants.json` to either a
user-supplied auro release tag, or — when no input is given — GitHub's
"latest" release (most recent non-draft, non-prerelease) on the private
upstream repo `Northern-Deep-Leviathan/auro`. After the file is updated the workflow
opens a pull request against the default branch for human review.

The reusable logic lives in a shell script under `scripts/publish/` so it
can be invoked locally as well as from CI.

## Non-Goals

- Auto-merging the PR.
- Triggering downstream builds/releases (handled by separate workflows).
- Scheduling or webhook-driven runs (manual dispatch only for now).
- Modifying any file other than `constants.json`.

## User Flow

1. Maintainer opens the Actions tab → **Sync Auro Version** → **Run
   workflow**.
2. They optionally type a tag (`v0.2.0`) into the `version` input.
3. Workflow resolves the target tag, updates `constants.json`, and opens a
   PR titled `chore: sync auro to <version>`.
4. If `constants.json` already matches the target version, the workflow
   exits successfully with a "no-op" log line and no PR is created.

## Components

### 1. `scripts/publish/sync-auro-version.sh`

POSIX shell script (bash) that owns all logic. Designed to be safely
runnable on a developer's machine and inside CI.

**Inputs (environment variables):**

| Var | Default | Notes |
|-----|---------|-------|
| `VERSION` | empty | Optional auro release tag, e.g. `v0.2.0`. |
| `AURO_REPO` | `Northern-Deep-Leviathan/auro` | Override for testing. |
| `CONSTANTS_FILE` | `constants.json` | Path relative to repo root. |
| `GH_TOKEN` | _required_ | PAT with `repo` (or fine-grained Contents:read) scope on `AURO_REPO`. |

**Dependencies:** `bash`, `gh`, `jq`. Script aborts with a clear message
if any is missing.

**Flow:**

1. `set -euo pipefail`; verify required tools and `GH_TOKEN`.
2. **Resolve target tag:**
   - If `VERSION` is non-empty:
     - `gh api repos/$AURO_REPO/releases/tags/$VERSION` → must return
       200 and `.draft == false`. Otherwise exit 1 with
       `tag "$VERSION" is not a published release of $AURO_REPO`.
   - If `VERSION` is empty:
     - `gh api repos/$AURO_REPO/releases/latest` → read `.tag_name`.
       GitHub's `/releases/latest` endpoint already excludes drafts and
       pre-releases, so a single call is sufficient.
     - Exit 1 with `no published releases found in $AURO_REPO` if the
       endpoint returns 404 (repo has only drafts/pre-releases or none).
3. **Read current value:** `current=$(jq -r '.auroVersion' "$CONSTANTS_FILE")`.
4. **No-op check:** if `current == target`, log
   `auroVersion already at <tag>; nothing to do`, emit
   `changed=false`, `version=<tag>`, exit 0.
5. **Write update:**
   `jq --arg v "$target" '.auroVersion = $v' "$CONSTANTS_FILE" > "$tmp"`
   then `mv "$tmp" "$CONSTANTS_FILE"`. Preserve the existing trailing
   newline and 2-space indent (jq's defaults match the current file).
6. **Emit outputs:** when `$GITHUB_OUTPUT` is set, append
   `version=<tag>` and `changed=true`; otherwise print them to stdout so
   the script is informative when run locally.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success (changed or no-op). |
| 1 | Validation failure (missing deps, missing token, tag not found, no releases, jq/IO error). |

### 2. `.github/workflows/sync-auro-version.yml`

```yaml
name: Sync Auro Version

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Auro release tag (e.g. v0.2.0). Leave empty to use GitHub's latest release (excludes drafts and pre-releases)."
        required: false
        type: string

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Sync auroVersion
        id: sync
        env:
          GH_TOKEN: ${{ secrets.AURO_RELEASES_TOKEN }}
          VERSION: ${{ inputs.version }}
        run: bash scripts/publish/sync-auro-version.sh

      - name: Open PR
        if: steps.sync.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          branch: chore/sync-auro-${{ steps.sync.outputs.version }}
          base: ${{ github.event.repository.default_branch }}
          title: "chore: sync auro to ${{ steps.sync.outputs.version }}"
          commit-message: "chore: sync auro to ${{ steps.sync.outputs.version }}"
          body: |
            Bumps `constants.json#auroVersion` to **${{ steps.sync.outputs.version }}**.

            Source: https://github.com/Northern-Deep-Leviathan/auro/releases/tag/${{ steps.sync.outputs.version }}

            Triggered by @${{ github.actor }} via `workflow_dispatch`
            (input version: `${{ inputs.version || '(auto: latest release)' }}`).
          labels: auro-sync
```

## Prerequisites

- **Repo secret `AURO_RELEASES_TOKEN`** — PAT with read access to
  `Northern-Deep-Leviathan/auro` releases. Must be configured before the
  workflow is usable; the script will exit 1 with an actionable error if
  it's missing or unauthorized.
- The default `GITHUB_TOKEN` is sufficient for the PR step because of the
  `permissions:` block.

## Error Handling

| Failure | Behavior |
|---------|----------|
| `AURO_RELEASES_TOKEN` missing/unauthorized | `gh` returns non-zero; script exits 1, workflow fails. |
| User-supplied tag not found or `draft=true` | Script exits 1 with `tag "<v>" is not a published release of <repo>`. |
| Zero published releases in upstream | Script exits 1 with `no published releases found in <repo>`. |
| `jq` or `gh` missing locally | Script exits 1 with install hint. |
| `constants.json` already at target | Script exits 0, `changed=false`, no PR step runs. |

## Testing

- **Local dry run:**
  `GH_TOKEN=$(gh auth token) VERSION=v0.1.0 bash scripts/publish/sync-auro-version.sh`
  on a clean checkout should print `already at v0.1.0; nothing to do`.
- **Local update:**
  `GH_TOKEN=$(gh auth token) VERSION=<existing-tag> bash scripts/publish/sync-auro-version.sh`
  should mutate `constants.json`; revert with `git checkout`.
- **Negative path:** supply a bogus tag, confirm exit 1 and message.
- **CI:** dispatch on a throwaway branch with no input; verify a PR is
  opened against the default branch with the auto-selected tag.

## Open Questions

None at design time. The PAT must be provisioned by a maintainer before
first run.
