/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — WEBHOOK SECURITY TEST SUITE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Test suite for webhook security hardening features.
 *
 * COVERAGE:
 * 1. IP Rate Limiting
 * 2. Replay Attack Prevention
 * 3. HMAC Signature Validation
 * 4. Execution Flood Control
 * 5. Security Observability
 *
 * USAGE:
 *   node tests/webhook-security.test.js
 *
 * VERSION: 1.0.0
 * ══════════════════════════════════════════════════════════════════════════════
 */

import crypto from 'crypto';
import webhookSecurity from '../src/middleware/webhook-security.js';

const {
  webhookSecurityMiddleware,
  validateHMACIfPresent,
  checkFloodControl,
  getSecurityMetrics,
  resetSecurityMetrics,
  CONFIG
} = webhookSecurity;

// ═══════════════════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

class TestResult {
  constructor(name) {
    this.name = name;
    this.passed = false;
    this.error = null;
    this.duration = 0;
  }

  pass() {
    this.passed = true;
  }

  fail(error) {
    this.passed = false;
    this.error = error;
  }
}

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

async function test(name, fn) {
  const result = new TestResult(name);
  const start = Date.now();

  try {
    await fn();
    result.pass();
  } catch (error) {
    result.fail(error);
  }

  result.duration = Date.now() - start;
  results.push(result);
}

// Mock request/response objects
function mockReq(overrides = {}) {
  return {
    params: {},
    headers: {},
    body: {},
    path: '/api/webhooks/WH-TEST/secret',
    method: 'POST',
    ip: '192.168.1.100',
    ...overrides
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    }
  };
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: IP RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

async function testIPRateLimiting() {
  console.log('\n═══ TEST SUITE 1: IP RATE LIMITING ═══\n');

  // Reset metrics before tests
  resetSecurityMetrics();

  await test('IP Rate Limit - Allow first request', async () => {
    const req = mockReq({ ip: '192.168.1.1' });
    const res = mockRes();
    let nextCalled = false;

    webhookSecurityMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert(nextCalled, 'Should call next() for first request');
    assertEqual(res.statusCode, 200, 'Should return 200 for allowed request');
  });

  await test('IP Rate Limit - Allow multiple requests under limit', async () => {
    const ip = '192.168.1.2';

    for (let i = 0; i < 10; i++) {
      const req = mockReq({
        ip,
        params: { webhook_id: `WH-TEST-${i}` },
        body: { alert: `test-${i}` }
      });
      const res = mockRes();
      let nextCalled = false;

      webhookSecurityMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert(nextCalled, `Request ${i + 1} should be allowed`);
    }
  });

  await test('IP Rate Limit - Block burst limit violation', async () => {
    const ip = '192.168.1.3';
    const burstLimit = CONFIG.IP_RATE_LIMIT.BURST_LIMIT;

    let blocked = false;

    // Send burst limit + 1 requests rapidly with unique payloads
    for (let i = 0; i <= burstLimit; i++) {
      const req = mockReq({
        ip,
        params: { webhook_id: `WH-BURST-${i}` },
        body: { alert: `burst-${i}` }
      });
      const res = mockRes();

      webhookSecurityMiddleware(req, res, () => {});

      if (res.statusCode === 429) {
        blocked = true;
        break;
      }
    }

    assert(blocked, 'Should block after exceeding burst limit');
  });

  await test('IP Rate Limit - Include Retry-After header', async () => {
    const ip = '192.168.1.4';
    const burstLimit = CONFIG.IP_RATE_LIMIT.BURST_LIMIT;

    let res;
    // Exceed burst limit with unique payloads
    for (let i = 0; i <= burstLimit; i++) {
      const req = mockReq({
        ip,
        params: { webhook_id: `WH-RETRY-${i}` },
        body: { alert: `retry-${i}` }
      });
      res = mockRes();
      webhookSecurityMiddleware(req, res, () => {});
    }

    assert(res.headers['Retry-After'], 'Should include Retry-After header');
    assert(res.jsonData.retry_after > 0, 'Should include retry_after in response');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: REPLAY ATTACK PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

async function testReplayPrevention() {
  console.log('\n═══ TEST SUITE 2: REPLAY ATTACK PREVENTION ═══\n');

  resetSecurityMetrics();

  await test('Replay Prevention - Accept request with valid timestamp', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const uniqueId = Date.now();
    const req = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: `WH-REPLAY-VALID-${uniqueId}` },
      body: { alert: `replay-valid-${uniqueId}` },
      ip: `192.168.2.${uniqueId % 250}`
    });
    const res = mockRes();
    let nextCalled = false;

    webhookSecurityMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert(nextCalled, 'Should accept request with valid timestamp');
  });

  await test('Replay Prevention - Reject old timestamp', async () => {
    // Timestamp 10 minutes ago (exceeds 5 minute skew)
    const timestamp = Math.floor(Date.now() / 1000) - (10 * 60);
    const uniqueId = Date.now();
    const req = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: `WH-REPLAY-OLD-${uniqueId}` },
      body: { alert: `replay-old-${uniqueId}` },
      ip: `192.168.3.${uniqueId % 250}`
    });
    const res = mockRes();

    webhookSecurityMiddleware(req, res, () => {});

    assertEqual(res.statusCode, 400, 'Should reject old timestamp');
    assert(res.jsonData && res.jsonData.code === 'TIMESTAMP_SKEW', 'Should return TIMESTAMP_SKEW error');
  });

  await test('Replay Prevention - Reject duplicate nonce', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const uniqueId = `replay-dup-${Date.now()}`;
    const webhookId = `WH-REPLAY-DUP-${Date.now()}`;
    const ip = `192.168.4.${Date.now() % 250}`;
    const payload = { alert: uniqueId };

    const req1 = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: webhookId },
      body: payload,
      ip: ip
    });
    const req2 = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: webhookId },
      body: payload,
      ip: ip
    });
    const res1 = mockRes();
    const res2 = mockRes();
    let next1Called = false;

    // First request should succeed
    webhookSecurityMiddleware(req1, res1, () => {
      next1Called = true;
    });

    // Second identical request should be blocked
    webhookSecurityMiddleware(req2, res2, () => {});

    assert(next1Called, 'First request should succeed');
    assertEqual(res2.statusCode, 400, 'Should reject duplicate request');
    assert(res2.jsonData && res2.jsonData.code === 'DUPLICATE_NONCE', 'Should return DUPLICATE_NONCE error');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: HMAC SIGNATURE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

async function testHMACValidation() {
  console.log('\n═══ TEST SUITE 3: HMAC SIGNATURE VALIDATION ═══\n');

  resetSecurityMetrics();

  const secret = 'test-webhook-secret-12345678901234567890123456789012';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = { alert: 'test' };

  function computeSignature(secret, timestamp, payload) {
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  await test('HMAC - Accept request without signature (backward compatible)', async () => {
    const req = mockReq({ body: payload });
    const result = validateHMACIfPresent(req, secret);

    assert(result.valid, 'Should accept request without signature');
    assert(!result.hmacUsed, 'Should indicate HMAC not used');
  });

  await test('HMAC - Accept request with valid signature', async () => {
    const signature = computeSignature(secret, timestamp, payload);
    const req = mockReq({
      headers: {
        'x-cybersentinel-timestamp': timestamp.toString(),
        'x-cybersentinel-signature': signature
      },
      body: payload
    });

    const result = validateHMACIfPresent(req, secret);

    assert(result.valid, 'Should accept request with valid signature');
    assert(result.hmacUsed, 'Should indicate HMAC was used');
  });

  await test('HMAC - Reject request with invalid signature', async () => {
    const invalidSignature = 'invalid-signature-1234567890abcdef';
    const req = mockReq({
      headers: {
        'x-cybersentinel-timestamp': timestamp.toString(),
        'x-cybersentinel-signature': invalidSignature
      },
      body: payload
    });

    const result = validateHMACIfPresent(req, secret);

    assert(!result.valid, 'Should reject request with invalid signature');
    assert(result.error, 'Should include error message');
  });

  await test('HMAC - Reject signature without timestamp', async () => {
    const signature = computeSignature(secret, timestamp, payload);
    const req = mockReq({
      headers: {
        'x-cybersentinel-signature': signature
      },
      body: payload
    });

    const result = validateHMACIfPresent(req, secret);

    assert(!result.valid, 'Should reject signature without timestamp');
    assert(result.code === 'MISSING_TIMESTAMP', 'Should return MISSING_TIMESTAMP error');
  });

  await test('HMAC - Reject expired timestamp with signature', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - (10 * 60); // 10 minutes ago
    const signature = computeSignature(secret, oldTimestamp, payload);
    const req = mockReq({
      headers: {
        'x-cybersentinel-timestamp': oldTimestamp.toString(),
        'x-cybersentinel-signature': signature
      },
      body: payload
    });

    const result = validateHMACIfPresent(req, secret);

    assert(!result.valid, 'Should reject expired timestamp');
    assert(result.code === 'TIMESTAMP_EXPIRED', 'Should return TIMESTAMP_EXPIRED error');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: EXECUTION FLOOD CONTROL
// ═══════════════════════════════════════════════════════════════════════════

async function testFloodControl() {
  console.log('\n═══ TEST SUITE 4: EXECUTION FLOOD CONTROL ═══\n');

  resetSecurityMetrics();

  await test('Flood Control - Allow executions under limit', async () => {
    const playbookId = 'PB-FLOOD-TEST-1';

    for (let i = 0; i < 10; i++) {
      const result = checkFloodControl(playbookId);
      assert(result.allowed, `Execution ${i + 1} should be allowed`);
    }
  });

  await test('Flood Control - Block per-playbook flood', async () => {
    const playbookId = 'PB-FLOOD-TEST-2';
    const maxExecutions = CONFIG.FLOOD_CONTROL.PER_PLAYBOOK_MAX;

    let blocked = false;

    // Attempt to exceed per-playbook limit
    for (let i = 0; i < maxExecutions + 5; i++) {
      const result = checkFloodControl(playbookId);
      if (!result.allowed && result.reason === 'PLAYBOOK_FLOOD_LIMIT') {
        blocked = true;
        break;
      }
    }

    assert(blocked, 'Should block per-playbook flood');
  });

  await test('Flood Control - Block global flood', async () => {
    const globalMax = CONFIG.FLOOD_CONTROL.GLOBAL_MAX;
    let blocked = false;

    // Attempt to exceed global limit with different playbooks
    for (let i = 0; i < globalMax + 10; i++) {
      const playbookId = `PB-GLOBAL-${i}`;
      const result = checkFloodControl(playbookId);
      if (!result.allowed && result.reason === 'GLOBAL_FLOOD_LIMIT') {
        blocked = true;
        break;
      }
    }

    assert(blocked, 'Should block global flood');
  });

  await test('Flood Control - Include reason in rejection', async () => {
    const playbookId = 'PB-FLOOD-TEST-3';
    const maxExecutions = CONFIG.FLOOD_CONTROL.PER_PLAYBOOK_MAX;

    // Exhaust limit
    for (let i = 0; i < maxExecutions; i++) {
      checkFloodControl(playbookId);
    }

    // Next request should be blocked
    const result = checkFloodControl(playbookId);

    assert(!result.allowed, 'Should block flood');
    assert(result.reason, 'Should include reason');
    assert(result.message, 'Should include message');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: SECURITY OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

async function testSecurityObservability() {
  console.log('\n═══ TEST SUITE 5: SECURITY OBSERVABILITY ═══\n');

  resetSecurityMetrics();

  await test('Metrics - Track rate limit events', async () => {
    const ip = '192.168.1.10';
    const burstLimit = CONFIG.IP_RATE_LIMIT.BURST_LIMIT;

    // Trigger rate limit with unique payloads
    for (let i = 0; i <= burstLimit + 1; i++) {
      const req = mockReq({
        ip,
        params: { webhook_id: `WH-METRICS-${i}` },
        body: { alert: `metrics-${i}` }
      });
      const res = mockRes();
      webhookSecurityMiddleware(req, res, () => {});
    }

    const metrics = getSecurityMetrics();
    assert(metrics.rate_limit.blocked > 0, 'Should track blocked requests');
    assert(metrics.rate_limit.allowed > 0, 'Should track allowed requests');
  });

  await test('Metrics - Track replay events', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const uniqueId = Date.now();
    const webhookId = `WH-REPLAY-METRICS-${uniqueId}`;
    const ip = `192.168.5.${uniqueId % 250}`;
    const payload = { alert: `replay-metrics-${uniqueId}` };

    // First request (allowed)
    const req1 = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: webhookId },
      body: payload,
      ip: ip
    });
    webhookSecurityMiddleware(req1, mockRes(), () => {});

    // Duplicate request (blocked)
    const req2 = mockReq({
      headers: { 'x-cybersentinel-timestamp': timestamp.toString() },
      params: { webhook_id: webhookId },
      body: payload,
      ip: ip
    });
    webhookSecurityMiddleware(req2, mockRes(), () => {});

    const metrics = getSecurityMetrics();
    assert(metrics.replay_protection.blocked > 0, 'Should track replay blocks');
    assert(metrics.replay_protection.allowed > 0, 'Should track allowed requests');
  });

  await test('Metrics - Include cache sizes', async () => {
    const metrics = getSecurityMetrics();

    assert('cache_sizes' in metrics, 'Should include cache sizes');
    assert('ip_rate_limit' in metrics.cache_sizes, 'Should include IP cache size');
    assert('nonce_cache' in metrics.cache_sizes, 'Should include nonce cache size');
    assert('playbook_rate' in metrics.cache_sizes, 'Should include playbook cache size');
  });

  await test('Metrics - Include uptime', async () => {
    const metrics = getSecurityMetrics();

    assert('uptime_ms' in metrics, 'Should include uptime in milliseconds');
    assert('uptime_human' in metrics, 'Should include human-readable uptime');
    assert(metrics.uptime_ms >= 0, 'Uptime should be non-negative');
  });

  await test('Metrics - Calculate block rate', async () => {
    resetSecurityMetrics();

    const ip = '192.168.1.11';

    // Allow some requests with unique payloads
    for (let i = 0; i < 5; i++) {
      const req = mockReq({
        ip: `192.168.1.${100 + i}`,
        params: { webhook_id: `WH-ALLOW-${i}` },
        body: { alert: `allow-${i}` }
      });
      webhookSecurityMiddleware(req, mockRes(), () => {});
    }

    // Block some requests with unique payloads
    const burstLimit = CONFIG.IP_RATE_LIMIT.BURST_LIMIT;
    for (let i = 0; i <= burstLimit + 1; i++) {
      const req = mockReq({
        ip,
        params: { webhook_id: `WH-BLOCK-${i}` },
        body: { alert: `block-${i}` }
      });
      webhookSecurityMiddleware(req, mockRes(), () => {});
    }

    const metrics = getSecurityMetrics();
    assert(metrics.rate_limit.block_rate, 'Should include block rate');
    assert(metrics.rate_limit.block_rate.includes('%'), 'Block rate should be a percentage');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                      ║');
  console.log('║     CYBERSENTINEL SOAR v3.0 — WEBHOOK SECURITY TEST SUITE            ║');
  console.log('║                                                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  await testIPRateLimiting();
  await testReplayPrevention();
  await testHMACValidation();
  await testFloodControl();
  await testSecurityObservability();

  const duration = Date.now() - startTime;

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('                           TEST RESULTS                                ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  results.forEach(result => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const icon = result.passed ? '✓' : '✗';
    console.log(`${icon} ${result.name} (${result.duration}ms)`);
    if (!result.passed) {
      console.log(`  Error: ${result.error.message}`);
    }

    if (result.passed) {
      passed++;
    } else {
      failed++;
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${duration}ms`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
