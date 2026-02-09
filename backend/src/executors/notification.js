/**
 * Notification Step Executor
 * Handles sending notifications via various channels
 */

import * as slack from '../integrations/slack.js';
import * as email from '../integrations/email.js';
import logger from '../utils/logger.js';
import { replaceVariables } from '../utils/helpers.js';

/**
 * Execute notification step
 */
export async function executeNotification(step, alert, context) {
  logger.info(`Executing notification step: ${step.name}`);

  const config = step.config;
  const channel = config.channel;
  const recipients = config.recipients;
  const message = config.message || config.template || step.name;

  // Replace variables in message
  const resolvedMessage = replaceVariables(message, { ...alert, ...context });

  try {
    let result;

    switch (channel) {
      case 'slack':
        result = await executeSlackNotification(recipients, resolvedMessage, alert);
        break;

      case 'email':
        result = await executeEmailNotification(recipients, alert, resolvedMessage);
        break;

      case 'teams':
        // Placeholder for Microsoft Teams
        result = { message: 'Microsoft Teams integration not yet implemented' };
        break;

      case 'pagerduty':
        // Placeholder for PagerDuty
        result = { message: 'PagerDuty integration not yet implemented' };
        break;

      case 'webhook':
        result = await executeWebhookNotification(recipients, { alert, message: resolvedMessage });
        break;

      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }

    logger.info(`✅ Notification sent: ${step.name}`);
    return {
      success: true,
      output: result
    };

  } catch (error) {
    logger.error(`❌ Notification failed: ${step.name}`, error);
    throw error;
  }
}

/**
 * Send Slack notification
 */
async function executeSlackNotification(recipients, message, alert) {
  const channels = Array.isArray(recipients) ? recipients : [recipients];

  const results = [];
  for (const channel of channels) {
    const result = await slack.sendMessage(channel, message, alert);
    results.push(result);
  }

  return {
    sent: true,
    channels: results
  };
}

/**
 * Send email notification
 */
async function executeEmailNotification(recipients, alert, additionalMessage) {
  const subject = `🚨 CyberSentinel Alert: ${alert.rule_name}`;
  const to = Array.isArray(recipients) ? recipients : recipients.split(',');

  return await email.sendEmail(to, subject, additionalMessage, alert);
}

/**
 * Send webhook notification
 */
async function executeWebhookNotification(webhookUrl, payload) {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.post(webhookUrl, payload);

    return {
      sent: true,
      statusCode: response.status,
      response: response.data
    };
  } catch (error) {
    throw new Error(`Webhook notification failed: ${error.message}`);
  }
}

export default {
  executeNotification
};
