/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — CYBERSENTINEL RESPONSE CONNECTOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Executes endpoint response actions (host isolation, process termination,
 * user account disabling) via the CyberSentinel Manager Active Response API.
 *
 * CONNECTOR TYPE: cybersentinel_response
 * ACTIONS:
 *   - isolate_host   : Cut off endpoint from network (manager remains reachable)
 *   - kill_process   : Terminate a process by name or PID on the target agent
 *   - disable_user   : Lock a user account on the target endpoint
 *
 * ARCHITECTURE NOTES:
 * - Communicates with the CyberSentinel manager (rebranded Wazuh) REST API
 *   using PUT /active-response.
 * - Active Response uses paired commands per Wazuh idiom:
 *     Linux:   soar-isolate-host0      / soar-kill-process0      / soar-disable-user0
 *     Windows: win_soar-isolate-host0  / win_soar-kill-process0  / win_soar-disable-user0
 *   Before each dispatch, the connector queries GET /agents to determine the
 *   agent OS family and picks the matching command name.
 * - Manager IP for the isolate_host whitelist is configured ONCE in the
 *   manager's ossec.conf <extra_args>. The connector does NOT pass the
 *   manager IP — Wazuh propagates it via the AR JSON payload.
 * - Token cache shared with blocklist connector pattern (10-min TTL).
 * - Simulation mode returns mock success without calling the manager.
 *
 * ENVIRONMENT VARIABLES:
 *   CYBERSENTINEL_CONTROL_PLANE_URL      - Manager API base URL (https://host:55000)
 *   CYBERSENTINEL_CONTROL_PLANE_USER     - API username (default: wazuh-wui)
 *   CYBERSENTINEL_CONTROL_PLANE_PASSWORD - API password
 *
 * VERSION: 1.1.0
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
      || 'wazuh-wui',
    password: process.env.CYBERSENTINEL_CONTROL_PLANE_PASSWORD
      || process.env.CYBERSENTINEL_API_PASSWORD
      || '',
  };
}

/**
 * Resolve the manager IP the agent's isolate-host script needs to whitelist.
 *
 * Verified 2026-05-14: Wazuh's PUT /active-response API does NOT auto-merge
 * <extra_args> from manager ossec.conf into the agent's parameters.extra_args
 * — that propagation only happens for rule-triggered AR. So API-triggered
 * isolate-host MUST pass the manager IP explicitly in the request body's
 * `arguments` array, where it lands on the agent as parameters.extra_args[0].
 *
 * Precedence:
 *   1. CYBERSENTINEL_MANAGER_IP env var (set explicitly for HA / NAT setups
 *      where the AR-allowed IP differs from the API hostname)
 *   2. Hostname parsed from CYBERSENTINEL_CONTROL_PLANE_URL
 */
function getManagerIp() {
  const explicit = (process.env.CYBERSENTINEL_MANAGER_IP || '').trim();
  if (explicit) return explicit;
  const url = process.env.CYBERSENTINEL_CONTROL_PLANE_URL || '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const API_TIMEOUT_MS = 30000;

// Paired command names — Linux base, win_ prefix for Windows
const AR_COMMANDS = {
  isolate_host: 'soar-isolate-host0',
  kill_process: 'soar-kill-process0',
  disable_user: 'soar-disable-user0',
};

function commandForOS(action, os) {
  const base = AR_COMMANDS[action];
  if (!base) throw new Error(`No AR command mapping for action '${action}'`);
  return os === 'windows' ? `win_${base}` : base;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH TOKEN CACHE
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
// AGENT OS LOOKUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Known platform values the manager returns for os.platform, classified into
 * the OS family that maps to our AR script set. Anything else fails closed
 * with UNSUPPORTED_OS so the connector never silently routes a darwin/bsd
 * agent to Linux scripts that would crash on missing iptables.
 */
const LINUX_PLATFORMS = new Set([
  'amzn', 'ubuntu', 'debian', 'centos', 'rhel', 'redhat', 'rocky',
  'almalinux', 'oracle', 'suse', 'sles', 'opensuse', 'fedora', 'linux',
]);
const WINDOWS_PLATFORMS = new Set(['windows']);

/**
 * Wazuh's manager-side agent ID is "000" — it represents the manager itself,
 * not an enrolled endpoint. The AR queue refuses to dispatch to agent 000
 * (verified empirically against 4.14.4: API returns HTTP 200 with
 * affected_items=[] and message "AR command was not sent to any agent").
 * Fail fast on the connector side so analysts get a clear error instead of
 * a silent no-op.
 */
function validateAgentId(agentId, action) {
  if (agentId === '000') {
    return {
      success: false,
      error: `Cannot dispatch ${action} to agent 000 (the manager itself). Specify an enrolled endpoint agent ID.`,
      details: { code: 'INVALID_AGENT_TARGET', retryable: false },
    };
  }
  return null;
}

function classifyOSPlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (WINDOWS_PLATFORMS.has(p)) return 'windows';
  if (LINUX_PLATFORMS.has(p)) return 'linux';
  throw Object.assign(
    new Error(`Unsupported agent OS platform '${platform}' — no AR scripts available for this family`),
    { code: 'UNSUPPORTED_OS', retryable: false }
  );
}

/**
 * Look up the OS family of an agent so we can pick the right paired
 * AR command name (linux → soar-X0, windows → win_soar-X0).
 *
 * GET /agents?agents_list=<id>&select=os.platform
 * Response shape (Wazuh 4.14.x):
 *   { data: { affected_items: [ { id, os: { platform: "amzn|ubuntu|windows|..." } } ] } }
 */
async function getAgentOS(agentId, token, config) {
  const response = await axios.get(
    `${config.url}/agents?agents_list=${encodeURIComponent(agentId)}&select=os.platform`,
    {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      timeout: API_TIMEOUT_MS,
    }
  );

  const items = response.data?.data?.affected_items || [];
  if (!items.length) {
    throw Object.assign(
      new Error(`Agent '${agentId}' not found on manager`),
      { code: 'AGENT_NOT_FOUND', retryable: false }
    );
  }

  const rawPlatform = items[0]?.os?.platform;
  try {
    return classifyOSPlatform(rawPlatform);
  } catch (err) {
    if (err.code === 'UNSUPPORTED_OS') {
      err.message = `Agent '${agentId}' (platform='${rawPlatform}'): ${err.message}`;
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE RESPONSE DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send an Active Response command to the manager.
 *
 * PUT /active-response?agents_list=<id>
 * Body: { command, arguments, alert }
 *
 * The manager forwards `arguments` LITERALLY to the agent script as
 * parameters.extra_args. Note: API-dispatched AR does NOT inherit
 * <extra_args> from manager ossec.conf (only rule-triggered AR does), so
 * every argument the agent script reads must be passed in this `arguments`
 * array — see getManagerIp() for the isolate-host case.
 *
 * COMMAND-NAME FORMAT (verified empirically against Wazuh 4.14.x dev manager
 * on 192.168.1.222 — May 2026):
 *   The API requires a "!" prefix on the command name for manual
 *   PUT /active-response dispatch. Without it the manager returns 1652
 *   "command not defined" even when the <command> block is registered in
 *   ossec.conf. The "!" prefix tells the manager "dispatch this directly,
 *   not via rule-match." Even built-in commands like firewall-drop0 fail
 *   without it on this API version.
 *
 * ADD-ONLY DISPATCH MODEL:
 *   This connector dispatches ADD-path AR only. Wazuh's API has no field
 *   to manually trigger an agent script's "delete" branch (un-isolate /
 *   unlock). Per joint decision with the manager team (May 2026):
 *     - Time-bounded actions (isolate-host) use Wazuh's native <timeout>
 *       auto-expiry on the <active-response> block. The manager
 *       dispatches "delete" to the agent automatically when the timer
 *       fires.
 *     - Un-bounded actions (disable-user, kill-process) are intentionally
 *       one-way from SOAR. Reversal is a manual SOC operator task and
 *       is not in the connector's contract.
 */
async function dispatchAR({ action, args, agentId }) {
  const config = getControlPlaneConfig();

  if (!config.url) {
    throw Object.assign(
      new Error('CyberSentinel manager is not configured. Set CYBERSENTINEL_CONTROL_PLANE_URL.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: false }
    );
  }

  const token = await authenticate(config);
  const os = await getAgentOS(agentId, token, config);
  const baseCmd = commandForOS(action, os);
  const command = `!${baseCmd}`;   // Required for manual API dispatch (Wazuh 4.14.x)

  const finalArgs = Array.isArray(args) ? args : [];

  logger.info(`[CyberSentinelResponse] Dispatch ${action} → ${command} args=${JSON.stringify(finalArgs)} agent=${agentId} (os=${os})`);

  const body = {
    command,
    arguments: finalArgs,
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

  // Manager returns HTTP 200 with structured failure inside the body for
  // dispatch-level errors (e.g. command-not-defined, agent-offline). Surface
  // those as connector errors instead of silently reporting success.
  const failedItems = response.data?.data?.failed_items || [];
  if (failedItems.length > 0) {
    const first = failedItems[0]?.error || {};
    throw Object.assign(
      new Error(`Manager rejected dispatch: ${first.message || 'unknown error'} (code ${first.code || '?'})`),
      { code: `MANAGER_DISPATCH_FAILED_${first.code || 'UNKNOWN'}`, retryable: false }
    );
  }

  return { os, command, args: finalArgs, data: response.data };
}

/**
 * Map axios/HTTP errors to analyst-friendly classified errors.
 */
function classifyError(error, operation) {
  const status = error.response?.status;

  if (error.code && typeof error.retryable === 'boolean') {
    return error;
  }
  if (status === 401 || status === 403) {
    return Object.assign(
      new Error('CyberSentinel manager authentication failed. Check credentials.'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }
  if (status === 404) {
    return Object.assign(
      new Error('CyberSentinel manager endpoint not found. Check the configured URL.'),
      { code: 'NOT_FOUND', retryable: false }
    );
  }
  if (status === 429) {
    return Object.assign(
      new Error('CyberSentinel manager rate limit reached. Try again shortly.'),
      { code: 'RATE_LIMITED', retryable: true }
    );
  }
  if (status >= 500) {
    return Object.assign(
      new Error('CyberSentinel manager is temporarily unavailable.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: true }
    );
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return Object.assign(
      new Error('Cannot reach CyberSentinel manager. Check network and URL configuration.'),
      { code: 'CONNECTION_FAILED', retryable: true }
    );
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
    return Object.assign(
      new Error('CyberSentinel manager request timed out.'),
      { code: 'CONNECTOR_TIMEOUT', retryable: true }
    );
  }
  return Object.assign(
    new Error(`CyberSentinel ${operation} failed: ${error.message}`),
    { code: 'INTERNAL_ERROR', retryable: false }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

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
  const agentReject = validateAgentId(cleanAgentId, 'isolate_host');
  if (agentReject) return agentReject;

  if (_simulate) {
    logger.info(`[CyberSentinelResponse] SIMULATION: Would isolate host ${cleanAgentId}`);
    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      timestamp,
      enforced_by: 'CyberSentinel Manager',
      _simulated: true,
    };
  }

  // CRITICAL: API-dispatched AR does NOT inherit <extra_args> from manager
  // ossec.conf — only rule-triggered AR does. The manager IP must be passed
  // explicitly in the PUT body's `arguments` array, which the agent receives
  // as parameters.extra_args. The isolate-host script reads extra_args[0]
  // for the manager IP to whitelist before applying iptables DROP rules.
  const managerIp = getManagerIp();
  if (!managerIp) {
    return {
      success: false,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      error: 'Manager IP is not configured. Set CYBERSENTINEL_MANAGER_IP or ensure CYBERSENTINEL_CONTROL_PLANE_URL has a parseable hostname.',
      details: { code: 'MISSING_MANAGER_IP', retryable: false },
    };
  }

  try {
    const result = await dispatchAR({
      action: 'isolate_host',
      args: [managerIp],   // passed to agent as parameters.extra_args[0]
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] isolate host dispatched for ${cleanAgentId} (cmd=${result.command}, manager_ip=${managerIp})`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'isolate_host',
      os: result.os,
      ar_command: result.command,
      timestamp,
      enforced_by: 'CyberSentinel Manager',
      details: result.data?.data || null,
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
  const agentReject = validateAgentId(cleanAgentId, 'kill_process');
  if (agentReject) return agentReject;

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
      enforced_by: 'CyberSentinel Manager',
      _simulated: true,
    };
  }

  try {
    const result = await dispatchAR({
      action: 'kill_process',
      args: [mode, target],
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] kill_process dispatched for ${cleanAgentId} (cmd=${result.command})`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'kill_process',
      target,
      mode,
      os: result.os,
      ar_command: result.command,
      timestamp,
      enforced_by: 'CyberSentinel Manager',
      details: result.data?.data || null,
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
  const agentReject = validateAgentId(cleanAgentId, 'disable_user');
  if (agentReject) return agentReject;

  const cleanUsername = username.trim();

  if (_simulate) {
    logger.info(`[CyberSentinelResponse] SIMULATION: Would disable user ${cleanUsername} on ${cleanAgentId}`);
    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'disable_user',
      username: cleanUsername,
      timestamp,
      enforced_by: 'CyberSentinel Manager',
      _simulated: true,
    };
  }

  try {
    const result = await dispatchAR({
      action: 'disable_user',
      args: [cleanUsername],
      agentId: cleanAgentId,
    });

    logger.info(`[CyberSentinelResponse] disable user dispatched for ${cleanAgentId} (cmd=${result.command})`);

    return {
      success: true,
      agent_id: cleanAgentId,
      action: 'disable_user',
      username: cleanUsername,
      os: result.os,
      ar_command: result.command,
      timestamp,
      enforced_by: 'CyberSentinel Manager',
      details: result.data?.data || null,
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
      // ADD-only. Release is driven by Wazuh native <timeout> auto-expiry
      // on the manager's <active-response> block, NOT a separate SOAR step.
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
      // ADD-only. Unlock is a manual SOC operator task, not a SOAR step.
    },
  },

  outputSchema: {
    isolate_host: {
      output_fields: {
        success: 'boolean',
        agent_id: 'string',
        action: 'string',
        os: 'string',
        ar_command: 'string',
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
        os: 'string',
        ar_command: 'string',
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
        os: 'string',
        ar_command: 'string',
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
