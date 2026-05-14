# SOAR Test Playbooks

Pre-built playbooks for validation/smoke-testing the CyberSentinel SOAR
platform against the manager on `192.168.1.222`.

## soar-ar-smoke-test-3.0.5.json

5-step playbook exercising every ADD-path Active Response action that SOAR
supports across the deployed agents.

> Release / unlock paths are NOT in SOAR's contract (decision 2026-05-14):
> - `isolate_host` release: handled by Wazuh native `<timeout>` auto-expiry
>   on the manager's `<active-response>` block — no SOAR dispatch.
> - `disable_user` unlock: manual SOC operator task, documented out of
>   scope for automated playbooks.

### Targets (5-step ADD-only matrix)

| Agent ID | Name        | OS      | Used in steps |
|----------|-------------|---------|---------------|
| 005      | Agent-70    | Ubuntu  | 1, 2, 5       |
| 007      | RootSeeker  | Windows | 3, 4          |

### Pre-flight setup (manager-side operator owns this)

The manager-side operator (on 192.168.1.222) creates test artifacts and
hands the PIDs to the SOAR side at run time. PIDs and usernames are
substituted into the playbook inputs OR passed as CLI flags to
`ar-dispatch.js` (see step-by-step below).

On agent 005 (Linux):
```bash
ssh root@192.168.1.70 'useradd -m soartest-linux 2>/dev/null'
ssh root@192.168.1.70 'nohup sleep 999 >/dev/null 2>&1 & echo "TEST_PID=$!"'
# manager-side operator notes the TEST_PID and hands it to the SOAR side
```

On agent 007 (Windows, via PSExec/RDP/hypervisor console):
```cmd
net user soartest-win Soart3st!Pass /add
start /B notepad.exe
tasklist /FI "IMAGENAME eq notepad.exe"
:: note the PID and hand it to the SOAR side
```

### Pre-stage console access (BEFORE step 7)

- Linux agent 005: open an SSH session from a jump host that is NOT
  `192.168.1.222`. Keep it open. If isolation lingers, run `iptables -F`
  from that session.

### Import via API

```bash
TOKEN=<your-SOAR-jwt>
curl -X POST http://localhost:3024/api/playbooks/import \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @docs/test-playbooks/soar-ar-smoke-test-3.0.5.json
```

The response contains the auto-generated `playbook_id` (e.g.
`PB-AUTO-A3F2D1`). Use that to dispatch.

### Run in Simulation mode first

In the SOAR Playbook Editor:
1. Open the imported playbook
2. Click "Run" → toggle "Simulation mode" ON
3. Verify each step shows SIMULATION log lines without dispatching
4. Confirm input mapping (agent IDs, usernames, modes) is correct

### Live-fire run — single-step CLI dispatcher (preferred)

The playbook engine runs sequentially with no native pause-between-steps
gate. For interactive live-fire validation with manager-side ACK between
each step, use the CLI dispatcher: `backend/scripts/ar-dispatch.js`. It
loads the real connector code and invokes ONE action per call, so each
dispatch is independently gated.

```bash
# Run inside the soar-backend container (uses container's .env)
docker exec soar-backend node /app/scripts/ar-dispatch.js <action> [flags]

# Preview the PUT body WITHOUT dispatching:
docker exec soar-backend node /app/scripts/ar-dispatch.js \
    kill_process --agent 005 --pid 12345 --dry-run-preview
```

Step-by-step commands (substitute `<PID>` with the value the
manager-side operator gives you at run time):

| Step | Command |
|------|---------|
| 1 | `docker exec soar-backend node /app/scripts/ar-dispatch.js kill_process --agent 005 --pid <LINUX_PID>` |
| 2 | `docker exec soar-backend node /app/scripts/ar-dispatch.js disable_user --agent 005 --user soartest-linux` |
| 3 | `docker exec soar-backend node /app/scripts/ar-dispatch.js kill_process --agent 007 --pid <WIN_PID>` |
| 4 | `docker exec soar-backend node /app/scripts/ar-dispatch.js disable_user --agent 007 --user soartest-win` |
| 5 | `docker exec soar-backend node /app/scripts/ar-dispatch.js isolate_host --agent 005` |

> Step 5 prerequisite: the manager-side operator must temporarily set
> `<timeout>60</timeout>` (or similar) on the soar-isolate-host0
> `<active-response>` block before dispatch, so Wazuh auto-releases the
> isolation. After validation, revert to `<timeout>0</timeout>`.

Expected agent-side log line per step:

| Step | Expected agent-side log line                                                                  |
|------|-----------------------------------------------------------------------------------------------|
| 1    | `cybersentinel-soar-kill-process: Killed PID <n> (sleep)` on 005                              |
| 2    | `cybersentinel-soar-disable-user: User 'soartest-linux' locked successfully` on 005           |
| 3    | `cybersentinel-soar-kill-process: Killed PID <n> (notepad)` on 007                            |
| 4    | `cybersentinel-soar-disable-user: Account 'soartest-win' locked successfully` on 007          |
| 5    | `cybersentinel-soar-isolate-host: Isolation applied (manager=192.168.1.222 whitelisted)` + auto `Isolation removed` ~60s later on 005 |

### Step ordering rationale

Steps are ordered least-to-most destructive. Non-destructive actions
(kill, lock/unlock) run first; isolation runs last. Each isolate_host ADD
step is paired with a RELEASE step IMMEDIATELY after, so any failure in
the RELEASE step is caught within ~60s of the ADD.

### On-failure semantics

- Steps 1-6: `on_failure: "continue"` — a single mis-staged user or
  process doesn't abort the rest of the test.
- Steps 7-10: `on_failure: "stop"` — isolation failures must halt the
  playbook so the operator can intervene before adding more isolation
  load.

### Post-test cleanup (manager-side operator)

```bash
# Linux agent 005
ssh root@192.168.1.70 'userdel -r soartest-linux'

# Windows agent 007 (PSExec / console)
net user soartest-win /delete
taskkill /IM notepad.exe /F   :: if any lingering test notepad processes
```
