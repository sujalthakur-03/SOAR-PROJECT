/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — CYBERSENTINEL BLOCKLIST CONNECTOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Manages CyberSentinel-controlled IP blocklists enforced by the
 * CyberSentinel Control Plane via CDB lists.
 *
 * CONNECTOR TYPE: cybersentinel_blocklist
 * ACTIONS:        cybersentinel_block_ip
 *
 * ARCHITECTURE NOTES:
 * - Internally communicates with the CyberSentinel Control Plane REST API
 * - Appends IPs to the CDB list: etc/lists/cybersentinel_blocked_ips
 * - Idempotent: does not duplicate IPs already in the list
 * - Supports TTL metadata (stored in SOAR, not in the Control Plane)
 * - Simulation mode: returns mock success without calling the Control Plane
 *
 * ENVIRONMENT VARIABLES:
 *   CYBERSENTINEL_CONTROL_PLANE_URL      - Control Plane API base URL
 *   CYBERSENTINEL_CONTROL_PLANE_USER     - API username
 *   CYBERSENTINEL_CONTROL_PLANE_PASSWORD  - API password
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Note: the CDB list filename used in Wazuh 4.x API calls is defined
// alongside the fetch/upload functions below.

/**
 * Read configuration from environment variables.
 * Falls back to legacy CYBERSENTINEL_API_* variables for backward compatibility.
 */
function getControlPlaneConfig() {
  return {
    url: process.env.CYBERSENTINEL_CONTROL_PLANE_URL
      || process.env.CYBERSENTINEL_API_URL
      || '',
    user: process.env.CYBERSENTINEL_CONTROL_PLANE_USER
      || process.env.CYBERSENTINEL_API_USERNAME
      || 'admin',
    password: process.env.CYBERSENTINEL_CONTROL_PLANE_PASSWORD
      || process.env.CYBERSENTINEL_API_PASSWORD
      || '',
  };
}

// Allow self-signed certificates for the Control Plane API
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

// API call timeout — generous to handle concurrent bursts
const API_TIMEOUT_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL PLANE API CLIENT (with token caching)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cached JWT token and its expiry.
 * Wazuh tokens typically last 900 seconds (15 min); we cache for 10 min.
 */
let cachedToken = null;
let cachedTokenExpiry = 0;
let tokenRefreshPromise = null;
const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Authenticate with the Control Plane and obtain a JWT token.
 * Returns a cached token when still valid to avoid flooding the API
 * during concurrent playbook executions.
 */
async function authenticate(config) {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedTokenExpiry) {
    return cachedToken;
  }

  // Coalesce concurrent auth requests into a single API call
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    try {
      const response = await axios.post(
        `${config.url}/security/user/authenticate`,
        {},
        {
          auth: { username: config.user, password: config.password },
          httpsAgent,
          timeout: API_TIMEOUT_MS,
        }
      );

      const token = response.data?.data?.token;
      if (!token) {
        throw new Error('Authentication succeeded but no token returned');
      }

      cachedToken = token;
      cachedTokenExpiry = Date.now() + TOKEN_CACHE_TTL_MS;
      return token;
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

/**
 * CDB list filename (used in the /lists/files/{filename} API).
 */
const CDB_LIST_FILENAME = 'cybersentinel_blocked_ips';

/**
 * Fetch the current CDB list entries from the Control Plane.
 * Uses the Wazuh 4.x API: GET /lists/files/{filename}
 *
 * Returns a Map of ip → reason entries.
 */
async function fetchCDBListEntries(token, config) {
  try {
    const response = await axios.get(
      `${config.url}/lists/files/${CDB_LIST_FILENAME}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent,
        timeout: API_TIMEOUT_MS,
      }
    );

    // Response format: { data: { affected_items: [ { "ip": "reason", ... } ] } }
    const items = response.data?.data?.affected_items?.[0] || {};
    const entries = new Map();
    for (const [key, value] of Object.entries(items)) {
      entries.set(key, value);
    }
    return entries;
  } catch (error) {
    // If the file doesn't exist yet, treat it as empty
    if (error.response?.status === 404) {
      logger.info('[CyberSentinelBlocklist] CDB list does not exist yet, will create');
      return new Map();
    }
    throw error;
  }
}

/**
 * Upload CDB list contents to the Control Plane.
 * Uses the Wazuh 4.x API: PUT /lists/files/{filename}
 *
 * @param {string} token - Auth token
 * @param {object} config - Control Plane config
 * @param {string} contents - CDB list file contents (key:value per line)
 */
async function uploadCDBList(token, config, contents) {
  await axios.put(
    `${config.url}/lists/files/${CDB_LIST_FILENAME}?overwrite=true`,
    contents,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      httpsAgent,
      timeout: API_TIMEOUT_MS,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
const CIDR_V4_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

function isValidIP(ip) {
  return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip) || CIDR_V4_REGEX.test(ip);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE METHOD: addBlockedIP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add an IP to the CyberSentinel blocklist.
 *
 * @param {object} params
 * @param {string} params.ip           - IP address to block
 * @param {string} params.reason       - Reason for blocking
 * @param {number} [params.ttl]        - TTL in minutes (metadata only, stored in SOAR)
 * @param {string} [params.execution_id] - Execution ID for audit
 * @param {boolean} [params._simulate] - If true, return mock result without API call
 * @returns {object} Block result
 */
export async function addBlockedIP({ ip, reason, ttl, execution_id, _simulate }) {
  const timestamp = new Date().toISOString();

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  if (!ip || typeof ip !== 'string' || ip.trim() === '') {
    throw Object.assign(
      new Error('No IP selected to block'),
      { code: 'INVALID_INPUT', retryable: false }
    );
  }

  const cleanIP = ip.trim();

  if (!isValidIP(cleanIP)) {
    throw Object.assign(
      new Error(`Invalid IP address format: ${cleanIP}`),
      { code: 'INVALID_INPUT', retryable: false }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIMULATION MODE
  // ─────────────────────────────────────────────────────────────────────────

  if (_simulate) {
    logger.info(`[CyberSentinelBlocklist] SIMULATION: Would block IP ${cleanIP}`);

    return {
      ip: cleanIP,
      blocklist: 'cybersentinel_blocked_ips',
      status: 'blocked',
      enforced_by: 'CyberSentinel Control Plane',
      timestamp,
      reason: reason || 'Blocked by CyberSentinel playbook',
      ttl_minutes: ttl || null,
      execution_id: execution_id || null,
      _simulated: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REAL EXECUTION — Control Plane API
  // ─────────────────────────────────────────────────────────────────────────

  const config = getControlPlaneConfig();

  if (!config.url) {
    throw Object.assign(
      new Error('CyberSentinel Control Plane is not configured. Set CYBERSENTINEL_CONTROL_PLANE_URL.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: false }
    );
  }

  logger.info(`[CyberSentinelBlocklist] Blocking IP ${cleanIP} via Control Plane`);

  try {
    // 1. Authenticate
    const token = await authenticate(config);

    // 2. Fetch current CDB list entries via Wazuh 4.x API
    const existingEntries = await fetchCDBListEntries(token, config);

    // 3. Idempotency check — do not duplicate
    if (existingEntries.has(cleanIP)) {
      logger.info(`[CyberSentinelBlocklist] IP ${cleanIP} already in blocklist, skipping`);

      return {
        ip: cleanIP,
        blocklist: 'cybersentinel_blocked_ips',
        status: 'already_blocked',
        enforced_by: 'CyberSentinel Control Plane',
        timestamp,
        reason: reason || 'Blocked by CyberSentinel playbook',
        ttl_minutes: ttl || null,
        execution_id: execution_id || null,
        _simulated: false,
      };
    }

    // 4. Build updated CDB list contents (key:value per line)
    const sanitizedReason = (reason || 'Blocked by CyberSentinel playbook')
      .replace(/[:\n\r]/g, ' ')
      .substring(0, 200);

    // Rebuild from existing entries + new entry
    const lines = [];
    for (const [key, value] of existingEntries) {
      lines.push(`${key}:${value}`);
    }
    lines.push(`${cleanIP}:${sanitizedReason}`);
    const updatedContents = lines.join('\n') + '\n';

    // 5. Upload updated list via Wazuh 4.x API
    await uploadCDBList(token, config, updatedContents);

    logger.info(`[CyberSentinelBlocklist] Successfully blocked IP ${cleanIP}`);

    return {
      ip: cleanIP,
      blocklist: 'cybersentinel_blocked_ips',
      status: 'blocked',
      enforced_by: 'CyberSentinel Control Plane',
      timestamp,
      reason: sanitizedReason,
      ttl_minutes: ttl || null,
      execution_id: execution_id || null,
      _simulated: false,
    };

  } catch (error) {
    // ─────────────────────────────────────────────────────────────────────────
    // ERROR HANDLING — rewrite to analyst-friendly messages
    // ─────────────────────────────────────────────────────────────────────────

    const status = error.response?.status;

    if (status === 401 || status === 403) {
      throw Object.assign(
        new Error('CyberSentinel Control Plane authentication failed. Check credentials.'),
        { code: 'AUTH_FAILED', retryable: false }
      );
    }

    if (status === 404) {
      throw Object.assign(
        new Error('CyberSentinel Control Plane endpoint not found. Check the configured URL.'),
        { code: 'NOT_FOUND', retryable: false }
      );
    }

    if (status === 429) {
      throw Object.assign(
        new Error('CyberSentinel Control Plane rate limit reached. Try again shortly.'),
        { code: 'RATE_LIMITED', retryable: true }
      );
    }

    if (status >= 500) {
      throw Object.assign(
        new Error('CyberSentinel Control Plane is temporarily unavailable.'),
        { code: 'SERVICE_UNAVAILABLE', retryable: true }
      );
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw Object.assign(
        new Error('Cannot reach CyberSentinel Control Plane. Check network and URL configuration.'),
        { code: 'CONNECTION_FAILED', retryable: true }
      );
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      throw Object.assign(
        new Error('CyberSentinel Control Plane request timed out.'),
        { code: 'CONNECTOR_TIMEOUT', retryable: true }
      );
    }

    // Re-throw already-classified errors
    if (error.code && typeof error.retryable === 'boolean') {
      throw error;
    }

    throw Object.assign(
      new Error(`Failed to update CyberSentinel blocklist: ${error.message}`),
      { code: 'INTERNAL_ERROR', retryable: false }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR IMPLEMENTATION (Connector Contract Interface)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector implementation following the standard contract.
 *
 * Registered as connector type "cybersentinel_blocklist" in the connector
 * registry. The execution engine calls execute() via invokeConnector().
 */
export const cybersentinelBlocklistConnector = {
  /**
   * Input schema per action type.
   */
  inputSchema: {
    block_ip: {
      required_fields: ['ip'],
      optional_fields: ['reason', 'ttl', 'execution_id'],
      field_types: {
        ip: 'string:ip',
        reason: 'string',
        ttl: 'number:int',
        execution_id: 'string',
      },
    },
  },

  /**
   * Output schema per action type.
   */
  outputSchema: {
    block_ip: {
      output_fields: {
        ip: 'string',
        blocklist: 'string',
        status: 'string',
        enforced_by: 'string',
        timestamp: 'string',
        reason: 'string',
        ttl_minutes: 'number',
        _simulated: 'boolean',
      },
    },
  },

  /**
   * Execute a connector action.
   *
   * @param {string} action  - The action type (e.g., 'block_ip')
   * @param {object} inputs  - Resolved input parameters
   * @param {object} config  - Connector configuration from the database
   * @returns {object} Action output
   */
  async execute(action, inputs, config) {
    switch (action) {
      case 'block_ip':
      case 'cybersentinel_block_ip': {
        // Determine simulation mode:
        // - Explicit _simulate flag from inputs
        // - trigger_source === 'simulation' in execution context
        // - shadow_mode in connector config
        const isSimulation = inputs._simulate
          || inputs.trigger_source === 'simulation'
          || config?.shadow_mode === true;

        return await addBlockedIP({
          ip: inputs.ip,
          reason: inputs.reason || 'Blocked by CyberSentinel playbook',
          ttl: inputs.ttl ? Number(inputs.ttl) : null,
          execution_id: inputs.execution_id || null,
          _simulate: isSimulation,
        });
      }

      default:
        throw Object.assign(
          new Error(`Unknown action: ${action}. Supported: block_ip`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  },
};

export default cybersentinelBlocklistConnector;
