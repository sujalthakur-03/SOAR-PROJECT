#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: soar-kill-process (Linux)
# ==============================================================================
# Terminates a process on the endpoint by PID or by name.
#
# Args (from SOAR API call → parameters.extra_args):
#   extra_args[0] = "pid" | "name"
#   extra_args[1] = PID number OR process name
#
# Deploy to: /var/ossec/active-response/bin/soar-kill-process.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"
LOG_PREFIX="cybersentinel-soar-kill-process"

log() {
    printf '%s %s: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$LOG_PREFIX" "$1" >> "$LOG_FILE"
}

INPUT_JSON="$(cat)"
COMMAND="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
MODE="$(printf '%s'   "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"\([^"]*\)".*/\1/p')"
TARGET="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"[^"]*"[[:space:]]*,[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "${MODE:-}" ] && [ $# -ge 2 ]; then
    MODE="$1"; TARGET="$2"
fi

if [ "$COMMAND" != "add" ]; then
    log "Ignoring command '$COMMAND' (only 'add' is supported)"
    exit 0
fi

if [ -z "${MODE:-}" ] || [ -z "${TARGET:-}" ]; then
    log "ERROR: missing mode (pid|name) or target"
    exit 1
fi

# ---- Safety: protected process blacklist ------------------------------------
BLACKLIST="init systemd kthreadd wazuh-agentd ossec-agentd cybersentinel-agentd sshd dbus-daemon systemd-journald"

case "$MODE" in
    pid)
        case "$TARGET" in
            ''|*[!0-9]*) log "ERROR: invalid PID '$TARGET'"; exit 1 ;;
        esac

        if [ "$TARGET" -lt 100 ]; then
            log "ERROR: refusing low PID $TARGET (likely system process)"
            exit 1
        fi

        # Idempotent: PID already gone is success, not failure
        if ! kill -0 "$TARGET" 2>/dev/null; then
            log "PID $TARGET already not running (idempotent no-op)"
            exit 0
        fi

        PROC_NAME="$(ps -p "$TARGET" -o comm= 2>/dev/null || echo '')"
        for bad in $BLACKLIST; do
            if [ "$PROC_NAME" = "$bad" ]; then
                log "ERROR: refusing to kill protected process $PROC_NAME (PID $TARGET)"
                exit 1
            fi
        done

        log "Killing PID $TARGET ($PROC_NAME)"
        if kill -9 "$TARGET" 2>/dev/null; then
            log "Killed PID $TARGET successfully"
        else
            # Race: process exited between kill -0 and kill -9 → still success
            if ! kill -0 "$TARGET" 2>/dev/null; then
                log "PID $TARGET exited before kill -9 (idempotent)"
            else
                log "ERROR: kill -9 $TARGET failed and process still running"
                exit 1
            fi
        fi
        ;;

    name)
        for bad in $BLACKLIST; do
            if [ "$TARGET" = "$bad" ]; then
                log "ERROR: refusing to kill protected process name $TARGET"
                exit 1
            fi
        done

        # Idempotent: pgrep miss is success
        if ! pgrep -x "$TARGET" >/dev/null 2>&1; then
            log "No processes matching '$TARGET' (idempotent no-op)"
            exit 0
        fi

        log "Killing processes matching name '$TARGET'"
        pkill -9 -x "$TARGET" 2>/dev/null || true
        log "kill-process (name=$TARGET) completed"
        ;;

    *)
        log "ERROR: unknown mode '$MODE' (expected 'pid' or 'name')"
        exit 1
        ;;
esac

exit 0
