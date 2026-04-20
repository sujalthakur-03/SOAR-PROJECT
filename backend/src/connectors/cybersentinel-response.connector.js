/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — CYBERSENTINEL RESPONSE CONNECTOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Executes endpoint response actions (host isolation, process termination,
 * user account disabling) via the CyberSentinel Control Plane Active Response
 * subsystem.
 *
 * CONNECTOR TYPE: cybersentinel_response
 * ACTIONS:
 *   - isolate_host   : Cut off endpoint from network (Control Plane remains reachable)
 *   - kill_process   : Terminate a process by name or PID on the target agent
 *   - disable_user   : Lock a user account on the target endpoint
 *
 * ARCHITECTURE NOTES:
 * - Internally communicates with the CyberSentinel Control Plane REST API
 *   using the PUT /active-response endpoint.
 * - Active Response custom commands are registered on the Control Plane with
 *   the trailing "0" suffix ("isolate-host0", "kill-process0", "disable-user0").
 * - Shares token caching with the blocklist connector pattern (10-min TTL).
 * - Simulation mode returns mock success without calling the Control Plane.
 *
 * ENVIRONMENT VARIABLES:
 *   CYBERSENTINEL_CONTROL_PLANE_URL      - Control Plane API base URL
 *   CYBERSENTINEL_CONTROL_PLANE_USER     - API username
 *   CYBERSENTINEL_CONTROL_PLANE_PASSWORD - API password
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

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const API_TIMEOUT_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH TOKEN CACHE (mirrors the blocklist connector pattern)
// ═══════════════════════════════════════════════════════════════════════════════

let cachedToken = null;
let cachedTokenExpiry = 0;
let tokenRefreshPromise = null;
const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function authenticate(config) {
  if (cachedToken && Date.now() < cachedTokenExpiry) {
    return cachedToken;
  }

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

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE RESPONSE DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send an Active Response command to the Control Plane.
 *
 * PUT /active-response
 * Body: { command, arguments, alert, agents_list }
 *
 * Custom Active Response commands are registered on the Control Plane with
 * the trailing "0" suffix by convention.
 */
async function sendActiveResponse({ command, args, agentId }) {
  const config = getControlPlaneConfig();

  if (!config.url) {
    throw Object.assign(
      new Error('CyberSentinel Control Plane is not configured. Set CYBERSENTINEL_CONTROL_PLANE_URL.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: false }
    );
  }

  const token = await authenticate(config);

  const body = {
    command,
    arguments: Array.isArray(args) ? args : [],
    alert: {},
  };

  const response = await axios.put(
    `${config.url}/active-response?agents_list=${encodeURIComponent(agentId)}`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      httpsAgent,
      timeout: API_TIMEOUT_MS,
    }
  );

  return response.data;
}

/**
 * Map axios/HTTP errors to analyst-friendly classified errors.
 */
function classifyError(error, operation) {
  const status = error.response?.status;

  if (status === 401 || status === 403) {
    return Object.assign(
      new Error('CyberSentinel Control Plane authentication failed. Check credentials.'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }
  if (status === 404) {
    return Object.assign(
      new Error('CyberSentinel Control Plane endpoint not found. Check the configured URL.'),
      { code: 'NOT_FOUND', retryable: false }
    );
  }
  if (status === 429) {
    return Object.assign(
      new Error('CyberSentinel Control Plane rate limit reached. Try again shortly.'),
      { code: 'RATE_LIMITED', retryable: true }
    );
  }
  if (status >= 500) {
    return Object.assign(
      new Error('CyberSentinel Control Plane is temporarily unavailable.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: true }
    );
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return Object.assign(
      new Error('Cannot reach CyberSentinel Control Plane. Check network and URL configuration.'),
      { code: 'CONNECTION_FAILED', retryable: true }
    );
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
    return Object.assign(
      new Error('CyberSentinel Control Plane request timed out.'),
      { code: 'CONNECTOR_TIMEOUT', retryable: true }
    );
  }
  if (error.code && typeof error.retryable === 'boolean') {
    return error;
  }
  return Object.assign(
    new Error(`CyberSentinel ${operation} failed: ${error.message}`),
    { code: 'INTERNAL_ERROR', retryable: false }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Isolate an endpoint from the network via the CyberSentinel Agent.
 */
export async function isolate_host({ agent_id, _simulate }) {
  const timestamp = new Date().toISOString();

  if (!agent_id || typeof agent_id !== 'string' || agent_id.trim() === '') {
    return {
      success: false,
      error: 'agent_id is required for isolate_host',
      details: { code: 'INVALID_INPUT' },
    };
  }

  const cleanAgentId = agent_id.trim();

  if (_simulate) {
    logger.info(`[CyberSentinelResponse] SIMULATION: Would isolate host ${cleanAgentId}`);
    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      _simulated: true,
    };
  }

  logger.info(`[CyberSentinelResponse] Isolating host ${cleanAgentId} via Control Plane`);

  try {
    const response = await sendActiveResponse({
      command: 'isolate-host0',
      args: [],
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] Successfully dispatched isolate_host for agent ${cleanAgentId}`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      details: response?.data || null,
      _simulated: false,
    };
  } catch (error) {
    const classified = classifyError(error, 'isolate_host');
    logger.error(`[CyberSentinelResponse] isolate_host failed for ${cleanAgentId}: ${classified.message}`);
    return {
      success: false,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      error: classified.message,
      details: { code: classified.code, retryable: classified.retryable },
    };
  }
}

/**
 * Terminate a process on the target endpoint by PID or name.
 */
export async function kill_process({ agent_id, process_name, pid, _simulate }) {
  const timestamp = new Date().toISOString();

  if (!agent_id || typeof agent_id !== 'string' || agent_id.trim() === '') {
    return {
      success: false,
      error: 'agent_id is required for kill_process',
      details: { code: 'INVALID_INPUT' },
    };
  }

  if (!pid && !process_name) {
    return {
      success: false,
      error: 'Either pid or process_name must be provided for kill_process',
      details: { code: 'INVALID_INPUT' },
    };
  }

  const cleanAgentId = agent_id.trim();
  const target = pid ? String(pid).trim() : String(process_name).trim();
  const mode = pid ? 'pid' : 'name';

  if (_simulate) {
    logger.info(`[CyberSentinelResponse] SIMULATION: Would kill process (${mode}=${target}) on ${cleanAgentId}`);
    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'kill_process',
      target,
      mode,
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      _simulated: true,
    };
  }

  logger.info(`[CyberSentinelResponse] Killing process (${mode}=${target}) on ${cleanAgentId}`);

  try {
    const response = await sendActiveResponse({
      command: 'kill-process0',
      args: [mode, target],
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] Successfully dispatched kill_process for agent ${cleanAgentId}`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'kill_process',
      target,
      mode,
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      details: response?.data || null,
      _simulated: false,
    };
  } catch (error) {
    const classified = classifyError(error, 'kill_process');
    logger.error(`[CyberSentinelResponse] kill_process failed for ${cleanAgentId}: ${classified.message}`);
    return {
      success: false,
      agent_id: cleanAgentId,
      action: 'kill_process',
      target,
      mode,
      error: classified.message,
      details: { code: classified.code, retryable: classified.retryable },
    };
  }
}

/**
 * Lock a user account on the target endpoint.
 */
export async function disable_user({ agent_id, username, _simulate }) {
  const timestamp = new Date().toISOString();

  if (!agent_id || typeof agent_id !== 'string' || agent_id.trim() === '') {
    return {
      success: false,
      error: 'agent_id is required for disable_user',
      details: { code: 'INVALID_INPUT' },
    };
  }

  if (!username || typeof username !== 'string' || username.trim() === '') {
    return {
      success: false,
      error: 'username is required for disable_user',
      details: { code: 'INVALID_INPUT' },
    };
  }

  const cleanAgentId = agent_id.trim();
  const cleanUsername = username.trim();

  if (_simulate) {
    logger.info(`[CyberSentinelResponse] SIMULATION: Would disable user ${cleanUsername} on ${cleanAgentId}`);
    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'disable_user',
      username: cleanUsername,
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      _simulated: true,
    };
  }

  logger.info(`[CyberSentinelResponse] Disabling user ${cleanUsername} on ${cleanAgentId}`);

  try {
    const response = await sendActiveResponse({
      command: 'disable-user0',
      args: [cleanUsername],
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] Successfully dispatched disable_user for agent ${cleanAgentId}`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'disable_user',
      username: cleanUsername,
      timestamp,
      enforced_by: 'CyberSentinel Control Plane',
      details: response?.data || null,
      _simulated: false,
    };
  } catch (error) {
    const classified = classifyError(error, 'disable_user');
    logger.error(`[CyberSentinelResponse] disable_user failed for ${cleanAgentId}: ${classified.message}`);
    return {
      success: false,
      agent_id: cleanAgentId,
      action: 'disable_user',
      username: cleanUsername,
      error: classified.message,
      details: { code: classified.code, retryable: classified.retryable },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR IMPLEMENTATION (Connector Contract Interface)
// ═══════════════════════════════════════════════════════════════════════════════

export const cybersentinelResponseConnector = {
  inputSchema: {
    isolate_host: {
      required_fields: ['agent_id'],
      optional_fields: [],
      field_types: { agent_id: 'string' },
    },
    kill_process: {
      required_fields: ['agent_id'],
      optional_fields: ['pid', 'process_name'],
      field_types: {
        agent_id: 'string',
        pid: 'string',
        process_name: 'string',
      },
    },
    disable_user: {
      required_fields: ['agent_id', 'username'],
      optional_fields: [],
      field_types: {
        agent_id: 'string',
        username: 'string',
      },
    },
  },

  outputSchema: {
    isolate_host: {
      output_fields: {
        success: 'boolean',
        agent_id: 'string',
        action: 'string',
        timestamp: 'string',
        enforced_by: 'string',
        _simulated: 'boolean',
      },
    },
    kill_process: {
      output_fields: {
        success: 'boolean',
        agent_id: 'string',
        action: 'string',
        target: 'string',
        mode: 'string',
        timestamp: 'string',
        enforced_by: 'string',
        _simulated: 'boolean',
      },
    },
    disable_user: {
      output_fields: {
        success: 'boolean',
        agent_id: 'string',
        action: 'string',
        username: 'string',
        timestamp: 'string',
        enforced_by: 'string',
        _simulated: 'boolean',
      },
    },
  },

  async execute(action, inputs, config) {
    const isSimulation = inputs._simulate
      || inputs.trigger_source === 'simulation'
      || config?.shadow_mode === true;

    switch (action) {
      case 'isolate_host':
        return await isolate_host({
          agent_id: inputs.agent_id,
          _simulate: isSimulation,
        });

      case 'kill_process':
        return await kill_process({
          agent_id: inputs.agent_id,
          process_name: inputs.process_name,
          pid: inputs.pid,
          _simulate: isSimulation,
        });

      case 'disable_user':
        return await disable_user({
          agent_id: inputs.agent_id,
          username: inputs.username,
          _simulate: isSimulation,
        });

      default:
        throw Object.assign(
          new Error(`Unknown action: ${action}. Supported: isolate_host, kill_process, disable_user`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  },
};

export default cybersentinelResponseConnector;
