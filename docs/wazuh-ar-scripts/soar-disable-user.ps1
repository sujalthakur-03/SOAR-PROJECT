# =============================================================================
# CyberSentinel SOAR - Active Response: soar-disable-user (Windows)
# =============================================================================
# Locks/unlocks a local user account via `net user`.
#
# Args (from SOAR API call -> parameters.extra_args):
#   extra_args[0] = username
# =============================================================================

$ErrorActionPreference = 'Stop'
$LogFile = 'C:\Program Files (x86)\ossec-agent\active-response\active-responses.log'
$LogPrefix = 'cybersentinel-soar-disable-user'

function Log-Msg($msg) {
    $ts = Get-Date -Format 'yyyy/MM/dd HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $LogPrefix`: $msg" } catch {}
}

$Protected = @('Administrator','Guest','DefaultAccount','WDAGUtilityAccount','SYSTEM','LocalService','NetworkService')

$inputJson = [Console]::In.ReadToEnd()
$payload = $null
$command = $null
$username = $null

if ($inputJson -and $inputJson.Trim().Length -gt 0) {
    try { $payload = $inputJson | ConvertFrom-Json } catch {}
}

if ($payload) {
    $command = $payload.command
    if ($payload.parameters.extra_args -and $payload.parameters.extra_args.Count -ge 1) {
        $username = $payload.parameters.extra_args[0]
    }
}

# Legacy fallback: positional argv
if (-not $username -and $args.Count -ge 1) { $username = $args[0] }
if (-not $command) { $command = 'add' }

if (-not $username) {
    Log-Msg "ERROR: no username provided"
    exit 1
}

foreach ($bad in $Protected) {
    if ($username -ieq $bad) {
        Log-Msg "ERROR: refusing to touch protected account '$username'"
        exit 1
    }
}

# Verify account exists
$exists = $false
try {
    $null = net user $username 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $exists = $true }
} catch {}
if (-not $exists) {
    Log-Msg "ERROR: user '$username' does not exist"
    exit 1
}

switch ($command) {
    'add' {
        Log-Msg "Locking account '$username'"
        $output = net user $username /active:no 2>&1
        if ($LASTEXITCODE -ne 0) {
            Log-Msg "ERROR: net user /active:no failed: $output"
            exit 1
        }
        Log-Msg "Account '$username' locked successfully"
    }
    'delete' {
        Log-Msg "Unlocking account '$username'"
        $output = net user $username /active:yes 2>&1
        if ($LASTEXITCODE -ne 0) {
            Log-Msg "ERROR: net user /active:yes failed: $output"
            exit 1
        }
        Log-Msg "Account '$username' unlocked successfully"
    }
    default {
        Log-Msg "ERROR: unknown command '$command'"
        exit 1
    }
}

exit 0
