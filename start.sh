#!/bin/bash

# Jerry Startup (macOS)
# Kills previous processes, rebuilds, and launches fresh

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo -e "${GREEN}${BOLD}       JERRY STARTUP (macOS)${NC}"
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"

# ── Step 1: Kill previous processes ──────────────────────────────
echo -e "${YELLOW} Cleaning up previous processes...${NC}"

# Kill any running Electron instances for ac.jerry
ELECTRON_PIDS=$(pgrep -f "ac.jerry.*[Ee]lectron|electron.*ac.jerry" 2>/dev/null)
if [ -n "$ELECTRON_PIDS" ]; then
    echo "$ELECTRON_PIDS" | xargs kill 2>/dev/null
    echo -e "  Killed Electron processes"
    sleep 1
fi

# Kill any insights runner or Claude SDK processes spawned by Jerry
INSIGHTS_PIDS=$(pgrep -f "insights_runner|ac.jerry.*claude_agent_sdk|ac.jerry.*bundled.*claude" 2>/dev/null)
if [ -n "$INSIGHTS_PIDS" ]; then
    echo "$INSIGHTS_PIDS" | xargs kill 2>/dev/null
    echo -e "  Killed insights/Claude SDK processes"
    sleep 1
fi

# Kill any roadmap/companion runners
RUNNER_PIDS=$(pgrep -f "ac.jerry.*runner" 2>/dev/null)
if [ -n "$RUNNER_PIDS" ]; then
    echo "$RUNNER_PIDS" | xargs kill 2>/dev/null
    echo -e "  Killed background runners"
    sleep 1
fi

# Force-kill any survivors
REMAINING=$(pgrep -f "ac.jerry.*[Ee]lectron" 2>/dev/null)
if [ -n "$REMAINING" ]; then
    echo "$REMAINING" | xargs kill -9 2>/dev/null
    echo -e "  Force-killed remaining processes"
    sleep 1
fi

echo -e "${GREEN} Cleanup complete.${NC}"
echo ""

# ── Step 2: Build Frontend ───────────────────────────────────────
echo -e "${CYAN} Building Frontend...${NC}"
cd apps/frontend && npm run build
BUILD_EXIT=$?
cd "$ROOT_DIR"

if [ $BUILD_EXIT -ne 0 ]; then
    echo -e "${RED}${BOLD} Build failed! Fix errors above before launching.${NC}"
    exit 1
fi
echo -e "${GREEN} Build complete.${NC}"
echo ""

# ── Step 3: Launch ───────────────────────────────────────────────
echo -e "${CYAN} Starting Frontend (Electron)...${NC}"
osascript -e "
tell application \"Terminal\"
    activate
    do script \"cd '${ROOT_DIR}/apps/frontend' && echo '  Jerry Frontend Starting...' && npm run start\"
end tell
" &>/dev/null

echo -e "${CYAN} Starting Backend (Python CLI)...${NC}"
osascript -e "
tell application \"Terminal\"
    activate
    do script \"cd '${ROOT_DIR}/apps/backend' && if [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi && echo '' && echo '  Jerry Backend Ready' && echo '  =========================' && echo '' && echo '  Commands:' && echo '    python spec_runner.py --interactive' && echo '    python spec_runner.py --task \\\"Your task\\\"' && echo '    python run.py --spec XXX' && echo '    python run.py --list' && echo ''\"
end tell
" &>/dev/null

echo ""
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo -e "${GREEN}${BOLD}       STARTUP COMPLETE${NC}"
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo ""
echo -e "  Frontend: ${CYAN}Running in separate Terminal window${NC}"
echo -e "  Backend:  ${CYAN}Ready in separate Terminal window${NC}"
echo ""
