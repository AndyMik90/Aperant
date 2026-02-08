#!/bin/bash

echo "============================================"
echo "       Claude Code Updater"
echo "============================================"
echo

CLAUDE="$HOME/.local/bin/claude"

echo "[1/3] Updating Claude Code..."
"$CLAUDE" update

echo
echo "[2/3] Update complete."
echo

cd ~/Documents/GitHub/ac.jerry || exit 1

echo "[3/3] Starting with --dangerously-skip-permissions..."
echo "Working directory: $(pwd)"
echo

"$CLAUDE" --dangerously-skip-permissions

read -rp "Press Enter to continue..."
