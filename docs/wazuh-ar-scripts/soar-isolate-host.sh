#!/bin/sh
# ==============================================================================
# CyberSentinel SOAR - Active Response: soar-isolate-host (Linux)
# ==============================================================================
# HARD-isolates the endpoint. After this script runs ADD path successfully:
#   - Only the manager IP can reach the agent (any TCP/UDP port, IPv4)
#   - The agent can only reach the manager on AR/heartbeat ports
#     (1514, 1515, 55000 TCP)
#   - All other IPv4 traffic (any address) is dropped
#   - All IPv6 traffic (manager is IPv4-only) is dropped except loopback
#   - The FORWARD chain is also gated to prevent transit-bypass on hosts
#     with ip_forward=1 (containers, dual-homed)
#   - Pre-existing ESTABLISHED flows are only preserved when one endpoint is
#     the manager. Other in-flight sessions (e.g. SSH from a jump host)
#     are killed.
#
# Manager IP source:
#   Comes from the AR JSON payload's parameters.extra_args[0]. The SOAR
#   connector passes it explicitly in the API `arguments` array (verified
#   2026-05-15: Wazuh API does NOT inherit <extra_args> from manager
#   ossec.conf for API-dispatched AR — only rule-triggered AR does).
#
# Delete-path detection:
#   The Wazuh API has no way to make parameters.command="delete" for manual
#   dispatch. The SOAR connector encodes the intent in extra_args[1]:
#   args = [managerIp, "delete"]. If extra_args[1] == "delete" this script
#   overrides COMMAND to "delete" and routes to the release branch.
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

# ---- Read Wazuh AR JSON from stdin ------------------------------------------
# wazuh-execd v4.14.1 leaves its write end of the pipe open, which would
# block `cat` forever. `timeout 3 cat` reads buffered JSON then exits.
INPUT_JSON="$(timeout 3 cat 2>/dev/null || true)"

COMMAND="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
MANAGER_IP="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"\([^"]*\)".*/\1/p')"
EXTRA_2="$(printf '%s' "$INPUT_JSON" | sed -n 's/.*"extra_args":\[[[:space:]]*"[^"]*"[[:space:]]*,[[:space:]]*"\([^"]*\)".*/\1/p')"

# Delete-sentinel override: SOAR connector sends ["managerIp", "delete"]
# to trigger the release branch.
if [ "$EXTRA_2" = "delete" ]; then
    COMMAND="delete"
fi

# Legacy calling convention fallback (manual CLI testing)
if [ -z "${MANAGER_IP:-}" ] && [ $# -ge 1 ]; then
    MANAGER_IP="$1"
fi

if [ -z "${MANAGER_IP:-}" ]; then
    log "ERROR: manager IP not provided (expected in parameters.extra_args[0])"
    exit 1
fi

# Strict IPv4 shape validation: 4 dotted octets, digits only, no leading/
# trailing dot, no double-dot, no octet > 255.
case "$MANAGER_IP" in
    *[!0-9.]*)        log "ERROR: invalid manager IP '$MANAGER_IP' (non-numeric)"; exit 1 ;;
    *..*|.*|*.)       log "ERROR: invalid manager IP '$MANAGER_IP' (malformed dots)"; exit 1 ;;
esac
OCTET_COUNT="$(echo "$MANAGER_IP" | tr '.' '\n' | wc -l)"
if [ "$OCTET_COUNT" != "4" ]; then
    log "ERROR: invalid manager IP '$MANAGER_IP' (expected 4 octets, got $OCTET_COUNT)"
    exit 1
fi
for OCT in $(echo "$MANAGER_IP" | tr '.' ' '); do
    if [ "$OCT" -gt 255 ] 2>/dev/null; then
        log "ERROR: invalid manager IP '$MANAGER_IP' (octet $OCT > 255)"
        exit 1
    fi
done

# ---- Reusable chain-teardown helper -----------------------------------------
teardown_chains() {
    iptables -D INPUT   -j "$CHAIN" 2>/dev/null || true
    iptables -D OUTPUT  -j "$CHAIN" 2>/dev/null || true
    iptables -D FORWARD -j "$CHAIN" 2>/dev/null || true
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
    if command -v ip6tables >/dev/null 2>&1; then
        ip6tables -D INPUT   -j "$CHAIN" 2>/dev/null || true
        ip6tables -D OUTPUT  -j "$CHAIN" 2>/dev/null || true
        ip6tables -D FORWARD -j "$CHAIN" 2>/dev/null || true
        ip6tables -F "$CHAIN" 2>/dev/null || true
        ip6tables -X "$CHAIN" 2>/dev/null || true
    fi
}

case "$COMMAND" in
    add)
        # ---- Pre-flight: refuse if manager unreachable ----------------------
        # Isolating with manager unreachable would orphan the agent — the
        # un-isolate command could never be delivered.
        REACHABLE=0
        for PORT in 1514 1515 55000; do
            if command -v nc >/dev/null 2>&1; then
                if nc -z -w 2 "$MANAGER_IP" "$PORT" 2>/dev/null; then
                    REACHABLE=1; break
                fi
            else
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

        # ---- Idempotent teardown of any prior isolation ---------------------
        teardown_chains

        # ============================================================
        # IPv4 ISOLATION
        # ============================================================
        iptables -N "$CHAIN"

        # Allow loopback (system services rely on it)
        iptables -A "$CHAIN" -i lo -j ACCEPT
        iptables -A "$CHAIN" -o lo -j ACCEPT

        # Preserve in-flight TCP session that delivered THIS AR command (from
        # manager) so the script can return cleanly. ONLY manager-related
        # ESTABLISHED flows survive — pre-existing SSH/whatever from a non-
        # manager host gets dropped along with everything else.
        iptables -A "$CHAIN" -s "$MANAGER_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT
        iptables -A "$CHAIN" -d "$MANAGER_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT

        # Outbound to manager: only AR/heartbeat ports (TCP 1514/1515/55000)
        iptables -A "$CHAIN" -d "$MANAGER_IP" -p tcp -m multiport --dports 1514,1515,55000 -j ACCEPT

        # Inbound from manager: any port (so forensic tooling driven from
        # the manager can reach agent services)
        iptables -A "$CHAIN" -s "$MANAGER_IP" -j ACCEPT

        # Everything else: DROP
        iptables -A "$CHAIN" -j DROP

        # Insert at position 1 so we evaluate before any existing rules
        iptables -I INPUT   1 -j "$CHAIN"
        iptables -I OUTPUT  1 -j "$CHAIN"
        # FORWARD too — closes transit-bypass on routers / containers / dual-homed
        iptables -I FORWARD 1 -j "$CHAIN"

        # ============================================================
        # IPv6 ISOLATION (manager is IPv4-only → drop ALL IPv6)
        # ============================================================
        if command -v ip6tables >/dev/null 2>&1; then
            ip6tables -N "$CHAIN"
            ip6tables -A "$CHAIN" -i lo -j ACCEPT
            ip6tables -A "$CHAIN" -o lo -j ACCEPT
            ip6tables -A "$CHAIN" -j DROP
            ip6tables -I INPUT   1 -j "$CHAIN"
            ip6tables -I OUTPUT  1 -j "$CHAIN"
            ip6tables -I FORWARD 1 -j "$CHAIN"
            log "IPv6 fully blocked (manager is IPv4-only; revisit if manager moves to IPv6)"
        else
            log "WARN: ip6tables not available — IPv6 traffic NOT blocked. Verify host has no IPv6 connectivity."
        fi

        log "Isolation applied (manager=$MANAGER_IP whitelisted; all other IPv4 + all IPv6 dropped)"
        ;;

    delete)
        teardown_chains
        log "Isolation removed"
        ;;

    *)
        log "ERROR: unknown command '$COMMAND' (expected 'add' or 'delete')"
        exit 1
        ;;
esac

exit 0
