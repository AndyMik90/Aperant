# Docker-Native Web UI Architecture

> Design document for converting AC Jerry from Electron to a containerized web application.

## Executive Summary

This document outlines the architecture for a Docker-native version of AC Jerry that:
1. Runs entirely in containers for security isolation
2. Provides a web-based UI accessible via browser
3. Maintains feature parity with the Electron app
4. Enables easy deployment on any Docker-capable host

---

## Goals

| Goal | Description |
|------|-------------|
| **Security Isolation** | All agent execution happens inside containers, limiting blast radius |
| **Portability** | Single `docker-compose up` to run anywhere |
| **No Native Dependencies** | No Electron, no node-pty on host, no Python on host |
| **Feature Parity** | All Electron features available in web UI |
| **Developer Experience** | Hot-reload for development, easy debugging |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Host Machine                                │
│                                                                          │
│   Browser ◄──── http://localhost:3000 ────►  Docker Container           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         ac-jerry Container                            │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                         Caddy / Nginx                                ││
│  │  - Serves React SPA static files                                    ││
│  │  - Reverse proxy: /api/* → FastAPI :8000                            ││
│  │  - WebSocket proxy: /ws/* → FastAPI :8000                           ││
│  │  - TLS termination (optional, for production)                       ││
│  └──────────────────────────────┬──────────────────────────────────────┘│
│                                 │                                        │
│  ┌──────────────────────────────▼──────────────────────────────────────┐│
│  │                        FastAPI Backend                               ││
│  │                                                                      ││
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐ ││
│  │  │  REST API   │  │  WebSocket   │  │     PTY Manager            │ ││
│  │  │             │  │  Handlers    │  │                            │ ││
│  │  │ /api/       │  │              │  │ - Spawn shell processes    │ ││
│  │  │  projects   │  │ /ws/terminal │  │ - Manage Claude sessions   │ ││
│  │  │  tasks      │  │ /ws/events   │  │ - Stream output via WS     │ ││
│  │  │  settings   │  │ /ws/logs     │  │                            │ ││
│  │  │  worktrees  │  │              │  │ Uses: ptyprocess (Python)  │ ││
│  │  └─────────────┘  └──────────────┘  └────────────────────────────┘ ││
│  │                          │                                          ││
│  │                          ▼                                          ││
│  │  ┌──────────────────────────────────────────────────────────────┐  ││
│  │  │              AC Jerry Python Core                          │  ││
│  │  │                                                                │  ││
│  │  │  - runners/         Agent orchestration                       │  ││
│  │  │  - core/client.py   Claude SDK integration                    │  ││
│  │  │  - core/worktree.py Git worktree management                   │  ││
│  │  │  - security/        Command validation                        │  ││
│  │  └──────────────────────────────────────────────────────────────┘  ││
│  │                                                                      ││
│  └──────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  Volumes:                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  /projects    ← Host project directories (bind mount)              ││
│  │  /data        ← Persistent data (settings, sessions, specs)        ││
│  │  /home/claude ← Claude CLI config, OAuth tokens                    ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        Supporting Services                               │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │    FalkorDB     │  │   Graphiti MCP   │  │  (Future: Agent Pool)  │ │
│  │                 │  │                  │  │                        │ │
│  │  Graph memory   │  │  Memory API      │  │  Per-task containers   │ │
│  │  for agents     │  │  for agents      │  │  for max isolation     │ │
│  └─────────────────┘  └──────────────────┘  └────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. FastAPI Backend

**Location:** `ac-jerry/api/`

**Structure:**
```
ac-jerry/api/
├── __init__.py
├── main.py              # FastAPI app, CORS, lifespan
├── routes/
│   ├── __init__.py
│   ├── projects.py      # /api/projects/*
│   ├── tasks.py         # /api/tasks/*
│   ├── terminals.py     # /api/terminals/*
│   ├── worktrees.py     # /api/worktrees/*
│   ├── settings.py      # /api/settings/*
│   ├── integrations.py  # /api/linear/*, /api/github/*
│   ├── insights.py      # /api/insights/*
│   └── health.py        # /api/health
├── websocket/
│   ├── __init__.py
│   ├── manager.py       # WebSocket connection manager
│   ├── terminal.py      # Terminal WebSocket handler
│   ├── events.py        # Task/agent event streaming
│   └── logs.py          # Log streaming
├── services/
│   ├── __init__.py
│   ├── project_service.py
│   ├── task_service.py
│   ├── terminal_service.py  # PTY management
│   └── agent_service.py     # Claude SDK wrapper
├── models/
│   ├── __init__.py
│   ├── project.py
│   ├── task.py
│   ├── terminal.py
│   └── api_models.py    # Pydantic request/response models
└── config.py            # Environment configuration
```

### 2. WebSocket Protocols

#### Terminal WebSocket (`/ws/terminal/{terminal_id}`)

```typescript
// Client → Server
interface TerminalInput {
  type: 'input' | 'resize' | 'invoke_claude' | 'resume_claude';
  data?: string;           // For 'input'
  cols?: number;           // For 'resize'
  rows?: number;           // For 'resize'
  cwd?: string;            // For 'invoke_claude'
  sessionId?: string;      // For 'resume_claude'
}

// Server → Client
interface TerminalOutput {
  type: 'output' | 'exit' | 'title' | 'claude_session' | 'rate_limit' | 'oauth_token';
  data?: string;           // For 'output'
  exitCode?: number;       // For 'exit'
  title?: string;          // For 'title'
  sessionId?: string;      // For 'claude_session'
  rateLimitInfo?: object;  // For 'rate_limit'
  oauthInfo?: object;      // For 'oauth_token'
}
```

#### Events WebSocket (`/ws/events/{project_id}`)

```typescript
// Server → Client (all events)
interface ProjectEvent {
  type: 'task_progress' | 'task_status' | 'task_error' | 'task_log' |
        'roadmap_progress' | 'ideation_progress' | 'insights_chunk' |
        'github_investigation' | 'release_progress';
  taskId?: string;
  projectId: string;
  payload: object;
}
```

### 3. REST API Specifications

#### Projects API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Add project by path |
| DELETE | `/api/projects/{id}` | Remove project |
| PATCH | `/api/projects/{id}/settings` | Update project settings |
| POST | `/api/projects/{id}/initialize` | Initialize ac-jerry in project |
| GET | `/api/projects/{id}/version` | Check ac-jerry version |
| GET | `/api/projects/{id}/context` | Get project context/index |
| POST | `/api/projects/{id}/refresh-index` | Refresh project index |

#### Tasks API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{id}/tasks` | List tasks for project |
| POST | `/api/projects/{id}/tasks` | Create new task |
| GET | `/api/tasks/{id}` | Get task details |
| PATCH | `/api/tasks/{id}` | Update task |
| DELETE | `/api/tasks/{id}` | Delete task |
| POST | `/api/tasks/{id}/start` | Start task execution |
| POST | `/api/tasks/{id}/stop` | Stop task execution |
| POST | `/api/tasks/{id}/review` | Submit review |
| POST | `/api/tasks/{id}/recover` | Recover stuck task |
| GET | `/api/tasks/{id}/logs` | Get task logs |

#### Worktrees API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks/{id}/worktree/status` | Get worktree status |
| GET | `/api/tasks/{id}/worktree/diff` | Get worktree diff |
| POST | `/api/tasks/{id}/worktree/merge` | Merge worktree |
| POST | `/api/tasks/{id}/worktree/merge/preview` | Preview merge |
| DELETE | `/api/tasks/{id}/worktree` | Discard worktree |
| GET | `/api/projects/{id}/worktrees` | List all worktrees |

#### Terminals API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/terminals` | Create terminal |
| DELETE | `/api/terminals/{id}` | Destroy terminal |
| GET | `/api/terminals/sessions` | Get saved sessions |
| POST | `/api/terminals/{id}/restore` | Restore session |
| POST | `/api/terminals/{id}/save-buffer` | Save terminal buffer |

#### Settings API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get app settings |
| PATCH | `/api/settings` | Update settings |
| GET | `/api/settings/claude-profiles` | Get Claude profiles |
| POST | `/api/settings/claude-profiles` | Create profile |
| DELETE | `/api/settings/claude-profiles/{id}` | Delete profile |

---

## Data Models

### Persistent Storage Structure

```
/data/
├── settings.json           # Global app settings
├── claude-profiles.json    # Multi-account Claude profiles
├── projects/
│   └── {project_id}/
│       ├── project.json    # Project metadata
│       ├── tasks/
│       │   └── {task_id}/
│       │       ├── task.json
│       │       ├── spec.md
│       │       ├── plan.json
│       │       └── logs/
│       ├── roadmap.json
│       ├── ideation.json
│       └── insights/
└── terminals/
    └── sessions/
        └── {date}/
            └── {session_id}.json
```

### Key Pydantic Models

```python
# api/models/project.py
class Project(BaseModel):
    id: str
    path: str
    name: str
    settings: ProjectSettings
    created_at: datetime
    updated_at: datetime

class ProjectSettings(BaseModel):
    linear_enabled: bool = False
    linear_api_key: Optional[str] = None
    github_enabled: bool = False
    graphiti_enabled: bool = False

# api/models/task.py
class Task(BaseModel):
    id: str
    project_id: str
    title: str
    description: str
    status: TaskStatus
    spec_path: Optional[str] = None
    worktree_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    metadata: Optional[TaskMetadata] = None

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    REVIEW = "review"
    APPROVED = "approved"
    REJECTED = "rejected"
    DONE = "done"
    FAILED = "failed"
    ARCHIVED = "archived"

# api/models/terminal.py
class TerminalSession(BaseModel):
    id: str
    project_path: str
    cwd: str
    created_at: datetime
    claude_session_id: Optional[str] = None
    buffer_path: Optional[str] = None
```

---

## Dockerfile Design

```dockerfile
# Dockerfile
FROM python:3.12-slim AS python-base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | sh

# Set up Python environment
WORKDIR /app
COPY ac-jerry/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install API dependencies
COPY ac-jerry/api/requirements.txt ./api-requirements.txt
RUN pip install --no-cache-dir -r api-requirements.txt

# Copy application code
COPY ac-jerry/ ./ac-jerry/

# --- Frontend Build Stage ---
FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY ac-jerry-ui/package*.json ./
RUN npm ci

COPY ac-jerry-ui/ ./
# Modify for web build (remove Electron-specific code)
ENV VITE_API_URL=/api
ENV VITE_WS_URL=/ws
RUN npm run build:web

# --- Production Stage ---
FROM python-base AS production

# Install Caddy for reverse proxy
RUN apt-get update && apt-get install -y caddy && rm -rf /var/lib/apt/lists/*

# Copy frontend build
COPY --from=frontend-build /app/dist/web /var/www/html

# Copy Caddyfile
COPY docker/Caddyfile /etc/caddy/Caddyfile

# Create data directories
RUN mkdir -p /data /projects /home/claude

# Environment
ENV PYTHONPATH=/app/ac-jerry
ENV DATA_DIR=/data
ENV PROJECTS_DIR=/projects
ENV CLAUDE_CONFIG_DIR=/home/claude/.claude

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start script
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
```

### Start Script

```bash
#!/bin/bash
# docker/start.sh

# Start FastAPI in background
cd /app/ac-jerry
uvicorn api.main:app --host 0.0.0.0 --port 8000 &

# Start Caddy (foreground)
caddy run --config /etc/caddy/Caddyfile
```

### Caddyfile

```caddyfile
# docker/Caddyfile
:3000 {
    # Serve React SPA
    root * /var/www/html
    file_server
    try_files {path} /index.html

    # Proxy API requests
    handle /api/* {
        reverse_proxy localhost:8000
    }

    # Proxy WebSocket requests
    handle /ws/* {
        reverse_proxy localhost:8000
    }
}
```

---

## Docker Compose

```yaml
# docker-compose.yml
name: ac-jerry

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ac-jerry
    ports:
      - "3000:3000"
    volumes:
      # Mount user's projects (read-write for agent work)
      - ${PROJECTS_PATH:-./projects}:/projects
      # Persistent data
      - ac-jerry-data:/data
      # Claude CLI config (for OAuth tokens)
      - ac-jerry-claude:/home/claude/.claude
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}
      - SECURITY_STRICT_MODE=${SECURITY_STRICT_MODE:-true}
      - GRAPHITI_ENABLED=${GRAPHITI_ENABLED:-false}
    depends_on:
      - falkordb
    networks:
      - ac-jerry-net

  falkordb:
    image: falkordb/falkordb:latest
    container_name: ac-jerry-falkordb
    volumes:
      - falkordb-data:/data
    networks:
      - ac-jerry-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  graphiti-mcp:
    image: falkordb/graphiti-knowledge-graph-mcp:latest
    container_name: ac-jerry-graphiti
    platform: linux/amd64
    environment:
      DATABASE_TYPE: falkordb
      FALKORDB_HOST: falkordb
      FALKORDB_PORT: "6379"
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    depends_on:
      falkordb:
        condition: service_healthy
    networks:
      - ac-jerry-net

volumes:
  ac-jerry-data:
  ac-jerry-claude:
  falkordb-data:

networks:
  ac-jerry-net:
    driver: bridge
```

---

## Security Considerations

### Container Isolation

1. **No host network access** - Containers use bridge network
2. **Volume restrictions** - Only `/projects` mounted, read-write limited to worktrees
3. **No privileged mode** - Containers run as non-root
4. **Strict mode enabled** - `SECURITY_STRICT_MODE=true` by default
5. **Resource limits** - Memory and CPU limits per container

### Agent Sandboxing

```yaml
# Future: Per-agent containers
agent-sandbox:
  image: ac-jerry-agent
  read_only: true
  tmpfs:
    - /tmp
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  networks:
    - agent-net  # Isolated network
```

### Secrets Management

1. OAuth tokens stored in named volume (`ac-jerry-claude`)
2. API keys passed via environment variables
3. Never logged or exposed via API
4. Consider Docker secrets for production

---

## Migration Path from Electron

### Phase 1: API Abstraction Layer

Create an abstraction layer in the React app that can use either Electron IPC or HTTP/WebSocket:

```typescript
// src/renderer/lib/api-client.ts
interface APIClient {
  getProjects(): Promise<Project[]>;
  createTask(projectId: string, title: string, desc: string): Promise<Task>;
  // ... all ElectronAPI methods
}

// Electron implementation (existing)
class ElectronAPIClient implements APIClient {
  async getProjects() {
    return window.electronAPI.getProjects();
  }
}

// Web implementation (new)
class WebAPIClient implements APIClient {
  async getProjects() {
    const res = await fetch('/api/projects');
    return res.json();
  }
}

// Factory
export function createAPIClient(): APIClient {
  if (typeof window.electronAPI !== 'undefined') {
    return new ElectronAPIClient();
  }
  return new WebAPIClient();
}
```

### Phase 2: Build Configuration

```typescript
// vite.config.ts
export default defineConfig({
  define: {
    'import.meta.env.IS_WEB': JSON.stringify(process.env.BUILD_TARGET === 'web'),
  },
  build: {
    outDir: process.env.BUILD_TARGET === 'web' ? 'dist/web' : 'out/renderer',
  },
});
```

### Phase 3: Conditional Imports

```typescript
// src/renderer/hooks/useTerminal.ts
import { useEffect } from 'react';

export function useTerminal(terminalId: string) {
  useEffect(() => {
    if (import.meta.env.IS_WEB) {
      // WebSocket-based terminal
      const ws = new WebSocket(`/ws/terminal/${terminalId}`);
      // ...
    } else {
      // Electron IPC-based terminal
      window.electronAPI.onTerminalOutput((id, data) => {
        // ...
      });
    }
  }, [terminalId]);
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] FastAPI skeleton with health endpoint
- [ ] WebSocket manager
- [ ] Terminal PTY service
- [ ] Basic project/task CRUD

### Phase 2: Terminal & Agent Execution (Week 2-3)
- [ ] Terminal WebSocket handler
- [ ] Claude session management
- [ ] Agent execution integration
- [ ] Log streaming

### Phase 3: React API Client (Week 3-4)
- [ ] Create APIClient abstraction
- [ ] Implement WebAPIClient
- [ ] Update components to use abstraction
- [ ] Add web build target

### Phase 4: Docker & Deployment (Week 4-5)
- [ ] Multi-stage Dockerfile
- [ ] Docker Compose configuration
- [ ] Volume management
- [ ] Security hardening

### Phase 5: Feature Parity (Week 5-8)
- [ ] Integrations (Linear, GitHub)
- [ ] Insights/Ideation
- [ ] Changelog/Release
- [ ] Settings & Profiles

---

## Open Questions

1. **Agent isolation strategy**: Run all agents in main container, or spawn per-task containers?
2. **Authentication**: Add user authentication for multi-user deployments?
3. **Scaling**: Support multiple concurrent users?
4. **Persistence**: SQLite vs PostgreSQL for production?
5. **Claude CLI**: Bundle in container or require host installation?

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2025-12-18 | Claude | Initial design document |
