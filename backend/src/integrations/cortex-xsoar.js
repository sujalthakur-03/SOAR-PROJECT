/**
 * Cortex XSOAR Integration
 * Threat Intelligence and Incident Management Platform
 */

import axios from 'axios';
import https from 'https';
import logger from '../utils/logger.js';

const cortexConfig = {
  apiUrl: process.env.CORTEX_API_URL,
  apiKey: process.env.CORTEX_API_KEY,
  verifySSL: process.env.CORTEX_VERIFY_SSL !== 'false'
};

// HTTPS agent for self-signed certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: cortexConfig.verifySSL
});

/**
 * Check IP reputation in Cortex XSOAR
 */
export async function checkIpReputation(ip) {
  try {
    logger.info(`Checking IP reputation in Cortex XSOAR: ${ip}`);

    const response = await axios.post(
      `${cortexConfig.apiUrl}/indicators/search`,
      {
        query: `value:"${ip}" and type:IP`,
        size: 1
      },
      {
        headers: {
          'Authorization': cortexConfig.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent
      }
    );

    const indicators = response.data.iocObjects || [];

    if (indicators.length === 0) {
      logger.info(`IP ${ip} not found in Cortex XSOAR indicators`);
      return {
        ip,
        found: false,
        reputation: 'unknown',
        score: 0,
        verdict: 'Unknown'
      };
    }

    const indicator = indicators[0];
    const score = indicator.score || 0;
    const verdict = determineVerdict(score);

    logger.info(`IP ${ip} reputation from Cortex: ${verdict} (score: ${score})`);

    return {
      ip,
      found: true,
      reputation: indicator.reputation || 'unknown',
      score,
      verdict,
      malicious: score >= 3, // Score 3 = Malicious in Cortex
      suspicious: score === 2,
      is_malicious: score >= 3,
      source: 'Cortex XSOAR',
      last_seen: indicator.lastSeen,
      first_seen: indicator.firstSeen,
      tags: indicator.CustomFields?.tags || [],
      related_incidents: indicator.relatedIncidents || []
    };
  } catch (error) {
    logger.error('Cortex XSOAR IP check failed:', error.message);

    // Return default response on error
    return {
      ip,
      found: false,
      reputation: 'unknown',
      score: 0,
      verdict: 'Unknown',
      error: error.message
    };
  }
}

/**
 * Check file hash reputation
 */
export async function checkFileHash(hash) {
  try {
    logger.info(`Checking file hash in Cortex XSOAR: ${hash}`);

    const response = await axios.post(
      `${cortexConfig.apiUrl}/indicators/search`,
      {
        query: `value:"${hash}" and (type:File or type:"File MD5" or type:"File SHA-1" or type:"File SHA-256")`,
        size: 1
      },
      {
        headers: {
          'Authorization': cortexConfig.apiKey,
          'Content-Type': 'application/json'
        },
        httpsAgent
      }
    );

    const indicators = response.data.iocObjects || [];

    if (indicators.length === 0) {
      return {
        hash,
        found: false,
        reputation: 'unknown',
        score: 0,
        verdict: 'Unknown'
      };
    }

    const indicator = indicators[0];
    const score = indicator.score || 0;

    return {
      hash,
      found: true,
      reputation: indicator.reputation,
      score,
      verdict: determineVerdict(score),
      malicious: score >= 3,
      source: 'Cortex XSOAR',
      indicator_type: indicator.indicator_type
    };
  } catch (error) {
    logger.error('Cortex XSOAR hash check failed:', error.message);
    return {
      hash,
      found: false,
      error: error.message
    };
  }
}

/**
 * Create incident in Cortex XSOAR
 */
export async function createIncident(alert, enrichmentData = {}) {
  try {
    logger.info(`Creating incident in Cortex XSOAR for alert: ${alert.alert_id}`);

    const incident = {
      name: `CyberSentinel: ${alert.rule_name}`,
      type: 'CyberSentinel Alert',
      severity: mapSeverityToCortex(alert.severity),
      occurred: alert.timestamp,
      details: alert.description,
      customFields: {
        alertid: alert.alert_id,
        ruleid: alert.rule_id,
        agentid: alert.agent_id,
        agentname: alert.agent_name,
        sourceip: alert.source_ip,
        destinationip: alert.destination_ip,
        mitretechnique: alert.mitre_technique,
        mitretactic: alert.mitre_tactic,
        enrichmentdata: JSON.stringify(enrichmentData)
      },
      labels: [
        { type: 'Source', value: 'CyberSentinel' },
        { type: 'Severity', value: alert.severity },
        { type: 'AgentName', value: alert.agent_name }
      ]
    };

    const response = await axios.post(
      `${cortexConfig.apiUrl}/incident`,
      incident,
      {
        headers: {
          'Authorization': cortexConfig.apiKey,
          'Content-Type': 'application/json'
        },
        httpsAgent
      }
    );

    const incidentId = response.data.id;
    logger.info(`✅ Created Cortex incident: ${incidentId}`);

    return {
      success: true,
      incident_id: incidentId,
      incident_url: `${cortexConfig.apiUrl.replace('/api/v1', '')}/#/Details/${incidentId}`
    };
  } catch (error) {
    logger.error('Failed to create Cortex incident:', error.message);
    throw error;
  }
}

/**
 * Run playbook in Cortex XSOAR
 */
export async function runPlaybook(playbookId, inputs = {}) {
  try {
    logger.info(`Running Cortex playbook: ${playbookId}`);

    const response = await axios.post(
      `${cortexConfig.apiUrl}/playbook/run`,
      {
        playbookId,
        inputs
      },
      {
        headers: {
          'Authorization': cortexConfig.apiKey,
          'Content-Type': 'application/json'
        },
        httpsAgent
      }
    );

    logger.info(`✅ Cortex playbook started: ${response.data.playbookId}`);

    return {
      success: true,
      playbook_id: playbookId,
      execution_id: response.data.playbookId
    };
  } catch (error) {
    logger.error('Failed to run Cortex playbook:', error.message);
    throw error;
  }
}

/**
 * Get indicators related to an IP
 */
export async function getIpIndicators(ip) {
  try {
    const response = await axios.post(
      `${cortexConfig.apiUrl}/indicators/search`,
      {
        query: `value:"${ip}"`,
        size: 10
      },
      {
        headers: {
          'Authorization': cortexConfig.apiKey,
          'Content-Type': 'application/json'
        },
        httpsAgent
      }
    );

    return response.data.iocObjects || [];
  } catch (error) {
    logger.error('Failed to get IP indicators:', error.message);
    return [];
  }
}

/**
 * Determine verdict from score
 */
function determineVerdict(score) {
  if (score === 0) return 'Unknown';
  if (score === 1) return 'Good';
  if (score === 2) return 'Suspicious';
  if (score === 3) return 'Malicious';
  return 'Unknown';
}

/**
 * Map CyberSentinel severity to Cortex severity
 */
function mapSeverityToCortex(severity) {
  const mapping = {
    'critical': 4,
    'high': 3,
    'medium': 2,
    'low': 1,
    'info': 0
  };
  return mapping[severity] || 0;
}

export default {
  checkIpReputation,
  checkFileHash,
  createIncident,
  runPlaybook,
  getIpIndicators
};
