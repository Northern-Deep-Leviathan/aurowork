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

exit $FAIL
