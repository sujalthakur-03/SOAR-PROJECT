#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: soar-delete-file (Linux)
# ==============================================================================
# Permanently removes a file on the endpoint with `rm -f`. Used for malware
# remediation, suspicious-file cleanup, etc.
#
# !!! NO PATH SAFETY LIST !!!
# Per the 2026 design decision, this script applies NO refusal list — it will
# delete WHATEVER path is provided. The SOC analyst is responsible for the
# file path. A typo in the playbook can delete arbitrary system files.
# Validate file paths upstream before dispatching.
#
# Args (from SOAR API call → parameters.extra_args):
#   extra_args[0] = absolute file path to delete
#
# Deploy to: /var/ossec/active-response/bin/soar-delete-file.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"
LOG_PREFIX="cybersentinel-soar-delete-file"

log() {
    printf '%s %s: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$LOG_PREFIX" "$1" >> "$LOG_FILE"
}

# stdin read with 3s timeout (wazuh-execd open-pipe-fd workaround)
INPUT_JSON="$(timeout 3 cat 2>/dev/null || true)"

COMMAND="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
FILE_PATH="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"\([^"]*\)".*/\1/p')"

# Legacy fallback: positional argv
if [ -z "${FILE_PATH:-}" ] && [ $# -ge 1 ]; then
    FILE_PATH="$1"
fi

# Only handle ADD; ignore DELETE (no auto-undo for a delete action)
if [ "$COMMAND" != "add" ]; then
    log "Ignoring command '$COMMAND' (only 'add' supported for delete_file)"
    exit 0
fi

if [ -z "${FILE_PATH:-}" ]; then
    log "ERROR: file path not provided (expected in parameters.extra_args[0])"
    exit 1
fi

# Path-shape sanity: must be absolute. Refuses /something with embedded shell
# metacharacters because parameters arrive verbatim and we eval them in shell.
case "$FILE_PATH" in
    /*) ;;
    *)
        log "ERROR: file path must be absolute (got '$FILE_PATH')"
        exit 1
        ;;
esac
case "$FILE_PATH" in
    *\;*|*\&*|*\|*|*\`*|*\$*|*\(*|*\)*|*\<*|*\>*|*\**|*\?*|*\[*|*\]*|*\{*|*\}*)
        log "ERROR: file path contains shell metacharacters, refusing (got '$FILE_PATH')"
        exit 1
        ;;
esac

# Idempotent: file already gone is success.
if [ ! -e "$FILE_PATH" ] && [ ! -L "$FILE_PATH" ]; then
    log "File '$FILE_PATH' does not exist (idempotent no-op)"
    exit 0
fi

# Capture the file shape for the log line BEFORE deletion.
if [ -d "$FILE_PATH" ]; then
    SHAPE="directory"
elif [ -L "$FILE_PATH" ]; then
    SHAPE="symlink"
elif [ -f "$FILE_PATH" ]; then
    SHAPE="file"
    SIZE="$(wc -c < "$FILE_PATH" 2>/dev/null || echo '?')"
    SHAPE="file (${SIZE} bytes)"
else
    SHAPE="other"
fi

# This script intentionally refuses to recurse into directories. Deleting a
# directory tree from an AR is a much bigger blast-radius operation and
# warrants a separate explicit action.
if [ -d "$FILE_PATH" ] && [ ! -L "$FILE_PATH" ]; then
    log "ERROR: '$FILE_PATH' is a directory; this script handles individual files only. Use a dedicated cleanup action for directory trees."
    exit 1
fi

log "Deleting $SHAPE: $FILE_PATH"
if rm -f -- "$FILE_PATH"; then
    log "Deleted successfully: $FILE_PATH"
else
    log "ERROR: rm -f failed for $FILE_PATH"
    exit 1
fi

exit 0
