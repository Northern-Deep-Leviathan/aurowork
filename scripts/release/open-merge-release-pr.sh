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
#   ACTOR         optional: dispatcher login (used in PR body)
#
# Outputs (appended to $GITHUB_OUTPUT, or stdout if unset):
#   release_tag, release_version, release_name, release_sha
#
# Failure mode: if tagging/pushing the tag fails AFTER the PR is merged,
# the bump is on main but the tag is missing. The script retries the tag
# push once; if it still fails, it emits ::error:: with the merge SHA so
# the operator can push the tag manually.

set -euo pipefail

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
