/**
 * Authentication Service
 * Handles user authentication and session management using MongoDB User model
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user.js';
import logger from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_to_a_random_secret_key_in_production';
const JWT_EXPIRY = '24h';

/**
 * Seed default users if they don't exist in MongoDB.
 * Called once at startup.
 */
export async function seedDefaultUsers() {
  const defaults = [
    {
      email: 'soaradmin@cybersentinel.local',
      password: 'CyberSentinelSOAR@2026',
      full_name: 'System Administrator',
      role: 'admin',
    },
    {
      email: 'analyst@cybersentinel.local',
      password: 'analyst123',
      full_name: 'Security Analyst',
      role: 'analyst',
    },
  ];

  for (const def of defaults) {
    try {
      const existing = await User.findOne({ email: def.email });
      if (!existing) {
        const user = new User({
          email: def.email,
          password_hash: def.password, // pre-save hook will bcrypt-hash this
          full_name: def.full_name,
          role: def.role,
          status: 'active',
        });
        await user.save();
        logger.info(`Seeded default user: ${def.email} (${def.role})`);
      }
    } catch (error) {
      logger.error(`Error seeding user ${def.email}:`, error);
    }
  }
}

/**
 * Authenticate user with email (or legacy username) and password
 */
export async function authenticateUser(username, password) {
  try {
    // Support login by email directly, or map legacy usernames
    let email = username;
    if (!username.includes('@')) {
      email = `${username}@cybersentinel.local`;
    }

    const user = await User.findOne({ email });

    if (!user) {
      logger.warn(`Login attempt for non-existent user: ${username}`);
      return { success: false, error: 'Invalid username or password' };
    }

    // Check if account is locked
    if (user.isLocked()) {
      logger.warn(`Login attempt for locked account: ${email}`);
      return { success: false, error: 'Account is locked. Please try again later.' };
    }

    // Check if account is active
    if (user.status === 'inactive') {
      logger.warn(`Login attempt for inactive account: ${email}`);
      return { success: false, error: 'Account is inactive. Contact an administrator.' };
    }

    // Verify password
    const isValid = await user.validatePassword(password);

    if (!isValid) {
      await user.recordFailedLogin();
      logger.warn(`Failed login attempt for user: ${email}`);
      return { success: false, error: 'Invalid username or password' };
    }

    // Update last login
    await user.updateLastLogin();

    // Generate JWT token
    const token = generateToken(user);

    // Return user data (without password hash)
    const userData = {
      id: user._id.toString(),
      username: user.email.split('@')[0],
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    };

    logger.info(`User logged in successfully: ${email}`);

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
 * Generate JWT token for a user document
 */
export function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      username: user.email.split('@')[0],
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
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
 * Get user by ID (MongoDB _id)
 */
export async function getUserById(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return null;
    }

    return {
      id: user._id.toString(),
      username: user.email.split('@')[0],
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    };
  } catch (error) {
    logger.error('Error fetching user by ID:', error);
    return null;
  }
}

/**
 * Create a new user (admin only)
 */
export async function createUser(userData) {
  try {
    // Check if email already exists
    const email = userData.email || `${userData.username}@cybersentinel.local`;
    const existing = await User.findOne({ email });
    if (existing) {
      return { success: false, error: 'A user with this email already exists' };
    }

    const newUser = new User({
      email,
      password_hash: userData.password, // pre-save hook will bcrypt-hash this
      full_name: userData.fullName || userData.full_name || userData.username || email.split('@')[0],
      role: userData.role || 'analyst',
      status: 'active',
    });

    await newUser.save();

    logger.info(`New user created: ${newUser.email}`);

    return {
      success: true,
      user: {
        id: newUser._id.toString(),
        username: newUser.email.split('@')[0],
        email: newUser.email,
        fullName: newUser.full_name,
        role: newUser.role,
      },
    };
  } catch (error) {
    logger.error('Error creating user:', error);
    return { success: false, error: 'Failed to create user' };
  }
}
