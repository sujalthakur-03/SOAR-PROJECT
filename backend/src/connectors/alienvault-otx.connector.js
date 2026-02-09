/**
 * AlienVault OTX Connector — Connector Contract Implementation
 *
 * Provides IP reputation, domain lookup, and file hash lookup
 * via the AlienVault OTX DirectConnect API v1.
 *
 * Registered as connector "alienvault-otx" in the connector registry.
 * The execution engine calls execute() via invokeConnector().
 *
 * ACTIONS:
 *   - lookup_ip     : Get IP address threat intelligence
 *   - lookup_domain : Get domain threat intelligence
 *   - lookup_hash   : Get file hash threat intelligence
 *
 * API: https://otx.alienvault.com/api/v1/indicators/
 * Auth: X-OTX-API-KEY header
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const DEFAULT_BASE_URL = 'https://otx.alienvault.com/api/v1';

/**
 * Derive reputation label from pulse count.
 *   0 pulses       → clean
 *   1-4 pulses     → suspicious
 *   5+ pulses      → malicious
 */
function deriveReputation(pulseCount) {
  if (pulseCount >= 5) return 'malicious';
  if (pulseCount >= 1) return 'suspicious';
  return 'clean';
}

/**
 * Derive confidence score from pulse count and validation data.
 * Scale: 0-100
 */
function deriveConfidence(pulseCount, validation = []) {
  if (pulseCount === 0) return 0;
  // Base confidence from pulse count (capped at 70)
  const pulseScore = Math.min(pulseCount * 7, 70);
  // Bonus for validation entries
  const validationBonus = Math.min((validation?.length || 0) * 10, 30);
  return Math.min(pulseScore + validationBonus, 100);
}

/**
 * Get API key from config with fallback to environment variable.
 * OTX allows unauthenticated access with lower rate limits,
 * so a missing key logs a warning rather than failing outright.
 */
function getApiKey(config) {
  const apiKey = config.api_key
    || config.otx_api_key
    || process.env.ALIENVAULT_OTX_API_KEY;

  if (!apiKey || apiKey === 'your_alienvault_otx_api_key') {
    logger.warn('[AlienVaultOTX] No API key configured — using unauthenticated access (lower rate limits)');
    return null;
  }

  return apiKey;
}

/**
 * Build request headers. Includes API key header only when a key is available.
 */
function buildHeaders(apiKey) {
  const headers = {};
  if (apiKey) {
    headers['X-OTX-API-KEY'] = apiKey;
  }
  return headers;
}

/**
 * Look up IP address via OTX DirectConnect API.
 * Endpoint: GET /indicators/IPv4/{ip}/general
 */
async function lookupIP(ip, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = getApiKey(config);

  const response = await axios.get(
    `${baseUrl}/indicators/IPv4/${ip}/general`,
    {
      headers: buildHeaders(apiKey),
      timeout: config.timeout_ms || 15000
    }
  );

  const data = response.data || {};
  const pulseCount = data.pulse_info?.count || 0;
  const pulses = (data.pulse_info?.pulses || []).slice(0, 10).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description?.substring(0, 200),
    created: p.created,
    tags: p.tags || [],
    adversary: p.adversary || ''
  }));
  const validation = data.validation || [];

  return {
    observable: ip,
    type: 'ip',
    pulse_count: pulseCount,
    reputation: deriveReputation(pulseCount),
    confidence: deriveConfidence(pulseCount, validation),
    country_code: data.country_code || null,
    country_name: data.country_name || null,
    asn: data.asn || null,
    city: data.city || null,
    pulses,
    raw: data
  };
}

/**
 * Look up domain via OTX DirectConnect API.
 * Endpoint: GET /indicators/domain/{domain}/general
 */
async function lookupDomain(domain, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = getApiKey(config);

  const response = await axios.get(
    `${baseUrl}/indicators/domain/${domain}/general`,
    {
      headers: buildHeaders(apiKey),
      timeout: config.timeout_ms || 15000
    }
  );

  const data = response.data || {};
  const pulseCount = data.pulse_info?.count || 0;
  const pulses = (data.pulse_info?.pulses || []).slice(0, 10).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description?.substring(0, 200),
    created: p.created,
    tags: p.tags || [],
    adversary: p.adversary || ''
  }));
  const validation = data.validation || [];

  return {
    observable: domain,
    type: 'domain',
    pulse_count: pulseCount,
    reputation: deriveReputation(pulseCount),
    confidence: deriveConfidence(pulseCount, validation),
    whois: data.whois || null,
    alexa: data.alexa || null,
    pulses,
    raw: data
  };
}

/**
 * Look up file hash via OTX DirectConnect API.
 * Endpoint: GET /indicators/file/{hash}/general
 */
async function lookupHash(hash, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = getApiKey(config);

  const response = await axios.get(
    `${baseUrl}/indicators/file/${hash}/general`,
    {
      headers: buildHeaders(apiKey),
      timeout: config.timeout_ms || 15000
    }
  );

  const data = response.data || {};
  const pulseCount = data.pulse_info?.count || 0;
  const pulses = (data.pulse_info?.pulses || []).slice(0, 10).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description?.substring(0, 200),
    created: p.created,
    tags: p.tags || [],
    adversary: p.adversary || ''
  }));
  const validation = data.validation || [];

  // Extract analysis data if present
  const analysis = data.analysis || {};
  const malware = analysis.malware || {};

  return {
    observable: hash,
    type: 'hash',
    pulse_count: pulseCount,
    reputation: deriveReputation(pulseCount),
    confidence: deriveConfidence(pulseCount, validation),
    file_type: data.type || null,
    file_class: data.type_class || null,
    malware_families: malware.families || [],
    pulses,
    raw: data
  };
}

/**
 * Connector implementation following the standard contract.
 *
 * INTERFACE:
 *   inputSchema  — declared per action
 *   outputSchema — declared per action
 *   execute(action, inputs, config) → ConnectorResult
 */
export const alienvaultOtxConnector = {
  inputSchema: {
    lookup_ip: {
      required_fields: ['ip'],
      optional_fields: [],
      field_types: { ip: 'string' }
    },
    lookup_domain: {
      required_fields: ['domain'],
      optional_fields: [],
      field_types: { domain: 'string' }
    },
    lookup_hash: {
      required_fields: ['hash'],
      optional_fields: [],
      field_types: { hash: 'string' }
    }
  },

  outputSchema: {
    lookup_ip: {
      output_fields: {
        observable: 'string',
        type: 'string',
        pulse_count: 'number',
        reputation: 'string',
        confidence: 'number',
        country_code: 'string',
        pulses: 'array'
      }
    },
    lookup_domain: {
      output_fields: {
        observable: 'string',
        type: 'string',
        pulse_count: 'number',
        reputation: 'string',
        confidence: 'number',
        pulses: 'array'
      }
    },
    lookup_hash: {
      output_fields: {
        observable: 'string',
        type: 'string',
        pulse_count: 'number',
        reputation: 'string',
        confidence: 'number',
        pulses: 'array'
      }
    }
  },

  async execute(action, inputs, config) {
    switch (action) {
      case 'lookup_ip':
      case 'otx_ip': {
        const ip = inputs.ip || inputs.source_ip || inputs.observable;
        if (!ip) {
          throw Object.assign(
            new Error('No IP address provided for AlienVault OTX lookup'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        logger.info(`[AlienVaultOTX] Looking up IP: ${ip}`);
        return await lookupIP(ip, config);
      }

      case 'lookup_domain':
      case 'otx_domain': {
        const domain = inputs.domain || inputs.observable;
        if (!domain) {
          throw Object.assign(
            new Error('No domain provided for AlienVault OTX lookup'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        logger.info(`[AlienVaultOTX] Looking up domain: ${domain}`);
        return await lookupDomain(domain, config);
      }

      case 'lookup_hash':
      case 'otx_hash': {
        const hash = inputs.hash || inputs.file_hash || inputs.observable;
        if (!hash) {
          throw Object.assign(
            new Error('No hash provided for AlienVault OTX lookup'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        logger.info(`[AlienVaultOTX] Looking up hash: ${hash}`);
        return await lookupHash(hash, config);
      }

      default:
        throw Object.assign(
          new Error(`Unknown AlienVault OTX action: ${action}. Supported: lookup_ip, lookup_domain, lookup_hash`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  }
};

export default alienvaultOtxConnector;
