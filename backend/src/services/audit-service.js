/**
 * Audit Service
 * Business logic for audit log operations with MongoDB
 */

import { AuditLog } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Create audit log entry
 */
export async function logAction(actionData) {
  try {
    await AuditLog.log({
      action: actionData.action || actionData.type,
      resource_type: actionData.resource_type,
      resource_id: actionData.resource_id,
      resource_name: actionData.resource_name,
      actor_email: actionData.actor_email || actionData.userId,
      actor_role: actionData.actor_role || 'user',
      actor_ip: actionData.actor_ip || actionData.ip_address,
      details: actionData.details || {},
      outcome: actionData.outcome || 'success',
      error_message: actionData.error_message,
      session_id: actionData.session_id,
      request_id: actionData.request_id
    });
  } catch (error) {
    logger.error('Failed to log audit action:', error);
    // Don't throw - audit logging should not break main flow
  }
}

/**
 * Get audit logs with filters
 */
export async function getAuditLogs(filters = {}) {
  try {
    const query = {};

    if (filters.actor_email) {
      query.actor_email = filters.actor_email;
    }

    if (filters.action) {
      query.action = filters.action;
    }

    if (filters.resource_type) {
      query.resource_type = filters.resource_type;
    }

    if (filters.resource_id) {
      query.resource_id = filters.resource_id;
    }

    if (filters.outcome) {
      query.outcome = filters.outcome;
    }

    // Date range filtering
    if (filters.start_date || filters.end_date) {
      query.timestamp = {};
      if (filters.start_date) {
        query.timestamp.$gte = new Date(filters.start_date);
      }
      if (filters.end_date) {
        query.timestamp.$lte = new Date(filters.end_date);
      }
    }

    const limit = parseInt(filters.limit) || 100;
    const offset = parseInt(filters.offset) || 0;

    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(offset)
      .lean();

    const total = await AuditLog.countDocuments(query);

    return {
      data: logs.map(log => ({
        ...log,
        id: log._id.toString()
      })),
      total,
      limit,
      offset
    };
  } catch (error) {
    logger.error('Failed to get audit logs:', error);
    throw error;
  }
}

/**
 * Get audit logs for specific resource
 */
export async function getResourceAuditLogs(resourceType, resourceId, limit = 50) {
  try {
    const logs = await AuditLog.find({
      resource_type: resourceType,
      resource_id: resourceId
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return logs.map(log => ({
      ...log,
      id: log._id.toString()
    }));
  } catch (error) {
    logger.error(`Failed to get audit logs for ${resourceType} ${resourceId}:`, error);
    throw error;
  }
}

/**
 * Get audit statistics
 */
export async function getAuditStats(timeRange = '24h') {
  try {
    const now = new Date();
    const rangeMs = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000
    }[timeRange] || 86400000;

    const query = {
      timestamp: { $gte: new Date(now - rangeMs) }
    };

    const [total, byAction, byResourceType, byOutcome] = await Promise.all([
      AuditLog.countDocuments(query),

      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$resource_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),

      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$outcome', count: { $sum: 1 } } }
      ])
    ]);

    return {
      total,
      by_action: byAction.map(a => ({ action: a._id, count: a.count })),
      by_resource_type: byResourceType.map(r => ({ resource_type: r._id, count: r.count })),
      by_outcome: byOutcome.map(o => ({ outcome: o._id, count: o.count })),
      time_range: timeRange
    };
  } catch (error) {
    logger.error('Failed to get audit stats:', error);
    throw error;
  }
}

export default {
  logAction,
  getAuditLogs,
  getResourceAuditLogs,
  getAuditStats
};
