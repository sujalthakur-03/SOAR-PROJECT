/**
 * VirusTotal Connector — Connector Contract Implementation
 *
 * Provides IP reputation lookup, hash scanning, and URL scanning
 * via the VirusTotal API v3.
 *
 * Registered as connector type "virustotal" in the connector registry.
 * The execution engine calls execute() via invokeConnector().
 *
 * ACTIONS:
 *   - lookup_ip   : Get IP address reputation
 *   - scan_hash   : Get file hash reputation
 *   - scan_url    : Submit and analyze a URL
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const DEFAULT_BASE_URL = 'https://www.virustotal.com/api/v3';

/**
 * Validate IPv4 address — each octet must be 0-255
 */
function isValidIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * Look up IP address reputation via VirusTotal API v3.
 * Endpoint: GET /ip_addresses/{ip}
 */
async function lookupIP(ip, config) {
  if (!isValidIPv4(ip)) {
    throw Object.assign(
      new Error(`Invalid IP address: ${ip} — each octet must be 0-255`),
      { code: 'INVALID_INPUT', retryable: false }
    );
  }
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = config.api_key;

  if (!apiKey || apiKey === 'your_virustotal_api_key_here') {
    throw Object.assign(
      new Error('VirusTotal API key not configured'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }

  const response = await axios.get(`${baseUrl}/ip_addresses/${ip}`, {
    headers: { 'x-apikey': apiKey },
    timeout: config.timeout_ms || 15000
  });

  const attrs = response.data?.data?.attributes || {};
  const stats = attrs.last_analysis_stats || {};

  const malicious = stats.malicious || 0;
  const suspicious = stats.suspicious || 0;
  const harmless = stats.harmless || 0;
  const undetected = stats.undetected || 0;
  const total = malicious + suspicious + harmless + undetected;

  return {
    ip,
    malicious_votes: malicious,
    suspicious_votes: suspicious,
    harmless_votes: harmless,
    undetected_votes: undetected,
    total_vendors: total,
    reputation_score: total > 0
      ? Math.round(((malicious * 100) + (suspicious * 50)) / total)
      : 0,
    as_owner: attrs.as_owner || 'Unknown',
    country: attrs.country || 'Unknown',
    network: attrs.network || 'Unknown',
    last_analysis_date: attrs.last_analysis_date || null,
    is_malicious: malicious > 0
  };
}

/**
 * Look up file hash reputation via VirusTotal API v3.
 * Endpoint: GET /files/{hash}
 */
async function scanHash(hash, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = config.api_key;

  if (!apiKey || apiKey === 'your_virustotal_api_key_here') {
    throw Object.assign(
      new Error('VirusTotal API key not configured'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }

  const response = await axios.get(`${baseUrl}/files/${hash}`, {
    headers: { 'x-apikey': apiKey },
    timeout: config.timeout_ms || 15000
  });

  const attrs = response.data?.data?.attributes || {};
  const stats = attrs.last_analysis_stats || {};

  return {
    hash,
    malicious: stats.malicious || 0,
    suspicious: stats.suspicious || 0,
    undetected: stats.undetected || 0,
    harmless: stats.harmless || 0,
    total_vendors: Object.keys(attrs.last_analysis_results || {}).length,
    reputation_score: calculateScore(stats),
    last_analysis_date: attrs.last_analysis_date || null,
    names: attrs.names || []
  };
}

/**
 * Submit and scan a URL via VirusTotal API v3.
 */
async function scanUrl(url, config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const apiKey = config.api_key;

  if (!apiKey || apiKey === 'your_virustotal_api_key_here') {
    throw Object.assign(
      new Error('VirusTotal API key not configured'),
      { code: 'AUTH_FAILED', retryable: false }
    );
  }

  const submitResponse = await axios.post(
    `${baseUrl}/urls`,
    new URLSearchParams({ url }),
    {
      headers: { 'x-apikey': apiKey },
      timeout: config.timeout_ms || 15000
    }
  );

  const analysisId = submitResponse.data?.data?.id;

  // Brief wait for analysis
  await new Promise(resolve => setTimeout(resolve, 3000));

  const response = await axios.get(`${baseUrl}/analyses/${analysisId}`, {
    headers: { 'x-apikey': apiKey },
    timeout: config.timeout_ms || 15000
  });

  const attrs = response.data?.data?.attributes || {};
  const stats = attrs.stats || {};

  return {
    url,
    malicious: stats.malicious || 0,
    suspicious: stats.suspicious || 0,
    undetected: stats.undetected || 0,
    harmless: stats.harmless || 0,
    total_vendors: Object.values(stats).reduce((a, b) => a + b, 0),
    reputation_score: calculateScore(stats),
    status: attrs.status || 'unknown'
  };
}

function calculateScore(stats) {
  const total = (stats.malicious || 0) + (stats.suspicious || 0) +
                (stats.undetected || 0) + (stats.harmless || 0);
  if (total === 0) return 0;
  const weighted = ((stats.malicious || 0) * 100) + ((stats.suspicious || 0) * 50);
  return Math.round(weighted / total);
}

/**
 * Connector implementation following the standard contract.
 */
export const virustotalConnector = {
  inputSchema: {
    lookup_ip: {
      required_fields: ['ip'],
      optional_fields: [],
      field_types: { ip: 'string' }
    },
    scan_hash: {
      required_fields: ['hash'],
      optional_fields: [],
      field_types: { hash: 'string' }
    },
    scan_url: {
      required_fields: ['url'],
      optional_fields: [],
      field_types: { url: 'string' }
    }
  },

  outputSchema: {
    lookup_ip: {
      output_fields: {
        ip: 'string',
        malicious_votes: 'number',
        suspicious_votes: 'number',
        harmless_votes: 'number',
        reputation_score: 'number',
        is_malicious: 'boolean',
        country: 'string',
        as_owner: 'string'
      }
    }
  },

  async execute(action, inputs, config) {
    switch (action) {
      case 'lookup_ip': {
        if (!inputs.ip) {
          throw Object.assign(
            new Error('No IP address provided for VirusTotal lookup'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        return await lookupIP(inputs.ip, config);
      }

      case 'scan_hash':
      case 'lookup_hash': {
        if (!inputs.hash) {
          throw Object.assign(
            new Error('No hash provided for VirusTotal scan'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        return await scanHash(inputs.hash, config);
      }

      case 'scan_url':
      case 'lookup_url': {
        if (!inputs.url) {
          throw Object.assign(
            new Error('No URL provided for VirusTotal scan'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        return await scanUrl(inputs.url, config);
      }

      default:
        throw Object.assign(
          new Error(`Unknown VirusTotal action: ${action}. Supported: lookup_ip, scan_hash, scan_url`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  }
};

export default virustotalConnector;
