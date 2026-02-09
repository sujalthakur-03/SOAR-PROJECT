/**
 * Integration test: Block IP via the actual connector code.
 *
 * Sends a REAL request to the CyberSentinel Control Plane
 * to add a test IP to the CDB list.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load env from root .env (has the real credentials)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import the connector
import { addBlockedIP } from './src/connectors/cybersentinel-blocklist.connector.js';

const TEST_IP = '10.99.99.2';
const TEST_REASON = 'Agent16 connector integration test';

async function main() {
  console.log('');
  console.log('================================================================');
  console.log('  CyberSentinel Blocklist — Connector Integration Test');
  console.log(`  Test IP: ${TEST_IP}`);
  console.log(`  Reason:  ${TEST_REASON}`);
  console.log(`  Control Plane: ${process.env.CYBERSENTINEL_CONTROL_PLANE_URL}`);
  console.log('================================================================');
  console.log('');

  try {
    console.log('[1/2] Calling addBlockedIP() — REAL execution (no simulation)...');
    console.log('');

    const result = await addBlockedIP({
      ip: TEST_IP,
      reason: TEST_REASON,
      ttl: 60,
      execution_id: 'TEST-AGENT16-001',
      _simulate: false,
    });

    console.log('');
    console.log('[2/2] Connector returned:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    if (result.status === 'blocked' || result.status === 'already_blocked') {
      console.log('================================================================');
      console.log(`  TEST PASSED — IP ${TEST_IP} status: ${result.status}`);
      console.log(`  Enforced by: ${result.enforced_by}`);
      console.log('================================================================');
      console.log('');
      console.log('Verify on the Wazuh server:');
      console.log('  cat /var/ossec/etc/lists/cybersentinel_blocked_ips');
    } else {
      console.log('UNEXPECTED status:', result.status);
      process.exit(1);
    }
  } catch (error) {
    console.error('');
    console.error('TEST FAILED:');
    console.error(`  ${error.message}`);
    if (error.code) console.error(`  Code: ${error.code}`);
    if (error.response) {
      console.error(`  HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }
}

main();
