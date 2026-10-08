#!/bin/sh
# Usage: scripts/qa-shot.sh <out-dir> [width] [height] [url-suffix...]
# Screenshots dev-harness pages with headless Chrome (dev server on :5180 must be running).
OUT=$1; W=${2:-1176}; H=${3:-1500}; shift 3 2>/dev/null
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
for page in ${@:-harness=tracking harness=comparison}; do
  name=$(echo "$page" | sed 's/.*=//; s/[^a-z0-9-]/_/g')
  "$CH" --headless=new --disable-gpu --hide-scrollbars --window-size=$W,$H --virtual-time-budget=6000 \
    --screenshot="$OUT/$name.png" "http://localhost:5180/?$page" >/dev/null 2>&1
  echo "$OUT/$name.png"
done
