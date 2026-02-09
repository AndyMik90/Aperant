@echo off
setlocal enabledelayedexpansion
title AC Jerry Startup
color 0A

echo.
echo  ============================================
echo       AC JERRY STARTUP
echo  ============================================
echo.

cd /d "%~dp0"

:: Kill existing Jerry processes for a clean restart
echo  Stopping existing processes...
taskkill /FI "WINDOWTITLE eq Jerry Frontend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Jerry Backend*" /F >nul 2>&1
:: Kill any stale electron/node dev servers from previous runs
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo  Done.
echo.

:: Start Frontend (Electron) in a new window
echo  Starting Frontend (Electron)...
start "Jerry Frontend" cmd /k "cd /d "%~dp0apps\frontend" && npm run dev"

:: Start Backend CLI window with venv activated
echo  Starting Backend (Python CLI)...
start "Jerry Backend" cmd /k "cd /d "%~dp0apps\backend" && if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat) && echo. && echo  AC Jerry Backend Ready && echo  ========================= && echo. && echo  Commands: && echo    python spec_runner.py --interactive && echo    python spec_runner.py --task "Your task" && echo    python run.py --spec XXX && echo    python run.py --list && echo."

echo.
echo  ============================================
echo       STARTUP COMPLETE
echo  ============================================
echo.
echo  Frontend: Running in separate window
echo  Backend:  Ready in separate window
echo.
echo  Press any key to close this window...
pause >nul
