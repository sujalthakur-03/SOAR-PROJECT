/**
 * MongoDB Index Creation Script
 * Creates performance indexes for execution queries
 *
 * AGENT 8 - Backend Execution Query & Statistics Optimizer
 *
 * Run with: node scripts/create-execution-indexes.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'cybersentinel';

async function createIndexes() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   CyberSentinel SOAR - Execution Index Creation Script        ║');
  console.log('║   Agent 8: Backend Execution Query & Statistics Optimizer     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Connect to MongoDB
    console.log(`📡 Connecting to MongoDB...`);
    console.log(`   URI: ${MONGODB_URI}`);
    console.log(`   Database: ${MONGODB_DB_NAME}\n`);

    await mongoose.connect(MONGODB_URI, {
      dbName: MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('executions');

    // Check if collection exists
    const collections = await db.listCollections({ name: 'executions' }).toArray();
    if (collections.length === 0) {
      console.log('⚠️  Warning: executions collection does not exist yet.');
      console.log('   Indexes will be created when the collection is first used.\n');
    }

    // Get existing indexes
    console.log('📋 Existing indexes:');
    const existingIndexes = await collection.indexes();
    existingIndexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });
    console.log('');

    // Create new indexes
    console.log('🔧 Creating performance indexes...\n');

    const indexesToCreate = [
      {
        name: 'idx_state_event_time',
        spec: { state: 1, event_time: -1 },
        options: { name: 'idx_state_event_time', background: true },
        description: 'State + event_time for filtered execution lists'
      },
      {
        name: 'idx_severity_event_time',
        spec: { 'trigger_data.severity': 1, event_time: -1 },
        options: { name: 'idx_severity_event_time', background: true },
        description: 'Severity filtering (nested field)'
      },
      {
        name: 'idx_rule_id_event_time',
        spec: { 'trigger_data.rule_id': 1, event_time: -1 },
        options: { name: 'idx_rule_id_event_time', background: true },
        description: 'Rule ID filtering (nested field)'
      },
      {
        name: 'idx_trigger_id_event_time',
        spec: { 'trigger_snapshot.trigger_id': 1, event_time: -1 },
        options: { name: 'idx_trigger_id_event_time', background: true },
        description: 'Trigger ID filtering (audit trail)'
      },
      {
        name: 'idx_webhook_event_time',
        spec: { webhook_id: 1, event_time: -1 },
        options: { name: 'idx_webhook_event_time', background: true },
        description: 'Webhook source filtering'
      },
      {
        name: 'idx_event_time',
        spec: { event_time: -1 },
        options: { name: 'idx_event_time', background: true },
        description: 'Event time range queries'
      },
      {
        name: 'idx_state_completed_at',
        spec: { state: 1, completed_at: -1 },
        options: { name: 'idx_state_completed_at', background: true },
        description: 'State-based statistics queries'
      }
    ];

    for (const indexDef of indexesToCreate) {
      try {
        // Check if index already exists
        const exists = existingIndexes.some(idx => idx.name === indexDef.name);

        if (exists) {
          console.log(`   ⏭️  ${indexDef.name} - Already exists (skipping)`);
        } else {
          await collection.createIndex(indexDef.spec, indexDef.options);
          console.log(`   ✅ ${indexDef.name} - Created`);
          console.log(`      ${indexDef.description}`);
        }
      } catch (error) {
        console.error(`   ❌ ${indexDef.name} - Failed: ${error.message}`);
      }
    }

    console.log('\n📊 Final index list:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n✅ Index creation complete!\n');

    // Display index usage recommendations
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('QUERY PATTERNS OPTIMIZED');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('1. Filter by state:');
    console.log('   GET /api/executions?state=EXECUTING');
    console.log('   → Uses: idx_state_event_time\n');

    console.log('2. Filter by severity:');
    console.log('   GET /api/executions?severity=critical');
    console.log('   → Uses: idx_severity_event_time\n');

    console.log('3. Filter by rule_id:');
    console.log('   GET /api/executions?rule_id=100002');
    console.log('   → Uses: idx_rule_id_event_time\n');

    console.log('4. Filter by trigger_id:');
    console.log('   GET /api/executions?trigger_id=TRG-001');
    console.log('   → Uses: idx_trigger_id_event_time\n');

    console.log('5. Filter by event time range:');
    console.log('   GET /api/executions?from_time=2026-01-20T00:00:00Z&to_time=2026-01-20T23:59:59Z');
    console.log('   → Uses: idx_event_time\n');

    console.log('6. Stats endpoint:');
    console.log('   GET /api/executions/stats');
    console.log('   → Uses: idx_state_event_time, idx_state_completed_at\n');

    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('📡 Disconnected from MongoDB\n');
    process.exit(0);
  }
}

createIndexes();
