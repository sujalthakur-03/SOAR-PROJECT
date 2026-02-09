/**
 * AbuseIPDB API Integration
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const API_KEY = process.env.ABUSEIPDB_API_KEY;
const BASE_URL = 'https://api.abuseipdb.com/api/v2';

/**
 * Check IP reputation
 */
export async function checkIp(ip) {
  try {
    const response = await axios.get(`${BASE_URL}/check`, {
      params: {
        ipAddress: ip,
        maxAgeInDays: 90,
        verbose: true
      },
      headers: {
        'Key': API_KEY,
        'Accept': 'application/json'
      }
    });

    const data = response.data.data;
    return {
      ip: data.ipAddress,
      abuse_score: data.abuseConfidenceScore,
      country: data.countryCode,
      usage_type: data.usageType,
      isp: data.isp,
      domain: data.domain,
      is_whitelisted: data.isWhitelisted,
      is_tor: data.isTor,
      total_reports: data.totalReports,
      last_reported: data.lastReportedAt,
      distinct_users: data.numDistinctUsers
    };
  } catch (error) {
    logger.error('AbuseIPDB checkIp failed:', error.message);
    // Return default data if API fails
    return {
      ip,
      abuse_score: 0,
      country: 'Unknown',
      usage_type: 'Unknown',
      isp: 'Unknown',
      error: error.message
    };
  }
}

/**
 * Report IP abuse
 */
export async function reportIp(ip, categories, comment) {
  try {
    const response = await axios.post(
      `${BASE_URL}/report`,
      new URLSearchParams({
        ip,
        categories: categories.join(','),
        comment
      }),
      {
        headers: {
          'Key': API_KEY,
          'Accept': 'application/json'
        }
      }
    );

    logger.info(`✅ Reported IP ${ip} to AbuseIPDB`);
    return {
      success: true,
      ip,
      abuseConfidenceScore: response.data.data.abuseConfidenceScore
    };
  } catch (error) {
    logger.error('AbuseIPDB reportIp failed:', error.message);
    throw error;
  }
}

export default {
  checkIp,
  reportIp
};
