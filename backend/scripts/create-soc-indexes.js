/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SOC METRICS INDEX CREATION SCRIPT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Creates indexes required for SOC metrics and SLA queries.
 * Run this script after deploying SOC metrics features.
 *
 * USAGE:
 *   node scripts/create-soc-indexes.js
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cybersentinel';

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const SOC_INDEXES = [
  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTIONS COLLECTION - SOC METRICS INDEXES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    collection: 'executions',
    indexes: [
      {
        name: 'idx_sla_acknowledge_breach',
        spec: { 'sla_status.acknowledge.breached': 1, webhook_received_at: -1 },
        options: { background: true }
      },
      {
        name: 'idx_sla_resolution_breach',
        spec: { 'sla_status.resolution.breached': 1, started_at: -1 },
        options: { background: true }
      },
      {
        name: 'idx_sla_policy',
        spec: { sla_policy_id: 1, completed_at: -1 },
        options: { background: true }
      },
      {
        name: 'idx_webhook_received_at',
        spec: { webhook_received_at: -1 },
        options: { background: true }
      },
      {
        name: 'idx_acknowledged_at',
        spec: { acknowledged_at: -1 },
        options: { background: true, sparse: true }
      },
      {
        name: 'idx_containment_at',
        spec: { containment_at: -1 },
        options: { background: true, sparse: true }
      }
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SLA_POLICIES COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    collection: 'sla_policies',
    indexes: [
      {
        name: 'idx_policy_id',
        spec: { policy_id: 1 },
        options: { unique: true }
      },
      {
        name: 'idx_scope_enabled',
        spec: { scope: 1, enabled: 1 }
      },
      {
        name: 'idx_unique_global_sla',
        spec: { scope: 1, enabled: 1 },
        options: {
          unique: true,
          partialFilterExpression: { scope: 'global', enabled: true }
        }
      },
      {
        name: 'idx_unique_playbook_sla',
        spec: { scope: 1, playbook_id: 1, enabled: 1 },
        options: {
          unique: true,
          partialFilterExpression: { scope: 'playbook', enabled: true }
        }
      },
      {
        name: 'idx_unique_severity_sla',
        spec: { scope: 1, severity: 1, enabled: 1 },
        options: {
          unique: true,
          partialFilterExpression: { scope: 'severity', enabled: true }
        }
      },
      {
        name: 'idx_enabled_priority',
        spec: { enabled: 1, priority: 1 }
      }
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SOC_HEALTH_ALERTS COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    collection: 'soc_health_alerts',
    indexes: [
      {
        name: 'idx_alert_id',
        spec: { alert_id: 1 },
        options: { unique: true }
      },
      {
        name: 'idx_active_alerts',
        spec: { status: 1, severity: 1, created_at: -1 }
      },
      {
        name: 'idx_type_status',
        spec: { type: 1, status: 1, created_at: -1 }
      },
      {
        name: 'idx_resource_alerts',
        spec: { resource_type: 1, resource_id: 1, status: 1 },
        options: { sparse: true }
      },
      {
        name: 'idx_created_at',
        spec: { created_at: -1 }
      },
      {
        name: 'idx_resolved_at',
        spec: { resolved_at: -1 },
        options: { sparse: true }
      }
    ]
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX CREATION
// ═══════════════════════════════════════════════════════════════════════════════

async function createIndexes() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  CyberSentinel SOAR - SOC Metrics Index Creation         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Connect to MongoDB
    console.log(`Connecting to MongoDB: ${MONGODB_URI.replace(/:[^:]*@/, ':****@')}`);
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    for (const { collection, indexes } of SOC_INDEXES) {
      console.log(`\n[ Collection: ${collection} ]`);
      console.log('─'.repeat(60));

      const coll = db.collection(collection);

      for (const { name, spec, options = {} } of indexes) {
        try {
          // Check if index already exists
          const existingIndexes = await coll.indexes();
          const exists = existingIndexes.some(idx => idx.name === name);

          if (exists) {
            console.log(`  ⊙ Index "${name}" already exists - skipping`);
            continue;
          }

          // Create index
          await coll.createIndex(spec, { ...options, name });
          console.log(`  ✓ Created index "${name}"`);

        } catch (error) {
          console.error(`  ✗ Failed to create index "${name}":`, error.message);
        }
      }
    }

    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Index Creation Complete                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════════════

createIndexes();
