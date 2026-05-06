@echo off
REM =============================================================================
REM CyberSentinel SOAR - Active Response: soar-isolate-host (Windows wrapper)
REM =============================================================================
REM Wraps soar-isolate-host.ps1 so wazuh-execd can invoke a .cmd entry point.
REM stdin (Wazuh AR JSON) is forwarded to PowerShell.
REM
REM Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\
REM   soar-isolate-host.cmd     <-- this file
REM   soar-isolate-host.ps1     <-- the actual logic
REM =============================================================================

setlocal
set "PS_SCRIPT=%~dp0soar-isolate-host.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
exit /b %ERRORLEVEL%
