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
 * Deactivate user (admin only) - sets status to 'inactive', does NOT delete
 */
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent self-deactivation
    if (user._id.toString() === req.user.userId) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    user.status = 'inactive';
    await user.save();

    logger.info(`User ${user.email} deactivated by ${req.user.email}`);

    res.json({
      success: true,
      message: `User ${user.email} has been deactivated`,
      id: user._id.toString(),
      status: 'inactive',
    });
  } catch (error) {
    logger.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Failed to deactivate user', message: error.message });
  }
});

/**
 * POST /api/users/:id/reset-password
 * Admin resets a user's password
 * Body: { password: "newPassword123" }
 */
router.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  try {
    const password = req.body.password?.trim();
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
