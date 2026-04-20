#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: disable-user (Linux)
# ==============================================================================
# Locks a user account on the endpoint.
#
# AR arguments (from Wazuh manager via SOAR):
#   arg1: username to lock
#
# Deploy to: /var/ossec/active-response/bin/disable-user.sh
# Owner:     root:wazuh   Mode: 750
#
# For Windows endpoints, see disable-user.cmd below.
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"

log() {
    printf '%s cybersentinel-disable-user: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

# Read the JSON payload from stdin (Wazuh AR v4.2+ calling convention)
INPUT_JSON="$(cat)"
COMMAND="$(echo "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
USERNAME="$(echo "$INPUT_JSON" | sed -n 's/.*"extra_args":\["\([^"]*\)".*/\1/p')"

# Fallback to positional arg (legacy calling convention)
if [ -z "$USERNAME" ] && [ $# -ge 1 ]; then
    USERNAME="$1"
fi

if [ -z "${USERNAME:-}" ]; then
    log "ERROR: no username provided"
    exit 1
fi

# ---- Safety checks -----------------------------------------------------------
PROTECTED="root daemon bin sys sync sshd wazuh ossec"

for bad in $PROTECTED; do
    if [ "$USERNAME" = "$bad" ]; then
        log "ERROR: refusing to disable protected account '$USERNAME'"
        exit 1
    fi
done

if ! id "$USERNAME" >/dev/null 2>&1; then
    log "ERROR: user '$USERNAME' does not exist"
    exit 1
fi

case "$COMMAND" in
    add)
        log "Locking user account '$USERNAME'"
        usermod -L "$USERNAME" || {
            log "ERROR: usermod -L $USERNAME failed"
            exit 1
        }

        # Kill any active sessions owned by this user
        pkill -KILL -u "$USERNAME" 2>/dev/null || true

        log "User '$USERNAME' locked successfully"
        ;;

    delete)
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
