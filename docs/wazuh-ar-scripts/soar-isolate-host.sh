#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: soar-isolate-host (Linux)
# ==============================================================================
# Cuts the endpoint off from the network using iptables DROP rules while
# preserving reachability to the CyberSentinel manager so the eventual
# un-isolate command can be delivered.
#
# Manager IP source (single source of truth):
#   The manager IP is configured ONCE in the manager's ossec.conf via the
#   <extra_args> element of the soar-isolate-host0 / win_soar-isolate-host0
#   <command> blocks. Wazuh propagates extra_args into the AR JSON payload
#   sent to the agent, where this script reads it from
#   parameters.extra_args[0]. NO agent-side env var or per-host config.
#
#   Example manager ossec.conf:
#     <command>
#       <name>soar-isolate-host0</name>
#       <executable>soar-isolate-host.sh</executable>
#       <extra_args>10.0.0.5</extra_args>
#       <timeout_allowed>yes</timeout_allowed>
#     </command>
#
# Deploy to: /var/ossec/active-response/bin/soar-isolate-host.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"
LOG_PREFIX="cybersentinel-soar-isolate-host"
CHAIN="CYBERSENTINEL_SOAR_ISOLATE"

log() {
    printf '%s %s: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$LOG_PREFIX" "$1" >> "$LOG_FILE"
}

# ---- Parse Wazuh AR v4.2+ JSON from stdin -----------------------------------
INPUT_JSON="$(cat)"
COMMAND="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
MANAGER_IP="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"\([^"]*\)".*/\1/p')"

# Legacy calling convention fallback: positional argv
if [ -z "${MANAGER_IP:-}" ] && [ $# -ge 1 ]; then
    MANAGER_IP="$1"
fi

if [ -z "${MANAGER_IP:-}" ]; then
    log "ERROR: manager IP not provided (expected in parameters.extra_args[0] from ossec.conf)"
    exit 1
fi

# Basic IP shape sanity check
case "$MANAGER_IP" in
    *[!0-9.]*|*..*|.*|*.) log "ERROR: invalid manager IP '$MANAGER_IP'"; exit 1 ;;
esac

case "$COMMAND" in
    add)
        # ---- Pre-flight: refuse if manager unreachable ------------------------
        # If we cannot reach the manager NOW, isolating would brick the agent
        # because the un-isolate command can never be delivered.
        REACHABLE=0
        for PORT in 1514 1515 55000; do
            if command -v nc >/dev/null 2>&1; then
                if nc -z -w 2 "$MANAGER_IP" "$PORT" 2>/dev/null; then
                    REACHABLE=1; break
                fi
            else
                # /dev/tcp fallback (bash/dash via timeout)
                if (exec 3<>/dev/tcp/"$MANAGER_IP"/"$PORT") 2>/dev/null; then
                    exec 3>&- 3<&- 2>/dev/null || true
                    REACHABLE=1; break
                fi
            fi
        done
        if [ "$REACHABLE" -eq 0 ]; then
            log "ERROR: manager $MANAGER_IP unreachable on 1514/1515/55000 — refusing to isolate (would orphan agent)"
            exit 1
        fi

        log "Pre-flight passed: manager $MANAGER_IP reachable"

        # ---- Idempotent teardown of any prior isolation -----------------------
        iptables -D INPUT  -j "$CHAIN" 2>/dev/null || true
        iptables -D OUTPUT -j "$CHAIN" 2>/dev/null || true
        iptables -F "$CHAIN" 2>/dev/null || true
        iptables -X "$CHAIN" 2>/dev/null || true

        # ---- Apply isolation chain --------------------------------------------
        iptables -N "$CHAIN"
        iptables -A "$CHAIN" -i lo -j ACCEPT
        iptables -A "$CHAIN" -o lo -j ACCEPT
        iptables -A "$CHAIN" -m state --state ESTABLISHED,RELATED -j ACCEPT
        iptables -A "$CHAIN" -d "$MANAGER_IP" -p tcp -m multiport --dports 1514,1515,55000 -j ACCEPT
        iptables -A "$CHAIN" -s "$MANAGER_IP" -j ACCEPT
        iptables -A "$CHAIN" -j DROP

        iptables -I INPUT  1 -j "$CHAIN"
        iptables -I OUTPUT 1 -j "$CHAIN"

        log "Isolation applied (manager=$MANAGER_IP whitelisted)"
        ;;

    delete)
        iptables -D INPUT  -j "$CHAIN" 2>/dev/null || true
        iptables -D OUTPUT -j "$CHAIN" 2>/dev/null || true
        iptables -F "$CHAIN" 2>/dev/null || true
        iptables -X "$CHAIN" 2>/dev/null || true
        log "Isolation removed"
        ;;

    *)
        log "ERROR: unknown command '$COMMAND' (expected 'add' or 'delete')"
        exit 1
        ;;
esac

exit 0
