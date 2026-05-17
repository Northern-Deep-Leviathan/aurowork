#!/usr/bin/env bash
# Best-effort cleanup of a sync-auro PR after a workflow failure.
# Mirrors the catch block in auro/script/publish-release-cli.ts.
# Never fails the workflow itself — always exits 0.
#
# Env:
#   VERSION   required (for branch name). If missing, logs and exits 0.
#   GH_TOKEN  required. Same bypass-capable token as the main step.
set +e

if [ -z "${VERSION:-}" ]; then
  echo "cleanup: VERSION not set; nothing to clean" >&2
  exit 0
fi

branch="chore/sync-auro-${VERSION}"

state=$(gh pr view "$branch" --json state -q .state 2>/dev/null)
if [ "$state" = "OPEN" ]; then
  gh pr close "$branch" --comment "Sync failed, auto-closing." >/dev/null 2>&1
fi

if git ls-remote --heads origin "$branch" | grep -q .; then
  git push origin --delete "$branch" --no-verify >/dev/null 2>&1
fi

exit 0
