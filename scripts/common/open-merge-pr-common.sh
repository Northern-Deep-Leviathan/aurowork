#!/usr/bin/env bash
# Shared helpers for open-merge-*-pr.sh scripts.
# Source from a caller that has already `set -euo pipefail`.
# Only depends on `git` and `gh` being on PATH.

die() { echo "::error::$*" >&2; exit 1; }

# rebase_on_base BASE_BRANCH
# Fetches origin/BASE_BRANCH and rebases the current branch onto it.
# On conflict, aborts the rebase and exits via die().
rebase_on_base() {
  local base="$1"
  git fetch origin "$base"
  if ! git rebase "origin/${base}"; then
    git rebase --abort || true
    die "branch conflicts with origin/${base}"
  fi
}

# push_branch BRANCH
# Pushes BRANCH to origin with --force-with-lease and --no-verify
# (matches the upstream release script's behavior).
push_branch() {
  local branch="$1"
  git push origin "$branch" --force-with-lease --no-verify
}

# watch_pr_checks BRANCH
# Runs `gh pr checks BRANCH --watch`. If checks pass, returns 0.
# If gh emits "no checks reported", logs and returns 0 (matches the
# existing auro-sync behavior — repos without required checks proceed).
# Any other failure mode calls die().
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
# Squash-merges BRANCH using --admin (ruleset bypass) and deletes the
# remote branch.
admin_squash_merge() {
  local branch="$1"
  gh pr merge "$branch" --squash --admin --delete-branch
}
