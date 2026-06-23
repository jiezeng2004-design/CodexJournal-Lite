#!/bin/bash
# scripts/archive.sh
#
# POSIX wrapper that runs `npm run archive` from the project root.
# This is the macOS/Linux counterpart of scripts/run-archive.ps1 and is
# intended to be the action invoked by the cron job installed by
# scripts/install-cron.sh.
#
# No destructive operations: it does not delete files and does not push to git.

set -e

# Resolve the project root from this script's location: scripts/.. -> project root.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Locate npm. On macOS/Linux the binary is `npm`; fall back to a best-effort
# lookup so the script also works inside non-standard environments.
NPM_BIN="npm"
if ! command -v "$NPM_BIN" >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm.cmd 2>/dev/null || true)"
fi
if [ -z "$NPM_BIN" ]; then
  echo "ERROR: npm not found in PATH." >&2
  exit 2
fi

echo "[archive] cwd = $PROJECT_ROOT"
echo "[archive] starting: npm run archive"

"$NPM_BIN" run archive
code=$?
if [ "$code" -ne 0 ]; then
  echo "[archive] npm run archive exited with code $code" >&2
fi
exit "$code"
