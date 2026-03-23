/**
 * JWT Authentication Middleware
 * Extracts and verifies Bearer token from Authorization header.
 * Sets req.user with decoded user data on success.
 *
 * Skips authentication for webhook ingestion routes that use
 * secret-in-URL auth (POST /api/webhooks/:webhook_id/:secret).
 */

import { verifyToken } from '../services/auth-service.js';
import logger from '../utils/logger.js';

/**
 * RBAC middleware factory.
 * Returns middleware that checks whether the authenticated user has one of
 * the required roles.  Must be used AFTER authMiddleware (req.user must exist).
 *
 * Usage:  router.post('/admin-only', requireRole('admin'), handler);
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', required_roles: roles });
    }
    next();
  };
}

// Paths that match webhook ingestion: /webhooks/<id>/<secret>
// These use URL-based secret auth instead of JWT.
const WEBHOOK_INGESTION_PATTERN = /^\/webhooks\/[^/]+\/[^/]+$/;

/**
 * Express middleware that enforces JWT authentication.
 * Returns 401 if no token is present or token is invalid/expired.
 *
 * Exempt routes (handled outside this middleware or via other auth):
 *   - POST /api/webhooks/:webhook_id/:secret (secret-in-URL auth)
 */
export default function authMiddleware(req, res, next) {
  // Skip JWT for webhook ingestion routes (they use secret-in-URL auth)
  if (req.method === 'POST' && WEBHOOK_INGESTION_PATTERN.test(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.substring(7);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Empty token.' });
  }

  const result = verifyToken(token);

  if (!result.valid) {
    return res.status(401).json({ error: result.error || 'Invalid or expired token' });
  }

  // Attach decoded user payload to request
  req.user = result.user;
  next();
}
