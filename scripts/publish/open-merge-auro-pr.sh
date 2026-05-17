#!/usr/bin/env bash
# Branch + commit + push + open PR + watch checks + admin-merge.
# Mirrors the merge sequence in auro/script/publish-release-cli.ts.
#
# Env:
#   VERSION         required: target auro tag (e.g. v0.2.0).
#   ACTOR           optional: GitHub login that dispatched the workflow.
#   INPUT_VERSION   optional: raw inputs.version (empty = auto-selected).
#   GH_TOKEN        required: bypass-capable token.
#   BASE_BRANCH     default: main
set -euo pipefail

# Shared helpers: die, rebase_on_base, push_branch, watch_pr_checks, admin_squash_merge.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/open-merge-pr-common.sh
. "${SCRIPT_DIR}/../common/open-merge-pr-common.sh"

[ -n "${VERSION:-}" ] || die "VERSION is required"
[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is required (bypass-capable token)"
BASE_BRANCH="${BASE_BRANCH:-main}"
ACTOR="${ACTOR:-$(git config user.name 2>/dev/null || echo local)}"
INPUT_VERSION="${INPUT_VERSION:-}"

branch="chore/sync-auro-${VERSION}"

# 1. Branch + commit (protection rules forbid direct main commits).
git checkout -b "$branch"
git commit -am "chore: sync auro to ${VERSION}"

# 2. Rebase on latest base to surface conflicts BEFORE opening the PR.
rebase_on_base "$BASE_BRANCH"

# 3. Push with force-with-lease, skip hooks (matches upstream release script).
push_branch "$branch"

# 4. Open the PR.
body=$(printf 'Bumps `constants.json#auroVersion` to **%s**.\n\nSource: https://github.com/Northern-Deep-Leviathan/auro/releases/tag/%s\n\nTriggered by @%s via workflow_dispatch (input: `%s`).' \
  "$VERSION" "$VERSION" "$ACTOR" "${INPUT_VERSION:-(auto: latest)}")
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$branch" \
  --title "chore: sync auro to ${VERSION}" \
  --body  "$body" \
  --label "auro-sync"

# 5. Watch required checks, tolerate "no checks reported".
watch_pr_checks "$branch"

# 6. Merge via ruleset bypass.
admin_squash_merge "$branch"
