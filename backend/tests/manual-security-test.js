/**
 * Manual Security Test - Simple verification script
 */

import crypto from 'crypto';

console.log('\n=== Testing Timestamp Parsing ===\n');

const now = Math.floor(Date.now() / 1000); // Unix epoch in seconds
console.log('Current timestamp (seconds):', now);
console.log('Current timestamp (string):', now.toString());

// Try parsing as string
const parsed = new Date(now.toString()).getTime();
console.log('Parsed with new Date(string):', parsed);
console.log('Is NaN?:', isNaN(parsed));

// Try parsing as number
const ts = now > 1e12 ? now : now * 1000;
console.log('Parsed as number (* 1000):', ts);

// Correct way: parseInt first
const correctParsed = parseInt(now.toString(), 10) * 1000;
console.log('Correct parsing (parseInt * 1000):', correctParsed);
console.log('Expected (Date.now()):', Date.now());

console.log('\n=== Testing Nonce Generation ===\n');

function generateNonce(webhookId, payload, timestamp) {
  const data = JSON.stringify({ webhookId, payload, timestamp });
  return crypto.createHash('sha256').update(data).digest('hex');
}

const webhookId = 'WH-TEST';
const payload = { alert: 'test' };
const timestamp1 = Math.floor(Date.now() / 1000);

const nonce1 = generateNonce(webhookId, payload, timestamp1);
const nonce2 = generateNonce(webhookId, payload, timestamp1);

console.log('Nonce 1:', nonce1.substring(0, 16));
console.log('Nonce 2:', nonce2.substring(0, 16));
console.log('Nonces match:', nonce1 === nonce2);

const nonce3 = generateNonce(webhookId, payload, timestamp1 + 1);
console.log('Nonce 3 (diff timestamp):', nonce3.substring(0, 16));
console.log('Nonces differ:', nonce1 !== nonce3);

console.log('\n=== Complete ===\n');
