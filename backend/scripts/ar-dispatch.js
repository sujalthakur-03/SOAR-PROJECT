#!/usr/bin/env node
/**
 * CyberSentinel SOAR — single-step Active Response dispatcher
 *
 * Validation tool for live-fire testing of the cybersentinel_response
 * connector against the dev manager on 192.168.1.222. Loads the real
 * connector code and invokes one action with operator-supplied inputs,
 * so each dispatch can be gated by the manager-side operator before the
 * next is fired.
 *
 * Exercised in this run:
 *   - auth + 10-min token cache
 *   - OS lookup via GET /agents?agents_list=<id>&select=os.platform
 *   - paired-command routing (soar-X0 vs win_soar-X0)
 *   - mode → '!' prefix for AR delete-path
 *   - agent-000 refusal + UNSUPPORTED_OS allowlist
 *   - error classification
 *
 * Reads CYBERSENTINEL_CONTROL_PLANE_URL / _USER / _PASSWORD from
 * backend/.env exactly like the running SOAR backend does, so the
 * dispatch path is byte-identical to a playbook-engine dispatch.
 *
 * Usage:
 *   node backend/scripts/ar-dispatch.js kill_process    --agent 005 --pid 12345
 *   node backend/scripts/ar-dispatch.js kill_process    --agent 005 --name sleep
 *   node backend/scripts/ar-dispatch.js disable_user    --agent 005 --user soartest-linux
 *   node backend/scripts/ar-dispatch.js isolate_host    --agent 005
 *
 * All actions are ADD-path only. Release / unlock are NOT exposed:
 *   - isolate_host release: handled by Wazuh native <timeout> auto-expiry
 *     on the manager's <active-response> block.
 *   - disable_user unlock:  manual SOC operator task, not a SOAR step.
 *
 * Add --simulate to skip the actual PUT (returns mock success).
 * Add --dry-run-preview to print the PUT body that WOULD be sent without
 *   dispatching (no auth call, no OS lookup, just the body shape).
 */

import 'dotenv/config';
import { cybersentinelResponseConnector } from '../src/connectors/cybersentinel-response.connector.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function previewPutBody(action, inputs) {
  const baseCommands = {
    isolate_host: 'soar-isolate-host0',
    kill_process: 'soar-kill-process0',
    disable_user: 'soar-disable-user0',
  };
  const isWin = String(inputs.agent_id) === '007';   // hint for preview only
  const base = baseCommands[action];
  const cmd = isWin ? `win_${base}` : base;
  // Wazuh 4.14.x manual-dispatch API requires "!" prefix on every command.
  const command = `!${cmd}`;

  let argsArr = [];
  if (action === 'kill_process') {
    argsArr = inputs.pid ? ['pid', String(inputs.pid)] : ['name', String(inputs.process_name)];
  } else if (action === 'disable_user') {
    argsArr = [String(inputs.username)];
  } else if (action === 'isolate_host') {
    // API-dispatched AR does NOT inherit manager ossec.conf <extra_args>.
    // Manager IP is passed explicitly in the API body's arguments array.
    const mgrIp = (process.env.CYBERSENTINEL_MANAGER_IP || '').trim()
      || (() => { try { return new URL(process.env.CYBERSENTINEL_CONTROL_PLANE_URL).hostname; } catch { return '<MANAGER_IP>'; } })();
    argsArr = [mgrIp];
  }

  return {
    url: `${process.env.CYBERSENTINEL_CONTROL_PLANE_URL}/active-response?agents_list=${encodeURIComponent(inputs.agent_id)}`,
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer <cached-jwt>',
      'Content-Type': 'application/json',
    },
    body: {
      command,
      arguments: argsArr,
      alert: {},
    },
    notes: {
      os_lookup: 'GET /agents?agents_list=<id>&select=os.platform — fetched at dispatch time',
      windows_routing: 'preview assumes agent 007 = windows; live dispatch resolves via real OS lookup',
      api_prefix: 'Wazuh 4.14.x API requires "!" prefix on every manual dispatch (verified 2026-05-12)',
      release_path: action === 'isolate_host'
        ? 'NOTE: release is handled by Wazuh native <timeout> on the manager <active-response> block, not by SOAR.'
        : action === 'disable_user'
        ? 'NOTE: unlock is a manual SOC operator task, not exposed by this connector.'
        : null,
    },
  };
}

async function main() {
  const [, , action, ...rest] = process.argv;
  if (!action || !['kill_process', 'disable_user', 'isolate_host'].includes(action)) {
    console.error('Usage: ar-dispatch.js <action> [flags]');
    console.error('  action: kill_process | disable_user | isolate_host');
    console.error('Flags: --agent <id>  --pid <n>  --name <s>  --user <s>');
    console.error('       --simulate         use the connector simulation path');
    console.error('       --dry-run-preview  print the PUT body shape only, no network');
    process.exit(2);
  }

  const args = parseArgs(rest);

  if (!args.agent) {
    console.error('--agent <id> is required');
    process.exit(2);
  }

  const inputs = { agent_id: String(args.agent) };
  if (action === 'kill_process') {
    if (args.pid) inputs.pid = String(args.pid);
    else if (args.name) inputs.process_name = String(args.name);
    else { console.error('--pid <n> or --name <s> required for kill_process'); process.exit(2); }
  }
  if (action === 'disable_user') {
    if (!args.user) { console.error('--user <name> required for disable_user'); process.exit(2); }
    inputs.username = String(args.user);
  }
  // isolate_host: no extra args; release is handled by Wazuh <timeout> auto-expiry.
  if (args.mode) {
    console.error('--mode flag is no longer supported. Connector is ADD-only; release/unlock paths were removed per the 2026-05-14 design decision.');
    process.exit(2);
  }
  if (args.simulate) inputs._simulate = true;

  if (args['dry-run-preview']) {
    console.log(JSON.stringify({
      mode: 'PREVIEW (no network call)',
      action,
      inputs,
      put: previewPutBody(action, inputs),
    }, null, 2));
    process.exit(0);
  }

  const startedAt = Date.now();
  console.log(`[ar-dispatch] action=${action} inputs=${JSON.stringify(inputs)}`);

  const result = await cybersentinelResponseConnector.execute(action, inputs, {});
  const durationMs = Date.now() - startedAt;

  console.log(JSON.stringify({
    duration_ms: durationMs,
    result,
  }, null, 2));

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('[ar-dispatch] FATAL:', err.message);
  console.error(err.stack);
  process.exit(2);
});
