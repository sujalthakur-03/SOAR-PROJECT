/**
 * Authentication Routes
 */

import express from 'express';
import { authenticateUser, verifyToken, getUserById, createUser } from '../services/auth-service.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateUser(username, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/verify
 * Verify JWT token and return user data
 */
router.post('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const result = verifyToken(token);

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    res.json({
      valid: true,
      user: result.user,
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * GET /auth/me
 * Get current user data from token
 */
router.get('/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const result = verifyToken(token);

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    const user = getUserById(result.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

/**
 * POST /auth/logout
 * Logout user (client-side token removal)
 */
router.post('/logout', (req, res) => {
  // In JWT-based auth, logout is handled client-side by removing the token
  // This endpoint is here for consistency and future session management
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * POST /auth/register
 * Create a new user (admin only)
 */
router.post('/register', async (req, res) => {
  try {
    // Verify admin token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const result = verifyToken(token);

      if (!result.valid || result.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
    } else {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userData = req.body;
    const result = await createUser(userData);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    logger.error('User registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
