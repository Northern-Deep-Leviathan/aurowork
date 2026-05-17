# build-desktop.yml PR-based bump + setup-auro-git — Implementation Plan (Part 2 of 3)

> Continuation of `2026-05-17-build-desktop-pr-bump-part-1.md`. See Part 1 for goal, architecture, and file structure.

**Tasks in this part:**
- Task 3: Refactor `scripts/publish/open-merge-auro-pr.sh` to source the shared library (behavior preserved).
- Task 4: Create `scripts/release/open-merge-release-pr.sh` + tests.

---

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

**End of Part 2.** Continue with Part 3 (Task 5: workflow refactor) in the next file.
