@echo off
title Claude Code
echo ============================================
echo        Claude Code Updater
echo ============================================
echo.

echo [1/3] Updating Claude Code...
"C:\Users\jamie.ballard\.local\bin\claude.exe" update

echo.
echo [2/3] Update complete.
echo.

cd /d C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

echo [3/3] Starting with --dangerously-skip-permissions...
echo Working directory: %CD%
echo.

"C:\Users\jamie.ballard\.local\bin\claude.exe" --dangerously-skip-permissions

pause
