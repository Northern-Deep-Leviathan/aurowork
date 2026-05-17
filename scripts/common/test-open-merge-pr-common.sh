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
