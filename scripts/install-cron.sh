#!/bin/bash
# scripts/install-cron.sh
#
# Installs (or removes) a cron job that runs `scripts/archive.sh` daily.
# This is the macOS/Linux counterpart of scripts/install-task.ps1, which
# registers a Windows Task Scheduler job. DOES NOT push to git and does NOT
# delete files.
#
# Usage:
#   ./scripts/install-cron.sh              # install: daily at 00:10
#   ./scripts/install-cron.sh 06:30        # install: daily at 06:30
#   ./scripts/install-cron.sh --remove     # remove the installed cron job
#
# The generated crontab entry is wrapped in fixed marker comments so that
# re-running this script replaces the previous entry instead of duplicating it.

set -e

MARKER_BEGIN="# BEGIN codexjournal-lite-cron"
MARKER_END="# END codexjournal-lite-cron"
DEFAULT_TIME="00:10"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARCHIVE_SCRIPT="$SCRIPT_DIR/archive.sh"
LOG_FILE="$PROJECT_ROOT/reports/cron-archive.log"

# -------- remove mode ----------------------------------------------------
if [ "${1:-}" = "--remove" ] || [ "${1:-}" = "-r" ]; then
  if ! command -v crontab >/dev/null 2>&1; then
    echo "ERROR: crontab not found. cron may not be installed on this system." >&2
    exit 2
  fi
  EXISTING="$(crontab -l 2>/dev/null || true)"
  CLEANED="$(printf '%s\n' "$EXISTING" | sed '/^# BEGIN codexjournal-lite-cron$/,/^# END codexjournal-lite-cron$/d')"
  printf '%s\n' "$CLEANED" | crontab -
  echo "Cron job removed."
  exit 0
fi

# -------- install mode ---------------------------------------------------
TIME="${1:-$DEFAULT_TIME}"

if [ ! -f "$ARCHIVE_SCRIPT" ]; then
  echo "ERROR: archive.sh not found at $ARCHIVE_SCRIPT" >&2
  exit 2
fi
chmod +x "$ARCHIVE_SCRIPT" 2>/dev/null || true

if ! command -v crontab >/dev/null 2>&1; then
  echo "ERROR: crontab not found. cron may not be installed on this system." >&2
  echo "On macOS cron is available by default; on Linux install the 'cron' package." >&2
  exit 2
fi

# Parse HH:MM into cron minute/hour (zero-padded to two digits).
if ! printf '%s' "$TIME" | grep -Eq '^[0-9]{1,2}:[0-9]{1,2}$'; then
  echo "ERROR: invalid time '$TIME'. Expected HH:MM (e.g. 00:10)." >&2
  exit 2
fi
CRON_MIN=$(printf '%s' "$TIME" | cut -d: -f2)
CRON_HOUR=$(printf '%s' "$TIME" | cut -d: -f1)
# Validate ranges (mirrors the TimeSpan validation done by install-task.ps1).
if [ "$CRON_HOUR" -gt 23 ] || [ "$CRON_MIN" -gt 59 ]; then
  echo "ERROR: invalid time '$TIME'. Hour must be 0-23 and minute 0-59." >&2
  exit 2
fi
CRON_MIN=$(printf '%02d' "$CRON_MIN")
CRON_HOUR=$(printf '%02d' "$CRON_HOUR")

# Build the cron entry. `cd` into the project root first so relative paths
# inside archive.sh / npm resolve correctly. Output is appended to a dedicated
# log file so cron does not try to mail the user.
CRON_ENTRY="$CRON_MIN $CRON_HOUR * * * cd \"$PROJECT_ROOT\" && \"$ARCHIVE_SCRIPT\" >> \"$LOG_FILE\" 2>&1"

# Fetch existing crontab (empty if none), strip any previous block, then append.
EXISTING="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$EXISTING" | sed '/^# BEGIN codexjournal-lite-cron$/,/^# END codexjournal-lite-cron$/d')"
NEW_CRON="$(printf '%s\n%s\n%s\n%s\n%s\n' "$CLEANED" "$MARKER_BEGIN" "$CRON_ENTRY" "$MARKER_END" "")"

printf '%s\n' "$NEW_CRON" | crontab -

echo ""
echo "Cron job installed."
echo "  Name:        CodexJournal-Lite Daily Archive"
echo "  Schedule:    daily at $TIME  ($CRON_MIN $CRON_HOUR * * *)"
echo "  Command:     cd \"$PROJECT_ROOT\" && \"$ARCHIVE_SCRIPT\""
echo "  Log:         $LOG_FILE"
echo ""
echo "How to inspect / manage it:"
echo "  - List:    crontab -l"
echo "  - Run now: \"$ARCHIVE_SCRIPT\""
echo "  - Remove:  ./scripts/install-cron.sh --remove"
echo ""
echo "App errors go to:  $PROJECT_ROOT/reports/errors.log"
echo "Journal goes to:   $PROJECT_ROOT/journal/YYYY-MM-DD.md"
