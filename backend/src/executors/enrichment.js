/**
 * Enrichment Step Executor
 * Handles threat intelligence enrichment from various sources
 */

import * as virustotal from '../integrations/virustotal.js';
import * as abuseipdb from '../integrations/abuseipdb.js';
import * as cortex from '../integrations/cortex-xsoar.js';
import logger from '../utils/logger.js';
import { replaceVariables } from '../utils/helpers.js';

/**
 * Execute enrichment step
 */
export async function executeEnrichment(step, alert, context) {
  logger.info(`Executing enrichment step: ${step.name}`);

  const config = step.config;
  const source = config.source || config.connector;
  const action = config.action_type || config.action || 'lookup';

  try {
    let result;

    switch (source) {
      case 'cortex':
      case 'cortex-xsoar':
        result = await executeCortexEnrichment(action, alert, context, config);
        break;

      case 'virustotal':
        result = await executeVirusTotalEnrichment(action, alert, context, config);
        break;

      case 'abuseipdb':
        result = await executeAbuseIPDBEnrichment(action, alert, context, config);
        break;

      case 'shodan':
        // Placeholder for Shodan integration
        result = { message: 'Shodan integration not yet implemented' };
        break;

      case 'greynoise':
        // Placeholder for GreyNoise integration
        result = { message: 'GreyNoise integration not yet implemented' };
        break;

      default:
        throw new Error(`Unknown enrichment source: ${source}`);
    }

    // Store result in context
    const outputVariable = config.output_variable || `${source}_data`;
    context[outputVariable] = result;

    logger.info(`✅ Enrichment completed: ${step.name}`);
    return {
      success: true,
      output: result
    };

  } catch (error) {
    logger.error(`❌ Enrichment failed: ${step.name}`, error);
    throw error;
  }
}

/**
 * Execute VirusTotal enrichment
 */
async function executeVirusTotalEnrichment(action, alert, context, config) {
  switch (action) {
    case 'lookup_hash':
    case 'scan_hash': {
      const hash = config.hash || alert.raw_data?.file_hash;
      if (!hash) throw new Error('No hash provided for VirusTotal scan');
      return await virustotal.scanHash(hash);
    }

    case 'lookup_url':
    case 'scan_url': {
      const url = config.url || alert.raw_data?.url;
      if (!url) throw new Error('No URL provided for VirusTotal scan');
      return await virustotal.scanUrl(url);
    }

    default:
      throw new Error(`Unknown VirusTotal action: ${action}`);
  }
}

/**
 * Execute AbuseIPDB enrichment
 */
async function executeAbuseIPDBEnrichment(action, alert, context, config) {
  switch (action) {
    case 'lookup_ip':
    case 'check_ip': {
      const ip = config.ip || alert.source_ip || replaceVariables(config.field, { ...alert, ...context });
      if (!ip) throw new Error('No IP provided for AbuseIPDB check');
      return await abuseipdb.checkIp(ip);
    }

    case 'report_ip': {
      const ip = config.ip || alert.source_ip;
      const categories = config.categories || [18]; // Default: Brute Force
      const comment = config.comment || `Reported by CyberSentinel: ${alert.rule_name}`;
      return await abuseipdb.reportIp(ip, categories, comment);
    }

    default:
      throw new Error(`Unknown AbuseIPDB action: ${action}`);
  }
}

/**
 * Execute Cortex XSOAR enrichment
 */
async function executeCortexEnrichment(action, alert, context, config) {
  switch (action) {
    case 'check_ip':
    case 'lookup_ip': {
      const ip = config.ip || alert.source_ip || replaceVariables(config.field, { ...alert, ...context });
      if (!ip) throw new Error('No IP provided for Cortex check');
      return await cortex.checkIpReputation(ip);
    }

    case 'check_hash':
    case 'lookup_hash': {
      const hash = config.hash || alert.raw_data?.file_hash;
      if (!hash) throw new Error('No hash provided for Cortex check');
      return await cortex.checkFileHash(hash);
    }

    case 'create_incident': {
      return await cortex.createIncident(alert, context);
    }

    default:
      throw new Error(`Unknown Cortex action: ${action}`);
  }
}

export default {
  executeEnrichment
};
