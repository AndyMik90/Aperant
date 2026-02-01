FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Configure git to allow any directory (needed for mounted volumes)
RUN git config --global --add safe.directory '*' \
    && git config --global user.email "auto-claude@local" \
    && git config --global user.name "Auto Claude"

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && ln -sf /root/.local/bin/claude /usr/local/bin/claude

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Create entrypoint script to setup git safe directory and Claude CLI config at runtime
RUN echo '#!/bin/bash\n\
# Ensure HOME is writable\n\
mkdir -p "$HOME" 2>/dev/null || true\n\
# Mark all directories as safe for git\n\
git config --global --add safe.directory "*" 2>/dev/null || true\n\
git config --global user.email "auto-claude@local" 2>/dev/null || true\n\
git config --global user.name "Auto Claude" 2>/dev/null || true\n\
\n\
# Configure Claude CLI based on environment variables\n\
CLAUDE_CONFIG_DIR="$HOME/.config/claude"\n\
mkdir -p "$CLAUDE_CONFIG_DIR"\n\
\n\
# Determine API key (prefer ANTHROPIC_AUTH_TOKEN, fallback to CLAUDE_CODE_OAUTH_TOKEN)\n\
API_KEY="${ANTHROPIC_AUTH_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-}}"\n\
\n\
# Create settings.json with API configuration\n\
cat > "$CLAUDE_CONFIG_DIR/settings.json" <<EOF\n\
{\n\
  "apiBaseUrl": "${ANTHROPIC_BASE_URL:-https://api.anthropic.com}",\n\
  "apiKey": "$API_KEY",\n\
  "models": {\n\
    "haiku": "${ANTHROPIC_DEFAULT_HAIKU_MODEL:-${DEFAULT_HAIKU_MODEL:-claude-haiku-4-5-20251001}}",\n\
    "sonnet": "${ANTHROPIC_DEFAULT_SONNET_MODEL:-${DEFAULT_SONNET_MODEL:-claude-sonnet-4-5-20250929}}",\n\
    "opus": "${ANTHROPIC_DEFAULT_OPUS_MODEL:-${DEFAULT_OPUS_MODEL:-claude-opus-4-5-20251101}}"\n\
  }\n\
}\n\
EOF\n\
\n\
exec "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

# Expose port 8000
EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]

# Run uvicorn from /app directory
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]