#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: isolate-host
# ==============================================================================
# Cuts off the endpoint from the network using iptables DROP rules.
# Keeps the Wazuh manager reachable so the agent can still receive commands
# (including the eventual un-isolate command).
#
# Deploy to: /var/ossec/active-response/bin/isolate-host.sh
# Owner:     root:wazuh   Mode: 750
# ==============================================================================

set -eu

LOG_FILE="/var/ossec/logs/active-responses.log"
MANAGER_IP="${WAZUH_MANAGER_IP:-}"

log() {
    printf '%s cybersentinel-isolate-host: %s\n' "$(date '+%Y/%m/%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

# Read the JSON payload from stdin (Wazuh AR v4.2+ calling convention)
INPUT_JSON="$(cat)"
COMMAND="$(echo "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"

# Accept the manager IP from $1 as a fallback (legacy calling convention)
if [ -z "$MANAGER_IP" ] && [ $# -ge 1 ]; then
    MANAGER_IP="$1"
fi

if [ -z "$MANAGER_IP" ]; then
    log "ERROR: WAZUH_MANAGER_IP env var is not set and no manager IP argument passed"
    exit 1
fi

case "$COMMAND" in
    add)
        log "Isolating host, permitting only manager IP $MANAGER_IP"

        # Flush existing CYBERSENTINEL chain if present
        iptables -F CYBERSENTINEL_ISOLATE 2>/dev/null || true
        iptables -N CYBERSENTINEL_ISOLATE 2>/dev/null || true

        # Allow loopback
        iptables -A CYBERSENTINEL_ISOLATE -i lo -j ACCEPT
        iptables -A CYBERSENTINEL_ISOLATE -o lo -j ACCEPT

        # Allow established connections so in-progress manager sessions survive
        iptables -A CYBERSENTINEL_ISOLATE -m state --state ESTABLISHED,RELATED -j ACCEPT

        # Allow Wazuh manager (1514/tcp, 1515/tcp, 55000/tcp)
        iptables -A CYBERSENTINEL_ISOLATE -d "$MANAGER_IP" -p tcp -m multiport --dports 1514,1515,55000 -j ACCEPT
        iptables -A CYBERSENTINEL_ISOLATE -s "$MANAGER_IP" -j ACCEPT

        # Drop everything else
        iptables -A CYBERSENTINEL_ISOLATE -j DROP

        # Insert chain at the top of INPUT and OUTPUT
        iptables -I INPUT 1 -j CYBERSENTINEL_ISOLATE
        iptables -I OUTPUT 1 -j CYBERSENTINEL_ISOLATE

        log "Host isolation applied successfully"
        ;;

    delete)
        log "Removing host isolation"
        iptables -D INPUT -j CYBERSENTINEL_ISOLATE 2>/dev/null || true
        iptables -D OUTPUT -j CYBERSENTINEL_ISOLATE 2>/dev/null || true
        iptables -F CYBERSENTINEL_ISOLATE 2>/dev/null || true
        iptables -X CYBERSENTINEL_ISOLATE 2>/dev/null || true
        log "Host isolation removed"
        ;;

    *)
        log "ERROR: unknown command '$COMMAND'"
        exit 1
        ;;
esac

exit 0
