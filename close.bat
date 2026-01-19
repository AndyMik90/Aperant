@echo off
setlocal enabledelayedexpansion
title Auto-Claude Shutdown
color 0C

echo.
echo  ============================================
echo       AUTO-CLAUDE SHUTDOWN
echo  ============================================
echo.

:: Kill Electron processes
echo  Closing Electron processes...
taskkill /F /IM "electron.exe" 2>nul
if %errorlevel%==0 (
    echo    Electron closed.
) else (
    echo    No Electron processes found.
)

:: Kill node processes related to Auto-Claude (electron-vite dev server)
echo  Closing Node.js dev server...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq Auto-Claude*" /NH 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)

:: Kill any cmd windows with Auto-Claude title
echo  Closing Auto-Claude command windows...
taskkill /F /FI "WINDOWTITLE eq Auto-Claude*" 2>nul

echo.
echo  ============================================
echo       SHUTDOWN COMPLETE
echo  ============================================
echo.
echo  Press any key to exit...
pause >nul
