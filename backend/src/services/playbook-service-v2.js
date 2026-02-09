/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK SERVICE (VERSIONED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Business logic for versioned playbook CRUD operations.
 *
 * KEY FEATURES:
 * - Automatic version management (updates create new versions)
 * - Only one enabled version per playbook_id at any time
 * - Complete DSL validation before save
 * - Audit trail (all versions preserved)
 * - NO delete operations (disable instead)
 *
 * VERSION: 2.0.0
 * ══════════════════════════════════════════════════════════════════════════════
 */

import PlaybookVersioned from '../models/playbook-v2.js';
import { validatePlaybookDSLOrThrow, validateShadowMode } from '../validators/playbook-validator.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// GET OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all playbooks (active versions only by default)
 *
 * @param {Object} filters - Query filters
 * @param {boolean} filters.all_versions - Include all versions (default: false)
 * @param {boolean} filters.enabled - Filter by enabled status
 * @param {number} filters.limit - Pagination limit (default: 100)
 * @param {number} filters.offset - Pagination offset (default: 0)
 * @returns {Object} - { playbooks: [], total: number, limit: number, offset: number }
 */
export async function getPlaybooks(filters = {}) {
  try {
    const {
      all_versions = false,
      enabled,
      limit = 100,
      offset = 0
    } = filters;

    const query = {};

    // By default, only return active (enabled) versions
    if (!all_versions && enabled === undefined) {
      query.enabled = true;
    } else if (enabled !== undefined) {
      query.enabled = enabled === 'true' || enabled === true;
    }

    // Get total count
    const total = await PlaybookVersioned.countDocuments(query);

    // Get playbooks
    let playbooks;
    if (all_versions) {
      // Return all versions, grouped by playbook_id
      playbooks = await PlaybookVersioned.find(query)
        .sort({ playbook_id: 1, version: -1 })
        .limit(limit)
        .skip(offset)
        .lean();
    } else {
      // Return only latest/active versions
      playbooks = await PlaybookVersioned.find(query)
        .sort({ created_at: -1 })
        .limit(limit)
        .skip(offset)
        .lean();
    }

    logger.debug(`[PlaybookService] Retrieved ${playbooks.length} playbook(s) (all_versions: ${all_versions})`);

    return {
      playbooks: playbooks.map(formatPlaybookResponse),
      total,
      limit,
      offset
    };
  } catch (error) {
    logger.error('[PlaybookService] Failed to get playbooks:', error);
    throw error;
  }
}

/**
 * Get a specific playbook by playbook_id
 * Returns active version by default, or specific version if requested
 *
 * @param {string} playbookId - Playbook ID (e.g., "PB-SSH-001")
 * @param {number} version - Optional version number
 * @returns {Object|null} - Playbook object or null if not found
 */
export async function getPlaybook(playbookId, version = null) {
  try {
    let playbook;

    if (version !== null) {
      // Get specific version
      playbook = await PlaybookVersioned.getSpecificVersion(playbookId, version);
      logger.debug(`[PlaybookService] Retrieved playbook ${playbookId} version ${version}`);
    } else {
      // Get active (enabled) version
      playbook = await PlaybookVersioned.getActiveVersion(playbookId);
      logger.debug(`[PlaybookService] Retrieved active version of playbook ${playbookId}`);
    }

    if (!playbook) {
      logger.warn(`[PlaybookService] Playbook ${playbookId} ${version ? `version ${version}` : 'active version'} not found`);
      return null;
    }

    return formatPlaybookResponse(playbook);
  } catch (error) {
    logger.error(`[PlaybookService] Failed to get playbook ${playbookId}:`, error);
    throw error;
  }
}

/**
 * Get all versions of a playbook
 *
 * @param {string} playbookId - Playbook ID
 * @returns {Array} - Array of all versions
 */
export async function getPlaybookVersions(playbookId) {
  try {
    const versions = await PlaybookVersioned.getAllVersions(playbookId);

    logger.debug(`[PlaybookService] Retrieved ${versions.length} version(s) for playbook ${playbookId}`);

    return versions.map(formatPlaybookResponse);
  } catch (error) {
    logger.error(`[PlaybookService] Failed to get versions for playbook ${playbookId}:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new playbook (version 1)
 *
 * @param {Object} data - Playbook data
 * @param {string} data.playbook_id - Optional custom playbook ID (auto-generated if not provided)
 * @param {string} data.name - Playbook name
 * @param {string} data.description - Playbook description
 * @param {Object} data.dsl - Playbook DSL object
 * @param {string} userId - User creating the playbook
 * @returns {Object} - Created playbook
 * @throws {ValidationError} - If DSL validation fails
 * @throws {Error} - If playbook_id already exists
 */
export async function createPlaybook(data, userId = 'system') {
  try {
    const { playbook_id, name, description, dsl } = data;

    // Validate required fields
    if (!name) {
      throw new Error('Playbook name is required');
    }

    if (!dsl) {
      throw new Error('Playbook DSL is required');
    }

    // Validate DSL (throws if invalid)
    validatePlaybookDSLOrThrow(dsl);

    // Check for shadow mode warnings
    const shadowModeWarnings = validateShadowMode(dsl);
    if (shadowModeWarnings.length > 0) {
      logger.warn(`[PlaybookService] Shadow mode warnings for new playbook:`, shadowModeWarnings);
    }

    // Check if playbook_id already exists
    if (playbook_id) {
      const existing = await PlaybookVersioned.findOne({ playbook_id });
      if (existing) {
        const error = new Error(`Playbook with ID '${playbook_id}' already exists`);
        error.code = 'DUPLICATE_PLAYBOOK_ID';
        throw error;
      }
    }

    // Create new playbook (version 1)
    const newPlaybook = new PlaybookVersioned({
      playbook_id: playbook_id || undefined, // Will be auto-generated if undefined
      version: 1,
      name,
      description: description || '',
      dsl,
      enabled: true, // First version is always enabled
      created_by: userId,
      change_summary: 'Initial version'
    });

    await newPlaybook.save();

    logger.info(`[PlaybookService] Created playbook ${newPlaybook.playbook_id} version 1 by ${userId}`);

    return formatPlaybookResponse(newPlaybook.toObject());
  } catch (error) {
    logger.error('[PlaybookService] Failed to create playbook:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update a playbook (creates new version)
 * Automatically disables previous active version if this one is enabled
 *
 * @param {string} playbookId - Playbook ID
 * @param {Object} updates - Update data
 * @param {string} updates.name - Optional new name
 * @param {string} updates.description - Optional new description
 * @param {Object} updates.dsl - Optional new DSL
 * @param {string} updates.change_summary - Optional change description
 * @param {string} userId - User making the update
 * @returns {Object} - New playbook version
 * @throws {ValidationError} - If DSL validation fails
 * @throws {Error} - If playbook not found
 */
export async function updatePlaybook(playbookId, updates, userId = 'system') {
  try {
    // Get current active version
    const currentVersion = await PlaybookVersioned.getActiveVersion(playbookId);

    if (!currentVersion) {
      const error = new Error(`Playbook ${playbookId} not found`);
      error.code = 'PLAYBOOK_NOT_FOUND';
      throw error;
    }

    // Validate DSL if provided
    if (updates.dsl) {
      validatePlaybookDSLOrThrow(updates.dsl);

      // Check for shadow mode warnings
      const shadowModeWarnings = validateShadowMode(updates.dsl);
      if (shadowModeWarnings.length > 0) {
        logger.warn(`[PlaybookService] Shadow mode warnings for updated playbook ${playbookId}:`, shadowModeWarnings);
      }
    }

    // Create new version using the model's static method
    const newVersion = await PlaybookVersioned.createNewVersion(playbookId, {
      name: updates.name || currentVersion.name,
      description: updates.description !== undefined ? updates.description : currentVersion.description,
      dsl: updates.dsl || currentVersion.dsl,
      enabled: true, // New version becomes active
      change_summary: updates.change_summary || `Updated from version ${currentVersion.version}`
    }, userId);

    logger.info(`[PlaybookService] Updated playbook ${playbookId} (created version ${newVersion.version}) by ${userId}`);

    return formatPlaybookResponse(newVersion.toObject());
  } catch (error) {
    logger.error(`[PlaybookService] Failed to update playbook ${playbookId}:`, error);
    throw error;
  }
}

/**
 * Toggle enabled state for a playbook
 * Toggles the currently active version or enables a specific version
 *
 * @param {string} playbookId - Playbook ID
 * @param {boolean} enabled - Enabled state
 * @param {number} version - Optional specific version to toggle
 * @returns {Object} - Updated playbook
 */
export async function togglePlaybook(playbookId, enabled, version = null) {
  try {
    let targetVersion;

    if (version !== null) {
      // Toggle specific version
      targetVersion = await PlaybookVersioned.toggleVersion(playbookId, version, enabled);
    } else {
      // Toggle current active version
      const activeVersion = await PlaybookVersioned.getActiveVersion(playbookId);

      if (!activeVersion) {
        const error = new Error(`No active version found for playbook ${playbookId}`);
        error.code = 'PLAYBOOK_NOT_FOUND';
        throw error;
      }

      targetVersion = await PlaybookVersioned.toggleVersion(playbookId, activeVersion.version, enabled);
    }

    logger.info(`[PlaybookService] Toggled playbook ${playbookId} version ${targetVersion.version} to enabled=${enabled}`);

    return formatPlaybookResponse(targetVersion.toObject());
  } catch (error) {
    logger.error(`[PlaybookService] Failed to toggle playbook ${playbookId}:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete ALL versions of a playbook by playbook_id.
 * This is a permanent, irreversible operation.
 *
 * @param {string} playbookId - Playbook ID (e.g., "PB-SSH-001")
 * @returns {Object} - { deletedCount }
 * @throws {Error} - If playbook not found
 */
export async function deletePlaybook(playbookId) {
  try {
    // Verify the playbook exists before deleting
    const exists = await PlaybookVersioned.findOne({ playbook_id: playbookId });
    if (!exists) {
      const error = new Error(`Playbook ${playbookId} not found`);
      error.code = 'PLAYBOOK_NOT_FOUND';
      throw error;
    }

    // Delete ALL versions of this playbook
    const result = await PlaybookVersioned.deleteMany({ playbook_id: playbookId });

    logger.info(`[PlaybookService] Deleted playbook ${playbookId} (${result.deletedCount} version(s) removed)`);

    return { deletedCount: result.deletedCount, playbook_id: playbookId };
  } catch (error) {
    logger.error(`[PlaybookService] Failed to delete playbook ${playbookId}:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format playbook for API response
 * Converts MongoDB document to clean API response format
 */
function formatPlaybookResponse(playbook) {
  return {
    playbook_id: playbook.playbook_id,
    version: playbook.version,
    enabled: playbook.enabled,
    name: playbook.name,
    description: playbook.description,
    dsl: playbook.dsl,
    created_by: playbook.created_by,
    updated_by: playbook.updated_by,
    change_summary: playbook.change_summary,
    created_at: playbook.created_at,
    updated_at: playbook.updated_at,
    // Include MongoDB _id for internal use if needed
    _id: playbook._id?.toString()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  getPlaybooks,
  getPlaybook,
  getPlaybookVersions,
  createPlaybook,
  updatePlaybook,
  togglePlaybook,
  deletePlaybook
};
