@echo off
REM =============================================================================
REM CyberSentinel SOAR - Active Response: soar-disable-user (Windows)
REM =============================================================================
REM Locks a local user account via `net user <name> /active:no`.
REM
REM Args (from SOAR API call -> parameters.extra_args):
REM   extra_args[0] = username to lock/unlock
REM
REM Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\soar-disable-user.cmd
REM
REM Reads JSON from stdin (Wazuh AR v4.2+) and falls back to %~1 for legacy.
REM Delegates to PowerShell for JSON parsing.
REM =============================================================================

setlocal
set "PS_SCRIPT=%~dp0soar-disable-user.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
exit /b %ERRORLEVEL%
