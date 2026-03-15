#!/usr/bin/env bash
set -euo pipefail

PLIST_ID="com.km.paper-cortex"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_ID}.plist"

UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${PLIST_ID}" 2>/dev/null || true

if [ -f "$PLIST_PATH" ]; then
  rm "$PLIST_PATH"
fi

echo "Uninstalled launchd agent: ${PLIST_ID}"
