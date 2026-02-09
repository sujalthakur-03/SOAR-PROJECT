/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK REST API ROUTES (VERSIONED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * REST API endpoints for versioned playbook management.
 *
 * ENDPOINTS:
 * - POST   /api/playbooks                    Create new playbook (version 1)
 * - GET    /api/playbooks                    List playbooks (active versions only by default)
 * - GET    /api/playbooks/:playbook_id       Get active version of playbook
 * - PUT    /api/playbooks/:playbook_id       Update playbook (creates new version)
 * - PATCH  /api/playbooks/:playbook_id/toggle Toggle enabled state
 * - GET    /api/playbooks/:playbook_id/versions Get all versions of playbook
 * - DELETE /api/playbooks/:playbook_id       NOT ALLOWED (audit safety)
 *
 * VERSIONING:
 * - Updates always create new versions
 * - Only one version per playbook_id can be enabled
 * - Old versions preserved as audit trail
 * - Query param ?version=N to get specific version
 * - Query param ?all_versions=true to list all versions
 *
 * ERROR FORMAT (consistent across all endpoints):
 * {
 *   "code": "ERROR_CODE",
 *   "message": "Human-readable error message",
 *   "details": { ... }
 * }
 *
 * VERSION: 2.0.0
 * ══════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import {
  getPlaybooks,
  getPlaybook,
  getPlaybookVersions,
  createPlaybook,
  updatePlaybook,
  togglePlaybook,
  deletePlaybook
} from '../services/playbook-service-v2.js';
import { ValidationError } from '../validators/playbook-validator.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLER MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

function handleError(error, req, res) {
  // Validation errors (from DSL validator)
  if (error instanceof ValidationError || error.name === 'ValidationError') {
    return res.status(400).json({
      code: error.code || 'VALIDATION_ERROR',
      message: error.message,
      details: error.details || error.errors || {}
    });
  }

  // Known application errors with codes
  if (error.code) {
    const statusCodes = {
      'DUPLICATE_PLAYBOOK_ID': 409,
      'PLAYBOOK_NOT_FOUND': 404,
      'DELETE_NOT_ALLOWED': 403,
      'INVALID_DSL': 400
    };

    const statusCode = statusCodes[error.code] || 500;

    return res.status(statusCode).json({
      code: error.code,
      message: error.message,
      details: error.details || {}
    });
  }

  // Generic errors
  logger.error('[PlaybookRoutes] Unhandled error:', error);
  return res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
    details: {
      error: error.message
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/playbooks - Create new playbook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new playbook (version 1)
 *
 * Request body:
 * {
 *   "playbook_id": "PB-SSH-001",  // Optional, auto-generated if not provided
 *   "name": "SSH Brute Force Response",
 *   "description": "Automated response to SSH brute force attacks",
 *   "dsl": { ... }  // Complete DSL object with steps
 * }
 *
 * Response: 201 Created
 * {
 *   "playbook_id": "PB-SSH-001",
 *   "version": 1,
 *   "enabled": true,
 *   "name": "SSH Brute Force Response",
 *   "description": "...",
 *   "dsl": { ... },
 *   "created_by": "user@example.com",
 *   "created_at": "2026-01-20T...",
 *   ...
 * }
 *
 * Errors:
 * - 400: DSL validation failed
 * - 409: Playbook ID already exists
 */
router.post('/playbooks', async (req, res) => {
  try {
    const userId = req.user?.email || req.body.created_by || 'system';
    const playbook = await createPlaybook(req.body, userId);

    logger.info(`[PlaybookRoutes] Created playbook ${playbook.playbook_id} by ${userId}`);

    res.status(201).json(playbook);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/playbooks - List playbooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List playbooks
 *
 * Query params:
 * - all_versions (boolean): Include all versions (default: false)
 * - enabled (boolean): Filter by enabled status
 * - limit (number): Pagination limit (default: 100)
 * - offset (number): Pagination offset (default: 0)
 *
 * Response: 200 OK
 * {
 *   "playbooks": [ ... ],
 *   "total": 42,
 *   "limit": 100,
 *   "offset": 0
 * }
 */
router.get('/playbooks', async (req, res) => {
  try {
    const filters = {
      all_versions: req.query.all_versions === 'true',
      enabled: req.query.enabled,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0
    };

    const result = await getPlaybooks(filters);

    logger.debug(`[PlaybookRoutes] Listed ${result.playbooks.length} playbook(s)`);

    res.json(result);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/playbooks/:playbook_id - Get specific playbook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get specific playbook
 *
 * Path params:
 * - playbook_id: Playbook ID (e.g., "PB-SSH-001")
 *
 * Query params:
 * - version (number): Specific version number (default: active version)
 *
 * Response: 200 OK
 * {
 *   "playbook_id": "PB-SSH-001",
 *   "version": 3,
 *   "enabled": true,
 *   "name": "SSH Brute Force Response",
 *   "dsl": { ... },
 *   ...
 * }
 *
 * Errors:
 * - 404: Playbook not found
 */
router.get('/playbooks/:playbook_id', async (req, res) => {
  try {
    const { playbook_id } = req.params;
    const version = req.query.version ? parseInt(req.query.version) : null;

    const playbook = await getPlaybook(playbook_id, version);

    if (!playbook) {
      return res.status(404).json({
        code: 'PLAYBOOK_NOT_FOUND',
        message: `Playbook ${playbook_id} ${version ? `version ${version}` : 'active version'} not found`,
        details: { playbook_id, version }
      });
    }

    logger.debug(`[PlaybookRoutes] Retrieved playbook ${playbook_id} ${version ? `version ${version}` : ''}`);

    res.json(playbook);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/playbooks/:playbook_id/versions - Get all versions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all versions of a playbook
 *
 * Path params:
 * - playbook_id: Playbook ID
 *
 * Response: 200 OK
 * [
 *   {
 *     "playbook_id": "PB-SSH-001",
 *     "version": 3,
 *     "enabled": true,
 *     "name": "...",
 *     "created_at": "...",
 *     "change_summary": "Updated enrichment step",
 *     ...
 *   },
 *   {
 *     "playbook_id": "PB-SSH-001",
 *     "version": 2,
 *     "enabled": false,
 *     ...
 *   },
 *   ...
 * ]
 */
router.get('/playbooks/:playbook_id/versions', async (req, res) => {
  try {
    const { playbook_id } = req.params;
    const versions = await getPlaybookVersions(playbook_id);

    logger.debug(`[PlaybookRoutes] Retrieved ${versions.length} version(s) for playbook ${playbook_id}`);

    res.json(versions);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/playbooks/:playbook_id - Update playbook (creates new version)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update playbook (creates new version)
 *
 * Path params:
 * - playbook_id: Playbook ID
 *
 * Request body (all fields optional):
 * {
 *   "name": "Updated name",
 *   "description": "Updated description",
 *   "dsl": { ... },  // New DSL object
 *   "change_summary": "Added notification step"
 * }
 *
 * Response: 200 OK
 * {
 *   "playbook_id": "PB-SSH-001",
 *   "version": 4,  // New version number
 *   "enabled": true,
 *   "name": "Updated name",
 *   "dsl": { ... },
 *   "change_summary": "Added notification step",
 *   ...
 * }
 *
 * Errors:
 * - 400: DSL validation failed
 * - 404: Playbook not found
 */
router.put('/playbooks/:playbook_id', async (req, res) => {
  try {
    const { playbook_id } = req.params;
    const userId = req.user?.email || req.body.updated_by || 'system';

    const updatedPlaybook = await updatePlaybook(playbook_id, req.body, userId);

    logger.info(`[PlaybookRoutes] Updated playbook ${playbook_id} to version ${updatedPlaybook.version} by ${userId}`);

    res.json(updatedPlaybook);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/playbooks/:playbook_id/toggle - Toggle enabled state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Toggle playbook enabled state
 *
 * Path params:
 * - playbook_id: Playbook ID
 *
 * Request body:
 * {
 *   "enabled": true  // or false
 * }
 *
 * Query params:
 * - version (number): Specific version to toggle (default: active version)
 *
 * Response: 200 OK
 * {
 *   "playbook_id": "PB-SSH-001",
 *   "version": 3,
 *   "enabled": false,
 *   ...
 * }
 *
 * Errors:
 * - 400: Missing or invalid enabled field
 * - 404: Playbook not found
 */
router.patch('/playbooks/:playbook_id/toggle', async (req, res) => {
  try {
    const { playbook_id } = req.params;
    const { enabled } = req.body;
    const version = req.query.version ? parseInt(req.query.version) : null;

    if (enabled === undefined) {
      return res.status(400).json({
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Field "enabled" is required in request body',
        details: { field: 'enabled' }
      });
    }

    const playbook = await togglePlaybook(playbook_id, enabled, version);

    logger.info(`[PlaybookRoutes] Toggled playbook ${playbook_id} version ${playbook.version} to enabled=${enabled}`);

    res.json(playbook);
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/playbooks/:playbook_id - Permanently delete playbook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete playbook and all its versions
 *
 * Path params:
 * - playbook_id: Playbook ID (e.g., "PB-SSH-001")
 *
 * Response: 200 OK
 * {
 *   "playbook_id": "PB-SSH-001",
 *   "deletedCount": 3,
 *   "message": "Playbook deleted successfully"
 * }
 *
 * Errors:
 * - 404: Playbook not found
 */
router.delete('/playbooks/:playbook_id', async (req, res) => {
  try {
    const { playbook_id } = req.params;
    const result = await deletePlaybook(playbook_id);

    logger.info(`[PlaybookRoutes] Deleted playbook ${playbook_id}`);

    res.json({
      ...result,
      message: 'Playbook deleted successfully'
    });
  } catch (error) {
    handleError(error, req, res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default router;
