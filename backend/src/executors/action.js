/**
 * Action Step Executor
 * Handles automated response actions (blocking, isolation, etc.)
 */

// CyberSentinel active response integration
import * as firewall from '../integrations/firewall.js';
import * as cybersentinelResponse from '../connectors/cybersentinel-response.connector.js';
import logger from '../utils/logger.js';
import { replaceVariables } from '../utils/helpers.js';

/**
 * Execute action step
 */
export async function executeAction(step, alert, context) {
  logger.info(`Executing action step: ${step.name}`);

  const config = step.config;
  const connector = config.connector_id || config.connector;
  const actionType = config.action_type || config.action;
  const parameters = config.parameters || {};

  // Replace variables in parameters
  const resolvedParams = {};
  for (const [key, value] of Object.entries(parameters)) {
    resolvedParams[key] = typeof value === 'string'
      ? replaceVariables(value, { ...alert, ...context })
      : value;
  }

  try {
    let result;

    switch (connector) {
      case 'cybersentinel_response':
      case 'cybersentinel-active-response':
      case 'cybersentinel':
        result = await executeCyberSentinelAction(actionType, alert, resolvedParams);
        break;

      case 'firewall-generic':
      case 'firewall-01':
      case 'firewall':
      case 'paloalto':
        result = await executeFirewallAction(actionType, alert, resolvedParams);
        break;

      case 'crowdstrike':
        // Placeholder for CrowdStrike integration
        result = { message: 'CrowdStrike integration not yet implemented' };
        break;

      default:
        throw new Error(`Unknown connector: ${connector}`);
    }

    logger.info(`✅ Action completed: ${step.name}`);
    return {
      success: true,
      output: result
    };

  } catch (error) {
    logger.error(`❌ Action failed: ${step.name}`, error);
    throw error;
  }
}

/**
 * Execute CyberSentinel active response action.
 *
 * Dispatches to the cybersentinel-response connector which communicates with
 * the CyberSentinel Control Plane Active Response subsystem.
 */
async function executeCyberSentinelAction(actionType, alert, parameters) {
  const agentId = parameters.agent_id || alert.agent_id;
  const isSimulation = parameters._simulate === true
    || parameters.trigger_source === 'simulation';

  switch (actionType) {
    case 'isolate_host':
      return await cybersentinelResponse.isolate_host({
        agent_id: agentId,
        _simulate: isSimulation,
      });

    case 'kill_process':
      return await cybersentinelResponse.kill_process({
        agent_id: agentId,
        process_name: parameters.process_name,
        pid: parameters.pid,
        _simulate: isSimulation,
      });

    case 'disable_user':
      return await cybersentinelResponse.disable_user({
        agent_id: agentId,
        username: parameters.username || alert.username,
        _simulate: isSimulation,
      });

    case 'collect_logs':
      logger.warn(`CyberSentinel action not yet implemented: ${actionType} for agent ${agentId}`);
      return { success: false, message: 'collect_logs not yet implemented', action: 'collect_logs' };

    default:
      throw new Error(`Unknown CyberSentinel action: ${actionType}`);
  }
}

/**
 * Execute firewall action
 */
async function executeFirewallAction(actionType, alert, parameters) {
  switch (actionType) {
    case 'block_ip': {
      const ip = parameters.ip || alert.source_ip;
      const duration = parameters.duration || '24h';
      const reason = parameters.reason || `Blocked by CyberSentinel: ${alert.rule_name}`;
      return await firewall.blockIp(ip, duration, reason);
    }

    case 'unblock_ip': {
      const ip = parameters.ip || alert.source_ip;
      return await firewall.unblockIp(ip);
    }

    case 'add_rule':
      return await firewall.addRule(parameters);

    case 'remove_rule':
      if (!parameters.rule_id) throw new Error('rule_id required for remove_rule action');
      return await firewall.removeRule(parameters.rule_id);

    default:
      throw new Error(`Unknown firewall action: ${actionType}`);
  }
}

export default {
  executeAction
};
