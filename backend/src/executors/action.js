/**
 * Action Step Executor
 * Handles automated response actions (blocking, isolation, etc.)
 */

// CyberSentinel active response integration
import * as firewall from '../integrations/firewall.js';
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
 * Execute CyberSentinel active response action
 */
async function executeCyberSentinelAction(actionType, alert, parameters) {
  const agentId = parameters.agent_id || alert.agent_id;

  // TODO: Implement CyberSentinel agent API integration
  logger.warn(`CyberSentinel action not yet implemented: ${actionType} for agent ${agentId}`);

  switch (actionType) {
    case 'isolate_host':
      return { success: false, message: 'CyberSentinel agent integration not implemented', action: 'isolate_host' };

    case 'kill_process':
      if (!parameters.pid) throw new Error('PID required for kill_process action');
      return { success: false, message: 'CyberSentinel agent integration not implemented', action: 'kill_process' };

    case 'collect_logs':
      return { success: false, message: 'CyberSentinel agent integration not implemented', action: 'collect_logs' };

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
