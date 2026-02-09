/**
 * MongoDB Connection Utility
 * Primary data persistence layer for CyberSentinel SOAR
 */

import mongoose from 'mongoose';
import logger from './logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'cybersentinel';
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

let isConnected = false;

/**
 * Connect to MongoDB with retry logic
 */
export async function connectToMongoDB() {
  if (isConnected) {
    logger.info('MongoDB already connected');
    return;
  }

  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      await mongoose.connect(MONGODB_URI, {
        dbName: MONGODB_DB_NAME,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      isConnected = true;
      logger.info(`✅ MongoDB connected successfully to ${MONGODB_DB_NAME}`);

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error:', error);
        isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
        isConnected = true;
      });

      return;
    } catch (error) {
      retries++;
      logger.error(`MongoDB connection attempt ${retries}/${MAX_RETRIES} failed:`, error.message);

      if (retries >= MAX_RETRIES) {
        logger.error('❌ FATAL: Could not connect to MongoDB after maximum retries');
        logger.error('Please verify:');
        logger.error(`  - MongoDB is running at: ${MONGODB_URI}`);
        logger.error(`  - Database name: ${MONGODB_DB_NAME}`);
        logger.error('  - Network connectivity');
        process.exit(1);
      }

      logger.info(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

/**
 * Test MongoDB connection
 */
export async function testConnection() {
  try {
    if (!isConnected) {
      await connectToMongoDB();
    }

    // Ping the database
    await mongoose.connection.db.admin().ping();
    return true;
  } catch (error) {
    logger.error('MongoDB connection test failed:', error);
    return false;
  }
}

/**
 * Close MongoDB connection
 */
export async function closeMongoDB() {
  try {
    await mongoose.connection.close();
    isConnected = false;
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection:', error);
  }
}

/**
 * Get connection status
 */
export function isMongoDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export default {
  connect: connectToMongoDB,
  testConnection,
  close: closeMongoDB,
  isConnected: isMongoDBConnected
};
