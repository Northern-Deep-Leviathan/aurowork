# Sync Auro Version — Design Spec

**Date:** 2026-05-15
**Status:** Approved for implementation planning
**Owner:** AuroWork maintainers

## Goal

Provide a manually-triggered GitHub Actions workflow that updates the
`auroVersion` field in the repo-root `constants.json` to either a
user-supplied auro release tag, or — when no input is given — GitHub's
"latest" release (most recent non-draft, non-prerelease) on the private
upstream repo `Northern-Deep-Leviathan/auro`.

The workflow then opens a release-style PR against the default branch
and immediately squash-merges it with `gh pr merge --admin`, using a
bypass-capable token so required reviews / status checks are skipped —
mirroring the merge flow in `auro`'s
[`script/publish-release-cli.ts`](../../../../auro/script/publish-release-cli.ts).

The reusable logic lives in three shell scripts under
`scripts/publish/`:

- `sync-auro-version.sh` — resolves the target tag and updates
  `constants.json`. Side-effect-free w.r.t. git.
- `open-merge-auro-pr.sh` — branches, commits, pushes, opens the PR,
  waits for checks, admin-merges. Owns all happy-path git/PR side
  effects.
- `cleanup-auro-pr.sh` — closes the PR (if still open) and deletes the
  remote branch. Invoked from the workflow's `failure()` step.

All PR/branch/merge operations use `gh` directly (no third-party
actions), matching the upstream reference. The workflow YAML is a thin
orchestrator that wires env vars to these scripts.

## Non-Goals

- Triggering downstream builds/releases (handled by separate workflows).
- Scheduling or webhook-driven runs (manual dispatch only for now).
- Modifying any file other than `constants.json`.

## User Flow

1. Maintainer opens the Actions tab → **Sync Auro Version** → **Run
   workflow**.
2. They optionally type a tag (`v0.2.0`) into the `version` input.
3. Workflow resolves the target tag, mutates `constants.json` on a
   `chore/sync-auro-<version>` branch, pushes it, opens a PR via
   `gh pr create`, waits for required checks (tolerating "no checks
   reported"), then merges with `gh pr merge --squash --admin` and
   deletes the branch.
4. If `constants.json` already matches the target version, the workflow
   logs "already at <tag>; nothing to do" and exits 0 with no PR.
5. On any failure after the branch was pushed, the workflow closes the
   PR (if open) and deletes the remote branch, mirroring the cleanup in
   `publish-release-cli.ts`.

## Components

### 1. `scripts/publish/sync-auro-version.sh`

POSIX shell script (bash) that owns version resolution and file
mutation **only**. It is purposely free of git / PR side effects so it
can be run locally without surprises.

**Inputs (environment variables):**

| Var | Default | Notes |
|-----|---------|-------|
| `VERSION` | empty | Optional auro release tag, e.g. `v0.2.0`. |
| `AURO_REPO` | `Northern-Deep-Leviathan/auro` | Override for testing. |
| `CONSTANTS_FILE` | `constants.json` | Path relative to repo root. |
| `GH_TOKEN` | _required_ | PAT with read access to `AURO_REPO` releases. |

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
       GitHub's `/releases/latest` already excludes drafts and
       pre-releases.
     - Exit 1 with `no published releases found in $AURO_REPO` on 404.
3. **Read current value:** `current=$(jq -r '.auroVersion' "$CONSTANTS_FILE")`.
4. **No-op check:** if `current == target`, log
   `auroVersion already at <tag>; nothing to do`, emit
   `changed=false`, `version=<tag>`, exit 0.
5. **Write update:**
   `jq --arg v "$target" '.auroVersion = $v' "$CONSTANTS_FILE" > "$tmp"`
   then `mv "$tmp" "$CONSTANTS_FILE"`. Preserves the existing trailing
   newline and 2-space indent.
6. **Emit outputs:** when `$GITHUB_OUTPUT` is set, append
   `version=<tag>` and `changed=true|false`; otherwise print to stdout.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success (changed or no-op). |
| 1 | Validation/IO failure. |

### 2. `.github/workflows/sync-auro-version.yml`

The workflow uses a single bypass-capable token (`AURO_SYNC_TOKEN`) for
all git, PR, and merge operations — exactly like
`publish-release-cli.ts` uses one `GH_TOKEN`. Read access to the
upstream private auro repo is handled by a second token
(`AURO_RELEASES_TOKEN`) scoped only to the resolution step.

```yaml
name: Sync Auro Version

on:
  workflow_dispatch:
    inputs:
      version:
        description: "Auro release tag (e.g. v0.2.0). Leave empty to use GitHub's latest release."
        required: false
        type: string

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    env:
      # Single bypass-capable token for every git/PR/merge call in this job.
      GH_TOKEN: ${{ secrets.AURO_SYNC_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.AURO_SYNC_TOKEN }}
          fetch-depth: 0

      - name: Configure git identity
        run: |
          git config user.name  "aurowork-bot"
          git config user.email "aurowork-bot@users.noreply.github.com"

      - name: Resolve & update auroVersion
        id: sync
        env:
          # Use the read-only token for upstream release lookup so the
          # bypass token isn't sent to a foreign repo.
          GH_TOKEN: ${{ secrets.AURO_RELEASES_TOKEN }}
          VERSION: ${{ inputs.version }}
        run: bash scripts/publish/sync-auro-version.sh

      - name: Open & merge PR
        if: steps.sync.outputs.changed == 'true'
        env:
          VERSION: ${{ steps.sync.outputs.version }}
          ACTOR: ${{ github.actor }}
          INPUT_VERSION: ${{ inputs.version }}
        run: bash scripts/publish/open-merge-auro-pr.sh

      - name: Cleanup on failure
        if: failure() && steps.sync.outputs.changed == 'true'
        env:
          VERSION: ${{ steps.sync.outputs.version }}
        run: bash scripts/publish/cleanup-auro-pr.sh
```

Key parallels with `auro/script/publish-release-cli.ts`:

- Single env-level `GH_TOKEN` (bypass-capable) instead of mixing tokens
  per call.
- `gh pr create` → `gh pr checks --watch` (tolerating "no checks
  reported") → `gh pr merge --squash --admin --delete-branch` is the
  exact merge sequence.
- `force-with-lease --no-verify` push of the release branch.
- `failure()` cleanup step mirrors the `catch` block: close the PR if
  open, delete the remote branch.

### 3. `scripts/publish/open-merge-auro-pr.sh`

POSIX bash script that owns the happy-path PR/merge sequence.
Invoked from the workflow; also runnable locally for end-to-end
testing on a fork.

**Inputs (env):**

| Var | Notes |
|-----|-------|
| `VERSION` | Required. Target auro tag (e.g. `v0.2.0`). Used in branch name, commit, PR title/body. |
| `ACTOR` | Optional. GitHub login that dispatched the workflow. Defaults to `$(git config user.name)` locally. |
| `INPUT_VERSION` | Optional. The raw `inputs.version` value; empty means "auto-selected". |
| `GH_TOKEN` | Required. Bypass-capable token (provided by the workflow `env:` block). |
| `BASE_BRANCH` | Defaults to `main`. |

**Flow:**

1. `set -euo pipefail`; assert `VERSION` and `GH_TOKEN` are set.
2. Compute `branch="chore/sync-auro-${VERSION}"`.
3. `git checkout -b "$branch"` and `git commit -am "chore: sync auro to ${VERSION}"`.
4. `git fetch origin "$BASE_BRANCH"` then `git rebase origin/$BASE_BRANCH`.
   On conflict, `git rebase --abort` and exit 1 with
   `branch conflicts with origin/$BASE_BRANCH — resolve manually and retry`.
5. `git push origin "$branch" --force-with-lease --no-verify`.
6. `gh pr create --base "$BASE_BRANCH" --head "$branch" --title ... --body ... --label auro-sync`.
   The body is built with `printf` and includes the auro release URL,
   the dispatching actor, and whether the version was user-supplied or
   auto-selected (`(auto: latest)` when `INPUT_VERSION` is empty).
7. `gh pr checks "$branch" --watch`, capturing stderr; if it exits
   non-zero and stderr contains `no checks reported`, log and proceed;
   otherwise re-emit stderr and exit 1.
8. `gh pr merge "$branch" --squash --admin --delete-branch`.

Exit codes: 0 on success; 1 on any failure (validation, rebase
conflict, push, PR creation, real check failure, merge failure).

### 4. `scripts/publish/cleanup-auro-pr.sh`

Best-effort cleanup invoked from the workflow's `failure()` step.
Mirrors the `catch` block in `publish-release-cli.ts`.

**Inputs (env):**

| Var | Notes |
|-----|-------|
| `VERSION` | Required. Target tag, used to derive the branch name. |
| `GH_TOKEN` | Required. Same bypass-capable token. |

**Flow:**

1. `set +e` (best-effort; never let cleanup itself fail the workflow).
2. Compute `branch="chore/sync-auro-${VERSION}"`.
3. `state=$(gh pr view "$branch" --json state -q .state 2>/dev/null)`.
4. If `state == "OPEN"`, run
   `gh pr close "$branch" --comment "Sync failed, auto-closing."`.
5. If `git ls-remote --heads origin "$branch"` returns a ref, run
   `git push origin --delete "$branch" --no-verify`.
6. Exit 0 unconditionally.

## Prerequisites

- **Repo secret `AURO_SYNC_TOKEN`** — PAT or GitHub App installation
  token configured as a **ruleset bypass actor** on this repo. Must
  hold `contents: write` and `pull-requests: write`. This is the
  equivalent of the "release App" referenced by
  `publish-release-cli.ts`. Required.
- **Repo secret `AURO_RELEASES_TOKEN`** — PAT with read access to
  releases on the private `Northern-Deep-Leviathan/auro`. Required.
- "Allow squash merging" enabled in repo settings (it already is, but
  noted for completeness). Native "Allow auto-merge" is **not**
  required because we use `--admin`.

## Error Handling

| Failure | Behavior |
|---------|----------|
| `AURO_RELEASES_TOKEN` missing/unauthorized | Script exits 1; workflow fails before any branch is pushed. |
| User-supplied tag missing or `draft=true` | Script exits 1: `tag "<v>" is not a published release of <repo>`. |
| Zero published releases in upstream | Script exits 1: `no published releases found in <repo>`. |
| `constants.json` already at target | Script exits 0, `changed=false`, no PR work runs. |
| Rebase conflict against `origin/main` | Step exits 1 with a "resolve manually and retry" message; cleanup step closes/deletes the branch. |
| PR checks fail (real failure, not "none reported") | Step exits 1; cleanup step closes the PR and deletes the branch. |
| `gh pr merge --admin` fails (token lacks bypass) | Step exits 1; cleanup step closes the PR and deletes the branch. |

## Testing

- **Local dry run (script only):**
  `GH_TOKEN=$(gh auth token) VERSION=v0.1.0 bash scripts/publish/sync-auro-version.sh`
  → prints `already at v0.1.0; nothing to do`.
- **Local update:** same with `VERSION=<existing-tag>`, revert with
  `git checkout`.
- **Negative path:** supply a bogus tag → exit 1 with clear message.
- **CI happy path:** dispatch with no input on a throwaway base branch;
  verify the PR is created, watched, admin-merged, and the branch
  deleted.
- **CI failure path:** temporarily revoke `AURO_SYNC_TOKEN`'s bypass
  and confirm the cleanup step closes the PR and deletes the branch.

## Open Questions

None at design time. The two secrets must be provisioned by a
maintainer before the first dispatch.
