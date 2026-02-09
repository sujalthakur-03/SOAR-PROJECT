/**
 * CyberSentinel SOAR Backend
 * Main entry point for the execution engine with MongoDB
 */

import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

import logger from './utils/logger.js';
import { connectToMongoDB, testConnection } from './utils/mongodb.js';
import triggerWebhookRoutes from './routes/trigger-webhook-routes.js';
import webhookManagementRoutes from './routes/webhook-management.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import socRoutes from './routes/soc-routes.js';
import caseRoutes from './routes/case-routes.js';
import { webhookSecurityMiddleware, securityRouter } from './middleware/webhook-security.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const PORT = process.env.PORT || 3001;
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api', caseRoutes);  // Case Management API (Agent 15)
app.use('/api/security', securityRouter);  // Security observability endpoints
app.use('/api/soc', socRoutes);  // SOC Metrics & SLA API (Agent 13)

// Apply security middleware to webhook routes
app.use('/api/webhooks', webhookSecurityMiddleware);
app.use('/api', webhookManagementRoutes);  // Webhook lifecycle API (must be before triggerWebhookRoutes)
app.use('/api', triggerWebhookRoutes);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'CyberSentinel Backend',
    version: '3.0.0',
    database: 'mongodb',
    timestamp: new Date().toISOString()
  });
});

/**
 * Status endpoint
 */
app.get('/status', async (req, res) => {
  const dbConnected = await testConnection();

  res.json({
    service: 'CyberSentinel SOAR Backend',
    version: '3.0.0',
    status: 'running',
    database: {
      type: 'mongodb',
      connected: dbConnected
    },
    features: {
      webhook_ingestion: 'active',
      alert_ingestion: 'disabled - use webhooks',
      execution_engine: 'active',
      case_management: 'active'
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Graceful shutdown
 */
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  // Close server
  if (global.server) {
    global.server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

/**
 * Start the backend service
 */
async function start() {
  try {
    // Print banner
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     ██████╗██╗   ██╗██████╗ ███████╗██████╗             ║
║    ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗            ║
║    ██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝            ║
║    ██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗            ║
║    ╚██████╗   ██║   ██████╔╝███████╗██║  ██║            ║
║     ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝            ║
║                                                           ║
║           SENTINEL SOAR - Backend Engine                 ║
║               Version 3.0.0 (MongoDB)                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);

    logger.info('Starting CyberSentinel SOAR Backend v3.0...');

    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await connectToMongoDB();

    // Test MongoDB connection
    logger.info('Testing MongoDB connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.error('MongoDB connection test failed. Please check your configuration.');
      process.exit(1);
    }

    logger.info('MongoDB connected and operational');

    // Start Express server
    const server = app.listen(PORT, () => {
      logger.info(`Backend server running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Status: http://localhost:${PORT}/status`);
      logger.info('');
      logger.info('CyberSentinel SOAR Backend v3.0 is ready!');
      logger.info('  - Database: MongoDB');
      logger.info('  - Webhook ingestion: ACTIVE');
      logger.info('  - Alert ingestion: DISABLED (use webhooks)');
      logger.info('  - Playbook execution: ACTIVE');
      logger.info('  - Case management: ACTIVE');
      logger.info('');
      logger.info('Architecture Notes:');
      logger.info('  - Alerts exist ONLY as trigger_data in executions');
      logger.info('  - Use playbook-specific webhooks for ingestion');
      logger.info('  - No generic /api/alerts endpoints available');
      logger.info('');
      logger.info('Press Ctrl+C to stop');
    });

    // Export server for shutdown handling
    global.server = server;

  } catch (error) {
    logger.error('Failed to start backend:', error);
    process.exit(1);
  }
}

// Start the service
start();
