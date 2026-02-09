/**
 * Email (SMTP) Connector — Connector Contract Implementation
 *
 * Sends email notifications via SMTP using nodemailer.
 *
 * Registered as connector type "email" in the connector registry.
 * The execution engine calls execute() via invokeConnector().
 *
 * ACTIONS:
 *   - send_email : Send an email notification
 */

import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

let cachedTransporter = null;

/**
 * Get or create SMTP transporter from connector config.
 */
function getTransporter(config) {
  const host = config.smtp_host || config.host || process.env.SMTP_HOST;
  const port = parseInt(config.smtp_port || config.port || process.env.SMTP_PORT || '587');
  const secure = config.smtp_secure === true || config.smtp_secure === 'true' ||
                 process.env.SMTP_SECURE === 'true';
  const user = config.smtp_user || config.user || process.env.SMTP_USER;
  const pass = config.smtp_pass || config.pass || process.env.SMTP_PASS;

  if (!host || !user) {
    throw Object.assign(
      new Error('SMTP not configured. Set smtp_host and smtp_user in connector config or environment.'),
      { code: 'SERVICE_UNAVAILABLE', retryable: false }
    );
  }

  // Re-use transporter if config unchanged
  if (cachedTransporter && cachedTransporter._host === host && cachedTransporter._user === user) {
    return cachedTransporter;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  transporter._host = host;
  transporter._user = user;
  cachedTransporter = transporter;
  return transporter;
}

/**
 * Send an email.
 */
async function sendEmail(inputs, config) {
  const transporter = getTransporter(config);

  const to = Array.isArray(inputs.to) ? inputs.to.join(',') : inputs.to;
  const from = inputs.from || config.smtp_user || config.user || process.env.SMTP_USER;
  const subject = inputs.subject || 'CyberSentinel SOAR Notification';
  const body = inputs.message || inputs.body || '';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: #fff; padding: 16px 20px; border-radius: 5px 5px 0 0; }
        .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 5px 5px; border: 1px solid #e9ecef; }
        .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
        pre { background: #eee; padding: 10px; border-radius: 4px; overflow-x: auto; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>CyberSentinel SOAR Alert</h2>
        </div>
        <div class="content">
          ${body.replace(/\n/g, '<br>')}
        </div>
        <div class="footer">
          Sent by CyberSentinel SOAR v3.0
        </div>
      </div>
    </body>
    </html>
  `;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html: htmlBody
  });

  logger.info(`[EmailConnector] Email sent to ${to}: ${info.messageId}`);

  return {
    success: true,
    message_id: info.messageId,
    recipients: to,
    subject
  };
}

/**
 * Connector implementation following the standard contract.
 */
export const emailConnector = {
  inputSchema: {
    send_email: {
      required_fields: ['to', 'subject', 'message'],
      optional_fields: ['from'],
      field_types: {
        to: 'string',
        subject: 'string',
        message: 'string',
        from: 'string'
      }
    }
  },

  outputSchema: {
    send_email: {
      output_fields: {
        success: 'boolean',
        message_id: 'string',
        recipients: 'string',
        subject: 'string'
      }
    }
  },

  async execute(action, inputs, config) {
    switch (action) {
      case 'send_email': {
        if (!inputs.to) {
          throw Object.assign(
            new Error('No recipient (to) provided for email'),
            { code: 'INVALID_INPUT', retryable: false }
          );
        }
        return await sendEmail(inputs, config);
      }

      default:
        throw Object.assign(
          new Error(`Unknown email action: ${action}. Supported: send_email`),
          { code: 'INVALID_ACTION', retryable: false }
        );
    }
  }
};

export default emailConnector;
