#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: soar-disable-user (Linux)
# ==============================================================================
# Locks a local user account on the endpoint via usermod -L.
#
# Args (from SOAR API call → parameters.extra_args):
#   extra_args[0] = username to lock/unlock
#
# Deploy to: /var/ossec/active-response/bin/soar-disable-user.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"
LOG_PREFIX="cybersentinel-soar-disable-user"

log() {
    printf '%s %s: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$LOG_PREFIX" "$1" >> "$LOG_FILE"
}

INPUT_JSON="$(cat)"
COMMAND="$(printf '%s'  "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
USERNAME="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "${USERNAME:-}" ] && [ $# -ge 1 ]; then
    USERNAME="$1"
fi

if [ -z "${USERNAME:-}" ]; then
    log "ERROR: no username provided (expected in parameters.extra_args[0])"
    exit 1
fi

# ---- Safety: protected accounts ---------------------------------------------
PROTECTED="root daemon bin sys sync sshd wazuh ossec cybersentinel"

for bad in $PROTECTED; do
    if [ "$USERNAME" = "$bad" ]; then
        log "ERROR: refusing to touch protected account '$USERNAME'"
        exit 1
    fi
done

if ! id "$USERNAME" >/dev/null 2>&1; then
    log "ERROR: user '$USERNAME' does not exist"
    exit 1
fi

case "$COMMAND" in
    add)
        # Idempotent: passwd -S shows 'L' for locked
        STATUS="$(passwd -S "$USERNAME" 2>/dev/null | awk '{print $2}' || echo '')"
        if [ "$STATUS" = "L" ]; then
            log "User '$USERNAME' already locked (idempotent no-op)"
            exit 0
        fi

        log "Locking user account '$USERNAME'"
        usermod -L "$USERNAME" || {
            log "ERROR: usermod -L $USERNAME failed"
            exit 1
        }
        # Terminate active sessions
        pkill -KILL -u "$USERNAME" 2>/dev/null || true
        log "User '$USERNAME' locked successfully"
        ;;

    delete)
        STATUS="$(passwd -S "$USERNAME" 2>/dev/null | awk '{print $2}' || echo '')"
        if [ "$STATUS" != "L" ]; then
            log "User '$USERNAME' already unlocked (idempotent no-op)"
            exit 0
        fi

        log "Unlocking user account '$USERNAME'"
        usermod -U "$USERNAME" || {
            log "ERROR: usermod -U $USERNAME failed"
            exit 1
        }
        log "User '$USERNAME' unlocked successfully"
        ;;

    *)
        log "ERROR: unknown command '$COMMAND'"
        exit 1
        ;;
esac

exit 0
