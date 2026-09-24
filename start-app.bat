@echo off
setlocal

set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found in C:\Program Files\nodejs.
    echo Please install Node.js from https://nodejs.org and try again.
    pause
    exit /b 1
)

set "PREFERRED_PORT=3002"
for %%P in (3002 3003 3004 3005 3006 3010) do (
    for /f "tokens=5" %%K in ('netstat -ano ^| findstr /R /C:" :%%P " 2^>nul') do (
        if not "%%K"=="" (
            echo Closing stale process using port %%P (PID %%K)
            taskkill /F /PID %%K >nul 2>&1
        )
    )
)

set "PORT=%PREFERRED_PORT%"

echo Starting Chess app on http://localhost:%PORT%...
start "" http://localhost:%PORT%
set PORT=%PORT%
npm start

if errorlevel 1 (
    echo.
    echo Failed to start the app.
    pause
)
