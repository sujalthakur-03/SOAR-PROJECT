/**
 * Audit Log Model
 * Stores all system activity for compliance and security auditing
 */

import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },

  // Actor information
  actor_email: {
    type: String,
    required: true,
    index: true
  },
  actor_role: {
    type: String,
    required: true,
    index: true
  },
  actor_ip: String,

  // Action details
  action: {
    type: String,
    required: true,
    index: true,
    enum: [
      'create',
      'read',
      'update',
      'delete',
      'execute',
      'approve',
      'reject',
      'login',
      'logout',
      'config_change',
      'webhook_triggered',
      'secret_rotated'
    ]
  },

  // Resource information
  resource_type: {
    type: String,
    required: true,
    index: true,
    enum: [
      'playbook',
      'execution',
      'approval',
      'connector',
      'user',
      'webhook',
      'system'
    ]
  },
  resource_id: String,
  resource_name: String,

  // Additional context
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Outcome
  outcome: {
    type: String,
    enum: ['success', 'failure', 'partial'],
    default: 'success',
    index: true
  },
  error_message: String,

  // Session tracking
  session_id: String,
  request_id: String
}, {
  timestamps: false // We use timestamp field directly
});

// TTL index - automatically delete logs older than 90 days
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// Compound indexes for common queries
auditLogSchema.index({ actor_email: 1, timestamp: -1 });
auditLogSchema.index({ resource_type: 1, resource_id: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, outcome: 1, timestamp: -1 });

// Static method to create audit log
auditLogSchema.statics.log = async function(logData) {
  try {
    const log = new this({
      timestamp: new Date(),
      actor_email: logData.actor_email || 'SYSTEM',
      actor_role: logData.actor_role || 'automation',
      actor_ip: logData.actor_ip || '127.0.0.1',
      action: logData.action,
      resource_type: logData.resource_type,
      resource_id: logData.resource_id,
      resource_name: logData.resource_name,
      details: logData.details || {},
      outcome: logData.outcome || 'success',
      error_message: logData.error_message,
      session_id: logData.session_id,
      request_id: logData.request_id
    });
    await log.save();
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break main flow
  }
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
