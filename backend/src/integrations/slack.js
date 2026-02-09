/**
 * Slack Integration
 */

import axios from 'axios';
import logger from '../utils/logger.js';

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

/**
 * Send message to Slack channel via webhook
 */
export async function sendMessage(channel, message, alertData = null) {
  try {
    const payload = {
      channel,
      text: message,
      blocks: alertData ? formatAlertBlocks(alertData) : undefined
    };

    const response = await axios.post(WEBHOOK_URL, payload);

    logger.info(`✅ Slack message sent to ${channel}`);
    return {
      success: true,
      channel,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Slack sendMessage failed:', error.message);
    throw error;
  }
}

/**
 * Format alert data as Slack blocks for rich display
 */
function formatAlertBlocks(alert) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 ${alert.rule_name}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Severity:*\n${getSeverityEmoji(alert.severity)} ${alert.severity.toUpperCase()}`
        },
        {
          type: 'mrkdwn',
          text: `*Agent:*\n${alert.agent_name}`
        },
        {
          type: 'mrkdwn',
          text: `*Source IP:*\n${alert.source_ip || 'N/A'}`
        },
        {
          type: 'mrkdwn',
          text: `*Time:*\n${new Date(alert.timestamp).toLocaleString()}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${alert.description}`
      }
    },
    {
      type: 'divider'
    }
  ];
}

/**
 * Get emoji for severity level
 */
function getSeverityEmoji(severity) {
  const emojis = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    info: '🔵'
  };
  return emojis[severity] || '⚪';
}

/**
 * Create Slack channel
 */
export async function createChannel(name, isPrivate = false) {
  try {
    if (!BOT_TOKEN) {
      throw new Error('Slack bot token not configured');
    }

    const response = await axios.post(
      'https://slack.com/api/conversations.create',
      {
        name,
        is_private: isPrivate
      },
      {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.ok) {
      throw new Error(response.data.error);
    }

    logger.info(`✅ Slack channel created: ${name}`);
    return {
      success: true,
      channelId: response.data.channel.id,
      channelName: name
    };
  } catch (error) {
    logger.error('Slack createChannel failed:', error.message);
    throw error;
  }
}

export default {
  sendMessage,
  createChannel
};
