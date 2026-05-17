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

die() { echo "error: $*" >&2; exit 1; }

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
git fetch origin "$BASE_BRANCH"
if ! git rebase "origin/${BASE_BRANCH}"; then
  git rebase --abort || true
  die "branch conflicts with origin/${BASE_BRANCH} — resolve manually and retry"
fi

# 3. Push with force-with-lease, skip hooks (matches upstream release script).
git push origin "$branch" --force-with-lease --no-verify

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
echo "waiting for PR checks..."
err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT
if ! gh pr checks "$branch" --watch 2> "$err_file"; then
  if grep -q "no checks reported" "$err_file"; then
    echo "no checks configured, proceeding"
  else
    cat "$err_file" >&2
    die "PR checks failed"
  fi
fi

# 6. Merge via ruleset bypass.
gh pr merge "$branch" --squash --admin --delete-branch
