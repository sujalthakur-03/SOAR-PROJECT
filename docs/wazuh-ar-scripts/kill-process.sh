#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: kill-process
# ==============================================================================
# Terminates a process on the endpoint by PID or by name.
#
# AR arguments (from Wazuh manager via SOAR):
#   arg1: "pid" or "name"
#   arg2: PID number OR process name pattern
#
# Deploy to: /var/ossec/active-response/bin/kill-process.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"

log() {
    printf '%s cybersentinel-kill-process: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

# Read the JSON payload from stdin (Wazuh AR v4.2+ calling convention)
INPUT_JSON="$(cat)"
COMMAND="$(echo "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"

# Extract extra_args from the JSON payload (pid|name + value)
MODE="$(echo "$INPUT_JSON" | sed -n 's/.*"extra_args":\["\([^"]*\)".*/\1/p')"
TARGET="$(echo "$INPUT_JSON" | sed -n 's/.*"extra_args":\["[^"]*","\([^"]*\)".*/\1/p')"

# Fallback to positional args (legacy calling convention)
if [ -z "$MODE" ] && [ $# -ge 2 ]; then
    MODE="$1"
    TARGET="$2"
fi

if [ "$COMMAND" != "add" ]; then
    log "Ignoring command '$COMMAND' (only 'add' is supported)"
    exit 0
fi

if [ -z "${MODE:-}" ] || [ -z "${TARGET:-}" ]; then
    log "ERROR: missing mode (pid|name) or target"
    exit 1
fi

# ---- Safety checks -----------------------------------------------------------
# Never kill critical system processes
BLACKLIST="init systemd kthreadd wazuh-agentd ossec-agentd sshd"

case "$MODE" in
    pid)
        # Verify it's a valid positive integer
        case "$TARGET" in
            ''|*[!0-9]*)
                log "ERROR: invalid PID '$TARGET'"
                exit 1
                ;;
        esac

        if [ "$TARGET" -lt 100 ]; then
            log "ERROR: refusing to kill low PID $TARGET (likely system process)"
            exit 1
        fi

        PROC_NAME="$(ps -p "$TARGET" -o comm= 2>/dev/null || echo '')"
        for bad in $BLACKLIST; do
            if [ "$PROC_NAME" = "$bad" ]; then
                log "ERROR: refusing to kill protected process $PROC_NAME (PID $TARGET)"
                exit 1
            fi
        done

        log "Killing PID $TARGET ($PROC_NAME)"
        kill -9 "$TARGET" || {
            log "ERROR: kill -9 $TARGET failed"
            exit 1
        }
        log "Killed PID $TARGET successfully"
        ;;

    name)
        for bad in $BLACKLIST; do
            if [ "$TARGET" = "$bad" ]; then
                log "ERROR: refusing to kill protected process name $TARGET"
                exit 1
            fi
        done

        log "Killing processes matching name '$TARGET'"
        pkill -9 -x "$TARGET" || {
            log "WARN: pkill returned non-zero (no matches?)"
        }
        log "kill-process (name=$TARGET) completed"
        ;;

    *)
        log "ERROR: unknown mode '$MODE' (expected 'pid' or 'name')"
        exit 1
        ;;
esac

exit 0
