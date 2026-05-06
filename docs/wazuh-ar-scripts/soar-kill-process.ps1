# =============================================================================
# CyberSentinel SOAR - Active Response: soar-kill-process (Windows)
# =============================================================================
# Terminates a process on the endpoint by PID or by name.
#
# Args (from SOAR API call -> parameters.extra_args):
#   extra_args[0] = "pid" | "name"
#   extra_args[1] = PID number OR process name (without .exe)
# =============================================================================

$ErrorActionPreference = 'Stop'
$LogFile = 'C:\Program Files (x86)\ossec-agent\active-response\active-responses.log'
$LogPrefix = 'cybersentinel-soar-kill-process'

function Log-Msg($msg) {
    $ts = Get-Date -Format 'yyyy/MM/dd HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $LogPrefix`: $msg" } catch {}
}

$Blacklist = @(
    'System','Idle','smss','csrss','wininit','services','lsass','svchost',
    'winlogon','dwm','LogonUI','wazuh-agent','cybersentinel-agent','ossec-agent'
)

$inputJson = [Console]::In.ReadToEnd()
try {
    $payload = $inputJson | ConvertFrom-Json
} catch {
    Log-Msg "ERROR: invalid JSON on stdin"
    exit 1
}

if ($payload.command -ne 'add') {
    Log-Msg "Ignoring command '$($payload.command)' (only 'add' supported)"
    exit 0
}

$extra = $payload.parameters.extra_args
if (-not $extra -or $extra.Count -lt 2) {
    Log-Msg "ERROR: extra_args must contain [mode, target]"
    exit 1
}
$mode   = $extra[0]
$target = $extra[1]

switch ($mode) {
    'pid' {
        if ($target -notmatch '^\d+$') {
            Log-Msg "ERROR: invalid PID '$target'"; exit 1
        }
        $pidInt = [int]$target
        if ($pidInt -lt 100) {
            Log-Msg "ERROR: refusing low PID $pidInt (likely system process)"; exit 1
        }

        $proc = Get-Process -Id $pidInt -ErrorAction SilentlyContinue
        if (-not $proc) {
            Log-Msg "PID $pidInt already not running (idempotent no-op)"; exit 0
        }

        if ($Blacklist -contains $proc.ProcessName) {
            Log-Msg "ERROR: refusing to kill protected process $($proc.ProcessName) (PID $pidInt)"
            exit 1
        }

        Log-Msg "Killing PID $pidInt ($($proc.ProcessName))"
        try {
            Stop-Process -Id $pidInt -Force -ErrorAction Stop
            Log-Msg "Killed PID $pidInt successfully"
        } catch {
            if (-not (Get-Process -Id $pidInt -ErrorAction SilentlyContinue)) {
                Log-Msg "PID $pidInt exited before kill (idempotent)"
            } else {
                Log-Msg "ERROR: Stop-Process failed: $($_.Exception.Message)"; exit 1
            }
        }
    }

    'name' {
        if ($Blacklist -contains $target) {
            Log-Msg "ERROR: refusing to kill protected process name '$target'"; exit 1
        }
        $procs = Get-Process -Name $target -ErrorAction SilentlyContinue
        if (-not $procs) {
            Log-Msg "No processes matching '$target' (idempotent no-op)"; exit 0
        }
        Log-Msg "Killing processes matching name '$target' (count=$($procs.Count))"
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Log-Msg "kill-process (name=$target) completed"
    }

    default {
        Log-Msg "ERROR: unknown mode '$mode' (expected 'pid' or 'name')"
        exit 1
    }
}

exit 0
