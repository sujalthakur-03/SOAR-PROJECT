/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK MODEL (VERSIONED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * VERSIONING ARCHITECTURE:
 * - playbook_id is IMMUTABLE (logical identifier like "PB-SSH-001")
 * - Each update creates a NEW VERSION (never mutates existing documents)
 * - Only ONE version per playbook_id can be enabled=true at any time
 * - Old versions remain in database as read-only audit trail
 * - NO delete endpoint - audit safety requirement
 *
 * SCHEMA FIELDS:
 * - playbook_id: Immutable logical identifier (user-defined or auto-generated)
 * - name: Human-readable playbook name
 * - description: Detailed playbook description
 * - version: Auto-incrementing integer per playbook_id
 * - enabled: Boolean flag for active/inactive state
 * - dsl: Complete validated playbook JSON object
 * - created_at: Timestamp of version creation
 * - updated_at: Timestamp of last modification
 *
 * CRITICAL RULES:
 * 1. playbook_id CANNOT be changed after creation
 * 2. Updates ALWAYS create new versions
 * 3. Only one enabled version per playbook_id
 * 4. DSL must be valid before saving
 * 5. No deletes - disable instead
 *
 * VERSION: 2.0.0 (VERSIONED)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Generate a unique playbook ID
 * Format: PB-{TYPE}-{RANDOM} (e.g., "PB-SSH-001", "PB-MALWARE-A3F")
 */
function generatePlaybookId() {
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PB-AUTO-${random}`;
}

/**
 * Playbook Schema (Versioned)
 *
 * Each document represents ONE VERSION of a playbook.
 * Multiple documents can share the same playbook_id with different version numbers.
 */
const playbookVersionedSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════════════════════
  // IMMUTABLE LOGICAL IDENTIFIER
  // ═══════════════════════════════════════════════════════════════════════════
  // This is the logical playbook identifier (e.g., "PB-SSH-001")
  // MUST be immutable across all versions
  // Used in webhook URLs, execution references, UI display
  playbook_id: {
    type: String,
    required: true,
    index: true,
    immutable: true, // Mongoose will prevent modification
    validate: {
      validator: function(v) {
        // Must start with PB- and contain only alphanumeric, dash, underscore
        return /^PB-[A-Z0-9_-]+$/i.test(v);
      },
      message: props => `${props.value} is not a valid playbook_id. Must match pattern: PB-XXX`
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION NUMBER
  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-incrementing version number per playbook_id
  // Version 1 = first creation
  // Each update increments this
  version: {
    type: Number,
    required: true,
    min: 1,
    index: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENABLED FLAG
  // ═══════════════════════════════════════════════════════════════════════════
  // Only ONE version per playbook_id can have enabled=true
  // When creating new version, previous enabled version is automatically disabled
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAYBOOK METADATA
  // ═══════════════════════════════════════════════════════════════════════════
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  description: {
    type: String,
    default: '',
    trim: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DSL OBJECT
  // ═══════════════════════════════════════════════════════════════════════════
  // Complete playbook definition object (validated before save)
  // This contains ALL playbook logic including:
  // - steps: Array of step definitions
  // - shadow_mode: Boolean flag
  // - trigger_type: webhook, manual, scheduled
  // - tags: Array of tags
  // - severity: Playbook severity level
  dsl: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT FIELDS
  // ═══════════════════════════════════════════════════════════════════════════
  created_by: {
    type: String,
    required: true,
    default: 'system'
  },

  updated_by: {
    type: String,
    default: null
  },

  // Change summary for this version
  change_summary: {
    type: String,
    default: ''
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPOUND INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Unique constraint: playbook_id + version must be unique
playbookVersionedSchema.index(
  { playbook_id: 1, version: 1 },
  { unique: true, name: 'idx_playbook_version_unique' }
);

// Query active versions (enabled=true) sorted by created_at
playbookVersionedSchema.index(
  { enabled: 1, created_at: -1 },
  { name: 'idx_enabled_created' }
);

// Query all versions for a specific playbook_id sorted by version DESC
playbookVersionedSchema.index(
  { playbook_id: 1, version: -1 },
  { name: 'idx_playbook_versions' }
);

// Query active version for specific playbook_id
playbookVersionedSchema.index(
  { playbook_id: 1, enabled: 1 },
  { name: 'idx_playbook_enabled' }
);

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

playbookVersionedSchema.pre('save', async function(next) {
  // Generate playbook_id if not provided (only on first version)
  if (this.isNew && !this.playbook_id) {
    this.playbook_id = generatePlaybookId();
  }

  // Ensure DSL has required structure
  if (!this.dsl || typeof this.dsl !== 'object') {
    const error = new Error('DSL must be a valid object');
    error.code = 'INVALID_DSL';
    return next(error);
  }

  // Ensure DSL has steps array
  if (!Array.isArray(this.dsl.steps) || this.dsl.steps.length === 0) {
    const error = new Error('DSL must contain at least one step');
    error.code = 'DSL_NO_STEPS';
    return next(error);
  }

  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the latest version number for a playbook_id
 */
playbookVersionedSchema.statics.getLatestVersionNumber = async function(playbookId) {
  const latest = await this.findOne({ playbook_id: playbookId })
    .sort({ version: -1 })
    .select('version')
    .lean();

  return latest ? latest.version : 0;
};

/**
 * Get the active (enabled) version for a playbook_id
 */
playbookVersionedSchema.statics.getActiveVersion = async function(playbookId) {
  return await this.findOne({ playbook_id: playbookId, enabled: true }).lean();
};

/**
 * Get all versions for a playbook_id
 */
playbookVersionedSchema.statics.getAllVersions = async function(playbookId) {
  return await this.find({ playbook_id: playbookId })
    .sort({ version: -1 })
    .lean();
};

/**
 * Get specific version of a playbook
 */
playbookVersionedSchema.statics.getSpecificVersion = async function(playbookId, version) {
  return await this.findOne({ playbook_id: playbookId, version }).lean();
};

/**
 * Disable all versions of a playbook_id
 * Used before creating a new enabled version
 */
playbookVersionedSchema.statics.disableAllVersions = async function(playbookId) {
  const result = await this.updateMany(
    { playbook_id: playbookId, enabled: true },
    { $set: { enabled: false } }
  );

  if (result.modifiedCount > 0) {
    logger.info(`Disabled ${result.modifiedCount} version(s) for playbook ${playbookId}`);
  }

  return result;
};

/**
 * Create a new version of a playbook
 * Automatically disables previous versions if this one is enabled
 */
playbookVersionedSchema.statics.createNewVersion = async function(playbookId, data, userId) {
  // Get latest version number
  const latestVersion = await this.getLatestVersionNumber(playbookId);
  const newVersion = latestVersion + 1;

  // If this new version should be enabled, disable all previous versions
  if (data.enabled !== false) {
    await this.disableAllVersions(playbookId);
  }

  // Create new version document
  const newPlaybookVersion = new this({
    playbook_id: playbookId,
    version: newVersion,
    name: data.name,
    description: data.description || '',
    dsl: data.dsl,
    enabled: data.enabled !== false, // Default to true
    created_by: userId,
    change_summary: data.change_summary || `Version ${newVersion} created`
  });

  await newPlaybookVersion.save();

  logger.info(`Created new version ${newVersion} for playbook ${playbookId} (enabled: ${newPlaybookVersion.enabled})`);

  return newPlaybookVersion;
};

/**
 * Toggle enabled state for a specific version
 * Ensures only one version is enabled at a time
 */
playbookVersionedSchema.statics.toggleVersion = async function(playbookId, version, enabled) {
  if (enabled) {
    // If enabling this version, disable all others first
    await this.disableAllVersions(playbookId);
  }

  const result = await this.findOneAndUpdate(
    { playbook_id: playbookId, version },
    { $set: { enabled } },
    { new: true }
  );

  if (!result) {
    throw new Error(`Playbook ${playbookId} version ${version} not found`);
  }

  logger.info(`${enabled ? 'Enabled' : 'Disabled'} playbook ${playbookId} version ${version}`);

  return result;
};

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get formatted version info for this playbook version
 */
playbookVersionedSchema.methods.getVersionInfo = function() {
  return {
    playbook_id: this.playbook_id,
    version: this.version,
    name: this.name,
    enabled: this.enabled,
    created_at: this.created_at,
    created_by: this.created_by,
    change_summary: this.change_summary
  };
};

/**
 * Clone this version as a new version (for updates)
 */
playbookVersionedSchema.methods.cloneAsNewVersion = async function(updates, userId) {
  const Model = this.constructor;

  // Disable all versions if this clone should be enabled
  if (updates.enabled !== false) {
    await Model.disableAllVersions(this.playbook_id);
  }

  const newVersionNumber = (await Model.getLatestVersionNumber(this.playbook_id)) + 1;

  const newVersion = new Model({
    playbook_id: this.playbook_id,
    version: newVersionNumber,
    name: updates.name !== undefined ? updates.name : this.name,
    description: updates.description !== undefined ? updates.description : this.description,
    dsl: updates.dsl !== undefined ? updates.dsl : this.dsl,
    enabled: updates.enabled !== false,
    created_by: userId,
    change_summary: updates.change_summary || `Updated from version ${this.version}`
  });

  await newVersion.save();

  logger.info(`Cloned playbook ${this.playbook_id} version ${this.version} to version ${newVersionNumber}`);

  return newVersion;
};

const PlaybookVersioned = mongoose.model('PlaybookVersioned', playbookVersionedSchema);

export default PlaybookVersioned;
