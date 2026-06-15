 #!/usr/bin/env bash
 # scripts/verify.sh
 #
 # POSIX shell wrapper for the cross-platform Node.js verify script.
 # Usage: ./scripts/verify.sh [--fresh] [--skip-archive]
 set -e
 SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
 PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
 exec node "$PROJECT_ROOT/src/verify.js" "$@"
