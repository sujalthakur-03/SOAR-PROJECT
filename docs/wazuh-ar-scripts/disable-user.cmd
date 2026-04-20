@echo off
REM =============================================================================
REM CyberSentinel SOAR - Active Response: disable-user (Windows)
REM =============================================================================
REM Locks a local user account on a Windows endpoint.
REM
REM Deploy to: C:\Program Files (x86)\ossec-agent\active-response\bin\disable-user.cmd
REM =============================================================================

setlocal EnableDelayedExpansion

set "LOG_FILE=C:\Program Files (x86)\ossec-agent\active-response\active-responses.log"
set "USERNAME=%~1"

if "%USERNAME%"=="" (
    echo %DATE% %TIME% cybersentinel-disable-user: ERROR no username provided >> "%LOG_FILE%"
    exit /b 1
)

REM Protected accounts - never touch
for %%A in (Administrator Guest DefaultAccount WDAGUtilityAccount) do (
    if /I "%USERNAME%"=="%%A" (
        echo %DATE% %TIME% cybersentinel-disable-user: ERROR refusing to disable protected account %USERNAME% >> "%LOG_FILE%"
        exit /b 1
    )
)

echo %DATE% %TIME% cybersentinel-disable-user: locking account %USERNAME% >> "%LOG_FILE%"
net user "%USERNAME%" /active:no
if errorlevel 1 (
    echo %DATE% %TIME% cybersentinel-disable-user: ERROR net user failed >> "%LOG_FILE%"
    exit /b 1
)

echo %DATE% %TIME% cybersentinel-disable-user: account %USERNAME% locked successfully >> "%LOG_FILE%"
exit /b 0
