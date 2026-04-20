# CyberSentinel SOAR — Wazuh Active Response Scripts

This directory contains the reference Active Response (AR) scripts that the
CyberSentinel SOAR `cybersentinel_response` connector dispatches to agents
via the Wazuh manager API (`PUT /active-response`).

> These scripts run on the **endpoints** (Wazuh agents). The SOAR backend
> talks only to the Wazuh **manager** — it never connects to agents directly.

## Scripts

| Script              | Purpose                                     | Platform       |
|---------------------|---------------------------------------------|----------------|
| `isolate-host.sh`   | Network isolation via `iptables` DROP rules | Linux          |
| `kill-process.sh`   | Kill a process by PID or name               | Linux          |
| `disable-user.sh`   | Lock a local user account (`usermod -L`)    | Linux          |
| `disable-user.cmd`  | Lock a local user account (`net user`)      | Windows        |

Each script reads the Wazuh AR JSON payload from `stdin` (v4.2+ calling
convention) and falls back to positional arguments for older agents. They log
to `/var/ossec/logs/active-responses.log`.

## Deployment

### 1. Copy scripts to each agent

On **Linux** agents:

```bash
sudo cp isolate-host.sh kill-process.sh disable-user.sh \
    /var/ossec/active-response/bin/
sudo chown root:wazuh /var/ossec/active-response/bin/*.sh
sudo chmod 750 /var/ossec/active-response/bin/*.sh
```

On **Windows** agents:

```
copy disable-user.cmd "C:\Program Files (x86)\ossec-agent\active-response\bin\"
```

For `isolate-host.sh`, set the Wazuh manager IP as an env var in
`/var/ossec/etc/ossec.conf` or pass it as a positional argument from the AR
command definition:

```bash
# Example systemd drop-in
Environment=WAZUH_MANAGER_IP=10.0.0.5
```

### 2. Register the AR commands on the Wazuh manager

Edit `/var/ossec/etc/ossec.conf` on the **manager** and add the `<command>`
blocks. The custom AR command name convention used by this SOAR is
`<name>0` (e.g., `isolate-host0`) — the trailing `0` tells Wazuh this is a
custom command without a built-in counterpart.

```xml
<ossec_config>

  <!-- ===== Command definitions ===== -->

  <command>
    <name>isolate-host0</name>
    <executable>isolate-host.sh</executable>
    <timeout_allowed>yes</timeout_allowed>
  </command>

  <command>
    <name>kill-process0</name>
    <executable>kill-process.sh</executable>
    <extra_args>pid name</extra_args>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <command>
    <name>disable-user0</name>
    <executable>disable-user.sh</executable>
    <extra_args>username</extra_args>
    <timeout_allowed>no</timeout_allowed>
  </command>

  <!-- ===== Active response bindings (no rules_id => manual only) ===== -->

  <active-response>
    <command>isolate-host0</command>
    <location>local</location>
    <timeout>0</timeout>
  </active-response>

  <active-response>
    <command>kill-process0</command>
    <location>local</location>
  </active-response>

  <active-response>
    <command>disable-user0</command>
    <location>local</location>
  </active-response>

</ossec_config>
```

**Important:** leave `rules_id` unset so the commands never fire automatically
on rule matches — all executions must come from SOAR playbooks via the
manager API (`PUT /active-response`).

### 3. Restart the Wazuh manager

```bash
sudo systemctl restart wazuh-manager
```

### 4. Verify from the SOAR side

Use the Playbook Editor to build a test playbook with an action step that
calls `cybersentinel_response` with action `isolate_host`, `kill_process`,
or `disable_user`. Run it in **Simulation Mode** first — the SOAR connector
will log "SIMULATION" lines without actually calling the manager API.

When ready, execute for real. Watch:

- `/tmp/backend.log` for `[CyberSentinelResponse]` entries from the SOAR
- `/var/ossec/logs/active-responses.log` on the target agent for the
  `cybersentinel-*` entries from the scripts above

## Safety features

All scripts include a blacklist of protected system accounts / processes
(`init`, `systemd`, `sshd`, `root`, `Administrator`, etc.) and refuse to
act on them. They also refuse to kill PIDs below 100 on Linux.

## Uninstalling

```bash
# Linux
sudo rm /var/ossec/active-response/bin/isolate-host.sh \
        /var/ossec/active-response/bin/kill-process.sh \
        /var/ossec/active-response/bin/disable-user.sh
# Remove the <command>/<active-response> blocks from ossec.conf
sudo systemctl restart wazuh-manager
```
