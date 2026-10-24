#!/usr/bin/env bash
# Renders assets/demo.html to assets/demo.gif with headless Chrome + ffmpeg (no project dependencies).
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PAGE="file://$PWD/assets/demo.html" FPS=10
DURATION_MS=24750 # keep in sync with DURATION (16500 × SPEED) in assets/demo.html
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# One frame at a time: parallel headless Chrome instances hang on macOS.
for ((i = 0; i < DURATION_MS * FPS / 1000; i++)); do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=900,500 \
    --user-data-dir="$TMP_DIR/profile" --screenshot="$TMP_DIR/$(printf 'f%04d' "$i").png" \
    "$PAGE?t=$((i * 1000 / FPS))" >/dev/null 2>&1
done

ffmpeg -loglevel error -y -framerate "$FPS" -i "$TMP_DIR/f%04d.png" \
  -vf "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  assets/demo.gif
echo "assets/demo.gif: $(du -h assets/demo.gif | cut -f1)"
