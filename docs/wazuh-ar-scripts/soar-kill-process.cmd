@echo off
REM =============================================================================
REM CyberSentinel SOAR - Active Response: soar-kill-process (Windows wrapper)
REM =============================================================================
setlocal
set "PS_SCRIPT=%~dp0soar-kill-process.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
exit /b %ERRORLEVEL%
