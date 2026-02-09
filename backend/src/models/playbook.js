/**
 * Playbook Model
 * Stores playbook definitions with embedded webhook configuration
 * Uses playbook_id as the logical unique identifier (NOT MongoDB _id)
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Generate a unique playbook ID
 */
function generatePlaybookId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PB-${timestamp}-${random}`;
}

const webhookSchema = new mongoose.Schema({
  secret: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  enabled: {
    type: Boolean,
    default: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  last_rotated: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const stepSchema = new mongoose.Schema({
  step_id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['action', 'condition', 'approval', 'notification', 'enrichment', 'transform']
  },
  connector_id: String,
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timeout: {
    type: Number,
    default: 300 // 5 minutes
  },
  retry_config: {
    enabled: {
      type: Boolean,
      default: false
    },
    max_attempts: {
      type: Number,
      default: 3
    },
    delay: {
      type: Number,
      default: 5000 // 5 seconds
    }
  }
}, { _id: false });

const playbookSchema = new mongoose.Schema({
  // Logical unique identifier (e.g., "PB-ABC123-DEF456")
  // This is used in webhook URLs, NOT MongoDB _id
  playbook_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generatePlaybookId
  },
  name: {
    type: String,
    required: true,
    index: true
  },
  description: {
    type: String,
    default: ''
  },
  tags: [{
    type: String,
    index: true
  }],
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'archived'],
    default: 'draft',
    index: true
  },
  trigger_type: {
    type: String,
    enum: ['webhook', 'manual', 'scheduled'],
    default: 'webhook',
    required: true
  },
  steps: [stepSchema],

  // Webhook configuration (embedded subdocument)
  webhook: {
    type: webhookSchema,
    default: () => ({})
  },

  // Matching rules for webhook validation
  matching_rules: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Expected payload schema for validation
  expected_schema: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  created_by: {
    type: String,
    required: true
  },
  updated_by: String,
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Indexes for performance
playbookSchema.index({ status: 1, created_at: -1 });
playbookSchema.index({ 'webhook.enabled': 1 });
playbookSchema.index({ tags: 1, status: 1 });

// Pre-save middleware to ensure webhook secret and playbook_id exist
playbookSchema.pre('save', function(next) {
  // Ensure playbook_id exists
  if (!this.playbook_id) {
    this.playbook_id = generatePlaybookId();
  }

  // Ensure webhook secret exists
  if (!this.webhook || !this.webhook.secret) {
    this.webhook = {
      secret: crypto.randomBytes(32).toString('hex'),
      enabled: true,
      created_at: new Date(),
      last_rotated: new Date()
    };
  }
  next();
});

// Method to rotate webhook secret
playbookSchema.methods.rotateWebhookSecret = function() {
  this.webhook.secret = crypto.randomBytes(32).toString('hex');
  this.webhook.last_rotated = new Date();
  return this.save();
};

// Method to toggle webhook
playbookSchema.methods.toggleWebhook = function(enabled) {
  this.webhook.enabled = enabled;
  return this.save();
};

// Method to get webhook URL (uses playbook_id, NOT _id)
playbookSchema.methods.getWebhookUrl = function(baseUrl) {
  return `${baseUrl}/api/webhooks/${this.playbook_id}/${this.webhook.secret}`;
};

const Playbook = mongoose.model('Playbook', playbookSchema);

export default Playbook;
