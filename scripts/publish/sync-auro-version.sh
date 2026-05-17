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
