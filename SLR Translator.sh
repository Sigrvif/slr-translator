#!/bin/bash
# SLR Translator 3 - Linux launcher
# Keeps the package portable: uses the bundled NW.js, PHP and (optional) Ruby,
# never the system interpreters. All runtime libraries are loaded from ./lib.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Bundled shared libraries (NW.js libs + libonig for PHP's mbstring).
export LD_LIBRARY_PATH="$SCRIPT_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Tell the bundled PHP where its php.ini lives (the ./php directory).
export PHPRC="$SCRIPT_DIR/php"

# A writable temp dir. The app (and PHP via $_SERVER['TMP']) reads $TMP/$TEMP.
export TMPDIR="${TMPDIR:-/tmp}"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"

# Keep the browser's crash-dump folder inside the app folder too. NW.js derives
# it from the XDG config home (~/.config) and ignores --user-data-dir for it.
export XDG_CONFIG_HOME="$SCRIPT_DIR/data/profile"

# Run from the app directory so every relative path (./www, ./data, ...) resolves.
cd "$SCRIPT_DIR" || exit 1

exec "$SCRIPT_DIR/nw" "$@"
