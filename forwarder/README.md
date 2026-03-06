# CyberSentinel Forwarder

A stateless, production-grade Python service that reads CyberSentinel EDR alerts and forwards matching alerts to SOAR playbook webhooks.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CyberSentinel Forwarder                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │ Alert Reader │───▶│ Rule Engine  │───▶│ Webhook      │                  │
│  │              │    │              │    │ Sender       │                  │
│  │ - JSONL      │    │ - Match      │    │              │                  │
│  │ - JSON Array │    │ - Priority   │    │ - Async HTTP │                  │
│  │ - Streaming  │    │ - Multi-dest │    │ - Retry      │                  │
│  └──────────────┘    └──────────────┘    │ - Backoff    │                  │
│         │                                 │ - HMAC Sign  │                  │
│         ▼                                 └──────────────┘                  │
│  ┌──────────────┐                                │                          │
│  │ Offset       │                                │                          │
│  │ Manager      │                                ▼                          │
│  │              │                    ┌───────────────────────┐              │
│  │ .forwarder_  │                    │ SOAR Webhook          │              │
│  │ offset       │                    │ /api/webhooks/:id/:s  │              │
│  └──────────────┘                    └───────────────────────┘              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Data Flow:
──────────
                                                            ┌─────────────────┐
┌─────────────────┐     ┌──────────────┐                    │ Playbook A      │
│ CyberSentinel   │     │              │    Match ────────▶ │ (Brute Force)   │
│ EDR             │────▶│  Forwarder   │                    └─────────────────┘
│ alerts.jsonl    │     │              │    Match ────────▶ ┌─────────────────┐
└─────────────────┘     │              │                    │ Playbook B      │
                        │              │                    │ (Malware)       │
                        │              │    No Match ──▶ X  └─────────────────┘
                        │              │    (Dropped)
                        └──────────────┘
```

## Key Features

- **Stateless Operation**: Only persists reading offset for restart recovery
- **Rule-Based Routing**: Flexible YAML-based matching rules
- **Multi-Destination**: One alert can trigger multiple playbooks
- **Exponential Backoff**: Configurable retry strategy
- **HMAC Authentication**: Optional payload signing
- **No Alert Storage**: Pure forwarding, no database

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Configure Routing Rules

Edit `routing_rules.yaml` to define your alert-to-playbook routing.

### 4. Run the Forwarder

```bash
python forwarder.py
```

### Docker Deployment

```bash
# Build image
docker build -t cybersentinel-forwarder .

# Run with mounted alert file and config
docker run -d \
  --name forwarder \
  -v /var/log/cybersentinel:/var/log/cybersentinel:ro \
  -v $(pwd)/routing_rules.yaml:/app/routing_rules.yaml:ro \
  -v forwarder-data:/app/data \
  -e SOAR_BASE_URL=http://soar:3001 \
  cybersentinel-forwarder
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALERT_SOURCE` | Path to alert file | `/var/log/cybersentinel/alerts.json` |
| `ALERT_FORMAT` | Format: `json`, `jsonl`, `ndjson` | `jsonl` |
| `ROUTING_RULES` | Path to routing rules YAML | `routing_rules.yaml` |
| `OFFSET_FILE` | Path to offset persistence file | `.forwarder_offset` |
| `MAX_RETRIES` | Maximum retry attempts | `3` |
| `RETRY_BASE_DELAY` | Initial retry delay (seconds) | `1.0` |
| `RETRY_MAX_DELAY` | Maximum retry delay (seconds) | `30.0` |
| `MAX_CONCURRENT` | Maximum concurrent requests | `10` |
| `DEFAULT_TIMEOUT` | Request timeout (seconds) | `30` |
| `HMAC_SECRET` | HMAC signing secret (optional) | None |
| `LOG_LEVEL` | Logging level | `INFO` |
| `POLL_INTERVAL` | File check interval (seconds) | `1.0` |
| `BATCH_SIZE` | Alerts per batch | `100` |

### Routing Rules Schema

```yaml
rules:
  - name: "Rule Name"
    enabled: true
    priority: 10        # Lower = higher priority
    match:
      "field.path":
        - "value1"
        - "value2"
    forward_to:
      - webhook_url: "https://soar/api/webhooks/PB-001/SECRET"
        timeout: 30
        headers:
          X-Custom: "value"
```

### Match Operators

| Operator | Example | Description |
|----------|---------|-------------|
| Exact | `"5710"` | Exact string match |
| Regex | `"regex:^5[0-9]+$"` | Regular expression |
| Greater Than | `"gt:10"` | Numeric comparison |
| Less Than | `"lt:100"` | Numeric comparison |
| Contains | `"contains:ssh"` | Substring match |
| Exists | `"exists:true"` | Field existence check |

## Dry-Run Mode

Enable dry-run mode to test routing rules without sending HTTP requests:

```bash
export FORWARDER_DRY_RUN=true
python forwarder.py
```

**Behavior in dry-run mode:**
- Evaluates all routing rules normally
- Logs intended webhook destinations
- Does NOT send any HTTP requests
- Does NOT commit offset (safe restart)

**Example output:**
```
[DRY-RUN] Would forward to: rule=SSH Brute Force Response url=http://localhost:3001/api/webhooks/PB-E****
[DRY-RUN] Would forward to: rule=Malware Detection Response url=http://localhost:3001/api/webhooks/PB-M****
```

## Offset Handling

The forwarder maintains a `.forwarder_offset` file to track the last processed position:

```json
{
  "offset": 12345,
  "updated_at": "2026-01-16T10:30:00Z",
  "alerts_processed": 100
}
```

**Behavior:**
- On startup, reads from saved offset position
- Saves offset periodically (every N alerts) and on shutdown
- If offset file is missing, starts from beginning
- If source file is smaller than offset, resets to beginning

### Offset Commit Logic (Critical)

The offset commit strategy ensures **at-least-once delivery** semantics:

```
OFFSET COMMIT DECISION MATRIX
═══════════════════════════════════════════════════════════════════════════════
 Scenario              │ Webhooks │ Offset Committed? │ Alert Re-processed?
═══════════════════════════════════════════════════════════════════════════════
 No match              │ 0/0      │ ✅ YES            │ No (intentional drop)
 All succeed           │ 3/3      │ ✅ YES            │ No
 Partial success       │ 2/3      │ ✅ YES            │ No (failures logged)
 All fail              │ 0/3      │ ❌ NO             │ Yes (on restart)
 Dry-run mode          │ N/A      │ ❌ NO             │ Yes (always)
═══════════════════════════════════════════════════════════════════════════════
```

**Critical Rules:**
1. Offset advances ONLY if ≥1 webhook delivery succeeds
2. If ALL deliveries fail → offset NOT committed → alert will retry on restart
3. Partial success → offset commits, failed destinations logged but NOT retried via replay
4. No match → offset commits (alert intentionally dropped per routing rules)

**Code reference:** `forwarder.py:_process_single_alert()` lines 873-952

## Retry & Backoff Strategy

The forwarder uses exponential backoff for failed webhook calls:

```
Attempt 1: Immediate
Attempt 2: Wait 1.0s  (base_delay * 2^0)
Attempt 3: Wait 2.0s  (base_delay * 2^1)
Attempt 4: Wait 4.0s  (base_delay * 2^2)
...
Maximum:   Wait 30.0s (max_delay cap)
```

**Non-retryable errors (4xx):** Immediately fail, no retry
**Retryable errors (5xx, timeout, network):** Retry with backoff

## Failure Scenario Matrix

This matrix documents forwarder behavior across all failure scenarios:

```
FAILURE SCENARIO MATRIX
═══════════════════════════════════════════════════════════════════════════════════════════
 Scenario                    │ Behavior                         │ Offset │ Alert Lost?
═══════════════════════════════════════════════════════════════════════════════════════════
 ALL DESTINATIONS SUCCESS    │ All webhooks return 202          │ ✅ Commit │ No
───────────────────────────────────────────────────────────────────────────────────────────
 PARTIAL SUCCESS             │ 1+ succeed, 1+ fail              │ ✅ Commit │ No
                             │ Failed destinations logged       │         │ (partial delivery)
                             │ No replay retry for failures     │         │
───────────────────────────────────────────────────────────────────────────────────────────
 ALL DESTINATIONS FAIL       │ All return non-202 after retries │ ❌ No    │ No
                             │ Alert reprocessed on restart     │         │ (retry on restart)
───────────────────────────────────────────────────────────────────────────────────────────
 NETWORK TIMEOUT             │ Request timeout after max_delay  │ ❌ No    │ No
 (all destinations)          │ Counted as failure, retry later  │         │ (retry on restart)
───────────────────────────────────────────────────────────────────────────────────────────
 4xx CLIENT ERROR            │ Immediate failure, no retry      │ Depends │ Depends
                             │ (bad payload, auth error)        │ on others│ on others
───────────────────────────────────────────────────────────────────────────────────────────
 5xx SERVER ERROR            │ Retry with exponential backoff   │ Depends │ Depends
                             │ Up to MAX_RETRIES attempts       │ on others│ on others
───────────────────────────────────────────────────────────────────────────────────────────
 SLOW WEBHOOK                │ Does NOT block other webhooks    │ N/A     │ No
                             │ Semaphore-bounded concurrency    │         │
───────────────────────────────────────────────────────────────────────────────────────────
 FILE READ ERROR             │ Skip batch, retry next poll      │ ❌ No    │ No
───────────────────────────────────────────────────────────────────────────────────────────
 INVALID JSON LINE           │ Skip line, log warning           │ ✅ Skip  │ Yes (malformed)
───────────────────────────────────────────────────────────────────────────────────────────
 DRY-RUN MODE                │ Log destinations, no HTTP        │ ❌ No    │ No
═══════════════════════════════════════════════════════════════════════════════════════════
```

### Non-Blocking Guarantees

The forwarder guarantees that one slow or failing webhook **NEVER blocks**:

1. **File reading** - Alert reader is independent of webhook delivery
2. **Other webhook deliveries** - `asyncio.gather()` runs all sends concurrently
3. **Main processing loop** - Semaphore limits concurrency but doesn't serialize

**Concurrency control:**
- `MAX_CONCURRENT` (default: 10) limits simultaneous HTTP requests
- Each webhook uses `async with self._semaphore` for bounded admission
- Slow webhooks consume semaphore slots but don't block the queue

## Security Considerations

### 1. Webhook Secret Protection

- Store secrets in environment variables, never in code
- Use `${VAR}` syntax in `routing_rules.yaml` for secret expansion
- Rotate webhook secrets periodically

### 2. HMAC Payload Signing

Enable HMAC signing for webhook authentication:

```bash
export HMAC_SECRET="your-32-char-secret-key"
```

The forwarder adds a header:
```
X-CyberSentinel-Signature: sha256=<hex-digest>
```

### 3. Network Security

- Run forwarder in isolated network segment
- Use TLS for webhook URLs (https://)
- Implement firewall rules to restrict outbound traffic

### 4. File Permissions

- Alert source: Read-only access
- Offset file: Read-write in dedicated directory
- Config files: Read-only, owned by root

### 5. Container Security

- Runs as non-root user (`forwarder`)
- Read-only root filesystem (except data volume)
- No capabilities required

## Test Plan

### Unit Tests

```bash
# Run unit tests
pytest tests/ -v
```

### Integration Test Plan

#### Test 1: Basic Alert Forwarding

**Setup:**
1. Start SOAR backend with test playbook
2. Configure routing rule matching the test playbook
3. Create test alert file

**Steps:**
```bash
# 1. Create test alert
echo '{"rule":{"id":"5710"},"severity":"high","agent":{"name":"test"}}' > /tmp/test_alerts.jsonl

# 2. Configure forwarder
export ALERT_SOURCE=/tmp/test_alerts.jsonl
export ALERT_FORMAT=jsonl

# 3. Run forwarder
python forwarder.py

# 4. Verify execution created in SOAR
curl http://localhost:3001/api/executions
```

**Expected Result:** Execution created with `state: EXECUTING`

#### Test 2: Multi-Destination Routing

**Steps:**
1. Configure rule with multiple `forward_to` targets
2. Send matching alert
3. Verify both webhooks receive the alert

#### Test 3: Rule Priority

**Steps:**
1. Configure two rules matching same alert
2. Rule A (priority: 10), Rule B (priority: 20)
3. With `continue_on_match: false`, only Rule A should trigger

#### Test 4: Retry Behavior

**Steps:**
1. Configure webhook to unavailable endpoint
2. Send alert
3. Verify retry attempts with increasing delays
4. Check logs for retry messages

#### Test 5: Offset Recovery

**Steps:**
1. Process 100 alerts, note offset
2. Kill forwarder (SIGTERM)
3. Add 50 more alerts
4. Restart forwarder
5. Verify only new 50 alerts processed

#### Test 6: HMAC Verification

**Steps:**
1. Enable HMAC_SECRET
2. Capture webhook request
3. Verify X-CyberSentinel-Signature header present
4. Manually verify signature matches payload

#### Test 7: Partial Success (Multi-Destination)

**Setup:**
1. Configure rule with 3 forward_to destinations
2. Make destination 1 and 3 available (return 202)
3. Make destination 2 unavailable (503 or timeout)

**Steps:**
```bash
# 1. Start mock servers
# Server 1: returns 202 (success)
# Server 2: returns 503 (fail)
# Server 3: returns 202 (success)

# 2. Send alert matching the multi-destination rule
echo '{"rule":{"id":"87100"},"severity":"critical"}' >> /tmp/test.jsonl

# 3. Run forwarder
python forwarder.py

# 4. Check logs
```

**Expected Result:**
- ✅ Offset IS committed (2/3 succeeded)
- ✅ Log shows: "Partial success: 2/3 destinations succeeded"
- ✅ Failed destination logged with error details
- ❌ Alert NOT reprocessed on restart

#### Test 8: All Destinations Failing

**Setup:**
1. Configure rule with 2 forward_to destinations
2. Make ALL destinations unavailable

**Steps:**
```bash
# 1. Configure webhooks pointing to non-existent endpoints
# 2. Send matching alert
echo '{"rule":{"id":"5710"},"severity":"high"}' >> /tmp/test.jsonl

# 3. Run forwarder, wait for retry exhaustion
python forwarder.py

# 4. Check offset file - should NOT have advanced
cat .forwarder_offset

# 5. Restart forwarder - alert should be reprocessed
```

**Expected Result:**
- ❌ Offset NOT committed
- ✅ Log shows: "ALL 2 webhook deliveries failed for alert. Offset NOT committed"
- ✅ On restart, same alert is reprocessed

#### Test 9: Dry-Run Mode

**Steps:**
```bash
# 1. Enable dry-run mode
export FORWARDER_DRY_RUN=true

# 2. Add test alerts
echo '{"rule":{"id":"5710"},"severity":"high"}' >> /tmp/test.jsonl
echo '{"rule":{"id":"87100"},"severity":"critical"}' >> /tmp/test.jsonl

# 3. Run forwarder
python forwarder.py

# 4. Verify NO HTTP requests sent (check SOAR logs)
# 5. Verify offset file unchanged
cat .forwarder_offset
```

**Expected Result:**
- ✅ Log shows: "[DRY-RUN] Would forward to: rule=..."
- ❌ No HTTP requests sent (verify with tcpdump or SOAR logs)
- ❌ Offset NOT committed
- ✅ All alerts will be reprocessed when dry-run disabled

#### Test 10: Concurrency Stress Test

**Setup:**
1. Configure MAX_CONCURRENT=5
2. Create slow webhook endpoint (2s response time)
3. Generate 100 alerts matching slow webhook

**Steps:**
```bash
# 1. Start slow mock server
# Returns 202 after 2 second delay

# 2. Generate 100 test alerts
for i in $(seq 1 100); do
  echo "{\"rule\":{\"id\":\"5710\"},\"severity\":\"high\",\"seq\":$i}" >> /tmp/stress.jsonl
done

# 3. Set concurrency limit
export MAX_CONCURRENT=5

# 4. Run forwarder and monitor
python forwarder.py &
watch -n1 'netstat -an | grep ESTABLISHED | grep :3001 | wc -l'
```

**Expected Result:**
- ✅ Never more than 5 concurrent connections
- ✅ All 100 alerts eventually processed
- ✅ File reading NOT blocked during slow deliveries
- ✅ Total time ≈ 100/5 * 2s = 40s (not 200s if serialized)

#### Test 11: Payload Immutability Verification

**Steps:**
```bash
# 1. Create test alert with specific content
echo '{"exact":"payload","with":123,"nested":{"data":true}}' > /tmp/immutable.jsonl

# 2. Capture webhook request body (use netcat or mock server)
nc -l 8080 > /tmp/received_payload.json &

# 3. Configure forwarder to send to localhost:8080
# 4. Run forwarder
# 5. Compare payloads byte-for-byte
diff <(cat /tmp/immutable.jsonl | tr -d '\n') /tmp/received_payload.json
```

**Expected Result:**
- ✅ Payloads are BIT-FOR-BIT identical
- ❌ No added fields (no timestamps, no source info)
- ❌ No removed fields
- ❌ No reordering of JSON keys
- ✅ Only difference: HTTP headers (Content-Type, HMAC signature)

### Load Test

```bash
# Generate 10000 test alerts
for i in $(seq 1 10000); do
  echo "{\"rule\":{\"id\":\"5710\"},\"severity\":\"high\",\"seq\":$i}" >> /tmp/load_test.jsonl
done

# Run forwarder and measure throughput
time python forwarder.py
```

**Target:** > 1000 alerts/second throughput

## Monitoring

### Log Output

```
2026-01-16 10:30:00 [INFO] CyberSentinelForwarder: Initializing...
2026-01-16 10:30:00 [INFO] CyberSentinelForwarder: Loaded 6 routing rules
2026-01-16 10:30:01 [INFO] CyberSentinelForwarder: Alert forwarded via 'SSH Brute Force' -> execution_id: EXE-20260116-A1B2C3
2026-01-16 10:30:02 [WARNING] CyberSentinelForwarder: Retry 1/3 for 'Malware Detection' after 1.0s: Request timeout
2026-01-16 10:30:05 [INFO] CyberSentinelForwarder: Statistics - Runtime: 300.0s, Read: 1500, Matched: 450, Dropped: 1050, Sent: 450, Failed: 2, Retried: 5
```

### Metrics to Monitor

- `alerts_read`: Total alerts read from source
- `alerts_matched`: Alerts matching at least one rule
- `alerts_dropped`: Alerts not matching any rule
- `webhooks_sent`: Successful webhook deliveries
- `webhooks_failed`: Failed webhook deliveries
- `webhooks_retried`: Total retry attempts

## Troubleshooting

### Alert Not Forwarding

1. Check rule is enabled
2. Verify field paths match alert structure
3. Check severity matches (case-sensitive)
4. Review logs at DEBUG level

### Webhook Failures

1. Verify webhook URL is correct
2. Check SOAR is running and accessible
3. Verify webhook secret matches playbook
4. Check network connectivity

### High Memory Usage

1. Reduce `BATCH_SIZE`
2. Reduce `MAX_CONCURRENT`
3. Check for memory leaks in custom rules

## License

Copyright 2026 CyberSentinel SOAR Team. All rights reserved.
