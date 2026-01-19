@echo off
setlocal enabledelayedexpansion
title Auto-Claude Startup
color 0A

echo.
echo  ============================================
echo       AUTO-CLAUDE STARTUP
echo  ============================================
echo.

cd /d "%~dp0"

:: Start Frontend (Electron) in a new window
echo  Starting Frontend (Electron)...
start "Auto-Claude Frontend" cmd /k "cd /d "%~dp0apps\frontend" && npm run dev"

:: Start Backend CLI window with venv activated
echo  Starting Backend (Python CLI)...
start "Auto-Claude Backend" cmd /k "cd /d "%~dp0apps\backend" && if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat) && echo. && echo  Auto-Claude Backend Ready && echo  ========================= && echo. && echo  Commands: && echo    python spec_runner.py --interactive && echo    python spec_runner.py --task "Your task" && echo    python run.py --spec XXX && echo    python run.py --list && echo."

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
