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
