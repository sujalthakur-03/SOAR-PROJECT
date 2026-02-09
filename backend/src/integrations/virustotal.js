/**
 * VirusTotal API Integration
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const API_KEY = process.env.VIRUSTOTAL_API_KEY;
const BASE_URL = 'https://www.virustotal.com/api/v3';

/**
 * Scan file hash
 */
export async function scanHash(hash) {
  try {
    const response = await axios.get(`${BASE_URL}/files/${hash}`, {
      headers: { 'x-apikey': API_KEY }
    });

    const data = response.data.data.attributes;
    return {
      hash,
      malicious: data.last_analysis_stats.malicious,
      suspicious: data.last_analysis_stats.suspicious,
      undetected: data.last_analysis_stats.undetected,
      harmless: data.last_analysis_stats.harmless,
      total_vendors: Object.keys(data.last_analysis_results).length,
      reputation_score: calculateReputationScore(data.last_analysis_stats),
      last_analysis_date: data.last_analysis_date,
      names: data.names || []
    };
  } catch (error) {
    logger.error('VirusTotal scanHash failed:', error.message);
    throw error;
  }
}

/**
 * Scan URL
 */
export async function scanUrl(url) {
  try {
    // First, submit URL for scanning
    const submitResponse = await axios.post(
      `${BASE_URL}/urls`,
      new URLSearchParams({ url }),
      {
        headers: { 'x-apikey': API_KEY }
      }
    );

    const analysisId = submitResponse.data.data.id;

    // Wait a bit for analysis to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get analysis results
    const response = await axios.get(`${BASE_URL}/analyses/${analysisId}`, {
      headers: { 'x-apikey': API_KEY }
    });

    const data = response.data.data.attributes;
    return {
      url,
      malicious: data.stats.malicious,
      suspicious: data.stats.suspicious,
      undetected: data.stats.undetected,
      harmless: data.stats.harmless,
      total_vendors: Object.values(data.stats).reduce((a, b) => a + b, 0),
      reputation_score: calculateReputationScore(data.stats),
      status: data.status
    };
  } catch (error) {
    logger.error('VirusTotal scanUrl failed:', error.message);
    throw error;
  }
}

/**
 * Scan file (upload and analyze)
 */
export async function scanFile(fileBuffer, fileName) {
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileBuffer, fileName);

    const response = await axios.post(`${BASE_URL}/files`, form, {
      headers: {
        ...form.getHeaders(),
        'x-apikey': API_KEY
      }
    });

    return {
      fileName,
      analysisId: response.data.data.id,
      status: 'queued'
    };
  } catch (error) {
    logger.error('VirusTotal scanFile failed:', error.message);
    throw error;
  }
}

/**
 * Calculate reputation score (0-100, higher is worse)
 */
function calculateReputationScore(stats) {
  const total = stats.malicious + stats.suspicious + stats.undetected + stats.harmless;
  if (total === 0) return 0;

  const weighted = (stats.malicious * 100) + (stats.suspicious * 50);
  return Math.round((weighted / total));
}

export default {
  scanHash,
  scanUrl,
  scanFile
};
