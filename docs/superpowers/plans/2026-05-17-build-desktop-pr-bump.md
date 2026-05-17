# build-desktop.yml PR-based bump + setup-auro-git — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task index:**
> - Task 1: Create `scripts/common/open-merge-pr-common.sh`
> - Task 2: Standalone tests for the shared helpers
> - Task 3: Refactor `scripts/publish/open-merge-auro-pr.sh` onto the shared helpers
> - Task 4: Create `scripts/release/open-merge-release-pr.sh` + tests
> - Task 5: Refactor `.github/workflows/build-desktop.yml`

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

**End of Task 2.**

## Task 3: Refactor `open-merge-auro-pr.sh` onto shared helpers

**Files:**
- Modify: `scripts/publish/open-merge-auro-pr.sh`
- Test: `scripts/publish/test-open-merge-auro-pr.sh` (unchanged — used to verify the refactor preserves behavior)

The current script (61 lines) has the inline `die`, rebase block, branch push, `gh pr checks --watch` block, and `gh pr merge` call that we just extracted into `scripts/common/open-merge-pr-common.sh`. This task swaps those inline blocks for helper calls.

- [ ] **Step 1: Verify the existing tests pass BEFORE the refactor (baseline)**

```bash
bash scripts/publish/test-open-merge-auro-pr.sh
```
Expected: every check `PASS:`, exit 0. This is our regression baseline.

- [ ] **Step 2: Rewrite `scripts/publish/open-merge-auro-pr.sh`**

Replace the entire file with:

```bash
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
```

- [ ] **Step 3: Confirm execute bit is preserved**

```bash
ls -l scripts/publish/open-merge-auro-pr.sh
```
Expected: mode starts with `-rwx` (executable). If not: `chmod +x scripts/publish/open-merge-auro-pr.sh`.

- [ ] **Step 4: Syntax check**

```bash
bash -n scripts/publish/open-merge-auro-pr.sh
```
Expected: exits 0, no output.

- [ ] **Step 5: Re-run the existing test suite (regression gate)**

```bash
bash scripts/publish/test-open-merge-auro-pr.sh
```
Expected: every check `PASS:`, exit 0. Identical output to Step 1. The test file was not modified — if any case now fails, the refactor changed externally observable behavior and must be corrected.

- [ ] **Step 6: Commit**

```bash
git add scripts/publish/open-merge-auro-pr.sh
git commit -m "refactor(scripts/publish): use open-merge-pr-common helpers"
```

---

## Task 4: Create `open-merge-release-pr.sh` + tests

**Files:**
- Create: `scripts/release/open-merge-release-pr.sh`
- Create: `scripts/release/test-open-merge-release-pr.sh`

This script is invoked by the `prepare` job in `build-desktop.yml`. The caller has already run `pnpm bump:$BUMP_TYPE`, refreshed the lockfile, and `git add -A`'d the result. The script's job: create the chore branch, commit, open a PR, wait for checks, admin-squash-merge, then tag the merge commit on `main` and emit outputs.

- [ ] **Step 1: Write the test file FIRST (TDD)**

Write `scripts/release/test-open-merge-release-pr.sh`:

```bash
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/open-merge-release-pr.sh"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# --- T1: script exists and is executable ---
if [ -x "$SCRIPT" ]; then pass "script is executable"; else fail "script not executable"; fi

# Shim factory:
#   mode = happy | no_checks | checks_fail | rebase_conflict | tag_push_fail
#   MERGE_SHA value is returned by `git rev-parse origin/<base>` (deadbeef).
make_shims() {
  local dir="$1" log="$2" mode="${3:-happy}"
  mkdir -p "$dir"
  for bin in gh git; do
    cat > "$dir/$bin" <<EOF
#!/usr/bin/env bash
echo "$bin \$*" >> "$log"
case "$bin \$*" in
  "git rev-parse origin/"*)
    echo "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    exit 0;;
  "git push origin v"*)
    if [ "$mode" = "tag_push_fail" ]; then exit 1; fi
    exit 0;;
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

# --- T2: happy path runs the expected sequence and emits outputs ---
tmp=$(mktemp -d); log="$tmp/calls.log"; out_file="$tmp/output"; : > "$log"; : > "$out_file"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" \
  NEW_VER=0.5.0 NEW_TAG=v0.5.0 ACTOR=alice GH_TOKEN=x \
  GITHUB_OUTPUT="$out_file" \
  bash "$SCRIPT" >/dev/null 2>&1
rc=$?
seq=$(tr '\n' '|' < "$log")
expect=(
  "git checkout -b chore/release-v0.5.0"
  "git commit -m chore: bump version to 0.5.0 [skip ci]"
  "git fetch origin main"
  "git rebase origin/main"
  "git push origin chore/release-v0.5.0 --force-with-lease --no-verify"
  "gh pr create --base main --head chore/release-v0.5.0"
  "gh pr checks chore/release-v0.5.0 --watch"
  "gh pr merge chore/release-v0.5.0 --squash --admin --delete-branch"
  "git rev-parse origin/main"
  "git tag v0.5.0 deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  "git push origin v0.5.0"
)
ok=1
for s in "${expect[@]}"; do
  case "$seq" in *"$s"*) :;; *) ok=0; echo "missing: $s" >&2;; esac
done
out=$(cat "$out_file")
for kv in \
  "release_tag=v0.5.0" \
  "release_version=0.5.0" \
  "release_name=AuroWork v0.5.0" \
  "release_sha=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; do
  echo "$out" | grep -qxF "$kv" || { ok=0; echo "missing output: $kv" >&2; }
done
if [ "$rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
  pass "happy path sequence + outputs"
else
  fail "happy path: rc=$rc"
fi
rm -rf "$tmp"

# --- T3: "no checks reported" is tolerated and merge+tag still run ---
tmp=$(mktemp -d); log="$tmp/calls.log"; out_file="$tmp/output"; : > "$log"; : > "$out_file"
make_shims "$tmp" "$log" no_checks
PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG=v0.5.0 GH_TOKEN=x \
  GITHUB_OUTPUT="$out_file" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr merge chore/release-v0.5.0 --squash --admin"*"git push origin v0.5.0"*)
    [ "$rc" -eq 0 ] && pass "no-checks tolerated" || fail "no-checks rc=$rc";;
  *) fail "no-checks: merge or tag-push not reached";;
esac
rm -rf "$tmp"

# --- T4: real check failure aborts before merge AND before tag ---
tmp=$(mktemp -d); log="$tmp/calls.log"; out_file="$tmp/output"; : > "$log"; : > "$out_file"
make_shims "$tmp" "$log" checks_fail
PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG=v0.5.0 GH_TOKEN=x \
  GITHUB_OUTPUT="$out_file" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr merge "*)        fail "checks_fail: merge should NOT run";;
  *"git tag v0.5.0"*)      fail "checks_fail: tag should NOT run";;
  *"gh pr checks "*"--watch"*)
    [ "$rc" -ne 0 ] && pass "real check failure aborts" || fail "checks_fail rc=$rc";;
  *) fail "checks_fail: watch was not invoked";;
esac
rm -rf "$tmp"

# --- T5: rebase conflict aborts before push (and before everything later) ---
tmp=$(mktemp -d); log="$tmp/calls.log"; out_file="$tmp/output"; : > "$log"; : > "$out_file"
make_shims "$tmp" "$log" rebase_conflict
PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG=v0.5.0 GH_TOKEN=x \
  GITHUB_OUTPUT="$out_file" bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"git push origin chore/release-"*) fail "rebase_conflict: push should NOT run";;
  *"git rebase origin/main"*)
    [ "$rc" -ne 0 ] && pass "rebase conflict aborts" || fail "rebase_conflict rc=$rc";;
  *) fail "rebase_conflict: rebase was not invoked";;
esac
rm -rf "$tmp"

# --- T6: tag-push failure (after merge) is retried once, then dies with operator guidance ---
tmp=$(mktemp -d); log="$tmp/calls.log"; out_file="$tmp/output"; : > "$log"; : > "$out_file"
make_shims "$tmp" "$log" tag_push_fail
out_text=$(PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG=v0.5.0 GH_TOKEN=x \
  GITHUB_OUTPUT="$out_file" bash "$SCRIPT" 2>&1); rc=$?
# Two attempts at `git push origin v0.5.0`.
count=$(grep -c "^git push origin v0.5.0$" "$log" || true)
if [ "$rc" -ne 0 ] \
   && [ "$count" -eq 2 ] \
   && echo "$out_text" | grep -q "::error::merged v0.5.0 as deadbeef" \
   && echo "$out_text" | grep -q "push manually: git push origin v0.5.0"; then
  pass "tag-push retried once, then dies with guidance"
else
  fail "tag_push_fail: rc=$rc count=$count out=$out_text"
fi
rm -rf "$tmp"

# --- T7: missing NEW_VER aborts ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
out=$(PATH="$tmp:$PATH" NEW_VER= NEW_TAG=v0.5.0 GH_TOKEN=x bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "NEW_VER required"; then
  pass "missing NEW_VER aborts"
else
  fail "missing NEW_VER: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T8: missing NEW_TAG aborts ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
out=$(PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG= GH_TOKEN=x bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "NEW_TAG required"; then
  pass "missing NEW_TAG aborts"
else
  fail "missing NEW_TAG: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T9: missing GH_TOKEN aborts ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
out=$(PATH="$tmp:$PATH" NEW_VER=0.5.0 NEW_TAG=v0.5.0 GH_TOKEN= bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GH_TOKEN required"; then
  pass "missing GH_TOKEN aborts"
else
  fail "missing GH_TOKEN: rc=$rc out=$out"
fi
rm -rf "$tmp"

exit $FAIL
```

- [ ] **Step 2: Make the test executable and run it (expect FAIL — script doesn't exist yet)**

```bash
chmod +x scripts/release/test-open-merge-release-pr.sh
bash scripts/release/test-open-merge-release-pr.sh
```
Expected: `FAIL: script not executable` (and subsequent failures). Exit non-zero. This is the failing baseline.

- [ ] **Step 3: Write `scripts/release/open-merge-release-pr.sh`**

Create the script:

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
```

- [ ] **Step 4: Make the script executable**

```bash
chmod +x scripts/release/open-merge-release-pr.sh
```

- [ ] **Step 5: Syntax-check**

```bash
bash -n scripts/release/open-merge-release-pr.sh
```
Expected: exits 0.

- [ ] **Step 6: Run the test suite — every case must pass**

```bash
bash scripts/release/test-open-merge-release-pr.sh
```
Expected: nine `PASS:` lines (T1 through T9), exit 0.

If T6 (`tag-push retried once, then dies with guidance`) is flaky because of the `sleep 3`, that's expected — the test waits ~3s on that one case.

- [ ] **Step 7: Confirm the auro-pr test suite still passes (no regression from shared lib)**

```bash
bash scripts/publish/test-open-merge-auro-pr.sh
```
Expected: identical to Task 3 Step 5 baseline.

- [ ] **Step 8: Commit**

```bash
git add scripts/release/open-merge-release-pr.sh scripts/release/test-open-merge-release-pr.sh
git commit -m "feat(scripts/release): add open-merge-release-pr.sh + tests"
```

---

**End of Task 4.**

## Task 5: Refactor `.github/workflows/build-desktop.yml`

**Files:**
- Modify: `.github/workflows/build-desktop.yml`

The workflow has three jobs: `prepare`, `create-release`, `build`. All three need the App token from `setup-auro-git`; `prepare` additionally restructures its bump step to call the new release script.

- [ ] **Step 1: Read the current workflow to anchor the edits**

```bash
sed -n '1,40p' .github/workflows/build-desktop.yml
```
This is for context only — no changes yet.

- [ ] **Step 2: Edit the `prepare` job — drop `RELEASE_PUSH_TOKEN` from checkout**

Find this block (around lines 42–47):

```yaml
      - name: Checkout (full history + tags)
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          token: ${{ secrets.RELEASE_PUSH_TOKEN || github.token }}
```

Replace with:

```yaml
      - name: Checkout (full history + tags)
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
```

(`setup-auro-git` rewrites `origin` to use the App token after checkout, so the checkout-time token only needs read access — the default `github.token` is sufficient.)

- [ ] **Step 3: Replace the inline `Configure git identity` step with `Setup Auro Git`**

Find the `Configure git identity` step (around lines 59–64):

```yaml
      - name: Configure git identity
        shell: bash
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

Replace with:

```yaml
      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}
```

- [ ] **Step 4: Replace the `Bump, commit, tag, push` step with the PR-based flow**

Find the entire `Bump, commit, tag, push` step (`id: bump`, approximately lines 65–152, ending with the closing `} >> "$GITHUB_OUTPUT"` and a blank line before `Forward prerelease flag`).

Replace the entire step with:

```yaml
      - name: Bump on PR branch, merge, tag
        id: bump
        shell: bash
        env:
          BUMP_TYPE: ${{ inputs.bump }}
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
          ACTOR: ${{ github.actor }}
        run: |
          set -euo pipefail

          # Sanity: must be on a branch (refs/heads/*) — refuse to run on a tag/PR.
          if [[ "${GITHUB_REF}" != refs/heads/* ]]; then
            echo "::error::This workflow must be dispatched from a branch (got: ${GITHUB_REF})."
            exit 1
          fi
          BRANCH="${GITHUB_REF#refs/heads/}"
          echo "Branch: $BRANCH"

          # bump-version.mjs has no runtime deps, but `pnpm bump:<type>` resolves
          # the script through pnpm's workspace filter, which needs the package
          # graph. Do NOT use --frozen-lockfile here: this job's whole purpose
          # is to mutate the lockfile, and main may already carry a lockfile
          # that's out of sync (e.g. left over from a failed previous run).
          pnpm install --no-frozen-lockfile --prefer-offline

          # Read current version BEFORE bumping.
          CUR_VER="$(node -p "require('./apps/app/package.json').version")"
          echo "Current version: $CUR_VER"

          # Run the bump script. It mutates 7 files in-place.
          pnpm bump:"$BUMP_TYPE"

          NEW_VER="$(node -p "require('./apps/app/package.json').version")"
          NEW_TAG="v${NEW_VER}"
          echo "New version: $NEW_VER"
          echo "New tag:     $NEW_TAG"

          # bump-version.mjs updates apps/orchestrator/package.json's
          # `aurowork-server` workspace dependency to the new version, which
          # invalidates pnpm-lock.yaml. Refresh the lockfile so the downstream
          # `pnpm install --frozen-lockfile` in the build job succeeds.
          pnpm install --lockfile-only

          # Guard 1: new version must differ from old.
          if [ "$CUR_VER" = "$NEW_VER" ]; then
            echo "::error::Bump produced the same version ($CUR_VER). Aborting."
            exit 1
          fi

          # Guard 2: new tag must not already exist on remote.
          if git ls-remote --tags origin "refs/tags/${NEW_TAG}" | grep -q .; then
            echo "::error::Tag ${NEW_TAG} already exists on origin. Aborting."
            exit 1
          fi

          # Guard 3: new version must be strictly greater than the largest existing v* tag.
          LARGEST="$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)"
          if [ -n "$LARGEST" ]; then
            HIGHEST="$(printf '%s\n%s\n' "$LARGEST" "$NEW_TAG" | sort -V | tail -n1)"
            if [ "$HIGHEST" != "$NEW_TAG" ] || [ "$LARGEST" = "$NEW_TAG" ]; then
              echo "::error::New tag ${NEW_TAG} is not strictly greater than existing ${LARGEST}."
              exit 1
            fi
          fi

          # Stage everything bump-version.mjs touched. The release script will
          # commit them on the PR branch.
          git add -A
          if git diff --cached --quiet; then
            echo "::error::No changes to commit after bump — bump-version.mjs did nothing."
            exit 1
          fi

          # Hand off: branch + commit + push + open PR + watch checks +
          # admin-squash-merge + tag merge SHA + push tag + emit outputs.
          BASE_BRANCH="$BRANCH" \
          NEW_VER="$NEW_VER" \
          NEW_TAG="$NEW_TAG" \
            bash scripts/release/open-merge-release-pr.sh
```

(`ACTOR` and `GH_TOKEN` come from the step `env:` block; `BASE_BRANCH`, `NEW_VER`, `NEW_TAG` are exported inline at hand-off.)

The `Forward prerelease flag` step immediately below is unchanged.

- [ ] **Step 5: Edit the `create-release` job — add `setup-auro-git`, switch token**

Find the `create-release` job (around lines 163–199). It currently has a single step:

```yaml
  create-release:
    name: Create Release
    needs: prepare
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          ...
```

Replace the `steps:` body with a checkout + setup-auro-git + the release step using the App token:

```yaml
  create-release:
    name: Create Release
    needs: prepare
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.release_sha }}

      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
        shell: bash
        run: |
          set -euo pipefail

          TAG="${{ needs.prepare.outputs.release_tag }}"
          NAME="${{ needs.prepare.outputs.release_name }}"
          TARGET_SHA="${{ needs.prepare.outputs.release_sha }}"

          echo "Release tag:    $TAG"
          echo "Release name:   $NAME"
          echo "Target commit:  $TARGET_SHA"

          # Check if release already exists (e.g. previous run partially succeeded)
          if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            echo "Release $TAG already exists — skipping."
            exit 0
          fi

          flags=()
          if [ "${{ needs.prepare.outputs.prerelease }}" = "true" ]; then
            flags+=( --prerelease )
          fi

          gh release create "$TAG" \
            --repo "$GITHUB_REPOSITORY" \
            --title "$NAME" \
            --notes "Desktop build for $TAG" \
            --target "$TARGET_SHA" \
            "${flags[@]}"
```

The checkout is needed so the `uses: ./.github/actions/setup-auro-git` reference can resolve a local action.

- [ ] **Step 6: Edit the `build` job — add `setup-auro-git`, switch all release tokens**

In the `build` job, immediately after the existing `Checkout bumped commit` and `Enable long paths` steps (around line 236), insert a `Setup Auro Git` step **before** the toolchain setup so its token is available to every later step that uploads to the release:

```yaml
      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}
```

Then swap two token references later in the same job:

**6a.** In the `Build + publish to release` step (around lines 365–380), change:

```yaml
        env:
          CI: true
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

to:

```yaml
        env:
          CI: true
          GITHUB_TOKEN: ${{ steps.gitsetup.outputs.token }}
```

**6b.** In the `Upload signature + latest.json` step (around lines 385–425), change:

```yaml
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

to:

```yaml
        env:
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
```

No other changes in `build`.

- [ ] **Step 7: Confirm the file still parses as YAML**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-desktop.yml')); print('ok')"
```
Expected: `ok`.

(If `actionlint` is available locally, run it too — it will catch more issues than `yaml.safe_load`. `actionlint` is optional.)

- [ ] **Step 8: Grep for stragglers — `RELEASE_PUSH_TOKEN` should be gone from this workflow**

```bash
grep -n "RELEASE_PUSH_TOKEN" .github/workflows/build-desktop.yml || echo "clean"
```
Expected: `clean`.

- [ ] **Step 9: Grep for stragglers — every `gh`/`git push` in this workflow now uses the App token**

```bash
grep -n -E "github\.token|secrets\.GITHUB_TOKEN" .github/workflows/build-desktop.yml || echo "clean"
```
Expected: `clean`. Every release-side token reference should now be `${{ steps.gitsetup.outputs.token }}` (in `prepare`, `create-release`, `build`).

If `grep` reports a match inside the `actions/checkout@v4` of `prepare` (we left that one as the default), that's fine — checkout's implicit `github.token` doesn't need to be explicit. But you should NOT see any explicit `github.token` or `secrets.GITHUB_TOKEN` reference in your edits.

- [ ] **Step 10: Diff the workflow against `main` and walk through it**

```bash
git diff --stat .github/workflows/build-desktop.yml
git diff .github/workflows/build-desktop.yml | head -200
```

Verify, against the spec:
- `prepare`: `Setup Auro Git` step appears, inline `git config` step is gone, `Bump…` step now ends in `bash scripts/release/open-merge-release-pr.sh` instead of inline `git commit / git tag / git push`.
- `create-release`: has `Checkout` + `Setup Auro Git` + `Create GitHub Release` (token from `gitsetup`).
- `build`: `Setup Auro Git` appears after `Enable long paths`; the tauri-action env's `GITHUB_TOKEN` and the upload step's `GH_TOKEN` both reference `steps.gitsetup.outputs.token`.

- [ ] **Step 11: Commit**

```bash
git add .github/workflows/build-desktop.yml
git commit -m "ci(build-desktop): PR-based version bump via setup-auro-git"
```

---

## Post-implementation verification

After all five tasks land, before merging:

- [ ] **Final tree state**

```bash
ls scripts/common/ scripts/release/
```
Expected:
```
scripts/common/:
open-merge-pr-common.sh
test-open-merge-pr-common.sh

scripts/release/:
generate-latest-json.mjs        (preexisting)
open-merge-release-pr.sh
test-open-merge-release-pr.sh
```

- [ ] **All test suites green**

```bash
bash scripts/common/test-open-merge-pr-common.sh \
  && bash scripts/publish/test-open-merge-auro-pr.sh \
  && bash scripts/release/test-open-merge-release-pr.sh \
  && echo "ALL GREEN"
```
Expected: `ALL GREEN`.

- [ ] **Workflow parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-desktop.yml')); print('ok')"
```
Expected: `ok`.

- [ ] **Repo secrets/vars sanity** (manual, in GitHub UI before first dispatch)

Confirm:
- Repository variable `AURO_APP_ID` is set.
- Repository secret `AURO_APP_KEY` is set.
- The GitHub App has `contents: write` and `pull-requests: write` permissions, plus repo access for `aurowork`, plus ruleset-bypass for protected branch `main` (so `gh pr merge --admin` works).
- `RELEASE_PUSH_TOKEN` is no longer required by this workflow (can be left in place but is unused).

- [ ] **First end-to-end run** (after merging the PR for this implementation)

Dispatch `Build Desktop` with `bump=patch`, `prerelease=true`, from a low-traffic branch. Confirm in the run logs that:
1. `prepare` opens a PR titled `chore: release vX.Y.Z`, watches checks, admin-merges it.
2. The tag `vX.Y.Z` appears on `main` pointing at the squashed merge commit.
3. `create-release` creates the release object targeting the same SHA.
4. `build` produces the MSI, signature, and `latest.json`, all uploaded under the same tag.

If any step fails, the failure-mode table in the spec tells you which side-effects to clean up manually.

---

**End of plan.**
