#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_ID="com.km.paper-cortex"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_ID}.plist"
LOG_PATH="$HOME/Library/Logs/paper-cortex.log"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# Ensure wrapper is executable (launchd can run it via /bin/bash)
chmod +x "$REPO_DIR/scripts/launchd-run.sh"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${PLIST_ID}</string>

    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${REPO_DIR}/scripts/launchd-run.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>

    <key>StandardErrorPath</key>
    <string>${LOG_PATH}</string>
  </dict>
</plist>
EOF

# Build before installing
cd "$REPO_DIR"
npm run build

UID_NUM="$(id -u)"
# Best-effort: unload old instance
launchctl bootout "gui/${UID_NUM}/${PLIST_ID}" 2>/dev/null || true

launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH"
launchctl enable "gui/${UID_NUM}/${PLIST_ID}"
launchctl kickstart -k "gui/${UID_NUM}/${PLIST_ID}"

echo "Installed launchd agent: ${PLIST_ID}"
echo "Plist: ${PLIST_PATH}"
echo "Log: ${LOG_PATH}"
