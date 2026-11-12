#!/usr/bin/env bash
# Loads the throwaway MV3 extension into branded Google Chrome via
# CDP Extensions.loadUnpacked (not --load-extension) and runs the side panel probe.
set -u
cd "$(dirname "$0")"
mkdir -p out-extension
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB_PID=$!
sleep 2
node extension-probe.mjs "$(command -v google-chrome)" "${EXT_PROFILE_DIR:-/tmp/ext-profile}" ./out-extension
CODE=$?
kill "$XVFB_PID" 2>/dev/null
exit "$CODE"
