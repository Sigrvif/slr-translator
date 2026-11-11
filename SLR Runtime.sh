#!/bin/bash
# SLR Runtime - serve the bundled local model in a console window, without opening
# SLR Translator. Uses the settings from the last start recorded by the editor
# (data/llama/laststart.json). Closing the window or Ctrl+C stops it.
#
# Launched from a terminal, the status prints right here. Launched from a desktop
# double-click there is no terminal to print to, so the launcher re-opens itself in
# the desktop's terminal emulator, and the window stays open after the runtime
# stops until you press Enter.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

if [ ! -t 1 ] && [ -z "$SLR_RUNTIME_IN_TERMINAL" ]; then
    # No terminal on stdout: desktop launch. Re-exec in the first available
    # terminal emulator. The inner command runs THIS script (forwarding any
    # arguments) on the new terminal, then waits for Enter so the window does
    # not vanish the moment the runtime stops.
    INNER='"$@"; rc=$?; echo; echo "Press Enter to close this window."; read _; exit $rc'
    for term in "x-terminal-emulator -e" "gnome-terminal --" "konsole -e" "xfce4-terminal -x" "xterm -e"; do
        prog=${term%% *}
        if command -v "$prog" >/dev/null 2>&1; then
            SLR_RUNTIME_IN_TERMINAL=1 $term bash -c "$INNER" slr-runtime "$SCRIPT_DIR/SLR Runtime.sh" "$@"
            exit $?
        fi
    done
    # No terminal emulator available: fall back to running headless (processes
    # start; the status is not visible). Documented behaviour.
fi

SLR_RUNTIME_IN_TERMINAL=1 exec "$SCRIPT_DIR/dev/node-linux" "$SCRIPT_DIR/dev/slr-runtime.js" "$@"
