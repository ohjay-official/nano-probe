#!/usr/bin/env bash
# Runs the Nano filming probe on a virtual screen and records that screen to out/screen.mp4.
set -u
cd "$(dirname "$0")"
mkdir -p out
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!
sleep 2
ffmpeg -y -loglevel error -video_size 1280x800 -framerate 10 -f x11grab -i :99 \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p out/screen.mp4 &
FF_PID=$!
node nano-probe.mjs "$(command -v google-chrome)" "${PROFILE_DIR:-/tmp/nano-profile}" ./out "${PROBE_TIMEOUT_MIN:-35}"
CODE=$?
kill -INT "$FF_PID" 2>/dev/null; wait "$FF_PID" 2>/dev/null
kill "$XVFB_PID" 2>/dev/null
exit "$CODE"
