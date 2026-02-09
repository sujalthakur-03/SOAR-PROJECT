/**
 * Email (SMTP) Integration
 */

import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

let transporter = null;

/**
 * Initialize email transporter
 */
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(smtpConfig);
  }
  return transporter;
}

/**
 * Send email
 */
export async function sendEmail(to, subject, body, alertData = null) {
  try {
    const transport = getTransporter();

    const htmlBody = alertData ? formatAlertEmail(alertData, body) : `<p>${body}</p>`;

    const mailOptions = {
      from: smtpConfig.auth.user,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      html: htmlBody
    };

    const info = await transport.sendMail(mailOptions);

    logger.info(`✅ Email sent to ${to}: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
      recipients: to
    };
  } catch (error) {
    logger.error('Email sendEmail failed:', error.message);
    throw error;
  }
}

/**
 * Format alert data as HTML email
 */
function formatAlertEmail(alert, additionalInfo = '') {
  const severityColors = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
    info: '#3b82f6'
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a1a; color: #fff; padding: 20px; border-radius: 5px 5px 0 0; }
        .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 5px 5px; }
        .severity-badge {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 3px;
          color: #fff;
          font-weight: bold;
          background: ${severityColors[alert.severity] || '#666'};
        }
        .field { margin: 10px 0; }
        .field-label { font-weight: bold; color: #333; }
        .field-value { color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 CyberSentinel Alert</h1>
          <h2>${alert.rule_name}</h2>
        </div>
        <div class="content">
          <div class="field">
            <span class="field-label">Severity:</span>
            <span class="severity-badge">${alert.severity.toUpperCase()}</span>
          </div>
          <div class="field">
            <span class="field-label">Agent:</span>
            <span class="field-value">${alert.agent_name} (${alert.agent_id})</span>
          </div>
          <div class="field">
            <span class="field-label">Source IP:</span>
            <span class="field-value">${alert.source_ip || 'N/A'}</span>
          </div>
          <div class="field">
            <span class="field-label">Destination IP:</span>
            <span class="field-value">${alert.destination_ip || 'N/A'}</span>
          </div>
          <div class="field">
            <span class="field-label">Time:</span>
            <span class="field-value">${new Date(alert.timestamp).toLocaleString()}</span>
          </div>
          <div class="field">
            <span class="field-label">Description:</span>
            <p class="field-value">${alert.description}</p>
          </div>
          ${additionalInfo ? `<hr><p>${additionalInfo}</p>` : ''}
        </div>
      </div>
    </body>
    </html>
  `;
}

export default {
  sendEmail
};
