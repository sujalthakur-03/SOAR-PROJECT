/**
 * Authentication Service
 * Handles user authentication and session management
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_random_secret_key_in_production';
const JWT_EXPIRY = '24h';

// In-memory user store (replace with database in production)
const users = [
  {
    id: 'admin-001',
    username: 'admin',
    // Password: admin (bcrypt hash)
    passwordHash: '$2b$10$SiO0XoiK9iQKvnohtjvBeeNbQ2A/1AyineX21H4mboftLR9guLLU.',
    email: 'admin@cybersentinel.local',
    fullName: 'System Administrator',
    role: 'admin',
    created_at: new Date().toISOString(),
  },
  {
    id: 'analyst-001',
    username: 'analyst',
    // Password: analyst123 (bcrypt hash)
    passwordHash: '$2b$10$PMkE9/Akf5vXaF0tKWPN8O/w.O.t1oyesVL3RwCMq9WkP0R39eSVC',
    email: 'analyst@cybersentinel.local',
    fullName: 'Security Analyst',
    role: 'analyst',
    created_at: new Date().toISOString(),
  },
];

/**
 * Authenticate user with username and password
 */
export async function authenticateUser(username, password) {
  try {
    // Find user by username
    const user = users.find(u => u.username === username);

    if (!user) {
      logger.warn(`Login attempt for non-existent user: ${username}`);
      return { success: false, error: 'Invalid username or password' };
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      logger.warn(`Failed login attempt for user: ${username}`);
      return { success: false, error: 'Invalid username or password' };
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Return user data (without password hash)
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    logger.info(`User logged in successfully: ${username}`);

    return {
      success: true,
      token,
      user: userData,
    };
  } catch (error) {
    logger.error('Authentication error:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, user: decoded };
  } catch (error) {
    logger.warn('Invalid token verification attempt');
    return { valid: false, error: 'Invalid or expired token' };
  }
}

/**
 * Get user by ID
 */
export function getUserById(userId) {
  const user = users.find(u => u.id === userId);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

/**
 * Create a new user (admin only)
 */
export async function createUser(userData) {
  try {
    // Check if username already exists
    if (users.find(u => u.username === userData.username)) {
      return { success: false, error: 'Username already exists' };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10);

    const newUser = {
      id: `user-${Date.now()}`,
      username: userData.username,
      passwordHash,
      email: userData.email || `${userData.username}@cybersentinel.local`,
      fullName: userData.fullName || userData.username,
      role: userData.role || 'analyst',
      created_at: new Date().toISOString(),
    };

    users.push(newUser);

    logger.info(`New user created: ${newUser.username}`);

    return {
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
      },
    };
  } catch (error) {
    logger.error('Error creating user:', error);
    return { success: false, error: 'Failed to create user' };
  }
}
