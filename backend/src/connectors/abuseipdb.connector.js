/**
 * AbuseIPDB Connector — Connector Contract Implementation
 *
 * Provides IP reputation lookup via the AbuseIPDB API v2.
 *
 * Registered as connector type "abuseipdb" in the connector registry.
 * The execution engine calls execute() via invokeConnector().
 *
 * ACTIONS:
 *   - lookup_ip   : Check IP reputation / abuse confidence score
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const DEFAULT_BASE_URL = 'https://api.abuseipdb.com/api/v2';

/**
 * Check IP reputation via AbuseIPDB API v2.
 * Endpoint: GET /check
 */
async function lookupIP(ip, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = config.api_key;

  if (!apiKey) {
    throw Object.assign(
      new Error('AbuseIPDB API key not configured'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }

  const response = await axios.get(`${baseUrl}/check`, {
    params: {
      ipAddress: ip,
      maxAgeInDays: 90,
      verbose: true
    },
    headers: {
      'Key': apiKey,
      'Accept': 'application/json'
    },
    timeout: config.timeout_ms || 10000
  });

  const data = response.data?.data || {};

  return {
    ip: data.ipAddress || ip,
    abuse_score: data.abuseConfidenceScore || 0,
    reputation_score: data.abuseConfidenceScore || 0,
    country: data.countryCode || 'Unknown',
    usage_type: data.usageType || 'Unknown',
    isp: data.isp || 'Unknown',
    domain: data.domain || 'Unknown',
    is_whitelisted: data.isWhitelisted || false,
    is_tor: data.isTor || false,
    total_reports: data.totalReports || 0,
    last_reported: data.lastReportedAt || null,
    distinct_users: data.numDistinctUsers || 0,
    is_malicious: (data.abuseConfidenceScore || 0) > 50
  };
}

/**
 * Connector implementation following the standard contract.
 */
export const abuseipdbConnector = {
  inputSchema: {
    lookup_ip: {
      required_fields: ['ip'],
      optional_fields: ['max_age_days'],
      field_types: { ip: 'string', max_age_days: 'number' }
    }
  },

  outputSchema: {
    lookup_ip: {
      output_fields: {
        ip: 'string',
        abuse_score: 'number',
        reputation_score: 'number',
        country: 'string',
        isp: 'string',
        is_tor: 'boolean',
        is_whitelisted: 'boolean',
        total_reports: 'number',
        is_malicious: 'boolean'
      }
    }
  },

  async execute(action, inputs, config) {
    switch (action) {
      case 'lookup_ip':
      case 'check_ip': {
        if (!inputs.ip) {
          throw Object.assign(
            new Error('No IP address provided for AbuseIPDB lookup'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        return await lookupIP(inputs.ip, config);
      }

      default:
        throw Object.assign(
          new Error(`Unknown AbuseIPDB action: ${action}. Supported: lookup_ip`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  }
};

export default abuseipdbConnector;
