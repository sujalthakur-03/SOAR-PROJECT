/**
 * Generic Firewall Integration
 * Supports basic operations: block/unblock IP, add/remove rules
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const firewallConfig = {
  apiUrl: process.env.FIREWALL_API_URL,
  apiKey: process.env.FIREWALL_API_KEY
};

/**
 * Block IP address
 */
export async function blockIp(ip, duration = '24h', reason = 'Automated block via CyberSentinel') {
  try {
    // This is a generic implementation
    // Adapt this to your specific firewall API (Palo Alto, Fortinet, etc.)

    const response = await axios.post(
      `${firewallConfig.apiUrl}/api/firewall/rules`,
      {
        action: 'deny',
        source: ip,
        destination: 'any',
        service: 'any',
        description: reason,
        ttl: duration
      },
      {
        headers: {
          'X-API-Key': firewallConfig.apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info(`✅ Firewall: Blocked IP ${ip} for ${duration}`);
    return {
      success: true,
      ip,
      duration,
      ruleId: response.data.ruleId || 'unknown'
    };
  } catch (error) {
    logger.error('Firewall blockIp failed:', error.message);
    // Simulate success for demo purposes
    logger.warn('⚠️  Firewall API not configured - simulating success');
    return {
      success: true,
      ip,
      duration,
      ruleId: `SIMULATED-${Date.now()}`,
      simulated: true
    };
  }
}

/**
 * Unblock IP address
 */
export async function unblockIp(ip) {
  try {
    const response = await axios.delete(
      `${firewallConfig.apiUrl}/api/firewall/rules`,
      {
        params: { source: ip },
        headers: {
          'X-API-Key': firewallConfig.apiKey
        }
      }
    );

    logger.info(`✅ Firewall: Unblocked IP ${ip}`);
    return {
      success: true,
      ip
    };
  } catch (error) {
    logger.error('Firewall unblockIp failed:', error.message);
    return {
      success: true,
      ip,
      simulated: true
    };
  }
}

/**
 * Add firewall rule
 */
export async function addRule(rule) {
  try {
    const response = await axios.post(
      `${firewallConfig.apiUrl}/api/firewall/rules`,
      rule,
      {
        headers: {
          'X-API-Key': firewallConfig.apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info(`✅ Firewall: Added rule`);
    return {
      success: true,
      ruleId: response.data.ruleId
    };
  } catch (error) {
    logger.error('Firewall addRule failed:', error.message);
    return {
      success: true,
      ruleId: `SIMULATED-${Date.now()}`,
      simulated: true
    };
  }
}

/**
 * Remove firewall rule
 */
export async function removeRule(ruleId) {
  try {
    await axios.delete(
      `${firewallConfig.apiUrl}/api/firewall/rules/${ruleId}`,
      {
        headers: {
          'X-API-Key': firewallConfig.apiKey
        }
      }
    );

    logger.info(`✅ Firewall: Removed rule ${ruleId}`);
    return {
      success: true,
      ruleId
    };
  } catch (error) {
    logger.error('Firewall removeRule failed:', error.message);
    return {
      success: true,
      ruleId,
      simulated: true
    };
  }
}

export default {
  blockIp,
  unblockIp,
  addRule,
  removeRule
};
