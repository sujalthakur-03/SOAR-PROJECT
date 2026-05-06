# =============================================================================
# CyberSentinel SOAR - Active Response: soar-isolate-host (Windows)
# =============================================================================
# Cuts the endpoint off from the network using Windows Firewall while keeping
# the CyberSentinel manager reachable so the un-isolate command can return.
#
# Manager IP comes from the AR JSON payload (parameters.extra_args[0]),
# which is bundled in by Wazuh from the manager's ossec.conf <extra_args>.
#
# Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\
#            soar-isolate-host.ps1   (invoked via soar-isolate-host.cmd)
# =============================================================================

$ErrorActionPreference = 'Stop'
$LogFile = 'C:\Program Files (x86)\ossec-agent\active-response\active-responses.log'
$LogPrefix = 'cybersentinel-soar-isolate-host'

function Log-Msg($msg) {
    $ts = Get-Date -Format 'yyyy/MM/dd HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $LogPrefix`: $msg" } catch {}
}

# ---- Read Wazuh AR JSON from stdin ------------------------------------------
$inputJson = [Console]::In.ReadToEnd()
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

if ($ManagerIP -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    Log-Msg "ERROR: invalid manager IP '$ManagerIP'"
    exit 1
}

# ---- Pre-flight: confirm manager is reachable BEFORE blocking the network --
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

switch ($command) {
    'add' {
        if (-not (Test-ManagerReachable $ManagerIP)) {
            Log-Msg "ERROR: manager $ManagerIP unreachable on 1514/1515/55000 - refusing to isolate (would orphan agent)"
            exit 1
        }
        Log-Msg "Pre-flight passed: manager $ManagerIP reachable"

        # ---- Idempotent teardown of any prior CS rules ---------------------
        Get-NetFirewallRule -DisplayName 'CS-SOAR-Isolate-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

        # ---- Allow rules MUST be created before flipping default to Block --
        New-NetFirewallRule -DisplayName 'CS-SOAR-Isolate-AllowManagerOut' `
            -Direction Outbound -Action Allow -Protocol TCP `
            -RemoteAddress $ManagerIP -RemotePort 1514,1515,55000 | Out-Null
        New-NetFirewallRule -DisplayName 'CS-SOAR-Isolate-AllowManagerIn' `
            -Direction Inbound -Action Allow -Protocol TCP `
            -RemoteAddress $ManagerIP | Out-Null
        New-NetFirewallRule -DisplayName 'CS-SOAR-Isolate-AllowLoopback' `
            -Direction Outbound -Action Allow -RemoteAddress 127.0.0.1 | Out-Null

        # ---- Flip default policy on every profile to Block -----------------
        Set-NetFirewallProfile -Profile Domain,Public,Private `
            -DefaultOutboundAction Block -DefaultInboundAction Block -Enabled True

        Log-Msg "Isolation applied (manager=$ManagerIP whitelisted)"
    }

    'delete' {
        Get-NetFirewallRule -DisplayName 'CS-SOAR-Isolate-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
        Set-NetFirewallProfile -Profile Domain,Public,Private `
            -DefaultOutboundAction Allow -DefaultInboundAction Allow
        Log-Msg "Isolation removed"
    }

    default {
        Log-Msg "ERROR: unknown command '$command' (expected 'add' or 'delete')"
        exit 1
    }
}

exit 0
