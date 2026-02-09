/**
 * User Model
 * Stores user accounts and authentication data
 */

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password_hash: {
    type: String,
    required: true
  },

  // Profile
  full_name: String,
  avatar_url: String,

  // Role-based access control
  role: {
    type: String,
    required: true,
    enum: ['viewer', 'analyst', 'engineer', 'admin', 'security_admin'],
    default: 'viewer',
    index: true
  },

  // Account status
  status: {
    type: String,
    enum: ['active', 'inactive', 'locked', 'pending'],
    default: 'active',
    index: true
  },

  // Authentication
  last_login: Date,
  failed_login_attempts: {
    type: Number,
    default: 0
  },
  locked_until: Date,

  // API access
  api_key: String,
  api_key_created_at: Date,

  // Password management
  password_changed_at: Date,
  password_reset_token: String,
  password_reset_expires: Date,

  // Multi-factor authentication
  mfa_enabled: {
    type: Boolean,
    default: false
  },
  mfa_secret: String,

  // Preferences
  preferences: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      email_notifications: true,
      dashboard_layout: 'default',
      theme: 'light'
    }
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Indexes
userSchema.index({ status: 1, role: 1 });
userSchema.index({ api_key: 1 }, { sparse: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password_hash')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password_hash = await bcrypt.hash(this.password_hash, salt);
    this.password_changed_at = new Date();
    next();
  } catch (error) {
    next(error);
  }
});

// Method to validate password
userSchema.methods.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password_hash);
};

// Method to update last login
userSchema.methods.updateLastLogin = function() {
  this.last_login = new Date();
  this.failed_login_attempts = 0;
  return this.save();
};

// Method to record failed login
userSchema.methods.recordFailedLogin = function() {
  this.failed_login_attempts += 1;

  // Lock account after 5 failed attempts
  if (this.failed_login_attempts >= 5) {
    this.status = 'locked';
    this.locked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  }

  return this.save();
};

// Method to unlock account
userSchema.methods.unlock = function() {
  this.status = 'active';
  this.failed_login_attempts = 0;
  this.locked_until = null;
  return this.save();
};

// Method to check if account is locked
userSchema.methods.isLocked = function() {
  if (this.status === 'locked' && this.locked_until) {
    if (new Date() > this.locked_until) {
      // Auto-unlock if lock period expired
      this.unlock();
      return false;
    }
    return true;
  }
  return this.status === 'locked';
};

const User = mongoose.model('User', userSchema);

export default User;
