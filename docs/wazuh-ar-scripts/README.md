# CyberSentinel SOAR — Active Response Scripts

These are the production AR scripts that the SOAR's `cybersentinel_response`
connector invokes through the CyberSentinel manager (rebranded Wazuh 4.14.x)
via `PUT /active-response`.

> The SOAR backend talks only to the manager. The manager forwards the AR
> command to the agent. **These scripts run on the agent (the endpoint).**

---

## Script inventory

| Action       | Linux                       | Windows wrapper              | Windows logic              |
|--------------|-----------------------------|------------------------------|----------------------------|
| isolate-host | `soar-isolate-host.sh`      | `soar-isolate-host.cmd`      | `soar-isolate-host.ps1`    |
| kill-process | `soar-kill-process.sh`      | `soar-kill-process.cmd`      | `soar-kill-process.ps1`    |
| disable-user | `soar-disable-user.sh`      | `soar-disable-user.cmd`      | `soar-disable-user.ps1`    |
| delete-file  | `soar-delete-file.sh`       | `soar-delete-file.cmd`       | `soar-delete-file.ps1`     |

All scripts read the Wazuh AR JSON payload from `stdin` (v4.2+ calling
convention) and fall back to positional arguments for legacy agents. They log
to `/var/ossec/logs/active-responses.log` (Linux) or
`C:\Program Files (x86)\ossec-agent\active-response\active-responses.log`
(Windows) with the prefix `cybersentinel-soar-<action>:`.

---

## Manager IP — single source of truth

`soar-isolate-host.sh` / `.ps1` need the manager IP at runtime so they can
whitelist it before applying the network DROP rules. **The IP is configured
exactly once, in the manager's `ossec.conf`**, via the `<extra_args>` element
of the isolate-host `<command>` block. Wazuh propagates `extra_args` into the
AR JSON payload sent to the agent, where the script reads it from
`parameters.extra_args[0]`.

No agent-side env var, no per-host config file, no `WAZUH_MANAGER_IP` in the
agent's environment.

### Deploy-time substitution

The shipped `ossec.conf` contains the literal sentinel string
`MANAGER_IP_PLACEHOLDER` (chosen because angle-bracketed placeholders like
`<MANAGER_IP>` are not well-formed XML and break image-build-time parsers).
**The operator must substitute it with the real manager IP before isolation
will function.** The script's input validation will refuse to apply firewall
rules while the placeholder is in place — fail-safe by design.

Substitution methods (pick one):

```bash
# 1. Inside a running container — quickest:
docker exec cybersentinel-manager sed -i \
    's/MANAGER_IP_PLACEHOLDER/10.0.0.5/g' /var/ossec/etc/ossec.conf
docker exec cybersentinel-manager cybersentinel-control restart

# 2. Pre-image-rebuild — for permanent customer-specific images:
sed -i 's/MANAGER_IP_PLACEHOLDER/10.0.0.5/g' \
    cybersentinel-manager/config/ossec.conf
docker compose build && docker compose up -d
```

If the manager IP ever changes, repeat the substitution and restart the
manager.

---

## Active Response naming convention — paired commands

CyberSentinel uses Wazuh's idiomatic paired-command pattern (the same pattern
Wazuh ships for `route-null` / `win_route-null`):

| Action       | Linux command name      | Windows command name        |
|--------------|-------------------------|-----------------------------|
| isolate-host | `soar-isolate-host0`    | `win_soar-isolate-host0`    |
| kill-process | `soar-kill-process0`    | `win_soar-kill-process0`    |
| disable-user | `soar-disable-user0`    | `win_soar-disable-user0`    |
| delete-file  | `soar-delete-file0`     | `win_soar-delete-file0`     |

The trailing `0` follows Wazuh's custom-command convention (signals "no
built-in counterpart"). The `soar-` prefix puts SOAR-owned actions in their
own namespace alongside Wazuh's seven built-in commands.

The SOAR connector does an OS lookup (`GET /agents?agents_list=<id>&select=os.platform`)
before each dispatch and routes Linux agents to `soar-X0` and Windows agents
to `win_soar-X0`.

---

## Deployment

### 1. Place scripts on agents (or distribute via shared folder)

**Linux agents:**

```bash
sudo cp soar-isolate-host.sh soar-kill-process.sh soar-disable-user.sh soar-delete-file.sh \
    /var/ossec/active-response/bin/
sudo chown root:wazuh /var/ossec/active-response/bin/soar-*.sh
sudo chmod 750 /var/ossec/active-response/bin/soar-*.sh
```

**Windows agents:**

```
copy soar-isolate-host.cmd  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-isolate-host.ps1  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-kill-process.cmd  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-kill-process.ps1  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-disable-user.cmd  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-disable-user.ps1  "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-delete-file.cmd   "C:\Program Files (x86)\ossec-agent\active-response\bin\"
copy soar-delete-file.ps1   "C:\Program Files (x86)\ossec-agent\active-response\bin\"
```

For multi-agent fleets, use Wazuh's shared folder
(`/var/ossec/etc/shared/default/`) so the manager auto-pushes the scripts to
every agent.

### 2. Register commands on the manager

Edit `/var/ossec/etc/ossec.conf` on the manager. Replace `MANAGER_IP_PLACEHOLDER` with
the actual manager IP (or comma-separated list for HA).

```xml
<ossec_config>

  <!-- ============== Linux command definitions ============== -->

  <command>
    <name>soar-isolate-host0</name>
    <executable>soar-isolate-host.sh</executable>
    <extra_args>MANAGER_IP_PLACEHOLDER</extra_args>
    <timeout_allowed>yes</timeout_allowed>
  </command>

  <command>
    <name>soar-kill-process0</name>
    <executable>soar-kill-process.sh</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <command>
    <name>soar-disable-user0</name>
    <executable>soar-disable-user.sh</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <command>
    <name>soar-delete-file0</name>
    <executable>soar-delete-file.sh</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <!-- ============== Windows command definitions ============== -->

  <command>
    <name>win_soar-isolate-host0</name>
    <executable>soar-isolate-host.cmd</executable>
    <extra_args>MANAGER_IP_PLACEHOLDER</extra_args>
    <timeout_allowed>yes</timeout_allowed>
  </command>

  <command>
    <name>win_soar-kill-process0</name>
    <executable>soar-kill-process.cmd</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <command>
    <name>win_soar-disable-user0</name>
    <executable>soar-disable-user.cmd</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <command>
    <name>win_soar-delete-file0</name>
    <executable>soar-delete-file.cmd</executable>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <!-- ============== Active Response bindings ============== -->
  <!-- No <rules_id> => commands fire ONLY on manual SOAR dispatch -->

  <active-response>
    <command>soar-isolate-host0</command>
    <location>local</location>
    <timeout>0</timeout>
  </active-response>
  <active-response>
    <command>soar-kill-process0</command>
    <location>local</location>
  </active-response>
  <active-response>
    <command>soar-disable-user0</command>
    <location>local</location>
  </active-response>
  <active-response>
    <command>soar-delete-file0</command>
    <location>local</location>
  </active-response>

  <active-response>
    <command>win_soar-isolate-host0</command>
    <location>local</location>
    <timeout>0</timeout>
  </active-response>
  <active-response>
    <command>win_soar-kill-process0</command>
    <location>local</location>
  </active-response>
  <active-response>
    <command>win_soar-disable-user0</command>
    <location>local</location>
  </active-response>
  <active-response>
    <command>win_soar-delete-file0</command>
    <location>local</location>
  </active-response>

</ossec_config>
```

**Critical:** never add `<rules_id>` — these must fire ONLY on manual dispatch
from SOAR, never on rule matches.

### 3. Restart the manager

CyberSentinel runs as a Docker stack (rebranded Wazuh image). Use the branded
control wrapper inside the container:

```bash
docker exec cybersentinel-manager cybersentinel-control restart
```

(On a non-containerized Wazuh manager: `systemctl restart wazuh-manager`.)

### 4. Verify from the SOAR side

Build a test playbook with an action step that calls `cybersentinel_response`
with action `isolate_host`, `kill_process`, or `disable_user`. Run it in
**Simulation Mode** first — the connector will log `SIMULATION` lines without
calling the manager.

When ready, execute for real and watch:

- `/tmp/backend.log` — `[CyberSentinelResponse]` entries from SOAR
- `/var/ossec/logs/active-responses.log` on the target agent — the
  `cybersentinel-soar-*` lines from the scripts

---

## Safety features (built into every script)

- **Manager-reachability precheck** (`isolate-host` only) — if the manager is
  not reachable on TCP 1514/1515/55000 right now, the script refuses to apply
  isolation. Prevents bricking an agent when the manager is down.
- **Protected account / process blacklist** — `root`, `Administrator`,
  `init`, `systemd`, `lsass`, `wazuh-agent`, `cybersentinel-agent`, etc., are
  all refused.
- **Low-PID refusal** — Linux script refuses any PID < 100.
- **Idempotent** — repeat dispatches are no-ops, not corruptions:
  - `kill-process` on a dead PID → exit 0 with "already not running"
  - `disable-user` on an already-locked account → exit 0 with "already locked"
  - `isolate-host` tears down its own chain before recreating it
- **Strict mode** — Linux scripts use `set -eu`; PowerShell uses
  `$ErrorActionPreference = 'Stop'`. No silent error swallowing.

---

## Uninstalling

```bash
# Linux agents
sudo rm /var/ossec/active-response/bin/soar-*.sh
# Windows agents — delete soar-*.cmd and soar-*.ps1 from the bin\ folder.
# Manager: remove the <command>/<active-response> blocks from ossec.conf
docker exec cybersentinel-manager cybersentinel-control restart
```
