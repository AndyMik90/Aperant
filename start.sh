#!/bin/bash

# Jerry Startup (macOS)
# Equivalent of start.bat for Mac

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo -e "${GREEN}${BOLD}       JERRY STARTUP (macOS)${NC}"
echo -e "${GREEN}${BOLD} ============================================${NC}"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"

# Start Frontend (Electron) in a new Terminal window
echo -e "${CYAN} Starting Frontend (Electron)...${NC}"
osascript -e "
tell application \"Terminal\"
    activate
    do script \"cd '$(pwd)/apps/frontend' && echo '  Jerry Frontend Starting...' && npm run dev\"
end tell
" &>/dev/null

# Start Backend CLI in a new Terminal window with venv activated
echo -e "${CYAN} Starting Backend (Python CLI)...${NC}"
osascript -e "
tell application \"Terminal\"
    activate
    do script \"cd '$(pwd)/apps/backend' && if [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi && echo '' && echo '  Jerry Backend Ready' && echo '  =========================' && echo '' && echo '  Commands:' && echo '    python spec_runner.py --interactive' && echo '    python spec_runner.py --task \\\"Your task\\\"' && echo '    python run.py --spec XXX' && echo '    python run.py --list' && echo ''\"
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
