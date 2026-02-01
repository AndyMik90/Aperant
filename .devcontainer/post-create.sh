#!/bin/bash
set -e

echo "🚀 Setting up Auto Claude development environment..."

# Track installation failures
CLAUDE_CLI_FAILED=false

# Install UV (Python package manager) if not installed
if ! command -v uv &> /dev/null; then
    echo "📦 Installing UV package manager..."
    
    UV_INSTALLER_URL="https://astral.sh/uv/install.sh"
    UV_INSTALLER_SCRIPT="$(mktemp)"

    # NOTE: This downloads and runs an official installer from astral.sh.
    # If you need stronger guarantees, set UV_INSTALLER_SHA256 to the expected
    # SHA-256 checksum of the installer to enable integrity verification.
    if ! curl -LsSf "$UV_INSTALLER_URL" -o "$UV_INSTALLER_SCRIPT"; then
        echo "❌ Failed to download UV installer from $UV_INSTALLER_URL"
        rm -f "$UV_INSTALLER_SCRIPT"
        exit 1
    fi

    if [ -n "${UV_INSTALLER_SHA256:-}" ]; then
        echo "🔐 Verifying UV installer integrity..."
        DOWNLOADED_SHA256="$(sha256sum "$UV_INSTALLER_SCRIPT" | awk '{print $1}')"
        if [ "$DOWNLOADED_SHA256" != "$UV_INSTALLER_SHA256" ]; then
            echo "❌ UV installer checksum mismatch!"
            echo "Expected: $UV_INSTALLER_SHA256"
            echo "Got:      $DOWNLOADED_SHA256"
            rm -f "$UV_INSTALLER_SCRIPT"
            exit 1
        fi
    fi

    sh "$UV_INSTALLER_SCRIPT"
    rm -f "$UV_INSTALLER_SCRIPT"

    # Ensure uv (installed in ~/.cargo/bin by default) is on PATH for this script.
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Install Claude CLI globally
echo "🤖 Installing Claude CLI..."
if ! npm install -g @anthropic-ai/claude-code; then
    echo "⚠️  Claude CLI installation failed (may require authentication)"
    CLAUDE_CLI_FAILED=true
fi

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo "🐍 Installing backend dependencies..."
cd apps/backend
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    uv venv
fi
echo "Installing Python packages..."
uv pip install -r requirements.txt

# Install test dependencies if available
if [ -f "../../tests/requirements-test.txt" ]; then
    echo "Installing test dependencies..."
    uv pip install -r ../../tests/requirements-test.txt
fi

cd ../..

# Install frontend dependencies
echo "⚛️  Installing frontend dependencies..."
cd apps/frontend
npm install
cd ../..

# Set up git hooks
echo "🔧 Setting up git hooks..."
if [ -d ".husky" ]; then
    if npm run | grep -q "^  prepare"; then
        npm run prepare || echo "⚠️  Husky setup failed"
    else
        echo "⚠️  Husky setup skipped (no npm 'prepare' script defined)"
    fi
fi

# Create .env files from examples if they don't exist
echo "📝 Checking environment files..."
if [ -f "apps/backend/.env.example" ] && [ ! -f "apps/backend/.env" ]; then
    echo "Creating apps/backend/.env from .env.example..."
    cp apps/backend/.env.example apps/backend/.env
    echo "⚠️  Please configure your .env file with API keys"
fi

if [ -f "apps/frontend/.env.example" ] && [ ! -f "apps/frontend/.env" ]; then
    echo "Creating apps/frontend/.env from .env.example..."
    cp apps/frontend/.env.example apps/frontend/.env
fi

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "📚 Quick Start Commands:"
echo "  npm run dev              - Start frontend development server"
echo "  npm run test             - Run frontend tests"
echo "  npm run test:backend     - Run backend tests"
echo "  npm run lint             - Lint frontend code"
echo "  cd apps/backend && .venv/bin/python run.py          - Backend CLI"
echo ""
echo "🔐 Authentication:"
echo "  Run 'claude' command to authenticate with Claude CLI"
echo "  Then type '/login' and press Enter to complete OAuth"
echo ""

# Show prominent warning if Claude CLI installation failed
if [ "$CLAUDE_CLI_FAILED" = true ]; then
    echo "⚠️  =============================================="
    echo "⚠️  WARNING: Claude CLI installation failed!"
    echo "⚠️  You may need to install it manually:"
    echo "⚠️  npm install -g @anthropic-ai/claude-code"
    echo "⚠️  =============================================="
    echo ""
fi
