#!/usr/bin/env bash
#
# dev/pack-release.sh — build the two SLR Translator release archives.
#
# Runs from either app tree on the dev pod (the sibling tree is found by
# name). Steps:
#   1. read the version from package.json and require both trees to agree
#   2. sync-check the shared source (www/, excluding node_modules)
#   3. pack both trees with 7za, excluding .git and vendor-source
#
# The archives land next to the app trees, named after the tree folders:
#   "SLR Translator v<version>.7z" and "SLR Translator Linux v<version>.7z"
#
# Note: THIRD-PARTY-NOTICES.html is not re-generated here — run
# `node dev/generate-third-party-notices.js` first if bundled components
# changed.

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OTHER="$(dirname "$HERE")/$( [ "$(basename "$HERE")" = "SLR Translator Linux" ] && echo "SLR Translator" || echo "SLR Translator Linux" )"
OUT="$(dirname "$HERE")"

version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" | head -1; }

V="$(version_of "$HERE/package.json")"
if [ -z "$V" ]; then
    echo "ERROR: cannot read version from $HERE/package.json" >&2
    exit 1
fi
V2="$(version_of "$OTHER/package.json")"
if [ "$V" != "$V2" ]; then
    echo "ERROR: version mismatch between the trees: '$V' vs '$V2'" >&2
    exit 1
fi
for f in "$HERE/package.json" "$OTHER/package.json"; do
    [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 1; }
done

echo "== v$V: sync check (www/, excluding node_modules) =="
SYNC="$(mktemp)"
trap 'rm -f "$SYNC"' EXIT
# mosaicRemover is a local-only unfinished project (see NEVER_SHIP below)
if ! diff -rq --exclude=node_modules --exclude=mosaicRemover "$HERE/www" "$OTHER/www" >"$SYNC" 2>&1; then
    echo "ERROR: www/ differs between the trees — fix the sync before packing:" >&2
    cat "$SYNC" >&2
    exit 1
fi
echo "   clean"

# Runtime state and local-only content NEVER ship. The app recreates
# data/logs, data/profile and the llama model/slot dirs on first boot;
# data/config.json is the user's live configuration; www/addons/mosaicRemover
# is an unfinished local project; data/adp.txt is a local scratch file.
NEVER_SHIP=(
    -xr!.git -xr!vendor-source
    -xr!data/config.json -xr!data/logs -xr!data/profile
    -xr!data/llama/models -xr!data/llama/slots
    -xr!data/adp.txt
    -xr!www/addons/mosaicRemover
)

pack() { # pack <src-dir>
    local src="$1" arch
    arch="$OUT/$(basename "$src") v$V.7z"
    rm -f "$arch"
    7za a -t7z -mx=9 "$arch" "$src" "${NEVER_SHIP[@]}" >/dev/null
    printf '   %s  (%s bytes)\n' "$(basename "$arch")" "$(stat -c%s "$arch")"
}

echo "== packing =="
pack "$OTHER"
pack "$HERE"
echo "done."
