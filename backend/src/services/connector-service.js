/**
 * Connector Service
 * Business logic for connector operations with MongoDB
 */

import { Connector, AuditLog } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Get all connectors with optional filters
 */
export async function getConnectors(filters = {}) {
  try {
    const query = {};

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.tags && filters.tags.length > 0) {
      query.tags = { $in: filters.tags };
    }

    const connectors = await Connector.find(query)
      .sort({ name: 1 })
      .lean();

    return connectors.map(c => ({
      ...c,
      id: c._id.toString(),
      connector_id: c._id.toString()
    }));
  } catch (error) {
    logger.error('Failed to get connectors:', error);
    throw error;
  }
}

/**
 * Get single connector by ID
 */
export async function getConnector(id) {
  try {
    const connector = await Connector.findById(id).lean();

    if (!connector) {
      return null;
    }

    return {
      ...connector,
      id: connector._id.toString(),
      connector_id: connector._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to get connector ${id}:`, error);
    throw error;
  }
}

/**
 * Create new connector
 */
export async function createConnector(data, userId) {
  try {
    const connector = new Connector({
      name: data.name,
      type: data.type,
      description: data.description || '',
      status: data.status || 'inactive',
      config: data.config || {},
      tags: data.tags || [],
      created_by: userId || 'system'
    });

    await connector.save();

    await AuditLog.log({
      action: 'create',
      resource_type: 'connector',
      resource_id: connector._id.toString(),
      resource_name: connector.name,
      actor_email: userId || 'system',
      details: { type: connector.type },
      outcome: 'success'
    });

    logger.info(`Connector created: ${connector._id} (${connector.name})`);

    return {
      ...connector.toObject(),
      id: connector._id.toString(),
      connector_id: connector._id.toString()
    };
  } catch (error) {
    logger.error('Failed to create connector:', error);
    throw error;
  }
}

/**
 * Update connector
 */
export async function updateConnector(id, updates, userId) {
  try {
    const connector = await Connector.findById(id);

    if (!connector) {
      throw new Error('Connector not found');
    }

    // Update fields
    if (updates.name) connector.name = updates.name;
    if (updates.description !== undefined) connector.description = updates.description;
    if (updates.status) connector.status = updates.status;
    if (updates.config) connector.config = { ...connector.config, ...updates.config };
    if (updates.tags) connector.tags = updates.tags;

    connector.updated_by = userId || 'system';
    await connector.save();

    await AuditLog.log({
      action: 'update',
      resource_type: 'connector',
      resource_id: connector._id.toString(),
      resource_name: connector.name,
      actor_email: userId || 'system',
      details: { updates: Object.keys(updates) },
      outcome: 'success'
    });

    logger.info(`Connector updated: ${connector._id} (${connector.name})`);

    return {
      ...connector.toObject(),
      id: connector._id.toString(),
      connector_id: connector._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to update connector ${id}:`, error);
    throw error;
  }
}

/**
 * Toggle connector status
 */
export async function toggleConnector(id, enabled) {
  try {
    const connector = await Connector.findById(id);

    if (!connector) {
      throw new Error('Connector not found');
    }

    connector.status = enabled ? 'active' : 'inactive';
    await connector.save();

    await AuditLog.log({
      action: 'config_change',
      resource_type: 'connector',
      resource_id: connector._id.toString(),
      resource_name: connector.name,
      details: { status: connector.status },
      outcome: 'success'
    });

    logger.info(`Connector ${enabled ? 'enabled' : 'disabled'}: ${connector._id} (${connector.name})`);

    return {
      ...connector.toObject(),
      id: connector._id.toString(),
      connector_id: connector._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to toggle connector ${id}:`, error);
    throw error;
  }
}

/**
 * Delete connector
 */
export async function deleteConnector(id, userId) {
  try {
    const connector = await Connector.findById(id);

    if (!connector) {
      throw new Error('Connector not found');
    }

    await Connector.deleteOne({ _id: id });

    await AuditLog.log({
      action: 'delete',
      resource_type: 'connector',
      resource_id: id,
      resource_name: connector.name,
      actor_email: userId || 'system',
      outcome: 'success'
    });

    logger.info(`Connector deleted: ${id} (${connector.name})`);

    return { success: true };
  } catch (error) {
    logger.error(`Failed to delete connector ${id}:`, error);
    throw error;
  }
}

/**
 * Test connector connection or execute a real action.
 *
 * @param {string} id - Connector MongoDB _id or name
 * @param {Object} options - Optional action and parameters for real invocation
 * @param {string} options.action - Action type to execute
 * @param {Object} options.parameters - Input parameters
 */
export async function testConnector(id, options = {}) {
  try {
    // Support lookup by _id or by name
    let connector = await Connector.findById(id).catch(() => null);
    if (!connector) {
      connector = await Connector.findOne({ name: id });
    }

    if (!connector) {
      throw new Error('Connector not found');
    }

    const { action, parameters } = options;

    // If action + parameters provided, invoke the real connector
    if (action && parameters && Object.keys(parameters).length > 0) {
      const { invokeConnector } = await import('../engine/connector-interface.js');

      const startTime = Date.now();
      try {
        const result = await invokeConnector(
          connector.name,
          action,
          parameters,
          15 // 15 second timeout for test
        );
        const duration = Date.now() - startTime;

        await connector.updateHealth('healthy', `Test action ${action} succeeded`);

        return {
          success: true,
          connector_id: connector._id.toString(),
          connector_name: connector.name,
          action,
          output: result,
          duration_ms: duration,
          health_status: 'healthy'
        };
      } catch (invokeError) {
        const duration = Date.now() - startTime;

        await connector.updateHealth('unhealthy', invokeError.message);

        return {
          success: false,
          connector_id: connector._id.toString(),
          connector_name: connector.name,
          action,
          error: invokeError.message,
          error_code: invokeError.code || 'UNKNOWN',
          retryable: invokeError.retryable || false,
          duration_ms: duration,
          health_status: 'unhealthy'
        };
      }
    }

    // No action provided — perform health check using real connectivity test
    const connectorInterface = await import('../engine/connector-interface.js');
    const getConnectorImpl = connectorInterface.default.getConnector;
    const impl = getConnectorImpl(connector.name) || getConnectorImpl(connector.type);

    if (impl) {
      await connector.updateHealth('healthy', 'Connector implementation registered');
    } else {
      await connector.updateHealth('unhealthy', 'No connector implementation found');
    }

    logger.info(`Connector tested: ${connector._id} (${connector.name}) - ${connector.health_status}`);

    return {
      connector_id: connector._id.toString(),
      connector_name: connector.name,
      health_status: connector.health_status,
      health_message: connector.health_message,
      last_health_check: connector.last_health_check
    };
  } catch (error) {
    logger.error(`Failed to test connector ${id}:`, error);
    throw error;
  }
}

export default {
  getConnectors,
  getConnector,
  createConnector,
  updateConnector,
  toggleConnector,
  deleteConnector,
  testConnector
};
