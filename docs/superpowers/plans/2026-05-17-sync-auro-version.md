# Sync Auro Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a manually-triggered GitHub Actions workflow that bumps `constants.json#auroVersion` to either a user-supplied or auto-selected `Northern-Deep-Leviathan/auro` release, then opens & admin-merges a PR — with logic factored into three shell scripts under `scripts/publish/`.

**Architecture:** Three shell scripts, one workflow YAML.
- `scripts/publish/sync-auro-version.sh` — resolves the target tag via `gh api` and rewrites `constants.json` with `jq`. No git side effects.
- `scripts/publish/open-merge-auro-pr.sh` — branches, commits, rebases, pushes, `gh pr create`, `gh pr checks --watch`, `gh pr merge --squash --admin --delete-branch`. Mirrors `auro/script/publish-release-cli.ts`.
- `scripts/publish/cleanup-auro-pr.sh` — best-effort close-PR / delete-branch on failure.
- `.github/workflows/sync-auro-version.yml` — `workflow_dispatch` orchestrator wiring env vars to the scripts.

**Tech Stack:** bash, `gh` CLI, `jq`, GitHub Actions (`ubuntu-latest`), `actions/checkout@v4`. No third-party actions.

**Spec:** `docs/superpowers/specs/2026-05-15-sync-auro-version-design.md`.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/publish/sync-auro-version.sh` | Create | Resolve auro tag (`/releases/latest` or `/releases/tags/<v>`), validate published, rewrite `constants.json`, emit `version=`/`changed=` outputs. |
| `scripts/publish/open-merge-auro-pr.sh` | Create | Branch + commit + rebase + push + `gh pr create` + watch checks + admin-merge. |
| `scripts/publish/cleanup-auro-pr.sh` | Create | Best-effort PR close + branch delete (called on workflow failure). |
| `scripts/publish/test-sync-auro-version.sh` | Create | Self-contained bats-free shell tests covering tag resolution, no-op path, jq mutation, error paths. |
| `.github/workflows/sync-auro-version.yml` | Modify | Replace single-line stub with full workflow that calls the three scripts. |
| `constants.json` | Touched at runtime only | Not edited by this plan; only edited by the script when the workflow runs. |

**Required repo secrets (set out-of-band, not by this plan):**
- `AURO_RELEASES_TOKEN` — PAT with read access to `Northern-Deep-Leviathan/auro` releases.
- `AURO_SYNC_TOKEN` — PAT/App token with `contents: write` + `pull-requests: write` + ruleset bypass on this repo.

---

## Task 1: `sync-auro-version.sh` — skeleton & dependency checks

**Files:**
- Create: `scripts/publish/sync-auro-version.sh`
- Test:   `scripts/publish/test-sync-auro-version.sh`

- [ ] **Step 1: Write the failing test (deps check)**

Create `scripts/publish/test-sync-auro-version.sh`:

```bash
#!/usr/bin/env bash
# Tiny test harness for sync-auro-version.sh. Each test prints PASS/FAIL.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/sync-auro-version.sh"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# --- T1: script exists and is executable ---
if [ -x "$SCRIPT" ]; then pass "script is executable"; else fail "script not executable"; fi

# --- T2: missing GH_TOKEN aborts with clear message ---
out=$(GH_TOKEN= VERSION= bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GH_TOKEN is required"; then
  pass "missing GH_TOKEN aborts"
else
  fail "missing GH_TOKEN: rc=$rc out=$out"
fi

exit $FAIL
```

Make it executable: `chmod +x scripts/publish/test-sync-auro-version.sh`.

- [ ] **Step 2: Run test, expect FAIL**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected: `FAIL: script not executable` (and subsequent tests fail because the script doesn't exist).

- [ ] **Step 3: Create the script skeleton**

Create `scripts/publish/sync-auro-version.sh`:

```bash
#!/usr/bin/env bash
# Resolve a Northern-Deep-Leviathan/auro release tag and update
# constants.json#auroVersion. Side-effect-free w.r.t. git.
#
# Env:
#   VERSION         optional auro tag (e.g. v0.2.0). Empty = use /releases/latest.
#   AURO_REPO       default Northern-Deep-Leviathan/auro
#   CONSTANTS_FILE  default constants.json
#   GH_TOKEN        required: PAT with read access to AURO_REPO releases
#
# Outputs (when $GITHUB_OUTPUT set, otherwise stdout):
#   version=<tag>
#   changed=true|false
set -euo pipefail

AURO_REPO="${AURO_REPO:-Northern-Deep-Leviathan/auro}"
CONSTANTS_FILE="${CONSTANTS_FILE:-constants.json}"
VERSION="${VERSION:-}"

die() { echo "error: $*" >&2; exit 1; }

# --- dependency + token checks ---
for bin in gh jq; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required (install with your package manager)"
done
[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is required (PAT with read access to $AURO_REPO releases)"

# --- (tag resolution + file mutation added in later tasks) ---
die "not yet implemented"
```

Make it executable: `chmod +x scripts/publish/sync-auro-version.sh`.

- [ ] **Step 4: Run test, expect T1 + T2 PASS**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected:
```
PASS: script is executable
PASS: missing GH_TOKEN aborts
```
Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish/sync-auro-version.sh scripts/publish/test-sync-auro-version.sh
git commit -m "feat(publish): skeleton sync-auro-version script + harness"
```

---

## Task 2: `sync-auro-version.sh` — tag resolution

**Files:**
- Modify: `scripts/publish/sync-auro-version.sh`
- Modify: `scripts/publish/test-sync-auro-version.sh`

We stub `gh` via a `PATH` shim so tests don't hit the network.

- [ ] **Step 1: Add failing tests for tag resolution**

Append to `scripts/publish/test-sync-auro-version.sh` **before** `exit $FAIL`:

```bash
# --- gh shim helper ---
make_gh_shim() {
  # Usage: make_gh_shim <tmpdir> <mode>
  # modes: latest_ok | latest_404 | tag_published | tag_draft | tag_404
  local dir="$1" mode="$2"
  mkdir -p "$dir"
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
mode="$mode"
case "\$mode:\$*" in
  latest_ok:"api repos/"*"/releases/latest")
    echo '{"tag_name":"v9.9.9","draft":false}'; exit 0;;
  latest_404:"api repos/"*"/releases/latest")
    echo 'gh: not found' >&2; exit 1;;
  tag_published:"api repos/"*"/releases/tags/"*)
    echo '{"tag_name":"v1.2.3","draft":false}'; exit 0;;
  tag_draft:"api repos/"*"/releases/tags/"*)
    echo '{"tag_name":"v1.2.3","draft":true}'; exit 0;;
  tag_404:"api repos/"*"/releases/tags/"*)
    echo 'gh: not found' >&2; exit 1;;
  *) echo "unstubbed gh call: \$*" >&2; exit 99;;
esac
EOF
  chmod +x "$dir/gh"
}

# --- T3: VERSION empty + /releases/latest 200 -> picks tag_name ---
tmp=$(mktemp -d); make_gh_shim "$tmp" latest_ok
echo '{"auroVersion":"v0.0.0"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION= CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "version=v9.9.9"; then
  pass "auto: /releases/latest tag picked"
else
  fail "auto: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T4: VERSION empty + /releases/latest 404 -> exits 1 with message ---
tmp=$(mktemp -d); make_gh_shim "$tmp" latest_404
echo '{"auroVersion":"v0.0.0"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION= CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "no published releases found"; then
  pass "auto: 404 -> clear error"
else
  fail "auto 404: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T5: VERSION set + published -> picks supplied tag ---
tmp=$(mktemp -d); make_gh_shim "$tmp" tag_published
echo '{"auroVersion":"v0.0.0"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION=v1.2.3 CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "version=v1.2.3"; then
  pass "explicit: published tag accepted"
else
  fail "explicit published: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T6: VERSION set + draft -> exits 1 ---
tmp=$(mktemp -d); make_gh_shim "$tmp" tag_draft
echo '{"auroVersion":"v0.0.0"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION=v1.2.3 CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q 'not a published release'; then
  pass "explicit: draft rejected"
else
  fail "explicit draft: rc=$rc out=$out"
fi
rm -rf "$tmp"

# --- T7: VERSION set + missing -> exits 1 ---
tmp=$(mktemp -d); make_gh_shim "$tmp" tag_404
echo '{"auroVersion":"v0.0.0"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION=v9.9.9 CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q 'not a published release'; then
  pass "explicit: missing tag rejected"
else
  fail "explicit 404: rc=$rc out=$out"
fi
rm -rf "$tmp"
```

- [ ] **Step 2: Run tests, expect T3–T7 FAIL**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected: T1/T2 pass, T3–T7 fail (script still says "not yet implemented").

- [ ] **Step 3: Implement tag resolution**

In `scripts/publish/sync-auro-version.sh`, replace the trailing `die "not yet implemented"` with:

```bash
# --- resolve target tag ---
if [ -n "$VERSION" ]; then
  # Validate the supplied tag is a published (non-draft) release.
  if ! payload=$(gh api "repos/$AURO_REPO/releases/tags/$VERSION" 2>/dev/null); then
    die "tag \"$VERSION\" is not a published release of $AURO_REPO"
  fi
  is_draft=$(printf '%s' "$payload" | jq -r '.draft')
  if [ "$is_draft" != "false" ]; then
    die "tag \"$VERSION\" is not a published release of $AURO_REPO"
  fi
  target="$VERSION"
else
  # /releases/latest already excludes drafts and pre-releases.
  if ! payload=$(gh api "repos/$AURO_REPO/releases/latest" 2>/dev/null); then
    die "no published releases found in $AURO_REPO"
  fi
  target=$(printf '%s' "$payload" | jq -r '.tag_name')
  [ -n "$target" ] && [ "$target" != "null" ] || die "no published releases found in $AURO_REPO"
fi

# --- file mutation added in Task 3 ---
emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  else
    printf '%s\n' "$1"
  fi
}
emit "version=$target"
emit "changed=false"   # placeholder; Task 3 computes the real value
```

- [ ] **Step 4: Run tests, expect T1–T7 PASS**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected: all seven `PASS:` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish/sync-auro-version.sh scripts/publish/test-sync-auro-version.sh
git commit -m "feat(publish): resolve auro target tag via gh api"
```

---

## Task 3: `sync-auro-version.sh` — no-op + write update

**Files:**
- Modify: `scripts/publish/sync-auro-version.sh`
- Modify: `scripts/publish/test-sync-auro-version.sh`

- [ ] **Step 1: Add failing tests for no-op + write paths**

Append to `scripts/publish/test-sync-auro-version.sh` before `exit $FAIL`:

```bash
# --- T8: no-op when current == target ---
tmp=$(mktemp -d); make_gh_shim "$tmp" latest_ok
echo '{"auroVersion":"v9.9.9"}' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION= CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
after=$(cat "$tmp/constants.json")
if [ "$rc" -eq 0 ] \
   && echo "$out" | grep -q "changed=false" \
   && echo "$out" | grep -q "version=v9.9.9" \
   && [ "$after" = '{"auroVersion":"v9.9.9"}' ]; then
  pass "no-op: file untouched, changed=false"
else
  fail "no-op: rc=$rc out=$out file=$after"
fi
rm -rf "$tmp"

# --- T9: write update when current != target ---
tmp=$(mktemp -d); make_gh_shim "$tmp" latest_ok
printf '{\n  "auroVersion": "v0.0.0"\n}\n' > "$tmp/constants.json"
out=$(PATH="$tmp:$PATH" GH_TOKEN=x VERSION= CONSTANTS_FILE="$tmp/constants.json" bash "$SCRIPT" 2>&1); rc=$?
new_ver=$(jq -r '.auroVersion' "$tmp/constants.json")
if [ "$rc" -eq 0 ] \
   && echo "$out" | grep -q "changed=true" \
   && echo "$out" | grep -q "version=v9.9.9" \
   && [ "$new_ver" = "v9.9.9" ]; then
  pass "update: file rewritten, changed=true"
else
  fail "update: rc=$rc out=$out new_ver=$new_ver"
fi
# trailing newline preserved
tail -c1 "$tmp/constants.json" | od -An -c | grep -q '\\n' \
  && pass "update: trailing newline preserved" \
  || fail "update: trailing newline missing"
rm -rf "$tmp"
```

- [ ] **Step 2: Run tests, expect T8/T9 FAIL**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected: T1–T7 pass; T8 fails (`changed=false` is hard-coded so the no-op text is right but the file-untouched check will pass — verify it does); T9 fails (file is not rewritten).

If T8 actually passes by accident, that's fine — keep going to make T9 pass.

- [ ] **Step 3: Implement no-op + write**

In `scripts/publish/sync-auro-version.sh`, replace the `emit "version=$target"` / `emit "changed=false"` block with:

```bash
# --- read current value ---
[ -f "$CONSTANTS_FILE" ] || die "$CONSTANTS_FILE not found"
current=$(jq -r '.auroVersion' "$CONSTANTS_FILE")
[ -n "$current" ] && [ "$current" != "null" ] || die "$CONSTANTS_FILE has no .auroVersion field"

emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  else
    printf '%s\n' "$1"
  fi
}

if [ "$current" = "$target" ]; then
  echo "auroVersion already at $target; nothing to do"
  emit "version=$target"
  emit "changed=false"
  exit 0
fi

# --- write update (preserves 2-space indent + trailing newline) ---
tmp_file=$(mktemp)
jq --indent 2 --arg v "$target" '.auroVersion = $v' "$CONSTANTS_FILE" > "$tmp_file"
mv "$tmp_file" "$CONSTANTS_FILE"

echo "auroVersion updated: $current -> $target"
emit "version=$target"
emit "changed=true"
```

- [ ] **Step 4: Run tests, expect all PASS**

Run: `bash scripts/publish/test-sync-auro-version.sh`
Expected: all ten `PASS:` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish/sync-auro-version.sh scripts/publish/test-sync-auro-version.sh
git commit -m "feat(publish): rewrite constants.json with jq + no-op detection"
```

---

## Task 4: Spec-compliance check against real `constants.json`

**Files:**
- Read-only: `constants.json`

- [ ] **Step 1: Smoke-test the script against the real file with a forced no-op**

```bash
# Force target = current so the script is a no-op and does NOT need network.
# We override the upstream call by pointing AURO_REPO at a bogus repo and
# pre-confirming the no-op via VERSION matching current value is not possible
# without network — instead we just confirm the script aborts cleanly when
# GH_TOKEN is unset on a real file.
GH_TOKEN= VERSION= bash scripts/publish/sync-auro-version.sh; echo "rc=$?"
```

Expected: prints `error: GH_TOKEN is required ...`, `rc=1`. Confirms the script does not touch `constants.json` when validation fails (verify with `git status` — clean).

- [ ] **Step 2: Verify `constants.json` is untouched**

Run: `git status --porcelain constants.json`
Expected: empty output.

- [ ] **Step 3: Commit (no-op if nothing changed)**

```bash
git status --porcelain  # should be empty; skip commit if so
```

If anything is dirty, investigate before proceeding.

---

(Plan continues in next chunk: Task 5 — `open-merge-auro-pr.sh`, Task 6 — `cleanup-auro-pr.sh`, Task 7 — workflow YAML, Task 8 — self-review & docs touch-ups.)

## Task 5: `open-merge-auro-pr.sh`

**Files:**
- Create: `scripts/publish/open-merge-auro-pr.sh`
- Create: `scripts/publish/test-open-merge-auro-pr.sh`

This script has heavy side effects (git push, `gh pr create`, `gh pr merge --admin`). We test it with `gh` + `git` shims that record commands to a log file, so we can assert the *sequence* of operations without touching a real remote.

- [ ] **Step 1: Write the failing test harness**

Create `scripts/publish/test-open-merge-auro-pr.sh`:

```bash
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/open-merge-auro-pr.sh"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

# --- T1: script exists and is executable ---
if [ -x "$SCRIPT" ]; then pass "script is executable"; else fail "script not executable"; fi

# --- shim factory: records every call to $log, success by default ---
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
      no_checks)    echo 'no checks reported' >&2; exit 1;;
      checks_fail)  echo 'some checks failed' >&2; exit 1;;
      *)            exit 0;;
    esac;;
  "git rebase origin/"*)
    [ "$mode" = "rebase_conflict" ] && exit 1; exit 0;;
  *) exit 0;;
esac
EOF
    chmod +x "$dir/$bin"
  done
}

# --- T2: happy path runs the expected gh/git sequence ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
PATH="$tmp:$PATH" \
  VERSION=v1.2.3 ACTOR=alice INPUT_VERSION=v1.2.3 GH_TOKEN=x \
  bash "$SCRIPT" >/dev/null 2>&1
rc=$?
seq=$(tr '\n' '|' < "$log")
expect_substrings=(
  "git checkout -b chore/sync-auro-v1.2.3"
  "git commit -am chore: sync auro to v1.2.3"
  "git fetch origin main"
  "git rebase origin/main"
  "git push origin chore/sync-auro-v1.2.3 --force-with-lease --no-verify"
  "gh pr create --base main --head chore/sync-auro-v1.2.3"
  "gh pr checks chore/sync-auro-v1.2.3 --watch"
  "gh pr merge chore/sync-auro-v1.2.3 --squash --admin --delete-branch"
)
ok=1
for s in "${expect_substrings[@]}"; do
  case "$seq" in *"$s"*) :;; *) ok=0; echo "missing in sequence: $s" >&2;; esac
done
if [ "$rc" -eq 0 ] && [ "$ok" -eq 1 ]; then pass "happy path sequence"; else fail "happy path: rc=$rc"; fi
rm -rf "$tmp"

# --- T3: "no checks reported" is tolerated ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" no_checks
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr merge chore/sync-auro-v1.2.3 --squash --admin"*)
    [ "$rc" -eq 0 ] && pass "no-checks tolerated" || fail "no-checks rc=$rc";;
  *) fail "no-checks: merge not reached";;
esac
rm -rf "$tmp"

# --- T4: real check failure aborts before merge ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" checks_fail
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr merge "*) fail "checks_fail: merge should NOT run";;
  *) [ "$rc" -ne 0 ] && pass "real check failure aborts" || fail "checks_fail rc=$rc";;
esac
rm -rf "$tmp"

# --- T5: rebase conflict aborts before push ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" rebase_conflict
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"git push origin"*) fail "rebase_conflict: push should NOT run";;
  *) [ "$rc" -ne 0 ] && pass "rebase conflict aborts" || fail "rebase_conflict rc=$rc";;
esac
rm -rf "$tmp"

# --- T6: missing VERSION aborts ---
tmp=$(mktemp -d); log="$tmp/calls.log"; : > "$log"
make_shims "$tmp" "$log" happy
out=$(PATH="$tmp:$PATH" VERSION= GH_TOKEN=x bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "VERSION is required"; then
  pass "missing VERSION aborts"
else
  fail "missing VERSION: rc=$rc out=$out"
fi
rm -rf "$tmp"

exit $FAIL
```

`chmod +x scripts/publish/test-open-merge-auro-pr.sh`.

- [ ] **Step 2: Run, expect FAIL**

Run: `bash scripts/publish/test-open-merge-auro-pr.sh`
Expected: `FAIL: script not executable` and downstream failures.

- [ ] **Step 3: Implement the script**

Create `scripts/publish/open-merge-auro-pr.sh`:

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
if ! gh pr checks "$branch" --watch 2> "$err_file"; then
  if grep -q "no checks reported" "$err_file"; then
    echo "no checks configured, proceeding"
  else
    cat "$err_file" >&2
    rm -f "$err_file"
    die "PR checks failed"
  fi
fi
rm -f "$err_file"

# 6. Merge via ruleset bypass.
gh pr merge "$branch" --squash --admin --delete-branch
```

`chmod +x scripts/publish/open-merge-auro-pr.sh`.

- [ ] **Step 4: Run, expect all PASS**

Run: `bash scripts/publish/test-open-merge-auro-pr.sh`
Expected: T1–T6 all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish/open-merge-auro-pr.sh scripts/publish/test-open-merge-auro-pr.sh
git commit -m "feat(publish): open & admin-merge auro sync PR via gh"
```

---

## Task 6: `cleanup-auro-pr.sh`

**Files:**
- Create: `scripts/publish/cleanup-auro-pr.sh`
- Create: `scripts/publish/test-cleanup-auro-pr.sh`

- [ ] **Step 1: Write failing tests**

Create `scripts/publish/test-cleanup-auro-pr.sh`:

```bash
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/cleanup-auro-pr.sh"
FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

if [ -x "$SCRIPT" ]; then pass "executable"; else fail "not executable"; fi

# Shim: gh returns "OPEN"/"CLOSED" or 1 if PR missing; git ls-remote returns ref or empty.
make_shims() {
  local dir="$1" log="$2" pr_state="$3" remote_has_branch="$4"
  mkdir -p "$dir"
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
echo "gh \$*" >> "$log"
case "\$*" in
  "pr view "*"--json state -q .state")
    [ "$pr_state" = "MISSING" ] && exit 1
    echo "$pr_state"; exit 0;;
  "pr close "*) exit 0;;
  *) exit 0;;
esac
EOF
  cat > "$dir/git" <<EOF
#!/usr/bin/env bash
echo "git \$*" >> "$log"
case "\$*" in
  "ls-remote --heads origin "*)
    [ "$remote_has_branch" = "yes" ] && echo "deadbeef refs/heads/foo"; exit 0;;
  *) exit 0;;
esac
EOF
  chmod +x "$dir/gh" "$dir/git"
}

# T2: open PR + remote branch -> close + delete
tmp=$(mktemp -d); log="$tmp/log"; : > "$log"
make_shims "$tmp" "$log" OPEN yes
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
ok=1
case "$seq" in *"gh pr close chore/sync-auro-v1.2.3"*) :;; *) ok=0;; esac
case "$seq" in *"git push origin --delete chore/sync-auro-v1.2.3 --no-verify"*) :;; *) ok=0;; esac
if [ "$rc" -eq 0 ] && [ "$ok" -eq 1 ]; then pass "open+remote: close & delete"; else fail "open+remote rc=$rc seq=$seq"; fi
rm -rf "$tmp"

# T3: closed PR + remote branch -> only delete (no close)
tmp=$(mktemp -d); log="$tmp/log"; : > "$log"
make_shims "$tmp" "$log" CLOSED yes
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
seq=$(tr '\n' '|' < "$log")
case "$seq" in
  *"gh pr close"*) fail "closed: should NOT call gh pr close";;
  *) case "$seq" in
       *"git push origin --delete"*) [ "$rc" -eq 0 ] && pass "closed: only delete branch" || fail "closed rc=$rc";;
       *) fail "closed: delete missing";;
     esac;;
esac
rm -rf "$tmp"

# T4: no PR + no remote -> still exits 0
tmp=$(mktemp -d); log="$tmp/log"; : > "$log"
make_shims "$tmp" "$log" MISSING no
PATH="$tmp:$PATH" VERSION=v1.2.3 GH_TOKEN=x bash "$SCRIPT" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && pass "no-op cleanup exits 0" || fail "no-op rc=$rc"
rm -rf "$tmp"

# T5: missing VERSION still exits 0 (best-effort) but logs error
tmp=$(mktemp -d); log="$tmp/log"; : > "$log"
make_shims "$tmp" "$log" OPEN yes
out=$(PATH="$tmp:$PATH" VERSION= GH_TOKEN=x bash "$SCRIPT" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "VERSION not set"; then
  pass "missing VERSION: warns, exits 0"
else
  fail "missing VERSION: rc=$rc out=$out"
fi
rm -rf "$tmp"

exit $FAIL
```

`chmod +x scripts/publish/test-cleanup-auro-pr.sh`.

- [ ] **Step 2: Run, expect FAIL**

Run: `bash scripts/publish/test-cleanup-auro-pr.sh`
Expected: `FAIL: not executable` and dependents fail.

- [ ] **Step 3: Implement**

Create `scripts/publish/cleanup-auro-pr.sh`:

```bash
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
```

`chmod +x scripts/publish/cleanup-auro-pr.sh`.

- [ ] **Step 4: Run, expect all PASS**

Run: `bash scripts/publish/test-cleanup-auro-pr.sh`
Expected: T1–T5 PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish/cleanup-auro-pr.sh scripts/publish/test-cleanup-auro-pr.sh
git commit -m "feat(publish): best-effort cleanup of failed auro sync PR"
```

---

## Task 7: Workflow YAML

**Files:**
- Modify: `.github/workflows/sync-auro-version.yml` (currently a single-line stub)

- [ ] **Step 1: Replace the stub with the full workflow**

Overwrite `.github/workflows/sync-auro-version.yml` with:

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
          # Read-only token for upstream release lookup so the bypass
          # token isn't sent to a foreign repo.
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

- [ ] **Step 2: Lint the YAML locally**

Run (if available): `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-auro-version.yml'))" && echo OK`
Expected: `OK`.

If `python` / PyYAML are not available, run `actionlint` or skip — the workflow will be validated on first dispatch.

- [ ] **Step 3: Sanity-check every `bash scripts/publish/*.sh` reference resolves to an executable file**

Run:
```bash
for f in scripts/publish/sync-auro-version.sh scripts/publish/open-merge-auro-pr.sh scripts/publish/cleanup-auro-pr.sh; do
  [ -x "$f" ] && echo "OK $f" || echo "MISSING $f"
done
```
Expected: three `OK` lines.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync-auro-version.yml
git commit -m "feat(ci): wire sync-auro-version workflow to publish scripts"
```

---

## Task 8: End-to-end test runner + final self-review

**Files:**
- Create: `scripts/publish/test-all.sh`

- [ ] **Step 1: Add an aggregate runner**

Create `scripts/publish/test-all.sh`:

```bash
#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
rc=0
for t in "$HERE"/test-*.sh; do
  [ "$t" = "$HERE/test-all.sh" ] && continue
  echo "=== $t ==="
  bash "$t" || rc=1
done
exit $rc
```

`chmod +x scripts/publish/test-all.sh`.

- [ ] **Step 2: Run the whole suite**

Run: `bash scripts/publish/test-all.sh`
Expected: every `PASS:` line for every test file; exit 0.

- [ ] **Step 3: Manual review pass**

Walk the spec section by section; verify each requirement maps to a task:

| Spec section | Where implemented |
|---|---|
| §1 `sync-auro-version.sh` flow steps 1–6 | Tasks 1–3 |
| §2 workflow YAML | Task 7 |
| §3 `open-merge-auro-pr.sh` | Task 5 |
| §4 `cleanup-auro-pr.sh` | Task 6 |
| Prerequisites (secrets) | Documented in plan header; configured out-of-band |
| Error handling table | Covered by test cases in Tasks 2, 3, 5, 6 |

If any row is missing, add a task before continuing.

- [ ] **Step 4: Commit the runner**

```bash
git add scripts/publish/test-all.sh
git commit -m "test(publish): aggregate runner for auro sync scripts"
```

- [ ] **Step 5: Open the integration PR for this branch**

(Outside the scope of the scripts themselves — this is how the work gets merged into the repo's default branch.)

```bash
git push -u origin HEAD
gh pr create --fill --label ci
```

Expected: PR opens; reviewers verify the workflow renders correctly in the Actions tab. **Do not dispatch the workflow from the PR branch in production until the two secrets are configured.**

---

## Self-Review Notes

- **Spec coverage:** all four components (§1–§4 of the spec) have dedicated tasks; the two repo secrets are documented in the File Map header.
- **Placeholders:** no TBD/TODO/"add validation" — every step shows actual code or actual commands.
- **Type/name consistency:**
  - branch name `chore/sync-auro-${VERSION}` is used identically in the open-merge script, the cleanup script, and the tests.
  - `gh pr merge ... --squash --admin --delete-branch` is the single merge invocation, matching the spec.
  - `gh pr checks ... --watch` + "no checks reported" tolerance appears once (Task 5) and is tested explicitly (T3 in `test-open-merge-auro-pr.sh`).
- **Test isolation:** every test creates its own `tmp` dir, writes its own `constants.json` / shims, and cleans up.
- **No hidden network calls:** all `gh`/`git` invocations in tests are routed through `$PATH` shims; no test requires the real `Northern-Deep-Leviathan/auro` to be reachable.
