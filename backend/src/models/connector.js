/**
 * Connector Model
 * Stores integration connector configurations
 */

import mongoose from 'mongoose';

const connectorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'email',
      'slack',
      'jira',
      'servicenow',
      'pagerduty',
      'splunk',
      'elastic',
      'crowdstrike',
      'cortex',
      'cybersentinel',
      'cybersentinel_blocklist',
      'virustotal',
      'abuseipdb',
      'alienvault_otx',
      'custom'
    ],
    index: true
  },
  description: String,

  status: {
    type: String,
    enum: ['active', 'inactive', 'error', 'testing'],
    default: 'inactive',
    index: true
  },

  // Encrypted configuration
  config: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },

  // Connection health
  last_health_check: Date,
  health_status: {
    type: String,
    enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
    default: 'unknown'
  },
  health_message: String,

  // Usage statistics
  total_executions: {
    type: Number,
    default: 0
  },
  successful_executions: {
    type: Number,
    default: 0
  },
  failed_executions: {
    type: Number,
    default: 0
  },
  last_executed_at: Date,

  // Rate limiting
  rate_limit: {
    max_requests: Number,
    time_window_ms: Number
  },

  // Metadata
  created_by: {
    type: String,
    required: true
  },
  updated_by: String,

  // Tags for categorization
  tags: [{
    type: String,
    index: true
  }]
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Indexes
connectorSchema.index({ status: 1, type: 1 });
connectorSchema.index({ tags: 1, status: 1 });

// Method to update health status
connectorSchema.methods.updateHealth = function(status, message = '') {
  this.last_health_check = new Date();
  this.health_status = status;
  this.health_message = message;
  return this.save();
};

// Method to record execution
connectorSchema.methods.recordExecution = function(success = true) {
  this.total_executions += 1;
  if (success) {
    this.successful_executions += 1;
  } else {
    this.failed_executions += 1;
  }
  this.last_executed_at = new Date();
  return this.save();
};

const Connector = mongoose.model('Connector', connectorSchema);

export default Connector;
