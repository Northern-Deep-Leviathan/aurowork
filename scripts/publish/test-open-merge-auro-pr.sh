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
