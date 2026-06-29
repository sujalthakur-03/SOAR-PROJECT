@echo off
REM =============================================================================
REM CyberSentinel SOAR - Active Response: soar-delete-file (Windows wrapper)
REM =============================================================================
setlocal
set "PS_SCRIPT=%~dp0soar-delete-file.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
exit /b %ERRORLEVEL%
