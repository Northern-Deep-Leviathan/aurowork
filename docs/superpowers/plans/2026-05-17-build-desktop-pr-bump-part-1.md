# build-desktop.yml PR-based bump + setup-auro-git — Implementation Plan (Part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Plan index:**
> - Part 1 (this file): Tasks 1–2 — shared helper library + its standalone tests
> - Part 2: Tasks 3–4 — refactor `open-merge-auro-pr.sh`, add `open-merge-release-pr.sh` + tests
> - Part 3: Task 5 — refactor `.github/workflows/build-desktop.yml`

**Goal:** Replace the inline `git config` + direct-push bump in `build-desktop.yml` with a PR-based flow that reuses `./.github/actions/setup-auro-git`, and factor the shared open-PR-and-merge logic into `scripts/common/open-merge-pr-common.sh` consumed by both `open-merge-auro-pr.sh` and the new `open-merge-release-pr.sh`.

**Architecture:** A composite GitHub Action already mints an App token and configures git identity; we adopt it in `build-desktop.yml`. The bump step writes a feature branch, hands off to `scripts/release/open-merge-release-pr.sh`, which (via shared helpers) opens a PR, waits for checks, admin-squash-merges, then tags the resulting merge commit on `main` and emits the `release_*` outputs that downstream jobs consume.

**Tech Stack:** Bash, `git`, GitHub CLI (`gh`), GitHub Actions (composite + workflow_dispatch), tauri-action, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-17-build-desktop-pr-bump-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/common/open-merge-pr-common.sh` | **create** | `die`, `rebase_on_base`, `push_branch`, `watch_pr_checks`, `admin_squash_merge` — function definitions only, safe to source |
| `scripts/common/test-open-merge-pr-common.sh` | **create** | Unit tests for the shared functions in isolation |
| `scripts/publish/open-merge-auro-pr.sh` | **modify** | Source the common lib; drop the now-shared inline blocks; keep all auro-sync-specific behavior |
| `scripts/publish/test-open-merge-auro-pr.sh` | **unchanged** | Re-run after refactor to confirm behavior preserved |
| `scripts/release/open-merge-release-pr.sh` | **create** | Release-bump variant: branch, commit, PR, merge, then tag merge SHA + push tag + emit `$GITHUB_OUTPUT` |
| `scripts/release/test-open-merge-release-pr.sh` | **create** | Stubs `git`/`gh`; asserts release-specific call sequence and outputs |
| `.github/workflows/build-desktop.yml` | **modify** | Adopt `setup-auro-git` in all three jobs; restructure `prepare` to invoke the release script; switch downstream tokens |

---

## Task 1: Create shared helper library

**Files:**
- Create: `scripts/common/open-merge-pr-common.sh`

This library is sourced by `open-merge-auro-pr.sh` and `open-merge-release-pr.sh`. It must define functions only — no top-level state changes — so callers that have already `set -euo pipefail` aren't disturbed.

- [ ] **Step 1: Create the shared helper file**

Write `scripts/common/open-merge-pr-common.sh`:

```bash
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
```

- [ ] **Step 2: Make it sourceable (no execute bit needed, but `chmod` not required)**

The file is sourced, not executed. Leave permissions default (644).

- [ ] **Step 3: Syntax-check with bash**

Run:
```bash
bash -n scripts/common/open-merge-pr-common.sh
```
Expected: exits 0, no output.

- [ ] **Step 4: Verify functions load cleanly when sourced**

Run:
```bash
bash -c 'set -euo pipefail; . scripts/common/open-merge-pr-common.sh; declare -F die rebase_on_base push_branch watch_pr_checks admin_squash_merge'
```
Expected output:
```
declare -f admin_squash_merge
declare -f die
declare -f push_branch
declare -f rebase_on_base
declare -f watch_pr_checks
```

- [ ] **Step 5: Commit**

```bash
git add scripts/common/open-merge-pr-common.sh
git commit -m "feat(scripts/common): add open-merge-pr shared helpers"
```

---

## Task 2: Add standalone tests for the shared helpers

**Files:**
- Create: `scripts/common/test-open-merge-pr-common.sh`

These tests exercise each helper function in isolation with `git` and `gh` stubbed on `PATH`. They complement (not replace) the end-to-end tests in Tasks 3–4.

- [ ] **Step 1: Write the failing test file**

Write `scripts/common/test-open-merge-pr-common.sh`:

```bash
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/open-merge-pr-common.sh"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# Shim factory: records every git/gh invocation to $log; mode controls
# whether `gh pr checks ... --watch` succeeds, fails with "no checks
# reported", or fails with a generic error; and whether `git rebase`
# fails (rebase_conflict mode).
make_shims() {
  local dir="$1" log="$2" mode="${3:-happy}"
  mkdir -p "$dir"
  for bin in gh git; do
    cat > "$dir/$bin" <<EOF
#!/usr/bin/env bash
echo "$bin \$*" >> "$log"
case "$bin \$*" in
  "gh pr checks "*"--watch"*)
    case "$mode" in
      no_checks)   echo 'no checks reported' >&2; exit 1;;
      checks_fail) echo 'some checks failed' >&2; exit 1;;
      *)           exit 0;;
    esac;;
  "git rebase origin/"*)
    [ "$mode" = "rebase_conflict" ] && exit 1; exit 0;;
  *) exit 0;;
esac
EOF
    chmod +x "$dir/$bin"
  done
}

# --- T1: library sources cleanly and defines every helper ---
out=$(bash -c "set -euo pipefail; . '$LIB'; declare -F die rebase_on_base push_branch watch_pr_checks admin_squash_merge" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] \
  && echo "$out" | grep -q "die$" \
  && echo "$out" | grep -q "rebase_on_base$" \
  && echo "$out" | grep -q "push_branch$" \
  && echo "$out" | grep -q "watch_pr_checks$" \
  && echo "$out" | grep -q "admin_squash_merge$"; then
  pass "library defines all helpers"
else
  fail "library load: rc=$rc out=$out"
fi

# --- T2: die() prints ::error:: prefix and exits non-zero ---
out=$(bash -c "set -uo pipefail; . '$LIB'; die 'boom'" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "::error::boom"; then
  pass "die emits ::error:: and exits non-zero"
else
  fail "die: rc=$rc out=$out"
fi

# --- T3: rebase_on_base happy path runs fetch + rebase ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" bash -c "set -euo pipefail; . '$LIB'; rebase_on_base main" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"git fetch origin main"*"git rebase origin/main"*)
    [ "$rc" -eq 0 ] && pass "rebase_on_base happy" || fail "rebase_on_base rc=$rc";;
  *) fail "rebase_on_base sequence: $seq";;
esac
rm -rf "$tmp"

# --- T4: rebase_on_base aborts rebase on conflict and dies ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" rebase_conflict
out=$(PATH="$tmp:$PATH" bash -c "set -uo pipefail; . '$LIB'; rebase_on_base main" 2>&1); rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"git rebase origin/main"*"git rebase --abort"*)
    if [ "$rc" -ne 0 ] && echo "$out" | grep -q "::error::"; then
      pass "rebase_on_base conflict aborts + dies"
    else
      fail "rebase_on_base conflict rc=$rc out=$out"
    fi;;
  *) fail "rebase_on_base conflict missing --abort: $seq";;
esac
rm -rf "$tmp"

# --- T5: push_branch passes --force-with-lease --no-verify ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" bash -c "set -euo pipefail; . '$LIB'; push_branch feat/x" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"git push origin feat/x --force-with-lease --no-verify"*)
    [ "$rc" -eq 0 ] && pass "push_branch flags" || fail "push_branch rc=$rc";;
  *) fail "push_branch sequence: $seq";;
esac
rm -rf "$tmp"

# --- T6: watch_pr_checks happy returns 0 ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" bash -c "set -euo pipefail; . '$LIB'; watch_pr_checks feat/x" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && pass "watch_pr_checks happy" || fail "watch_pr_checks rc=$rc"
rm -rf "$tmp"

# --- T7: watch_pr_checks tolerates "no checks reported" ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" no_checks
PATH="$tmp:$PATH" bash -c "set -euo pipefail; . '$LIB'; watch_pr_checks feat/x" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && pass "watch_pr_checks no-checks tolerated" || fail "no_checks rc=$rc"
rm -rf "$tmp"

# --- T8: watch_pr_checks dies on real failure ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" checks_fail
out=$(PATH="$tmp:$PATH" bash -c "set -uo pipefail; . '$LIB'; watch_pr_checks feat/x" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "::error::PR checks failed"; then
  pass "watch_pr_checks real failure dies"
else
  fail "watch_pr_checks real fail rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T9: admin_squash_merge passes the right flags ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" bash -c "set -euo pipefail; . '$LIB'; admin_squash_merge feat/x" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr merge feat/x --squash --admin --delete-branch"*)
    [ "$rc" -eq 0 ] && pass "admin_squash_merge flags" || fail "admin_squash_merge rc=$rc";;
  *) fail "admin_squash_merge sequence: $seq";;
esac
rm -rf "$tmp"

exit $FAIL
```

- [ ] **Step 2: Make the test executable**

```bash
chmod +x scripts/common/test-open-merge-pr-common.sh
```

- [ ] **Step 3: Run the tests**

```bash
bash scripts/common/test-open-merge-pr-common.sh
```
Expected: nine `PASS:` lines, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/common/test-open-merge-pr-common.sh
git commit -m "test(scripts/common): unit tests for open-merge-pr helpers"
```

---

**End of Part 1.** Continue with Part 2 (Tasks 3–4) in the next file.
