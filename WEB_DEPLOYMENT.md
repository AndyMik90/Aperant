# Auto Claude Web Deployment Guide

This guide explains how to run Auto Claude as a web application, allowing you to host it on a VPS and access it from anywhere.

## Quick Start

### Option 1: Docker (Recommended)

The easiest way to deploy Auto Claude Web is using Docker:

```bash
# Build the Docker image
docker build -f Dockerfile.web -t auto-claude-web .

# Run the container
docker run -d \
  -p 3456:3456 \
  -v /path/to/your/projects:/projects \
  -v auto-claude-data:/data \
  --name auto-claude-web \
  auto-claude-web
```

Or use Docker Compose:

```bash
# Set your projects directory
export PROJECTS_DIR=/path/to/your/projects

# Optional: Set Anthropic API key
export ANTHROPIC_API_KEY=your-api-key

# Start the service
docker-compose -f docker-compose.web.yml up -d
```

Access the web interface at `http://localhost:3456`

### Option 2: Manual Setup

If you prefer to run without Docker:

```bash
# Install dependencies
npm run install:all
npm run install:web

# Build the frontend for web
npm run build:web

# Start the web server
npm run start:web
```

## Development Mode

For development with hot-reload:

```bash
# Terminal 1: Start the web server
npm run start:web

# Terminal 2: Start the frontend dev server
npm run dev:web
```

The dev server runs on `http://localhost:5173` with API proxy to the web server.

## Architecture

The web version replaces the Electron main process with a Node.js web server:

```
Browser (React App)
    ↓ HTTP/WebSocket
Web Server (Express + Socket.IO)
    ↓ subprocess spawn
Python Backend (agents, tasks, etc.)
```

### Components

1. **Web Server** (`apps/web-server/`)
   - Express HTTP server for REST API
   - Socket.IO for real-time events
   - PTY terminal management via node-pty
   - Python subprocess spawning for agents

2. **Frontend** (`apps/frontend/dist/`)
   - Same React app as desktop version
   - Uses web API client instead of Electron IPC

3. **Python Backend** (`apps/backend/`)
   - Unchanged from desktop version
   - Handles task execution, AI agents, etc.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3456 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `DATA_DIR` | ./data | Settings and project list storage |
| `STATIC_DIR` | apps/frontend/dist | Frontend static files |
| `BACKEND_DIR` | apps/backend | Python backend directory |
| `CORS_ORIGIN` | * | CORS allowed origins |
| `ANTHROPIC_API_KEY` | - | API key for Anthropic/Claude |

### Volumes (Docker)

| Volume | Purpose |
|--------|---------|
| `/data` | Persistent data (settings, project list) |
| `/projects` | Your code projects directory |

## Security Considerations

When deploying to a VPS:

1. **Use HTTPS**: Put a reverse proxy (nginx, Caddy) in front with SSL
2. **Authentication**: Add authentication middleware (not included by default)
3. **Firewall**: Restrict access to port 3456
4. **API Keys**: Store securely, never commit to git

### Example nginx configuration:

```nginx
server {
    listen 443 ssl http2;
    server_name auto-claude.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/auto-claude.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auto-claude.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Limitations

Some features are not available in web mode:

1. **Desktop Integration**: No native file picker, system notifications
2. **OAuth**: GitHub/GitLab OAuth requires manual token configuration
3. **Auto-updates**: No automatic updates (rebuild Docker image instead)
4. **Screen Capture**: Not available in browser

## Troubleshooting

### Connection Issues

```bash
# Check server health
curl http://localhost:3456/api/health

# View logs
docker logs auto-claude-web
```

### Terminal Not Working

Ensure node-pty is properly built for your platform:

```bash
cd apps/web-server
npm rebuild @lydell/node-pty
```

### Python Backend Errors

Check Python environment:

```bash
# In container
docker exec -it auto-claude-web bash
cd /app/apps/backend
python -c "import core; print('OK')"
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/projects | List projects |
| POST | /api/projects | Add project |
| GET | /api/projects/:id/tasks | List tasks |
| POST | /api/projects/:id/tasks | Create task |
| POST | /api/terminals | Create terminal |
| GET | /api/settings | Get settings |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| terminal:output | Server→Client | Terminal output |
| terminal:input | Client→Server | Terminal input |
| task:progress | Server→Client | Task progress update |
| task:statusChange | Server→Client | Task status change |
| agent:log | Server→Client | Agent log message |
