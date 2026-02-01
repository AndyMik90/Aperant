# Contributing to Jerry

Thank you for your interest in contributing to Jerry! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
  - [Python Backend](#python-backend)
  - [Electron Frontend](#electron-frontend)
- [Running from Source](#running-from-source)
- [Pre-commit Hooks](#pre-commit-hooks)
- [Code Style](#code-style)
- [Testing](#testing)
- [Continuous Integration](#continuous-integration)
- [Git Workflow](#git-workflow)
  - [Branch Overview](#branch-overview)
  - [Main Branches](#main-branches)
  - [Supporting Branches](#supporting-branches)
  - [Branch Naming](#branch-naming)
  - [Where to Branch From](#where-to-branch-from)
  - [Pull Request Targets](#pull-request-targets)
  - [Release Process](#release-process-maintainers)
  - [Commit Messages](#commit-messages)
  - [PR Hygiene](#pr-hygiene)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Architecture Overview](#architecture-overview)

## Contributor License Agreement (CLA)

All contributors must sign our Contributor License Agreement (CLA) before contributions can be accepted.

### Why We Require a CLA

Jerry is currently licensed under AGPL-3.0. The CLA ensures the project has proper licensing flexibility should we introduce additional licensing options (such as commercial/enterprise licenses) in the future.

You retain full copyright ownership of your contributions.

### How to Sign

1. Open a Pull Request
2. The CLA bot will automatically comment with instructions
3. Comment on the PR with: `I have read the CLA Document and I hereby sign the CLA`
4. Done - you only need to sign once, and it applies to all future contributions

Read the full CLA here: [CLA.md](CLA.md)

## Prerequisites

Before contributing, ensure you have the following installed:

- **Python 3.12+** - For the backend framework
- **Node.js 24+** - For the Electron frontend
- **npm 10+** - Package manager for the frontend (comes with Node.js)
- **uv** (recommended) or **pip** - Python package manager
- **CMake** - Required for building native dependencies (e.g., LadybugDB)
- **Git** - Version control

### Installing Python 3.12

**Windows:**
```bash
winget install Python.Python.3.12
```

**macOS:**
```bash
brew install python@3.12
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install python3.12 python3.12-venv
```

**Linux (Fedora):**
```bash
sudo dnf install python3.12
```

### Installing Node.js 24+

**Windows:**
```bash
winget install OpenJS.NodeJS.LTS
```

**macOS:**
```bash
brew install node@24
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

**Linux (Fedora):**
```bash
sudo dnf install nodejs npm
```

### Installing CMake

**Windows:**
```bash
winget install Kitware.CMake
```

**macOS:**
```bash
brew install cmake
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install cmake
```

**Linux (Fedora):**
```bash
sudo dnf install cmake
```

## Quick Start

The fastest way to get started:

```bash
# Clone the repository
git clone https://github.com/AndyMik90/Auto-Claude.git
cd Jerry

# Install all dependencies (cross-platform)
npm run install:all

# Run in development mode
npm run dev

# Or build and run production
npm start
```

## Development Setup

The project consists of two main components:

1. **Python Backend** (`apps/backend/`) - The core autonomous coding framework
2. **Electron Frontend** (`apps/frontend/`) - Optional desktop UI

### Python Backend

The recommended way is to use `npm run install:backend` (or `npm run install:all` from the root), which automatically installs both runtime and test dependencies. You can also set up manually:

```bash
# Navigate to the backend directory
cd apps/backend

# Create virtual environment
# Windows:
py -3.12 -m venv .venv
.venv\Scripts\activate

# macOS/Linux:
python3.12 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install test dependencies
pip install -r ../../tests/requirements-test.txt

# Set up environment
cp .env.example .env
# Edit .env and add your CLAUDE_CODE_OAUTH_TOKEN (get it via: claude setup-token)
```

### Electron Frontend

```bash
# Navigate to the frontend directory
cd apps/frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

## Running from Source

If you want to run Jerry from source (for development or testing unreleased features), follow these steps:

### Step 1: Clone and Set Up

```bash
git clone https://github.com/AndyMik90/Auto-Claude.git
cd Jerry/apps/backend

# Using uv (recommended)
uv venv && uv pip install -r requirements.txt

# Or using standard Python
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Set up environment
cd apps/backend
cp .env.example .env
# Edit .env and add your CLAUDE_CODE_OAUTH_TOKEN (get it via: claude setup-token)
```

### Step 2: Run the Desktop UI

```bash
cd ../frontend

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Or production build
npm run build && npm run start
```

<details>
<summary><b>Windows users:</b> If installation fails with node-gyp errors, click here</summary>

Jerry automatically downloads prebuilt binaries for Windows. If prebuilts aren't available for your Electron version yet, you'll need Visual Studio Build Tools:

1. Download [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Select "Desktop development with C++" workload
3. In "Individual Components", add "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs"
4. Restart terminal and run `npm install` again

</details>

> **Note:** For regular usage, we recommend downloading the pre-built releases from [GitHub Releases](https://github.com/AndyMik90/Auto-Claude/releases). Running from source is primarily for contributors and those testing unreleased features.

## Pre-commit Hooks

We use [pre-commit](https://pre-commit.com/) to run linting and formatting checks before each commit. This ensures code quality and consistency across the project.

### Setup

```bash
# Install pre-commit
pip install pre-commit

# Install the git hooks (run once after cloning)
pre-commit install
```

### What Runs on Commit

When you commit, the following checks run automatically:

| Check | Scope | Description |
|-------|-------|-------------|
| **ruff** | `apps/backend/` | Python linter with auto-fix |
| **ruff-format** | `apps/backend/` | Python code formatter |
| **eslint** | `apps/frontend/` | TypeScript/React linter |
| **typecheck** | `apps/frontend/` | TypeScript type checking |
| **trailing-whitespace** | All files | Removes trailing whitespace |
| **end-of-file-fixer** | All files | Ensures files end with newline |
| **check-yaml** | All files | Validates YAML syntax |
| **check-added-large-files** | All files | Prevents large file commits |

### Running Manually

```bash
# Run all checks on all files
pre-commit run --all-files

# Run a specific hook
pre-commit run ruff --all-files

# Skip hooks temporarily (not recommended)
git commit --no-verify -m "message"
```

### If a Check Fails

1. **Ruff auto-fixes**: Some issues are fixed automatically. Stage the changes and commit again.
2. **ESLint errors**: Fix the reported issues in your code.
3. **Type errors**: Resolve TypeScript type issues before committing.

## Code Style

### Python

- Follow PEP 8 style guidelines
- Use type hints for function signatures
- Use docstrings for public functions and classes
- Keep functions focused and under 50 lines when possible
- Use meaningful variable and function names

```python
# Good
def get_next_chunk(spec_dir: Path) -> dict | None:
    """
    Find the next pending chunk in the implementation plan.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        The next chunk dict or None if all chunks are complete
    """
    ...

# Avoid
def gnc(sd):
    ...
```

### TypeScript/React

- Use TypeScript strict mode
- Follow the existing component patterns in `apps/frontend/src/`
- Use functional components with hooks
- Prefer named exports over default exports
- Use the UI components from `src/renderer/components/ui/`

```typescript
// Good
export function TaskCard({ task, onEdit }: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  ...
}

// Avoid
export default function(props) {
  ...
}
```

### General

- No trailing whitespace
- Use 2 spaces for indentation in TypeScript/JSON, 4 spaces in Python
- End files with a newline
- Keep line length under 100 characters when practical

## Testing

### Python Tests

```bash
# Run all tests (from repository root)
npm run test:backend

# Or manually with pytest
cd apps/backend
.venv/Scripts/pytest.exe ../tests -v          # Windows
.venv/bin/pytest ../tests -v                   # macOS/Linux

# Run a specific test file
npm run test:backend -- tests/test_security.py -v

# Run a specific test
npm run test:backend -- tests/test_security.py::test_bash_command_validation -v

# Skip slow tests
npm run test:backend -- -m "not slow"

# Run with coverage
pytest tests/ --cov=apps/backend --cov-report=html
```

Test configuration is in `tests/pytest.ini`.

### Frontend Tests

```bash
cd apps/frontend

# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run E2E tests (requires built app)
npm run build
npm run test:e2e

# Run linting
npm run lint

# Run type checking
npm run typecheck
```

### Testing Requirements

Before submitting a PR:

1. **All existing tests must pass**
2. **New features should include tests**
3. **Bug fixes should include a regression test**
4. **Test coverage should not decrease significantly**

## Continuous Integration

All pull requests and pushes to `main` trigger automated CI checks via GitHub Actions.

### Workflows

| Workflow | Trigger | What it checks |
|----------|---------|----------------|
| **CI** | Push to `main`, PRs | Python tests (3.11 & 3.12), Frontend tests |
| **Lint** | Push to `main`, PRs | Ruff (Python), ESLint + TypeScript (Frontend) |

### PR Requirements

Before a PR can be merged:

1. All CI checks must pass (green checkmarks)
2. Python tests pass on both Python 3.11 and 3.12
3. Frontend tests pass
4. Linting passes (no ruff or eslint errors)
5. TypeScript type checking passes

### Running CI Checks Locally

```bash
# Python tests
cd apps/backend
source .venv/bin/activate
pytest ../../tests/ -v

# Frontend tests
cd apps/frontend
npm test
npm run lint
npm run typecheck
```

## Git Workflow

We use a **Git Flow** branching strategy to manage releases and parallel development.

### Branch Overview

```
main (stable)          ← Only released, tested code (tagged versions)
  │
develop                ← Integration branch - all PRs merge here first
  │
├── feature/xxx        ← New features
├── fix/xxx            ← Bug fixes
├── release/vX.Y.Z     ← Release preparation
└── hotfix/xxx         ← Emergency production fixes
```

### Main Branches

| Branch | Purpose | Protected |
|--------|---------|-----------|
| `main` | Production-ready code. Only receives merges from `release/*` or `hotfix/*` branches. Every merge is tagged (v2.7.0, v2.8.0, etc.) | ✅ Yes |
| `develop` | Integration branch where all features and fixes are combined. This is the default target for all PRs. | ✅ Yes |

### Supporting Branches

| Branch Type | Branch From | Merge To | Purpose |
|-------------|-------------|----------|---------|
| `feature/*` | `develop` | `develop` | New features and enhancements |
| `fix/*` | `develop` | `develop` | Bug fixes (non-critical) |
| `release/*` | `develop` | `main` + `develop` | Release preparation and final testing |
| `hotfix/*` | `main` | `main` + `develop` | Critical production bug fixes |

### Branch Naming

Use descriptive branch names with a prefix indicating the type of change:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New feature | `feature/add-dark-mode` |
| `fix/` | Bug fix | `fix/memory-leak-in-worker` |
| `hotfix/` | Urgent production fix | `hotfix/critical-crash-fix` |
| `docs/` | Documentation | `docs/update-readme` |
| `refactor/` | Code refactoring | `refactor/simplify-auth-flow` |
| `test/` | Test additions/fixes | `test/add-integration-tests` |
| `chore/` | Maintenance tasks | `chore/update-dependencies` |
| `release/` | Release preparation | `release/v2.8.0` |
| `hotfix/` | Emergency fixes | `hotfix/critical-auth-bug` |

### Where to Branch From

```bash
# For features and bug fixes - ALWAYS branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/my-new-feature

# For hotfixes only - branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix
```

### Pull Request Targets

> ⚠️ **Important:** All PRs should target `develop`, NOT `main`!

| Your Branch Type | Target Branch |
|------------------|---------------|
| `feature/*` | `develop` |
| `fix/*` | `develop` |
| `docs/*` | `develop` |
| `refactor/*` | `develop` |
| `test/*` | `develop` |
| `chore/*` | `develop` |
| `hotfix/*` | `main` (maintainers only) |
| `release/*` | `main` (maintainers only) |

### Release Process (Maintainers)

When ready to release a new version:

```bash
# 1. Create release branch from develop
git checkout develop
git pull origin develop
git checkout -b release/v2.8.0

# 2. Update version numbers, CHANGELOG, final fixes only
# No new features allowed in release branches!

# 3. Merge to main and tag
git checkout main
git merge release/v2.8.0
git tag v2.8.0
git push origin main --tags

# 4. Merge back to develop (important!)
git checkout develop
git merge release/v2.8.0
git push origin develop

# 5. Delete release branch
git branch -d release/v2.8.0
git push origin --delete release/v2.8.0
```

### Beta Release Process (Maintainers)

Beta releases allow users to test new features before they're included in a stable release. Beta releases are published from the `develop` branch.

**Creating a Beta Release:**

1. Go to **Actions** → **Beta Release** workflow in GitHub
2. Click **Run workflow**
3. Enter the beta version (e.g., `2.8.0-beta.1`)
4. Optionally enable dry run to test without publishing
5. Click **Run workflow**

The workflow will:
- Validate the version format
- Update `package.json` on develop
- Create and push a tag (e.g., `v2.8.0-beta.1`)
- Build installers for all platforms
- Create a GitHub pre-release

**Version Format:**
```
X.Y.Z-beta.N   (e.g., 2.8.0-beta.1, 2.8.0-beta.2)
X.Y.Z-alpha.N  (e.g., 2.8.0-alpha.1)
X.Y.Z-rc.N     (e.g., 2.8.0-rc.1)
```

**For Users:**
Users can opt into beta updates in Settings → Updates → "Beta Updates" toggle. When enabled, the app will check for and install beta versions. Users can switch back to stable at any time.

### Hotfix Workflow

For urgent production fixes that can't wait for the normal release cycle:

**1. Create hotfix from main**

```bash
git checkout main
git pull origin main
git checkout -b hotfix/150-critical-fix
```

**2. Fix the issue**

```bash
# ... make changes ...
git commit -m "hotfix: fix critical crash on startup"
```

**3. Open PR to main (fast-track review)**

```bash
gh pr create --base main --title "hotfix: fix critical crash on startup"
```

**4. After merge to main, sync to develop**

```bash
git checkout develop
git pull origin develop
git merge main
git push origin develop
```

```
main ─────●─────●─────●─────●───── (production)
          ↑     ↑     ↑     ↑
develop ──●─────●─────●─────●───── (integration)
          ↑     ↑     ↑
feature/123 ────●
feature/124 ──────────●
hotfix/125 ─────────────────●───── (from main, merge to both)
```

> **Note:** Hotfixes branch FROM `main` and merge TO `main` first, then sync back to `develop` to keep branches aligned.

### Commit Messages

Write clear, concise commit messages that explain the "why" behind changes:

```bash
# Good
git commit -m "Add retry logic for failed API calls

Implements exponential backoff for transient failures.
Fixes #123"

# Avoid
git commit -m "fix stuff"
git commit -m "WIP"
```

**Format:**
```
<type>: <subject>

<body>

<footer>
```

- **type**: feat, fix, docs, style, refactor, test, chore
- **subject**: Short description (50 chars max, imperative mood)
- **body**: Detailed explanation if needed (wrap at 72 chars)
- **footer**: Reference issues, breaking changes

### PR Hygiene

**Rebasing:**
- **Rebase onto develop** before opening a PR and before merge to maintain linear history
- Use `git fetch origin && git rebase origin/develop` to sync your branch
- Use `--force-with-lease` when force-pushing rebased branches (safer than `--force`)
- Notify reviewers after force-pushing during active review
- **Exception:** Never rebase after PR is approved and others have reviewed specific commits

**Commit organization:**
- **Squash fixup commits** (typos, "oops", review feedback) into their parent commits
- **Keep logically distinct changes** as separate commits that could be reverted independently
- Each commit should compile and pass tests independently
- No "WIP", "fix tests", or "lint" commits in final PR - squash these

**Before requesting review:**
```bash
# Ensure up-to-date with develop
git fetch origin && git rebase origin/develop

# Clean up commit history (squash fixups, reword messages)
git rebase -i origin/develop

# Force push with safety check
git push --force-with-lease

# Verify everything works
npm run test:backend
cd apps/frontend && npm test && npm run lint && npm run typecheck
```

**PR size:**
- Keep PRs small (<400 lines changed ideally)
- Split large features into stacked PRs if possible

## Pull Request Process

1. **Fork the repository** and create your branch from `develop` (not main!)

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines

3. **Test thoroughly**:
   ```bash
   # Python (from repository root)
   npm run test:backend

   # Frontend
   cd apps/frontend && npm test && npm run lint && npm run typecheck
   ```

4. **Update documentation** if your changes affect:
   - Public APIs
   - Configuration options
   - User-facing behavior

5. **Create the Pull Request**:
   - Use a clear, descriptive title
   - Reference any related issues
   - Describe what changes you made and why
   - Include screenshots for UI changes
   - List any breaking changes

6. **PR Title Format**:
   ```
   <type>: <description>
   ```
   Examples:
   - `feat: Add support for custom prompts`
   - `fix: Resolve memory leak in worker process`
   - `docs: Update installation instructions`

7. **Review Process**:
   - Address reviewer feedback promptly
   - Keep the PR focused on a single concern
   - Squash commits if requested

## Issue Reporting

### Bug Reports

When reporting a bug, include:

1. **Clear title** describing the issue
2. **Environment details**:
   - OS and version
   - Python version
   - Node.js version (for UI issues)
   - Jerry version
3. **Steps to reproduce** the issue
4. **Expected behavior** vs **actual behavior**
5. **Error messages** or logs (if applicable)
6. **Screenshots** (for UI issues)

### Feature Requests

When requesting a feature:

1. **Describe the problem** you're trying to solve
2. **Explain your proposed solution**
3. **Consider alternatives** you've thought about
4. **Provide context** on your use case

## Architecture Overview

Jerry consists of two main parts:

### Python Backend (`apps/backend/`)

The core autonomous coding framework:

- **Entry Points**: `run.py` (build runner), `spec_runner.py` (spec creator)
- **Agent System**: `agent.py`, `client.py`, `prompts/`
- **Execution**: `coordinator.py` (parallel), `worktree.py` (isolation)
- **Memory**: `memory.py` (file-based), `graphiti_memory.py` (graph-based)
- **QA**: `qa_loop.py`, `prompts/qa_*.md`

### Electron Frontend (`apps/frontend/`)

Desktop interface:

- **Main Process**: `src/main/` - Electron main process, IPC handlers
- **Renderer**: `src/renderer/` - React UI components
- **Shared**: `src/shared/` - Types and utilities

For detailed architecture information, see [CLAUDE.md](CLAUDE.md).

---

## Questions?

If you have questions about contributing, feel free to:

1. Open a GitHub issue with the `question` label
2. Review existing issues and discussions

Thank you for contributing to Jerry!
