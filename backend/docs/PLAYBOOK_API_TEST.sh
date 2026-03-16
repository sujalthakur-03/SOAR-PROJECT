#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# CYBERSENTINEL SOAR v3.0 — PLAYBOOK API TEST SCRIPT
# ══════════════════════════════════════════════════════════════════════════════
#
# Tests all Playbook Management API endpoints with authentication.
#
# Usage:
#   ./PLAYBOOK_API_TEST.sh [base_url]
#
# Default base URL: http://localhost:3001/api/v2
# Login: soaradmin / CyberSentinelSOAR@2026
#
# ══════════════════════════════════════════════════════════════════════════════

set -e

# Configuration
BASE_URL="${1:-http://localhost:3001/api/v2}"
AUTH_URL="${BASE_URL%/api/v2}/auth"
SAMPLES_FILE="${2:-./PLAYBOOK_SAMPLES.json}"

AUTH_USER="${SOAR_TEST_USER:-soaradmin}"
AUTH_PASS="${SOAR_TEST_PASS:-CyberSentinelSOAR@2026}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# ── Auth ─────────────────────────────────────────────────────────────────────

get_token() {
    echo -e "${BLUE}Authenticating as ${AUTH_USER}...${NC}"

    TOKEN_RESPONSE=$(curl -s -X POST "${AUTH_URL}/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${AUTH_USER}\",\"password\":\"${AUTH_PASS}\"}")

    TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"token" *: *"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")

    if [ -z "$TOKEN" ]; then
        echo -e "${RED}Failed to authenticate. Response:${NC}"
        echo "$TOKEN_RESPONSE"
        exit 1
    fi

    AUTH_HEADER="Authorization: Bearer ${TOKEN}"
    echo -e "${GREEN}Authenticated successfully${NC}"
    echo ""
}

# ── Helpers ──────────────────────────────────────────────────────────────────

print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

print_test() {
    local test_name="$1"
    local status="$2"

    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓ PASS${NC}: $test_name"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $test_name"
        ((TESTS_FAILED++))
    fi
}

test_api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local expected_status="$4"
    local description="$5"

    echo ""
    echo -e "${YELLOW}Testing:${NC} $description"
    echo -e "${YELLOW}Method:${NC} $method $endpoint"

    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${BASE_URL}${endpoint}" \
            -H "Content-Type: application/json" \
            -H "${AUTH_HEADER}" \
            -d "$data")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${BASE_URL}${endpoint}" \
            -H "${AUTH_HEADER}")
    fi

    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    echo -e "${YELLOW}Response Status:${NC} $status_code"
    echo -e "${YELLOW}Response Body:${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"

    if [ "$status_code" = "$expected_status" ]; then
        print_test "$description" "PASS"
        return 0
    else
        print_test "$description (Expected $expected_status, got $status_code)" "FAIL"
        return 1
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN TEST SUITE
# ══════════════════════════════════════════════════════════════════════════════

print_header "CYBERSENTINEL SOAR — PLAYBOOK API TEST SUITE"
echo "Base URL: $BASE_URL"
echo "Auth URL: $AUTH_URL"

# Authenticate first
get_token

# Check if samples file exists
if [ ! -f "$SAMPLES_FILE" ]; then
    echo -e "${YELLOW}WARN:${NC} Samples file not found: $SAMPLES_FILE"
    echo "Running basic tests without sample playbooks..."
    echo ""

    # ── Basic tests without samples file ─────────────────────────────────────

    print_header "TEST 1: LIST PLAYBOOKS"
    test_api_call "GET" "/playbooks" "" "200" "List all playbooks"

    print_header "TEST 2: CREATE SIMPLE PLAYBOOK"
    simple_pb='{
        "name": "API Test Playbook",
        "description": "Created by test script",
        "dsl": {
            "trigger_type": "webhook",
            "steps": [{
                "step_id": "notify",
                "name": "Send Notification",
                "type": "notification",
                "connector_id": "slack",
                "action_type": "send_message",
                "input": {"channel": "literal:#soc-alerts", "message_template": "literal:Test alert"},
                "on_success": {"behavior": "end"},
                "on_failure": "continue",
                "timeout_seconds": 30
            }]
        }
    }'
    test_api_call "POST" "/playbooks" "$simple_pb" "201" "Create simple notification playbook" || true

    # Get the created playbook ID from the last response
    CREATED_ID=$(echo "$body" | jq -r '.playbook_id' 2>/dev/null || echo "")

    if [ -n "$CREATED_ID" ] && [ "$CREATED_ID" != "null" ]; then
        print_header "TEST 3: GET SPECIFIC PLAYBOOK"
        test_api_call "GET" "/playbooks/${CREATED_ID}" "" "200" "Get created playbook by ID"

        print_header "TEST 4: UPDATE PLAYBOOK"
        update_payload='{"name": "API Test Playbook UPDATED", "change_summary": "Updated by test script"}'
        test_api_call "PUT" "/playbooks/${CREATED_ID}" "$update_payload" "200" "Update playbook (creates version 2)"

        print_header "TEST 5: GET VERSION HISTORY"
        test_api_call "GET" "/playbooks/${CREATED_ID}/versions" "" "200" "Get version history"

        print_header "TEST 6: TOGGLE PLAYBOOK"
        test_api_call "PATCH" "/playbooks/${CREATED_ID}/toggle" '{"enabled": false}' "200" "Disable playbook"
        test_api_call "PATCH" "/playbooks/${CREATED_ID}/toggle" '{"enabled": true}' "200" "Enable playbook"
    fi

    print_header "TEST 7: ERROR CASES"
    test_api_call "GET" "/playbooks/PB-NONEXISTENT-999" "" "404" "Get non-existent playbook (should 404)"
    test_api_call "PUT" "/playbooks/PB-NONEXISTENT-999" '{"name":"x"}' "404" "Update non-existent playbook (should 404)"

else
    # ── Full tests with samples file ─────────────────────────────────────────

    echo "Samples File: $SAMPLES_FILE"

    print_header "TEST 1: CREATE VALID PLAYBOOKS"

    simple_pb=$(jq -c '.valid_playbooks.simple_notification.playbook' "$SAMPLES_FILE")
    test_api_call "POST" "/playbooks" "$simple_pb" "201" "Create simple notification playbook"

    complex_pb=$(jq -c '.valid_playbooks.enrichment_condition_action.playbook' "$SAMPLES_FILE")
    test_api_call "POST" "/playbooks" "$complex_pb" "201" "Create complex playbook"

    approval_pb=$(jq -c '.valid_playbooks.approval_workflow.playbook' "$SAMPLES_FILE")
    test_api_call "POST" "/playbooks" "$approval_pb" "201" "Create approval workflow playbook"

    shadow_pb=$(jq -c '.valid_playbooks.shadow_mode.playbook' "$SAMPLES_FILE")
    test_api_call "POST" "/playbooks" "$shadow_pb" "201" "Create shadow mode playbook"

    print_header "TEST 2: CREATE INVALID PLAYBOOKS (SHOULD FAIL)"

    for key in missing_on_false missing_on_timeout circular_reference invalid_step_reference duplicate_step_ids missing_connector_id; do
        invalid_pb=$(jq -c ".invalid_playbooks.${key}.playbook" "$SAMPLES_FILE" 2>/dev/null)
        if [ -n "$invalid_pb" ] && [ "$invalid_pb" != "null" ]; then
            test_api_call "POST" "/playbooks" "$invalid_pb" "400" "Reject playbook: ${key}"
        fi
    done

    print_header "TEST 3: DUPLICATE PLAYBOOK ID"
    test_api_call "POST" "/playbooks" "$simple_pb" "409" "Reject duplicate playbook_id"

    print_header "TEST 4: GET OPERATIONS"
    test_api_call "GET" "/playbooks" "" "200" "List all playbooks"
    test_api_call "GET" "/playbooks?all_versions=true" "" "200" "List all versions"
    test_api_call "GET" "/playbooks/PB-NOTIFY-001" "" "200" "Get specific playbook"
    test_api_call "GET" "/playbooks/PB-NOTIFY-001/versions" "" "200" "Get version history"
    test_api_call "GET" "/playbooks/PB-NONEXISTENT" "" "404" "Get non-existent (should 404)"

    print_header "TEST 5: UPDATE OPERATIONS"
    update_payload='{"name":"Updated Playbook","description":"Updated","change_summary":"Test update"}'
    test_api_call "PUT" "/playbooks/PB-NOTIFY-001" "$update_payload" "200" "Update playbook (version 2)"

    print_header "TEST 6: TOGGLE OPERATIONS"
    test_api_call "PATCH" "/playbooks/PB-NOTIFY-001/toggle" '{"enabled": false}' "200" "Disable playbook"
    test_api_call "PATCH" "/playbooks/PB-NOTIFY-001/toggle" '{"enabled": true}' "200" "Enable playbook"

    print_header "TEST 7: ERROR CASES"
    test_api_call "PUT" "/playbooks/PB-NONEXISTENT" "$update_payload" "404" "Update non-existent (should 404)"
    test_api_call "PATCH" "/playbooks/PB-NONEXISTENT/toggle" '{"enabled":false}' "404" "Toggle non-existent (should 404)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST: UNAUTHENTICATED ACCESS (SHOULD FAIL)
# ══════════════════════════════════════════════════════════════════════════════

print_header "TEST: UNAUTHENTICATED ACCESS"
echo ""
echo -e "${YELLOW}Testing:${NC} Unauthenticated request should be rejected"
unauth_status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/playbooks")
if [ "$unauth_status" = "401" ]; then
    print_test "Unauthenticated request returns 401" "PASS"
else
    print_test "Unauthenticated request returns 401 (got $unauth_status)" "FAIL"
fi

# ══════════════════════════════════════════════════════════════════════════════
# TEST SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

print_header "TEST SUMMARY"
echo ""
echo -e "${GREEN}Tests Passed:${NC} $TESTS_PASSED"
echo -e "${RED}Tests Failed:${NC} $TESTS_FAILED"
echo -e "Total Tests: $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}SOME TESTS FAILED${NC}"
    exit 1
fi
