# SOAR Test Playbooks

Pre-built playbooks for validation/smoke-testing the CyberSentinel SOAR
platform against the manager on `192.168.1.222`.

## soar-ar-smoke-test-3.0.5.json

10-step playbook that exercises every Active Response action across Linux
and Windows agents.

### Targets

| Agent ID | Name                       | OS      | Used in steps      |
|----------|----------------------------|---------|--------------------|
| 005      | Agent-70                   | Ubuntu  | 1, 2, 3, 7, 8      |
| 007      | RootSeeker                 | Windows | 4, 5, 6            |
| 056      | AnshWindowsVirtualMachine  | Windows | 9, 10              |

### Pre-flight setup (operator runs ONCE before the test)

On agent 005 (Linux):
```bash
ssh root@192.168.1.70 'useradd -m soartest 2>/dev/null; sleep 999 &'
```

On agent 007 (Windows, via PSExec/RDP/console):
```cmd
net user soartest Soart3st!Pass /add
start /B powershell.exe -Command "Start-Sleep -Seconds 999"
```

On agent 056 (Windows, hypervisor console pre-staged):
- No setup required — only isolate_host tests target this agent.

### Pre-stage console access (BEFORE step 7 and step 9)

- Linux agent 005: open an SSH session from a jump host that is NOT
  `192.168.1.222`. Keep it open. If isolation lingers, run `iptables -F`
  from that session.
- Windows agent 056: open hypervisor console (vSphere / Hyper-V Manager /
  Proxmox / etc.) and keep it visible. If isolation lingers and RDP is
  blocked, recover via console.

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

### Live-fire run

Once simulation is clean and console access is staged:
1. Click "Run" → Simulation mode OFF
2. Coordinate with the manager-side operator who's tailing
   `active-responses.log` on `192.168.1.222`
3. Watch each step's result in the Execution Detail view
4. After step 10, both sides cross-check log lines against the contract:

| Step | Expected agent-side log line                                                                  |
|------|-----------------------------------------------------------------------------------------------|
| 1    | `cybersentinel-soar-kill-process: Killed PID <n> (sleep)` on 005                              |
| 2    | `cybersentinel-soar-disable-user: User 'soartest' locked successfully` on 005                 |
| 3    | `cybersentinel-soar-disable-user: User 'soartest' unlocked successfully` on 005               |
| 4    | `cybersentinel-soar-kill-process: Killed PID <n> (powershell)` on 007                         |
| 5    | `cybersentinel-soar-disable-user: Account 'soartest' locked successfully` on 007              |
| 6    | `cybersentinel-soar-disable-user: Account 'soartest' unlocked successfully` on 007            |
| 7    | `cybersentinel-soar-isolate-host: Isolation applied (manager=192.168.1.222 whitelisted)` on 005 |
| 8    | `cybersentinel-soar-isolate-host: Isolation removed` on 005                                   |
| 9    | `cybersentinel-soar-isolate-host: Isolation applied (manager=192.168.1.222 whitelisted)` on 056 |
| 10   | `cybersentinel-soar-isolate-host: Isolation removed` on 056                                   |

### Step ordering rationale

Steps are ordered least-to-most destructive. Steps 7+8 (Linux isolation)
run before 9+10 (Windows isolation) because Linux recovery (SSH from jump
host) is faster than Windows recovery (hypervisor console). Each
isolate_host ADD step is paired with a RELEASE step IMMEDIATELY after, so
any failure in the RELEASE step is caught within ~60s of the ADD.

### On-failure semantics

- Steps 1-6: `on_failure: "continue"` — a single mis-staged user or
  process doesn't abort the rest of the test.
- Steps 7-10: `on_failure: "stop"` — isolation failures must halt the
  playbook so the operator can intervene before adding more isolation
  load.

### Post-test cleanup

```bash
# Linux agent 005
ssh root@192.168.1.70 'userdel -r soartest'

# Windows agent 007 (PSExec / console)
net user soartest /delete
```
