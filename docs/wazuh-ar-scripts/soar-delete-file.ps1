# =============================================================================
# CyberSentinel SOAR - Active Response: soar-delete-file (Windows)
# =============================================================================
# Permanently removes a file on the endpoint with Remove-Item -Force. Used for
# malware remediation / suspicious-file cleanup.
#
# !!! NO PATH SAFETY LIST !!!
# Per the 2026 design decision, this script applies NO refusal list — it will
# delete WHATEVER path is provided. The SOC analyst is responsible for the
# file path. A typo can delete arbitrary system files.
#
# Args (from SOAR API call -> parameters.extra_args):
#   extra_args[0] = absolute file path to delete
#
# Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\
#            soar-delete-file.ps1 (invoked via soar-delete-file.cmd)
# =============================================================================

$ErrorActionPreference = 'Stop'
$LogFile   = 'C:\Program Files (x86)\ossec-agent\active-response\active-responses.log'
$LogPrefix = 'cybersentinel-soar-delete-file'

function Log-Msg($msg) {
    $ts = Get-Date -Format 'yyyy/MM/dd HH:mm:ss'
    try { Add-Content -Path $LogFile -Value "$ts $LogPrefix`: $msg" } catch {}
}

# Timed stdin read (wazuh-execd may leave its pipe write-end open)
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

# Only handle add; ignore delete (no auto-undo for a file delete)
if ($payload.command -ne 'add') {
    Log-Msg "Ignoring command '$($payload.command)' (only 'add' supported)"
    exit 0
}

$extra = $payload.parameters.extra_args
if (-not $extra -or $extra.Count -lt 1) {
    Log-Msg "ERROR: parameters.extra_args[0] missing (expected absolute file path)"
    exit 1
}
$FilePath = $extra[0]

# Path-shape sanity: must be a fully-qualified Windows path (drive letter +
# colon + backslash, OR UNC \\server\share path). No relative paths.
if ($FilePath -notmatch '^([A-Za-z]:\\|\\\\)') {
    Log-Msg "ERROR: file path must be absolute (got '$FilePath')"
    exit 1
}

# Idempotent: gone is success
if (-not (Test-Path -LiteralPath $FilePath)) {
    Log-Msg "File '$FilePath' does not exist (idempotent no-op)"
    exit 0
}

# Refuse directories — this script handles single files only
$item = Get-Item -LiteralPath $FilePath -Force -ErrorAction SilentlyContinue
if ($item -and $item.PSIsContainer) {
    Log-Msg "ERROR: '$FilePath' is a directory; this script handles individual files only. Use a dedicated cleanup action for directory trees."
    exit 1
}

$sizeHint = ''
if ($item -and -not $item.PSIsContainer) {
    $sizeHint = " ($($item.Length) bytes)"
}

Log-Msg "Deleting file${sizeHint}: $FilePath"
try {
    Remove-Item -LiteralPath $FilePath -Force -ErrorAction Stop
    Log-Msg "Deleted successfully: $FilePath"
} catch {
    Log-Msg "ERROR: Remove-Item failed for $FilePath`: $($_.Exception.Message)"
    exit 1
}

exit 0
