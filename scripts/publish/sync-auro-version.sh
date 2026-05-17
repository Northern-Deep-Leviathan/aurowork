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
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONSTANTS_FILE="${CONSTANTS_FILE:-$REPO_ROOT/constants.json}"
VERSION="${VERSION:-}"

die() { echo "error: $*" >&2; exit 1; }

# --- dependency + token checks ---
[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is required (PAT with read access to $AURO_REPO releases)"

for bin in gh jq; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required (install with your package manager)"
done

# --- (tag resolution + file mutation added in later tasks) ---
die "not yet implemented"
