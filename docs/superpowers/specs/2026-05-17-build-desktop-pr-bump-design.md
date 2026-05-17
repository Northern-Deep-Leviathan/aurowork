# build-desktop.yml: PR-based version bump + `setup-auro-git`

**Date:** 2026-05-17
**Status:** Approved (brainstorming)
**Scope:** `.github/workflows/build-desktop.yml`, plus:
- new script `scripts/release/open-merge-release-pr.sh` (+ its test)
- new shared library `scripts/common/open-merge-pr-common.sh` (sourced by both `open-merge-*-pr.sh` scripts)
- refactor `scripts/publish/open-merge-auro-pr.sh` to source the shared library

## Motivation

Two coupled cleanups to `build-desktop.yml`:

1. The `prepare` job hand-rolls `git config user.name/email` and depends on a `RELEASE_PUSH_TOKEN` secret. The repo already has a `./.github/actions/setup-auro-git` composite action that mints a GitHub App token, sets the git identity to `<app-slug>[bot]`, and re-points `origin` to use the App token. Reusing it removes duplication and drops the `RELEASE_PUSH_TOKEN` dependency.
2. The `prepare` job currently pushes the bump commit + tag directly to the dispatched branch (typically `main`). This bypasses branch protection and produces no PR audit trail. We want a PR-based flow that mirrors `scripts/publish/open-merge-auro-pr.sh`: branch → push → open PR → watch checks → admin squash-merge → tag the squashed merge commit on `main`.

## Tagging model (decided)

Tag the **squashed merge commit on `main`** after the PR merges. The tag SHA equals the new `HEAD` of `BASE_BRANCH` post-merge. This keeps `main` linear, keeps the tagged commit reachable from `main`, and avoids dangling tags on failure paths (tagging only happens after a successful admin-merge).

## Token model (decided)

All git/gh operations in `prepare`, `create-release`, and `build` use the App token from `setup-auro-git`. The checkout step's `token:` input reverts to plain `github.token` (or omitted), since `setup-auro-git` rewrites `origin` after checkout. The `RELEASE_PUSH_TOKEN` secret reference is removed.

## Check-gating (decided)

Wait for PR checks before admin-merging, using `gh pr checks --watch` with the "no checks reported" fall-through, identical to `open-merge-auro-pr.sh`. If checks are absent the script proceeds; if checks fail the script exits before merging or tagging.

## Script reuse (decided)

Create a new sibling script `scripts/release/open-merge-release-pr.sh` modeled on `scripts/publish/open-merge-auro-pr.sh`. Factor the genuinely-shared steps into `scripts/common/open-merge-pr-common.sh`, sourced by both scripts. Refactor `open-merge-auro-pr.sh` in the same change to consume the shared library — otherwise the duplication just moves.

**Shared functions** (in `scripts/common/open-merge-pr-common.sh`):

| Function | Behavior |
|---|---|
| `die MSG` | Print `::error::MSG` to stderr, `exit 1`. |
| `rebase_on_base BASE_BRANCH` | `git fetch origin BASE_BRANCH`; `git rebase origin/BASE_BRANCH`; on conflict, abort and `die`. |
| `push_branch BRANCH` | `git push origin BRANCH --force-with-lease --no-verify`. |
| `watch_pr_checks BRANCH` | `gh pr checks BRANCH --watch`, tolerating `no checks reported`; `die` on any other failure. |
| `admin_squash_merge BRANCH` | `gh pr merge BRANCH --squash --admin --delete-branch`. |

The library is `set -euo pipefail`-safe when sourced (no top-level state changes; functions only).

**Script-specific (stays in each `open-merge-*-pr.sh`):** env-var validation, branch name, commit message, label creation (name/color/description), PR title/body, and — for the release script — the post-merge tag-and-push step plus `$GITHUB_OUTPUT` emission.

The two scripts diverge as:

| Aspect | `open-merge-auro-pr.sh` | `open-merge-release-pr.sh` |
|---|---|---|
| Branch | `chore/sync-auro-${VERSION}` | `chore/release-${NEW_TAG}` |
| Commit | `chore: sync auro to ${VERSION}` | `chore: bump version to ${NEW_VER} [skip ci]` |
| Label | `auro-sync` | `release` |
| PR body | auro-version-sync template | release-bump template |
| Post-merge | (none) | **tag merge SHA, push tag, emit `$GITHUB_OUTPUT`** |

## Workflow changes

### `prepare` job

Replace:

```yaml
- name: Checkout (full history + tags)
  uses: actions/checkout@v4
  with:
    ref: ${{ github.sha }}
    fetch-depth: 0
    token: ${{ secrets.RELEASE_PUSH_TOKEN || github.token }}
- name: Setup Node ...
- name: Setup pnpm ...
- name: Configure git identity
  run: |
    git config user.name  "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
- name: Bump, commit, tag, push
  id: bump
  ...
```

With:

```yaml
- name: Checkout (full history + tags)
  uses: actions/checkout@v4
  with:
    ref: ${{ github.sha }}
    fetch-depth: 0
- name: Setup Auro Git
  id: gitsetup
  uses: ./.github/actions/setup-auro-git
  with:
    auro-app-id: ${{ vars.AURO_APP_ID }}
    auro-app-key: ${{ secrets.AURO_APP_KEY }}
- name: Setup Node ...
- name: Setup pnpm ...
- name: Bump on PR branch, merge, tag
  id: bump
  env:
    BUMP_TYPE: ${{ inputs.bump }}
    GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
    ACTOR: ${{ github.actor }}
  shell: bash
  run: |
    set -euo pipefail

    # Refuse non-branch dispatches (unchanged guard).
    [[ "${GITHUB_REF}" == refs/heads/* ]] || { echo "::error::Must dispatch from a branch."; exit 1; }
    BRANCH="${GITHUB_REF#refs/heads/}"

    pnpm install --no-frozen-lockfile --prefer-offline

    CUR_VER="$(node -p "require('./apps/app/package.json').version")"
    pnpm bump:"$BUMP_TYPE"
    NEW_VER="$(node -p "require('./apps/app/package.json').version")"
    NEW_TAG="v${NEW_VER}"
    pnpm install --lockfile-only

    # Guards (preserved verbatim from current workflow):
    #   1. NEW_VER != CUR_VER
    #   2. NEW_TAG not already on origin
    #   3. NEW_TAG strictly greater than largest existing v* tag
    [ "$CUR_VER" != "$NEW_VER" ] || { echo "::error::Bump produced the same version."; exit 1; }
    ! git ls-remote --tags origin "refs/tags/${NEW_TAG}" | grep -q . || { echo "::error::Tag ${NEW_TAG} already exists."; exit 1; }
    LARGEST="$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)"
    if [ -n "$LARGEST" ]; then
      HIGHEST="$(printf '%s\n%s\n' "$LARGEST" "$NEW_TAG" | sort -V | tail -n1)"
      { [ "$HIGHEST" = "$NEW_TAG" ] && [ "$LARGEST" != "$NEW_TAG" ]; } || { echo "::error::New tag not strictly greater than ${LARGEST}."; exit 1; }
    fi

    git add -A
    git diff --cached --quiet && { echo "::error::No changes after bump."; exit 1; } || true

    BASE_BRANCH="$BRANCH" NEW_VER="$NEW_VER" NEW_TAG="$NEW_TAG" \
      bash scripts/release/open-merge-release-pr.sh
```

The `Forward prerelease flag` step is unchanged.

### `create-release` and `build` jobs

Both need the App token so they can push to release objects without relying on `RELEASE_PUSH_TOKEN`. Add a `Setup Auro Git` step at the top of each (after checkout in `build`; before any `gh` call in `create-release`) and replace `GITHUB_TOKEN`/`GH_TOKEN` references with `${{ steps.gitsetup.outputs.token }}`.

The `tauri-action` step's `GITHUB_TOKEN` env also switches to the App token so it can upload to the release.

## `scripts/common/open-merge-pr-common.sh`

```bash
#!/usr/bin/env bash
# Shared helpers for open-merge-*-pr.sh scripts.
# Source from a caller that has already `set -euo pipefail`.
# Each function is self-contained and only depends on `git` + `gh` being on PATH.

die() { echo "::error::$*" >&2; exit 1; }

# rebase_on_base BASE_BRANCH
rebase_on_base() {
  local base="$1"
  git fetch origin "$base"
  if ! git rebase "origin/${base}"; then
    git rebase --abort || true
    die "branch conflicts with origin/${base}"
  fi
}

# push_branch BRANCH
push_branch() {
  local branch="$1"
  git push origin "$branch" --force-with-lease --no-verify
}

# watch_pr_checks BRANCH
# Returns 0 if checks pass or none are reported; dies otherwise.
watch_pr_checks() {
  local branch="$1"
  local err_file
  err_file="$(mktemp)"
  if ! gh pr checks "$branch" --watch 2> "$err_file"; then
    if grep -q "no checks reported" "$err_file"; then
      echo "no checks configured, proceeding"
      rm -f "$err_file"
      return 0
    fi
    cat "$err_file" >&2
    rm -f "$err_file"
    die "PR checks failed"
  fi
  rm -f "$err_file"
}

# admin_squash_merge BRANCH
admin_squash_merge() {
  local branch="$1"
  gh pr merge "$branch" --squash --admin --delete-branch
}
```

## `scripts/release/open-merge-release-pr.sh`

```bash
#!/usr/bin/env bash
# Branch + commit + push + open PR + watch checks + admin squash-merge,
# then tag the squashed merge commit on BASE_BRANCH and push the tag.
#
# Mirrors scripts/publish/open-merge-auro-pr.sh; diverges on branch name,
# commit message, label, PR body, and the post-merge tag step.
#
# Env:
#   NEW_VER       required: bumped version, e.g. "0.5.0"
#   NEW_TAG       required: tag, e.g. "v0.5.0"
#   GH_TOKEN      required: bypass-capable App token
#   BASE_BRANCH   default: main
#   ACTOR         optional: dispatcher login (for PR body)
#
# Outputs (appended to $GITHUB_OUTPUT):
#   release_tag, release_version, release_name, release_sha
#
# IMPORTANT: if tagging/pushing the tag fails AFTER the PR is merged, the
# bump is on main but the tag is missing. The script retries the tag push;
# if it still fails, it emits ::error:: with the merge SHA so the operator
# can push the tag manually.

set -euo pipefail

# Shared helpers: die, rebase_on_base, push_branch, watch_pr_checks, admin_squash_merge.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/open-merge-pr-common.sh
. "${SCRIPT_DIR}/../common/open-merge-pr-common.sh"

[ -n "${NEW_VER:-}" ] || die "NEW_VER required"
[ -n "${NEW_TAG:-}" ] || die "NEW_TAG required"
[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN required"
BASE_BRANCH="${BASE_BRANCH:-main}"
ACTOR="${ACTOR:-github-actions}"

branch="chore/release-${NEW_TAG}"

# 1. Branch + commit (staged changes carry over from caller).
git checkout -b "$branch"
git commit -m "chore: bump version to ${NEW_VER} [skip ci]"

# 2. Rebase on base to surface conflicts early.
rebase_on_base "$BASE_BRANCH"

# 3. Push branch.
push_branch "$branch"

# 4. Ensure label, open PR.
gh label create release --color 0e8a16 --description "Release bump PRs" --force >/dev/null
body=$(printf 'Release bump for **%s**.\n\nTriggered by @%s via workflow_dispatch.' "$NEW_TAG" "$ACTOR")
gh pr create --base "$BASE_BRANCH" --head "$branch" \
  --title "chore: release ${NEW_TAG}" --body "$body" --label release

# 5. Watch checks.
watch_pr_checks "$branch"

# 6. Admin squash-merge.
admin_squash_merge "$branch"

# 7. Tag the merge commit on BASE_BRANCH.
git fetch origin "$BASE_BRANCH"
MERGE_SHA="$(git rev-parse "origin/${BASE_BRANCH}")"
git tag "$NEW_TAG" "$MERGE_SHA"

# 8. Push tag with one retry.
if ! git push origin "$NEW_TAG"; then
  sleep 3
  git push origin "$NEW_TAG" || die "merged ${NEW_TAG} as ${MERGE_SHA} but tag push failed; push manually: git push origin ${NEW_TAG}"
fi

# 9. Emit outputs.
{
  echo "release_tag=${NEW_TAG}"
  echo "release_version=${NEW_VER}"
  echo "release_name=AuroWork ${NEW_TAG}"
  echo "release_sha=${MERGE_SHA}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
```

## `scripts/publish/open-merge-auro-pr.sh` refactor

Same change replaces the inline `die`, rebase block, branch-push, `gh pr checks --watch` block, and `gh pr merge` call with the corresponding helper calls; the rest (env-var checks, branch name, commit message, label, PR body) stays. Net effect: same external behavior, ~30 fewer lines, and a single source of truth for the shared sequence.

## Tests

**`scripts/release/test-open-merge-release-pr.sh`** — mirrors `scripts/publish/test-open-merge-auro-pr.sh`. Stubs `git` and `gh` on `PATH`, records calls, asserts:

- Branch name = `chore/release-vX.Y.Z`
- Commit message = `chore: bump version to X.Y.Z [skip ci]`
- `gh pr create` carries `--label release` and the release title
- `gh pr merge` carries `--squash --admin --delete-branch`
- `git tag NEW_TAG MERGE_SHA` is invoked with the rev-parsed `origin/BASE_BRANCH`
- `git push origin NEW_TAG` is invoked
- `$GITHUB_OUTPUT` receives all four `release_*` keys
- Failure-path: simulated `gh pr checks` failure with `no checks reported` proceeds; any other failure exits non-zero before merge.

**`scripts/publish/test-open-merge-auro-pr.sh`** — re-run unchanged to confirm the refactor preserves behavior. No assertion changes required.

No dedicated test for `scripts/common/open-merge-pr-common.sh`; the two callers' tests exercise it end-to-end.

## Failure-mode summary

| Failure | Outcome |
|---|---|
| Branch push rejected | Script exits, no PR, no tag. |
| `gh pr create` fails | Script exits, no tag. |
| Checks fail (non-"no checks reported") | Script exits before merge, no tag. |
| `gh pr merge` fails | Script exits, no tag. Bump branch may linger; operator deletes manually. |
| Tag push fails after merge | Retried once; on second failure, `::error::` instructs operator to push tag manually. `main` already has the bump. |
| Concurrent dispatch | Existing `concurrency: build-desktop-${{ github.ref }}` cancels in-progress. |

## Removed

- `Configure git identity` step (replaced by `setup-auro-git`).
- `RELEASE_PUSH_TOKEN` secret reference in `actions/checkout`.
- Inline `git commit / git tag / git push origin "HEAD:${BRANCH}" / git push origin "$NEW_TAG"` block (moved into the new script, branch push replaced by PR flow).

## Out of scope

- Changes to `bump-version.mjs`.
- Changes to `tauri-action` invocation beyond the token swap.
- Changes to `sync-auro-version.yml`.
- Further generalization (e.g., a single parameterized `open-merge-pr.sh`) — the shared library covers the duplication; remaining differences are intentional.
