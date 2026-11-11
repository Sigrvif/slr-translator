#!/usr/bin/env bash
# Extract Raw-tab test fixtures. Run once:  bash dev/rawview-tests/setup-fixtures.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$DIR/../.." && pwd)"
# Fixtures are NEVER committed: they are extracted from your own local test
# games. Point the two vars below (or the matching env vars) at copies you
# own; the rawview tests skip cleanly while the fixtures are absent.
SLRPROJ="${SLRTEST_SLRPROJ:-/workspaces/dev/Test Game/Unpacked VXAce/Ace Test.slrproj}"
MVDIR="${SLRTEST_MVDIR:-}"
[ -f "$SLRPROJ" ] || { echo "vxace source .slrproj not found ($SLRPROJ) - set SLRTEST_SLRPROJ"; exit 1; }
[ -d "$MVDIR" ] || { echo "mv source game dir not found ($MVDIR) - set SLRTEST_MVDIR"; exit 1; }
SEVENZ_SRC="$APP/node_modules/7zip-bin/linux/x64/7za"
SEVENZ="$(mktemp -u /tmp/rawview-7za.XXXX)"

cp "$SEVENZ_SRC" "$SEVENZ"
chmod +x "$SEVENZ"

TMP="$(mktemp -d /tmp/rawview-fixtures.XXXX)"
"$SEVENZ" x -y -o"$TMP" "$SLRPROJ" \
    data/YAML/Map003.yaml data/YAML/Actors.yaml data/YAML/Items.yaml \
    data/YAML/CommonEvents.yaml data/YAML/System.yaml data/YAML/Troops.yaml \
    data/Game.ini > /dev/null

mkdir -p "$DIR/fixtures/vxace" "$DIR/fixtures/mv"
mv "$TMP"/data/YAML/*.yaml "$DIR/fixtures/vxace/"
mv "$TMP"/data/Game.ini "$DIR/fixtures/vxace/"
rm -rf "$TMP"

cp "$MVDIR/Map002.json" "$MVDIR/Actors.json" "$DIR/fixtures/mv/"
echo "Fixtures ready:"
ls "$DIR/fixtures/vxace" "$DIR/fixtures/mv"
