#!/usr/bin/env bash
set -euo pipefail

# Wrapper used by launchd. launchd does not load your shell profile, so tools
# installed via Homebrew or nvm are often not on PATH.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Try common PATHs first (Homebrew Intel + Apple Silicon)
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

# If node is still missing, try nvm.
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    # Best-effort: use default (or any installed) version.
    nvm use --silent default >/dev/null 2>&1 || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "paper-cortex launchd wrapper: 'node' not found. PATH=$PATH" >&2
  exit 127
fi

exec node --enable-source-maps "${REPO_DIR}/dist/main.js"
