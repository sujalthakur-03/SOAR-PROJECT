/**
 * Approval Model
 * Stores approval requests for playbook executions
 */

import mongoose from 'mongoose';

const approvalSchema = new mongoose.Schema({
  execution_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Execution',
    required: true,
    index: true
  },
  // Logical playbook ID (e.g., "PB-ABC123-DEF456"), NOT MongoDB ObjectId
  playbook_id: {
    type: String,
    required: true,
    index: true
  },
  step_id: {
    type: String,
    required: true
  },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'expired'],
    default: 'pending',
    index: true
  },

  // Context from the triggering alert
  trigger_context: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Approval request details
  required_role: {
    type: String,
    default: 'security_admin'
  },
  reason: String,

  // Approval decision
  approved_by: String,
  approved_at: Date,
  decision_note: String,

  // Expiration
  expires_at: {
    type: Date,
    index: true
  },

  // Notification tracking
  notified_users: [String],
  notification_sent_at: Date
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Compound indexes
approvalSchema.index({ status: 1, created_at: -1 });
approvalSchema.index({ execution_id: 1, step_id: 1 }, { unique: true });
approvalSchema.index({ expires_at: 1, status: 1 });

// Method to approve
approvalSchema.methods.approve = function(userId, note = '') {
  this.status = 'approved';
  this.approved_by = userId;
  this.approved_at = new Date();
  this.decision_note = note;
  return this.save();
};

// Method to reject
approvalSchema.methods.reject = function(userId, note = '') {
  this.status = 'rejected';
  this.approved_by = userId;
  this.approved_at = new Date();
  this.decision_note = note;
  return this.save();
};

// Method to check if expired
approvalSchema.methods.isExpired = function() {
  return this.expires_at && new Date() > this.expires_at;
};

const Approval = mongoose.model('Approval', approvalSchema);

export default Approval;
