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
