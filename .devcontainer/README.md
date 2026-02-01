# Auto Claude Devcontainer

This devcontainer provides a complete development environment for Auto Claude with all necessary tools and dependencies pre-configured.

## Features

### Pre-installed Tools
- **Node.js 24** - Latest LTS version for frontend development
- **Python 3.12+** - Required for backend development
- **UV** - Fast Python package manager
- **Git & GitHub CLI** - Version control and GitHub integration
- **Claude CLI** - Anthropic's Claude Code CLI tool

### VSCode Extensions
- **Claude Dev** - AI pair programming with Claude
- **GitHub Copilot** - AI code completion
- **Python Tools** - Python, Pylance, Ruff formatter
- **TypeScript/JavaScript** - Biome formatter and linter
- **Tailwind CSS** - CSS IntelliSense
- **GitLens** - Enhanced Git integration

### Port Forwarding
- `8000` - Backend API server
- `5173` - Frontend development server (Vite)
- `9222` - Electron remote debugging port

## Usage

### GitHub Codespaces

1. Open this repository on GitHub
2. Click the green "Code" button
3. Select "Codespaces" tab
4. Click "Create codespace on develop" (or your branch)
5. Wait for the container to build and dependencies to install
6. Start developing!

### Local Development with VSCode

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install [VSCode](https://code.visualstudio.com/)
3. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
4. Open this repository in VSCode
5. Press `F1` and select "Dev Containers: Reopen in Container"
6. Wait for the container to build and dependencies to install

## Getting Started

After the devcontainer is set up:

1. **Authenticate with Claude CLI**:
   ```bash
   claude
   # Type: /login
   # Press Enter to open browser and complete OAuth
   ```

2. **Configure environment variables**:
   - Edit `apps/backend/.env` with your API keys
   - Edit `apps/frontend/.env` if needed

3. **Start development**:
   ```bash
   # Frontend development
   npm run dev
   
   # Backend development
   cd apps/backend
   .venv/bin/python run.py --help
   ```

## Available Commands

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Lint code
- `cd apps/frontend && npm run typecheck` - Type check TypeScript

### Backend
- `npm run test:backend` - Run backend tests
- `cd apps/backend && .venv/bin/python run.py` - Run backend CLI

### Full Stack
- `npm run install:all` - Install all dependencies
- `npm run web` - Run full stack (backend + frontend)

## Troubleshooting

### Claude CLI authentication fails
- Make sure you have a Claude Pro/Max subscription
- Try running `claude` command manually and follow the OAuth flow

### Python virtual environment not found
```bash
cd apps/backend
uv venv
uv pip install -r requirements.txt
```

### Frontend dependencies not installed
```bash
cd apps/frontend
npm install
```

### Port already in use
- Stop any local services running on ports 8000, 5173, or 9222
- Or modify the `forwardPorts` in `.devcontainer/devcontainer.json`

## Customization

### Adding VSCode Extensions
Edit `.devcontainer/devcontainer.json` and add to the `extensions` array:
```json
"customizations": {
  "vscode": {
    "extensions": [
      "your.extension-id"
    ]
  }
}
```

### Changing Python Version
Edit the `features` section in `.devcontainer/devcontainer.json`:
```json
"features": {
  "ghcr.io/devcontainers/features/python:1": {
    "version": "3.13"
  }
}
```

### Adding System Packages
Create a custom Dockerfile in `.devcontainer/Dockerfile` and reference it in `devcontainer.json`:
```json
{
  "build": {
    "dockerfile": "Dockerfile"
  }
}
```

## Contributing

When working in the devcontainer, follow the same contribution guidelines as local development. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
