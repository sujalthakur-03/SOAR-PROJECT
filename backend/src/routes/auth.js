/**
 * Authentication Routes
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser, verifyToken, getUserById, createUser, generateToken } from '../services/auth-service.js';
import authMiddleware from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';
import User from '../models/user.js';
import logger from '../utils/logger.js';
import { logAction, actorFromReq } from '../services/audit-service.js';

// Helper: extract IP from request even when no JWT is present (login/logout)
function ipFromReq(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  const firstHop = typeof xff === 'string' ? xff.split(',')[0].trim() : undefined;
  return firstHop || req?.ip || req?.socket?.remoteAddress || 'unknown';
}

const router = express.Router();

// ── Login Rate Limiter ──────────────────────────────────────────────────────
// Max 5 login attempts per IP per 15-minute window (in-memory store).
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_RATE_MAX = 5;
const loginAttempts = new Map(); // ip -> { count, resetAt }

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && now < record.resetAt) {
    if (record.count >= LOGIN_RATE_MAX) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
        retry_after_seconds: retryAfterSec,
      });
    }
    record.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
  }

  next();
}

// Periodically clean up expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now >= record.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  const clientIp = ipFromReq(req);
  const username = req.body?.username || 'unknown';

  try {
    const { password } = req.body;

    if (!username || username === 'unknown' || !password) {
      // Don't audit malformed requests — they're noise, not real attempts.
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateUser(username, password);

    if (!result.success) {
      // Failed login — audit so SOC can see brute-force / credential-stuffing
      logAction({
        action: 'login',
        resource_type: 'auth',
        resource_name: username,
        actor_email: username,                  // best-effort: what they typed
        actor_role: 'unknown',
        actor_ip: clientIp,
        outcome: 'failure',
        error_message: result.error,
        details: { reason: result.error },
      }).catch(() => {});
      return res.status(401).json({ error: result.error });
    }

    // Successful login — audit
    logAction({
      action: 'login',
      resource_type: 'auth',
      resource_name: result.user.email,
      actor_email: result.user.email,
      actor_role: result.user.role,
      actor_ip: clientIp,
      outcome: 'success',
    }).catch(() => {});

    res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    logger.error('Login error:', error);
    logAction({
      action: 'login',
      resource_type: 'auth',
      resource_name: username,
      actor_email: username,
      actor_role: 'unknown',
      actor_ip: clientIp,
      outcome: 'failure',
      error_message: error.message,
    }).catch(() => {});
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
router.get('/me', async (req, res) => {
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

    const user = await getUserById(result.user.userId);

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
  // In JWT-based auth, logout is handled client-side by removing the token.
  // Audit the explicit hit so we know who logged out from where, when.
  // The endpoint is not authMiddleware-gated, so req.user may be absent;
  // we honor the Authorization header if present.
  let actorEmail = 'anonymous';
  let actorRole = 'unknown';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const v = verifyToken(authHeader.substring(7));
    if (v.valid && v.user) {
      actorEmail = v.user.email || actorEmail;
      actorRole = v.user.role || actorRole;
    }
  }
  logAction({
    action: 'logout',
    resource_type: 'auth',
    resource_name: actorEmail,
    actor_email: actorEmail,
    actor_role: actorRole,
    actor_ip: ipFromReq(req),
    outcome: 'success',
  }).catch(() => {});
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * POST /auth/sso/exchange
 * Exchange a SIEM-issued SSO token for a SOAR JWT
 */
router.post('/sso/exchange', async (req, res) => {
  try {
    // 1. Extract token from body
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    // 2. Verify with SOAR_SSO_SECRET
    const SSO_SECRET = process.env.SOAR_SSO_SECRET;
    if (!SSO_SECRET) return res.status(500).json({ error: 'SSO not configured' });

    let decoded;
    try {
      decoded = jwt.verify(token, SSO_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'SSO token expired' });
      }
      return res.status(401).json({ error: 'Invalid SSO token' });
    }

    // 3. Validate purpose and issuer
    if (decoded.purpose !== 'sso_exchange') {
      return res.status(401).json({ error: 'Invalid token purpose' });
    }
    if (decoded.iss !== 'cybersentinel-siem') {
      return res.status(401).json({ error: 'Invalid token issuer' });
    }

    // 4. Derive email from username
    let email = decoded.email;
    if (!email && decoded.username) {
      email = decoded.username.includes('@') ? decoded.username : `${decoded.username}@cybersentinel.local`;
    }
    if (!email) {
      return res.status(400).json({ error: 'No email or username in SSO token' });
    }

    // 5. Find user in MongoDB
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Register first via SIEM admin.' });
    }

    // 6. Check account status
    if (user.isLocked()) {
      return res.status(403).json({ error: 'Account is locked' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    // 7. Update last login
    await user.updateLastLogin();

    // 8. Generate SOAR JWT (same as normal login)
    const soarToken = generateToken(user);

    // 9. Return EXACT same format as /auth/login
    const userData = {
      id: user._id.toString(),
      username: user.email.split('@')[0],
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    };

    logger.info(`SSO login successful: ${email} (from SIEM)`);

    res.json({
      success: true,
      token: soarToken,
      user: userData,
    });
  } catch (error) {
    logger.error('SSO exchange error:', error);
    res.status(500).json({ error: 'SSO exchange failed' });
  }
});

/**
 * POST /auth/register
 * Create a new user (admin only)
 */
router.post('/register', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
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
