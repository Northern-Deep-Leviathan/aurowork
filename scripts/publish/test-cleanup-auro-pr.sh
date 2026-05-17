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
