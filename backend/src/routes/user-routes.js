/**
 * User Management API Routes
 * CRUD operations for user accounts (admin only)
 */

import express from 'express';
import User from '../models/user.js';
import { requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/users
 * List all users (admin only)
 * Never returns password_hash
 */
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const users = await User.find()
      .select('-password_hash -mfa_secret -password_reset_token -api_key')
      .sort({ created_at: -1 })
      .lean();

    const result = users.map(u => ({
      id: u._id.toString(),
      username: u.email.split('@')[0],
      email: u.email,
      fullName: u.full_name,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      last_login: u.last_login,
    }));

    res.json({ count: result.length, users: result });
  } catch (error) {
    logger.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users', message: error.message });
  }
});

/**
 * GET /api/users/check?username=<username>
 * Check if a user exists and is usable for SSO (admin only)
 *
 * Used by the SIEM to keep its local "soarRegistered" flag in sync
 * with the actual SOAR user database.
 *
 * Accepts either a bare username ("csadmin") or a full email
 * ("csadmin@cybersentinel.local"). Bare usernames are mapped to
 * "<username>@cybersentinel.local" the same way authenticateUser does.
 *
 * Response:
 *   200 { exists: true, status, role, usable_for_sso }
 *   200 { exists: false }
 *   400 if username param is missing
 *
 * Note: Always returns 200 (no 404) so the SIEM can rely on a single
 * predictable response shape without try/catch handling.
 */
router.get('/users/check', requireRole('admin'), async (req, res) => {
  try {
    const username = (req.query.username || '').toString().trim();
    if (!username) {
      return res.status(400).json({ error: 'username query parameter is required' });
    }

    const email = username.includes('@')
      ? username.toLowerCase()
      : `${username.toLowerCase()}@cybersentinel.local`;

    const user = await User.findOne({ email })
      .select('status role')
      .lean();

    if (!user) {
      logger.info(`[UserCheck] ${email} → not found (requested by ${req.user.email})`);
      return res.json({ exists: false });
    }

    const usable_for_sso = user.status === 'active';

    logger.info(`[UserCheck] ${email} → exists=true status=${user.status} usable=${usable_for_sso}`);

    res.json({
      exists: true,
      status: user.status,
      role: user.role,
      usable_for_sso,
    });
  } catch (error) {
    logger.error('Error checking user existence:', error);
    res.status(500).json({ error: 'Failed to check user', message: error.message });
  }
});

/**
 * GET /api/users/:id
 * Get a single user by ID (admin only)
 */
router.get('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password_hash -mfa_secret -password_reset_token -api_key')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user._id.toString(),
      username: user.email.split('@')[0],
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      status: user.status,
      created_at: user.created_at,
      last_login: user.last_login,
      mfa_enabled: user.mfa_enabled,
      failed_login_attempts: user.failed_login_attempts,
      preferences: user.preferences,
    });
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user', message: error.message });
  }
});

/**
 * PUT /api/users/:id
 * Update user fields (admin only)
 * Can change: role, fullName (full_name), email, status
 */
router.put('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const { role, fullName, full_name, email, status } = req.body;

    const VALID_ROLES = ['viewer', 'analyst', 'senior_analyst', 'engineer', 'admin', 'security_admin'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const VALID_STATUSES = ['active', 'inactive', 'locked', 'pending'];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role !== undefined) user.role = role;
    if (fullName !== undefined || full_name !== undefined) user.full_name = fullName || full_name;
    if (email !== undefined) user.email = email;
    if (status !== undefined) user.status = status;

    await user.save();

    logger.info(`User ${user.email} updated by ${req.user.email}`);

    res.json({
      id: user._id.toString(),
      username: user.email.split('@')[0],
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      status: user.status,
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user', message: error.message });
  }
});

/**
 * DELETE /api/users/:id
 * Permanently delete a user (admin only)
 */
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent self-deletion
    if (user._id.toString() === req.user.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const deletedEmail = user.email;
    await User.deleteOne({ _id: user._id });

    logger.info(`User ${deletedEmail} deleted by ${req.user.email}`);

    res.json({
      success: true,
      message: `User ${deletedEmail} has been deleted`,
      id: req.params.id,
    });
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user', message: error.message });
  }
});

/**
 * POST /api/users/:id/reset-password
 * Admin resets a user's password
 * Body: { password: "newPassword123" }
 */
router.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  try {
    const password = (req.body.password || req.body.newPassword)?.trim();
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters (excluding whitespace)' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Setting password_hash triggers the pre-save hook which hashes it
    user.password_hash = password;
    user.failed_login_attempts = 0;
    if (user.status === 'locked') {
      user.status = 'active';
      user.locked_until = null;
    }
    await user.save();

    logger.info(`Password reset for ${user.email} by ${req.user.email}`);

    res.json({
      success: true,
      message: `Password reset for ${user.email}`,
    });
  } catch (error) {
    logger.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password', message: error.message });
  }
});

export default router;
