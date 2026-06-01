# =============================================================================
# CyberSentinel SOAR - Active Response: soar-isolate-host (Windows)
# =============================================================================
# HARD-isolates the endpoint via Windows Firewall. After a successful ADD:
#   - Default inbound + outbound action: Block (all profiles)
#   - ALL pre-existing enabled firewall allow rules are temporarily disabled
#     (rule names snapshotted to a backup file for restore on release)
#   - The only enabled allow rules are CS-SOAR-Isolate-*:
#       * Outbound TCP to manager on ports 1514/1515/55000 (AR/heartbeat)
#       * Inbound from manager (any port — for forensic tooling)
#       * Loopback (local services)
#
# Why disable existing rules: Windows Firewall evaluates ALLOW rules even
# when DefaultAction=Block. Pre-existing app rules (RDP, Chrome, IT-installed
# allows) would keep traffic flowing. The snapshot-and-disable approach is
# the only way to get true allowlist semantics on Windows Firewall.
#
# Manager IP comes from the AR JSON payload's parameters.extra_args[0].
# Delete-sentinel: parameters.extra_args[1] == "delete" routes to release.
#
# Snapshot file:
#   C:\Program Files (x86)\ossec-agent\active-response\soar-isolate-rules-backup.txt
#   One rule name per line. Created on isolate ADD, consumed and deleted on DELETE.
#
# Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\
#            soar-isolate-host.ps1   (invoked via soar-isolate-host.cmd)
# =============================================================================

$ErrorActionPreference = 'Stop'
$LogFile      = 'C:\Program Files (x86)\ossec-agent\active-response\active-responses.log'
$SnapshotFile = 'C:\Program Files (x86)\ossec-agent\active-response\soar-isolate-rules-backup.txt'
$LogPrefix    = 'cybersentinel-soar-isolate-host'
$RulePrefix   = 'CS-SOAR-Isolate-'

function Log-Msg($msg) {
    $ts = Get-Date -Format 'yyyy/MM/dd HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $LogPrefix`: $msg" } catch {}
}

# ---- Read Wazuh AR JSON from stdin with timeout -----------------------------
# wazuh-execd on some agent versions leaves its pipe write-end open. Use a
# 3-second timer + StandardInput.Peek style guard.
$inputJson = ''
try {
    $reader = [Console]::In
    $deadline = (Get-Date).AddSeconds(3)
    while ((Get-Date) -lt $deadline) {
        if ($reader.Peek() -ne -1) {
            $inputJson = $reader.ReadToEnd()
            break
        }
        Start-Sleep -Milliseconds 50
    }
} catch {}

if (-not $inputJson) {
    Log-Msg "ERROR: empty stdin (no JSON payload from wazuh-execd)"
    exit 1
}

try {
    $payload = $inputJson | ConvertFrom-Json
} catch {
    Log-Msg "ERROR: invalid JSON on stdin"
    exit 1
}

$command   = $payload.command
$extraArgs = $payload.parameters.extra_args

if (-not $extraArgs -or $extraArgs.Count -lt 1) {
    Log-Msg "ERROR: parameters.extra_args[0] missing (manager IP)"
    exit 1
}
$ManagerIP = $extraArgs[0]

# Delete-sentinel override: SOAR connector sends [managerIp, "delete"] for release
if ($extraArgs.Count -ge 2 -and $extraArgs[1] -eq 'delete') {
    $command = 'delete'
}

# Strict IPv4 validation
if ($ManagerIP -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
    Log-Msg "ERROR: invalid manager IP '$ManagerIP' (not dotted-quad)"
    exit 1
}
$octets = $ManagerIP -split '\.'
foreach ($o in $octets) {
    if ([int]$o -gt 255) {
        Log-Msg "ERROR: invalid manager IP '$ManagerIP' (octet $o > 255)"
        exit 1
    }
}

# ---- Pre-flight: manager reachability ---------------------------------------
function Test-ManagerReachable($ip) {
    foreach ($port in 1514, 1515, 55000) {
        try {
            $tcp = New-Object Net.Sockets.TcpClient
            $task = $tcp.ConnectAsync($ip, $port)
            if ($task.Wait(2000) -and $tcp.Connected) {
                $tcp.Close()
                return $true
            }
            $tcp.Close()
        } catch {}
    }
    return $false
}

# ---- Snapshot helpers -------------------------------------------------------
function Snapshot-And-Disable-Existing-Rules {
    # Idempotent: if a snapshot file already exists from a prior un-released
    # isolation, leave it alone — restoring twice would re-disable nothing.
    if (Test-Path $SnapshotFile) {
        Log-Msg "WARN: snapshot file already exists at $SnapshotFile — leaving prior snapshot intact"
        return
    }

    # Capture all currently-enabled rules EXCEPT our own SOAR rules
    $rules = Get-NetFirewallRule -Enabled True -ErrorAction SilentlyContinue |
             Where-Object { $_.DisplayName -notlike "$RulePrefix*" }

    $count = ($rules | Measure-Object).Count
    if ($count -eq 0) {
        Log-Msg "No pre-existing enabled rules to snapshot (default-block-only isolation)"
        # Touch the snapshot so we know we ran
        Set-Content -Path $SnapshotFile -Value ''
        return
    }

    # Save names (one per line) for restore
    $names = $rules | Select-Object -ExpandProperty Name
    Set-Content -Path $SnapshotFile -Value $names

    # Disable them all
    $disabled = 0
    foreach ($name in $names) {
        try {
            Disable-NetFirewallRule -Name $name -ErrorAction Stop
            $disabled++
        } catch {
            Log-Msg "WARN: could not disable rule '$name': $($_.Exception.Message)"
        }
    }
    Log-Msg "Snapshotted + disabled $disabled pre-existing firewall allow rule(s); names saved to $SnapshotFile"
}

function Restore-Snapshotted-Rules {
    if (-not (Test-Path $SnapshotFile)) {
        Log-Msg "No snapshot file to restore (release with no prior isolate?)"
        return
    }
    $names = Get-Content -Path $SnapshotFile -ErrorAction SilentlyContinue | Where-Object { $_ -ne '' }
    $enabled = 0
    foreach ($name in $names) {
        try {
            Enable-NetFirewallRule -Name $name -ErrorAction Stop
            $enabled++
        } catch {
            Log-Msg "WARN: could not re-enable rule '$name' (may have been deleted while isolated): $($_.Exception.Message)"
        }
    }
    Remove-Item -Path $SnapshotFile -ErrorAction SilentlyContinue
    Log-Msg "Restored $enabled snapshotted rule(s); snapshot file removed"
}

switch ($command) {
    'add' {
        if (-not (Test-ManagerReachable $ManagerIP)) {
            Log-Msg "ERROR: manager $ManagerIP unreachable on 1514/1515/55000 — refusing to isolate (would orphan agent)"
            exit 1
        }
        Log-Msg "Pre-flight passed: manager $ManagerIP reachable"

        # ---- Step 1: idempotent teardown of any prior CS rules -------------
        Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue

        # ---- Step 2: snapshot + disable everything else (the LEAK FIX) -----
        Snapshot-And-Disable-Existing-Rules

        # ---- Step 3: add our 3 allow rules ---------------------------------
        # Manager outbound — only AR/heartbeat ports
        New-NetFirewallRule -DisplayName "${RulePrefix}AllowManagerOut" `
            -Direction Outbound -Action Allow -Protocol TCP `
            -RemoteAddress $ManagerIP -RemotePort 1514,1515,55000 `
            -Profile Domain,Public,Private | Out-Null

        # Manager inbound — any port (forensic tooling)
        New-NetFirewallRule -DisplayName "${RulePrefix}AllowManagerIn" `
            -Direction Inbound -Action Allow -Protocol TCP `
            -RemoteAddress $ManagerIP `
            -Profile Domain,Public,Private | Out-Null

        # Loopback — local services rely on it
        New-NetFirewallRule -DisplayName "${RulePrefix}AllowLoopbackOut" `
            -Direction Outbound -Action Allow -RemoteAddress 127.0.0.1 `
            -Profile Domain,Public,Private | Out-Null

        # ---- Step 4: flip defaults to Block on all profiles ----------------
        Set-NetFirewallProfile -Profile Domain,Public,Private `
            -DefaultOutboundAction Block -DefaultInboundAction Block -Enabled True

        Log-Msg "Isolation applied (manager=$ManagerIP whitelisted; all other rules disabled; default action=Block)"
    }

    'delete' {
        # Remove our CS rules
        Get-NetFirewallRule -DisplayName "$RulePrefix*" -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue

        # Restore defaults
        Set-NetFirewallProfile -Profile Domain,Public,Private `
            -DefaultOutboundAction Allow -DefaultInboundAction Allow

        # Re-enable snapshotted rules
        Restore-Snapshotted-Rules

        Log-Msg "Isolation removed (default action=Allow; pre-existing rules restored)"
    }

    default {
        Log-Msg "ERROR: unknown command '$command' (expected 'add' or 'delete')"
        exit 1
    }
}

exit 0
