/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — WEBHOOK SECURITY MIDDLEWARE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * AGENT 12 IMPLEMENTATION: Runtime Security Hardening
 *
 * This middleware provides production-grade security protections for webhook
 * ingestion WITHOUT modifying existing architecture. All protections are
 * additive layers that wrap existing functionality.
 *
 * SECURITY FEATURES:
 * 1. Per-IP Rate Limiting with burst protection
 * 2. Replay Attack Prevention (timestamp validation + nonce cache)
 * 3. Optional HMAC Signature Verification (X-CyberSentinel-Signature)
 * 4. Execution Flood Control (per-playbook rate limits)
 * 5. Security Observability (structured rejection/violation logs)
 *
 * ARCHITECTURE CONSTRAINTS:
 * - NO modifications to Webhook, Execution, Trigger, or Playbook models
 * - NO changes to execution state machine
 * - Backward compatible with existing secret-in-URL authentication
 *
 * VERSION: 1.0.0
 * ══════════════════════════════════════════════════════════════════════════════
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Per-IP Rate Limiting
  IP_RATE_LIMIT: {
    WINDOW_MS: 60 * 1000,           // 1 minute window
    MAX_REQUESTS: 100,               // Max requests per IP per window
    BURST_LIMIT: 20,                 // Max burst in 5 seconds
    BURST_WINDOW_MS: 5 * 1000,       // 5 second burst window
    BLOCK_DURATION_MS: 5 * 60 * 1000 // 5 minute block for abuse
  },

  // Replay Attack Prevention
  REPLAY_PROTECTION: {
    MAX_TIMESTAMP_SKEW_MS: 5 * 60 * 1000,  // 5 minute timestamp tolerance
    NONCE_TTL_MS: 10 * 60 * 1000,           // 10 minute nonce cache
    FINGERPRINT_TTL_MS: 5 * 60 * 1000       // 5 minute fingerprint dedup
  },

  // HMAC Signature Verification
  HMAC: {
    HEADER_NAME: 'x-cybersentinel-signature',
    TIMESTAMP_HEADER: 'x-cybersentinel-timestamp',
    ALGORITHM: 'sha256',
    TOLERANCE_MS: 5 * 60 * 1000  // 5 minute timestamp tolerance
  },

  // Execution Flood Control
  FLOOD_CONTROL: {
    PER_PLAYBOOK_WINDOW_MS: 60 * 1000,  // 1 minute window
    PER_PLAYBOOK_MAX: 50,                // Max executions per playbook per window
    GLOBAL_WINDOW_MS: 60 * 1000,         // 1 minute global window
    GLOBAL_MAX: 500                       // Max global executions per window
  },

  // Cache cleanup interval
  CLEANUP_INTERVAL_MS: 60 * 1000  // Clean caches every minute
};

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY CACHES (Production: Use Redis for distributed deployment)
// ═══════════════════════════════════════════════════════════════════════════

// Per-IP rate limiting cache
// Structure: { ip: { count: number, windowStart: number, burstCount: number, burstStart: number, blockedUntil: number } }
const ipRateLimitCache = new Map();

// Nonce cache for replay prevention
// Structure: { nonce: timestamp }
const nonceCache = new Map();

// Per-playbook execution rate cache
// Structure: { playbook_id: { count: number, windowStart: number } }
const playbookRateCache = new Map();

// Global execution rate counter
let globalExecCounter = { count: 0, windowStart: Date.now() };

// Security event counters for observability
const securityMetrics = {
  rateLimit: { blocked: 0, allowed: 0 },
  replay: { blocked: 0, allowed: 0 },
  hmac: { valid: 0, invalid: 0, skipped: 0 },
  flood: { blocked: 0, allowed: 0 },
  startTime: Date.now()
};

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log a security event with structured data
 */
function logSecurityEvent(eventType, details, severity = 'warn') {
  const event = {
    type: 'SECURITY_EVENT',
    event_type: eventType,
    timestamp: new Date().toISOString(),
    ...details
  };

  if (severity === 'error') {
    logger.error('Security violation', event);
  } else if (severity === 'warn') {
    logger.warn('Security event', event);
  } else {
    logger.info('Security event', event);
  }

  return event;
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-IP RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract client IP from request (supports proxies)
 */
function getClientIP(req) {
  // Trust X-Forwarded-For if behind a proxy (configure appropriately in production)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Get the first IP in the chain (original client)
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Check if IP is rate limited
 * Returns: { allowed: boolean, reason?: string, retryAfter?: number }
 */
function checkIPRateLimit(ip) {
  const now = Date.now();
  const config = CONFIG.IP_RATE_LIMIT;

  // Get or create rate limit entry
  let entry = ipRateLimitCache.get(ip);
  if (!entry) {
    entry = {
      count: 0,
      windowStart: now,
      burstCount: 0,
      burstStart: now,
      blockedUntil: 0
    };
    ipRateLimitCache.set(ip, entry);
  }

  // Check if IP is blocked
  if (entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      reason: 'IP_BLOCKED',
      retryAfter,
      message: `IP temporarily blocked for abuse. Retry after ${retryAfter} seconds.`
    };
  }

  // Reset window if expired
  if (now - entry.windowStart > config.WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  // Reset burst window if expired
  if (now - entry.burstStart > config.BURST_WINDOW_MS) {
    entry.burstCount = 0;
    entry.burstStart = now;
  }

  // Check burst limit
  if (entry.burstCount >= config.BURST_LIMIT) {
    // Block IP for repeated burst violations
    entry.blockedUntil = now + config.BLOCK_DURATION_MS;
    return {
      allowed: false,
      reason: 'BURST_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(config.BLOCK_DURATION_MS / 1000),
      message: 'Burst rate limit exceeded. IP temporarily blocked.'
    };
  }

  // Check rate limit
  if (entry.count >= config.MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.windowStart + config.WINDOW_MS - now) / 1000);
    return {
      allowed: false,
      reason: 'RATE_LIMIT_EXCEEDED',
      retryAfter,
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`
    };
  }

  // Allow request and increment counters
  entry.count++;
  entry.burstCount++;

  return { allowed: true };
}

/**
 * Express middleware for per-IP rate limiting
 */
export function ipRateLimitMiddleware(req, res, next) {
  const ip = getClientIP(req);
  const result = checkIPRateLimit(ip);

  if (!result.allowed) {
    securityMetrics.rateLimit.blocked++;

    logSecurityEvent('IP_RATE_LIMIT', {
      ip,
      reason: result.reason,
      path: req.path,
      method: req.method,
      user_agent: req.headers['user-agent']
    });

    res.set('Retry-After', result.retryAfter);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: result.message,
      retry_after: result.retryAfter
    });
  }

  securityMetrics.rateLimit.allowed++;
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY ATTACK PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate request nonce from payload
 */
function generateNonce(webhookId, payload, timestamp) {
  const data = JSON.stringify({ webhookId, payload, timestamp });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Check for replay attack
 * Returns: { allowed: boolean, reason?: string }
 */
function checkReplayAttack(webhookId, payload, requestTimestamp) {
  const now = Date.now();
  const config = CONFIG.REPLAY_PROTECTION;

  // Validate timestamp if provided
  if (requestTimestamp) {
    let ts;

    // Parse timestamp (support ISO 8601 or Unix epoch)
    if (typeof requestTimestamp === 'string') {
      // Try parseInt first (for Unix epoch strings like "1769079930")
      const parsedInt = parseInt(requestTimestamp, 10);
      if (!isNaN(parsedInt)) {
        // Handle seconds vs milliseconds
        ts = parsedInt > 1e12 ? parsedInt : parsedInt * 1000;
      } else {
        // Try ISO 8601 parsing
        ts = new Date(requestTimestamp).getTime();
      }
    } else if (typeof requestTimestamp === 'number') {
      // Handle seconds vs milliseconds
      ts = requestTimestamp > 1e12 ? requestTimestamp : requestTimestamp * 1000;
    }

    if (isNaN(ts)) {
      return {
        allowed: false,
        reason: 'INVALID_TIMESTAMP',
        message: 'Invalid timestamp format'
      };
    }

    // Check timestamp skew
    const skew = Math.abs(now - ts);
    if (skew > config.MAX_TIMESTAMP_SKEW_MS) {
      return {
        allowed: false,
        reason: 'TIMESTAMP_SKEW',
        message: `Request timestamp is too far from server time (${Math.round(skew / 1000)}s skew, max ${config.MAX_TIMESTAMP_SKEW_MS / 1000}s)`
      };
    }
  }

  // Generate nonce for this request
  const nonce = generateNonce(webhookId, payload, requestTimestamp || now);

  // Check if nonce was seen before
  if (nonceCache.has(nonce)) {
    return {
      allowed: false,
      reason: 'DUPLICATE_NONCE',
      message: 'Duplicate request detected (possible replay attack)'
    };
  }

  // Store nonce
  nonceCache.set(nonce, now);

  return { allowed: true };
}

/**
 * Express middleware for replay attack prevention
 */
export function replayProtectionMiddleware(req, res, next) {
  // Only apply to webhook ingestion endpoints
  if (!req.path.includes('/webhooks/')) {
    return next();
  }

  const webhookId = req.params.webhook_id;
  const payload = req.body;
  const timestamp = req.headers[CONFIG.HMAC.TIMESTAMP_HEADER] || req.body?.timestamp;

  const result = checkReplayAttack(webhookId, payload, timestamp);

  if (!result.allowed) {
    securityMetrics.replay.blocked++;

    logSecurityEvent('REPLAY_ATTACK', {
      webhook_id: webhookId,
      reason: result.reason,
      ip: getClientIP(req),
      timestamp_header: req.headers[CONFIG.HMAC.TIMESTAMP_HEADER],
      payload_timestamp: req.body?.timestamp
    });

    return res.status(400).json({
      error: 'Bad Request',
      message: result.message,
      code: result.reason
    });
  }

  securityMetrics.replay.allowed++;
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// HMAC SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute HMAC signature for payload
 */
function computeHMAC(secret, timestamp, payload) {
  const data = `${timestamp}.${JSON.stringify(payload)}`;
  return crypto
    .createHmac(CONFIG.HMAC.ALGORITHM, secret)
    .update(data)
    .digest('hex');
}

/**
 * Verify HMAC signature (constant-time comparison)
 */
function verifyHMAC(signature, expectedSignature) {
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Check HMAC signature if present
 * Returns: { valid: boolean, required: boolean, reason?: string }
 */
function checkHMACSignature(req, webhookSecret) {
  const signature = req.headers[CONFIG.HMAC.HEADER_NAME];
  const timestamp = req.headers[CONFIG.HMAC.TIMESTAMP_HEADER];

  // If no signature header, HMAC is optional (backward compatible)
  if (!signature) {
    return { valid: true, required: false, reason: 'NO_SIGNATURE_HEADER' };
  }

  // If signature provided, timestamp is required
  if (!timestamp) {
    return {
      valid: false,
      required: true,
      reason: 'MISSING_TIMESTAMP',
      message: 'HMAC signature requires X-CyberSentinel-Timestamp header'
    };
  }

  // Validate timestamp
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return {
      valid: false,
      required: true,
      reason: 'INVALID_TIMESTAMP',
      message: 'Invalid timestamp format in X-CyberSentinel-Timestamp'
    };
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - ts);
  if (skew > CONFIG.HMAC.TOLERANCE_MS / 1000) {
    return {
      valid: false,
      required: true,
      reason: 'TIMESTAMP_EXPIRED',
      message: `Signature timestamp expired (${skew}s old, max ${CONFIG.HMAC.TOLERANCE_MS / 1000}s)`
    };
  }

  // Compute expected signature
  const expectedSignature = computeHMAC(webhookSecret, timestamp, req.body);

  // Verify signature
  const isValid = verifyHMAC(signature, expectedSignature);

  if (!isValid) {
    return {
      valid: false,
      required: true,
      reason: 'INVALID_SIGNATURE',
      message: 'HMAC signature verification failed'
    };
  }

  return { valid: true, required: true };
}

/**
 * HMAC verification helper - to be called from webhook handler
 * This doesn't block requests without HMAC (backward compatible)
 * but validates when present
 */
export function validateHMACIfPresent(req, webhookSecret) {
  const result = checkHMACSignature(req, webhookSecret);

  if (!result.required) {
    securityMetrics.hmac.skipped++;
    return { valid: true, hmacUsed: false };
  }

  if (result.valid) {
    securityMetrics.hmac.valid++;
    return { valid: true, hmacUsed: true };
  }

  securityMetrics.hmac.invalid++;

  logSecurityEvent('HMAC_VALIDATION_FAILED', {
    reason: result.reason,
    ip: getClientIP(req),
    path: req.path,
    signature_present: !!req.headers[CONFIG.HMAC.HEADER_NAME],
    timestamp_present: !!req.headers[CONFIG.HMAC.TIMESTAMP_HEADER]
  }, 'error');

  return {
    valid: false,
    hmacUsed: true,
    error: result.message,
    code: result.reason
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION FLOOD CONTROL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if playbook execution is allowed (per-playbook rate limiting)
 * Returns: { allowed: boolean, reason?: string }
 */
function checkPlaybookFloodControl(playbookId) {
  const now = Date.now();
  const config = CONFIG.FLOOD_CONTROL;

  // Check global rate limit
  if (now - globalExecCounter.windowStart > config.GLOBAL_WINDOW_MS) {
    globalExecCounter = { count: 0, windowStart: now };
  }

  if (globalExecCounter.count >= config.GLOBAL_MAX) {
    return {
      allowed: false,
      reason: 'GLOBAL_FLOOD_LIMIT',
      message: 'System execution rate limit exceeded. Please try again later.'
    };
  }

  // Check per-playbook rate limit
  let entry = playbookRateCache.get(playbookId);
  if (!entry) {
    entry = { count: 0, windowStart: now };
    playbookRateCache.set(playbookId, entry);
  }

  // Reset window if expired
  if (now - entry.windowStart > config.PER_PLAYBOOK_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  if (entry.count >= config.PER_PLAYBOOK_MAX) {
    return {
      allowed: false,
      reason: 'PLAYBOOK_FLOOD_LIMIT',
      message: `Playbook ${playbookId} execution rate limit exceeded. Please try again later.`
    };
  }

  // Allow and increment
  entry.count++;
  globalExecCounter.count++;

  return { allowed: true };
}

/**
 * Check flood control before execution creation
 * Call this from webhook handler before creating execution
 */
export function checkFloodControl(playbookId) {
  const result = checkPlaybookFloodControl(playbookId);

  if (!result.allowed) {
    securityMetrics.flood.blocked++;

    logSecurityEvent('FLOOD_CONTROL', {
      playbook_id: playbookId,
      reason: result.reason,
      global_count: globalExecCounter.count,
      playbook_count: playbookRateCache.get(playbookId)?.count || 0
    });

    return result;
  }

  securityMetrics.flood.allowed++;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current security metrics
 */
export function getSecurityMetrics() {
  const uptime = Date.now() - securityMetrics.startTime;

  return {
    uptime_ms: uptime,
    uptime_human: `${Math.round(uptime / 1000 / 60)} minutes`,
    rate_limit: {
      blocked: securityMetrics.rateLimit.blocked,
      allowed: securityMetrics.rateLimit.allowed,
      block_rate: securityMetrics.rateLimit.allowed > 0
        ? (securityMetrics.rateLimit.blocked / (securityMetrics.rateLimit.blocked + securityMetrics.rateLimit.allowed) * 100).toFixed(2) + '%'
        : '0%'
    },
    replay_protection: {
      blocked: securityMetrics.replay.blocked,
      allowed: securityMetrics.replay.allowed
    },
    hmac_validation: {
      valid: securityMetrics.hmac.valid,
      invalid: securityMetrics.hmac.invalid,
      skipped: securityMetrics.hmac.skipped
    },
    flood_control: {
      blocked: securityMetrics.flood.blocked,
      allowed: securityMetrics.flood.allowed
    },
    cache_sizes: {
      ip_rate_limit: ipRateLimitCache.size,
      nonce_cache: nonceCache.size,
      playbook_rate: playbookRateCache.size
    }
  };
}

/**
 * Reset security metrics (for testing)
 */
export function resetSecurityMetrics() {
  securityMetrics.rateLimit = { blocked: 0, allowed: 0 };
  securityMetrics.replay = { blocked: 0, allowed: 0 };
  securityMetrics.hmac = { valid: 0, invalid: 0, skipped: 0 };
  securityMetrics.flood = { blocked: 0, allowed: 0 };
  securityMetrics.startTime = Date.now();
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clean expired entries from caches
 */
function cleanupCaches() {
  const now = Date.now();
  let cleaned = { ip: 0, nonce: 0, playbook: 0 };

  // Clean IP rate limit cache (entries older than block duration + window)
  const ipExpiry = CONFIG.IP_RATE_LIMIT.BLOCK_DURATION_MS + CONFIG.IP_RATE_LIMIT.WINDOW_MS;
  for (const [ip, entry] of ipRateLimitCache.entries()) {
    if (now - entry.windowStart > ipExpiry && entry.blockedUntil < now) {
      ipRateLimitCache.delete(ip);
      cleaned.ip++;
    }
  }

  // Clean nonce cache
  for (const [nonce, timestamp] of nonceCache.entries()) {
    if (now - timestamp > CONFIG.REPLAY_PROTECTION.NONCE_TTL_MS) {
      nonceCache.delete(nonce);
      cleaned.nonce++;
    }
  }

  // Clean playbook rate cache
  for (const [playbookId, entry] of playbookRateCache.entries()) {
    if (now - entry.windowStart > CONFIG.FLOOD_CONTROL.PER_PLAYBOOK_WINDOW_MS * 2) {
      playbookRateCache.delete(playbookId);
      cleaned.playbook++;
    }
  }

  if (cleaned.ip > 0 || cleaned.nonce > 0 || cleaned.playbook > 0) {
    logger.debug('Security cache cleanup', {
      cleaned,
      remaining: {
        ip: ipRateLimitCache.size,
        nonce: nonceCache.size,
        playbook: playbookRateCache.size
      }
    });
  }
}

// Start cleanup interval
setInterval(cleanupCaches, CONFIG.CLEANUP_INTERVAL_MS);

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Combined security middleware that applies all protections
 * Use this as a single middleware for webhook endpoints
 */
/**
 * Get trusted IPs (lazy-loaded so dotenv has time to initialize)
 */
function getTrustedIPs() {
  return (process.env.WEBHOOK_TRUSTED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean);
}

export function webhookSecurityMiddleware(req, res, next) {
  const ip = getClientIP(req);

  // Skip rate limiting for trusted IPs (internal forwarders)
  const trustedIPs = getTrustedIPs();
  const isTrusted = trustedIPs.some(trustedIp => ip === trustedIp || ip === `::ffff:${trustedIp}`);
  if (isTrusted) {
    securityMetrics.rateLimit.allowed++;
    req.clientIP = ip;
    req.trustedSource = true;
    return next();
  }

  // Step 1: IP Rate Limiting
  const rateLimitResult = checkIPRateLimit(ip);

  if (!rateLimitResult.allowed) {
    securityMetrics.rateLimit.blocked++;

    logSecurityEvent('IP_RATE_LIMIT', {
      ip,
      reason: rateLimitResult.reason,
      path: req.path,
      method: req.method
    });

    res.set('Retry-After', rateLimitResult.retryAfter);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: rateLimitResult.message,
      retry_after: rateLimitResult.retryAfter
    });
  }

  securityMetrics.rateLimit.allowed++;

  // Step 2: Replay Protection (only for POST with body)
  if (req.method === 'POST' && req.body) {
    const webhookId = req.params.webhook_id;
    const timestamp = req.headers[CONFIG.HMAC.TIMESTAMP_HEADER] || req.body?.timestamp;

    const replayResult = checkReplayAttack(webhookId, req.body, timestamp);

    if (!replayResult.allowed) {
      securityMetrics.replay.blocked++;

      logSecurityEvent('REPLAY_ATTACK', {
        webhook_id: webhookId,
        reason: replayResult.reason,
        ip
      });

      return res.status(400).json({
        error: 'Bad Request',
        message: replayResult.message,
        code: replayResult.reason
      });
    }

    securityMetrics.replay.allowed++;
  }

  // Store IP in request for downstream use
  req.clientIP = ip;

  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTER FOR SECURITY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';

const securityRouter = express.Router();

/**
 * GET /api/security/metrics
 * Returns current security metrics (admin only in production)
 */
securityRouter.get('/metrics', (req, res) => {
  res.json({
    success: true,
    metrics: getSecurityMetrics()
  });
});

/**
 * GET /api/security/config
 * Returns current security configuration (sanitized)
 */
securityRouter.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      ip_rate_limit: {
        window_seconds: CONFIG.IP_RATE_LIMIT.WINDOW_MS / 1000,
        max_requests: CONFIG.IP_RATE_LIMIT.MAX_REQUESTS,
        burst_limit: CONFIG.IP_RATE_LIMIT.BURST_LIMIT,
        burst_window_seconds: CONFIG.IP_RATE_LIMIT.BURST_WINDOW_MS / 1000,
        block_duration_seconds: CONFIG.IP_RATE_LIMIT.BLOCK_DURATION_MS / 1000
      },
      replay_protection: {
        max_timestamp_skew_seconds: CONFIG.REPLAY_PROTECTION.MAX_TIMESTAMP_SKEW_MS / 1000,
        nonce_ttl_seconds: CONFIG.REPLAY_PROTECTION.NONCE_TTL_MS / 1000
      },
      hmac: {
        header: CONFIG.HMAC.HEADER_NAME,
        timestamp_header: CONFIG.HMAC.TIMESTAMP_HEADER,
        algorithm: CONFIG.HMAC.ALGORITHM,
        tolerance_seconds: CONFIG.HMAC.TOLERANCE_MS / 1000
      },
      flood_control: {
        per_playbook_window_seconds: CONFIG.FLOOD_CONTROL.PER_PLAYBOOK_WINDOW_MS / 1000,
        per_playbook_max: CONFIG.FLOOD_CONTROL.PER_PLAYBOOK_MAX,
        global_window_seconds: CONFIG.FLOOD_CONTROL.GLOBAL_WINDOW_MS / 1000,
        global_max: CONFIG.FLOOD_CONTROL.GLOBAL_MAX
      }
    }
  });
});

export { securityRouter };

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Middleware
  webhookSecurityMiddleware,
  ipRateLimitMiddleware,
  replayProtectionMiddleware,

  // Helpers
  validateHMACIfPresent,
  checkFloodControl,
  getClientIP,

  // Observability
  getSecurityMetrics,
  resetSecurityMetrics,

  // Router
  securityRouter,

  // Config (for testing)
  CONFIG
};
