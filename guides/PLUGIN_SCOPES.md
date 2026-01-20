# Plugin Scopes - Global vs Project-Specific

Auto Claude supports two plugin installation scopes: **global** (default) and **project-specific**. This provides flexibility for shared tooling while allowing per-project customization.

## Overview

| Scope | Location | Use Case | Example |
|-------|----------|----------|---------|
| **Global** | Application Support folder | Shared tools, personal preferences | LLM providers,常用 methodologies |
| **Project** | `.auto-claude/plugins/` | Project-specific requirements | Custom methodology, team integrations |

## Directory Structure

```
~/.auto-claude/                          # Global: Application Support
├── plugins/                             # Global plugins
│   ├── @auto-claude/
│   │   ├── bmad/                        # Available to all projects
│   │   ├── provider-openai/
│   │   └── integration-github/
│   └── @my-user/
│       └── my-custom-methodology/
├── registry-cache/                      # Plugin registry cache
└── config.json                          # Global plugin config

~/projects/my-project/
├── .auto-claude/
│   ├── plugins/                         # Project-specific plugins
│   │   └── @my-team/
│   │       └── team-methodology/        # Only for this project
│   └── config.json                      # Project plugin config
└── package.json
```

## Installation Flows

### Global Installation (Default)

```bash
# Install globally (available to all projects)
auto-claude plugin install bmad

# Explicit global flag
auto-claude plugin install bmad --global

# Output
✓ Installed bmad@1.0.0 globally
  Location: ~/.auto-claude/plugins/@auto-claude/bmad
  Available to: All projects
```

**Implementation:**
```typescript
async install(pluginId: string, options: InstallOptions = {}): Promise<void> {
  const scope = options.scope ?? 'global';
  const targetDir = scope === 'global'
    ? this.getGlobalPluginDir()
    : this.getProjectPluginDir();

  await this.installPlugin(pluginId, targetDir);
}

private getGlobalPluginDir(): string {
  const platform = process.platform;

  if (platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Auto Claude',
      'plugins'
    );
  }

  if (platform === 'win32') {
    return path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Auto Claude',
      'plugins'
    );
  }

  // Linux
  return path.join(
    os.homedir(),
    '.auto-claude',
    'plugins'
  );
}
```

### Project-Specific Installation

```bash
# Install for current project only
cd ~/projects/my-project
auto-claude plugin install bmad --project

# Or specify project path
auto-claude plugin install bmad --project ~/projects/other-project

# Output
✓ Installed bmad@1.0.0 for project "my-project"
  Location: ~/projects/my-project/.auto-claude/plugins/@auto-claude/bmad
  Available to: my-project only
```

**Implementation:**
```typescript
async installForProject(
  pluginId: string,
  projectPath?: string
): Promise<void> {
  const projectDir = projectPath ?? process.cwd();
  const targetDir = path.join(projectDir, '.auto-claude', 'plugins');

  await this.installPlugin(pluginId, targetDir);
}
```

## Plugin Resolution Order

When resolving plugins, project-specific plugins take precedence over global plugins:

```
1. Project plugins (.auto-claude/plugins/)
   ↓ (not found)
2. Global plugins (~/.auto-claude/plugins/)
   ↓ (not found)
3. Built-in plugins (bundled with app)
```

**Implementation:**
```typescript
class PluginResolver {
  async resolvePlugin(pluginId: string): Promise<Plugin | null> {
    const projectDir = this.detectProjectDir();

    // 1. Check project-specific
    if (projectDir) {
      const projectPath = path.join(
        projectDir,
        '.auto-claude',
        'plugins',
        this.scopePath(pluginId)
      );

      if (await pathExists(projectPath)) {
        return this.loadPlugin(projectPath);
      }
    }

    // 2. Check global
    const globalPath = path.join(
      this.getGlobalPluginDir(),
      this.scopePath(pluginId)
    );

    if (await pathExists(globalPath)) {
      return this.loadPlugin(globalPath);
    }

    // 3. Check built-ins
    const builtin = this.getBuiltInPlugin(pluginId);
    if (builtin) {
      return builtin;
    }

    return null;
  }

  private scopePath(pluginId: string): string {
    // Convert scoped npm package to path
    // @auto-claude/bmad -> @auto-claude/bmad
    // my-plugin -> my-plugin
    return pluginId.startsWith('@')
      ? pluginId
      : pluginId.replace('/', path.sep);
  }
}
```

## Scoping Strategies

### Strategy 1: Shadowing (Recommended)

Project plugins "shadow" global plugins with the same ID:

```typescript
// Global: bmad@1.0.0
// Project: bmad@2.0.0 (overrides global for this project)

const plugin = await resolver.resolvePlugin('bmad');
// Returns project's bmad@2.0.0
```

### Strategy 2: Explicit Selection

Require explicit selection when conflicts exist:

```typescript
// Requires explicit --project flag
auto-claude plugin install bmad --project

// When running, must specify which to use
auto-claude run --use-plugin project:bmad
auto-claude run --use-plugin global:bmad
```

### Strategy 3: Merge

Combine global and project plugins:

```typescript
// List all available plugins (merged)
const allPlugins = [
  ...projectPlugins,  // Loaded first
  ...globalPlugins,   // Loaded second
  ...builtInPlugins,  // Loaded last
];
```

## Configuration

### Global Configuration

```json
// ~/.auto-claude/config.json
{
  "plugins": {
    "autoUpdate": true,
    "updateInterval": "daily",
    "defaultScope": "global",
    "enabled": {
      "@auto-claude/bmad": true,
      "@auto-claude/provider-openai": true,
      "@auto-claude/integration-github": false
    }
  }
}
```

### Project Configuration

```json
// .auto-claude/config.json
{
  "plugins": {
    "inheritGlobal": true,
    "overrides": {
      "@auto-claude/bmad": {
        "enabled": false,
        "config": {
          "brainstormVariants": 5
        }
      }
    },
    "projectOnly": [
      "@my-team/team-methodology"
    ]
  }
}
```

## Migration Between Scopes

```bash
# Move global plugin to project
auto-claude plugin move bmad --to-project

# Move project plugin to global
auto-claude plugin move bmad --to-global

# Copy to project (keep global)
auto-claude plugin copy bmad --to-project

# Output
✓ Moved bmad from global to project-specific
  Old: ~/.auto-claude/plugins/@auto-claude/bmad
  New: ~/projects/my-project/.auto-claude/plugins/@auto-claude/bmad
```

**Implementation:**
```typescript
async movePlugin(
  pluginId: string,
  from: Scope,
  to: Scope
): Promise<void> {
  const sourceDir = from === 'global'
    ? this.getGlobalPluginDir()
    : this.getProjectPluginDir();

  const targetDir = to === 'global'
    ? this.getGlobalPluginDir()
    : this.getProjectPluginDir();

  const sourcePath = path.join(sourceDir, this.scopePath(pluginId));
  const targetPath = path.join(targetDir, this.scopePath(pluginId));

  // Move directory
  await fs.move(sourcePath, targetPath);

  // Update config
  await this.updateScopeConfig(pluginId, from, to);
}
```

## CLI Commands

```bash
# Installation (defaults to global)
auto-claude plugin install <id>              # Global
auto-claude plugin install <id> --global     # Explicit global
auto-claude plugin install <id> --project    # Project-specific
auto-claude plugin install <id> --project ~/path/to/project

# List plugins
auto-claude plugin list                      # All (project + global)
auto-claude plugin list --global             # Global only
auto-claude plugin list --project            # Project only
auto-claude plugin list --project ~/other    # Specific project

# Remove plugins
auto-claude plugin uninstall <id>            # Uninstall from current scope
auto-claude plugin uninstall <id> --global   # Uninstall global
auto-claude plugin uninstall <id> --project  # Uninstall project

# Move between scopes
auto-claude plugin move <id> --to-project
auto-claude plugin move <id> --to-global

# Enable/disable plugins
auto-claude plugin enable <id>
auto-claude plugin disable <id>

# Plugin info
auto-claude plugin info <id>                 # Shows scope, version, etc.
```

## Use Cases

### Global Plugins

**Best for:**
- LLM providers (OpenAI, Anthropic, etc.)
- Common integrations (GitHub, Linear)
- Personal methodology preferences
- Developer tools and utilities

```bash
# Install once, use everywhere
auto-claude plugin install provider-openai --global
auto-claude plugin install integration-github --global
auto-claude plugin install bmad --global
```

### Project-Specific Plugins

**Best for:**
- Team-specific methodologies
- Experimental plugins
- Project configurations
- Client-specific integrations

```bash
# Install for this project only
cd ~/projects/client-work
auto-claude plugin install @client/custom-methodology --project
auto-claude plugin install @client/internal-integration --project
```

## Isolation Benefits

### 1. Version Conflicts

```
Global:  bmad@1.0.0
Project: bmad@2.0.0-beta

✓ No conflict - project uses its own version
```

### 2. Configuration Separation

```
Global:  brainstormVariants = 3 (personal preference)
Project: brainstormVariants = 5 (team requirement)

✓ Project config overrides global
```

### 3. Dependency Management

```
Global:  Plugin A depends on library@1.0
Project: Plugin B depends on library@2.0

✓ Isolated node_modules per scope
```

## Application Support Folder Paths

| Platform | Path |
|----------|------|
| **macOS** | `~/Library/Application Support/Auto Claude/plugins/` |
| **Windows** | `%APPDATA%\Auto Claude\plugins\` |
| **Linux** | `~/.auto-claude/plugins/` |

**Platform detection:**
```typescript
function getApplicationSupportPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Auto Claude');

    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Auto Claude');

    default: // linux, etc.
      return path.join(home, '.auto-claude');
  }
}
```

## Electron Integration

```typescript
// apps/frontend/src/main/plugins/scopes.ts

import { app } from 'electron';

export class PluginScopeManager {
  constructor() {
    this.ensureGlobalPluginDir();
  }

  private ensureGlobalPluginDir(): void {
    const globalDir = this.getGlobalPluginDir();
    fs.ensureDirSync(globalDir);
  }

  getGlobalPluginDir(): string {
    // Use Electron's app.getPath for cross-platform paths
    const appData = app.getPath('userData');
    return path.join(appData, 'plugins');
  }

  getProjectPluginDir(projectPath: string): string {
    return path.join(projectPath, '.auto-claude', 'plugins');
  }

  async getAllPluginDirs(projectPath?: string): Promise<string[]> {
    const dirs: string[] = [];

    // Project plugins
    if (projectPath) {
      const projectDir = this.getProjectPluginDir(projectPath);
      if (await fs.pathExists(projectDir)) {
        dirs.push(projectDir);
      }
    }

    // Global plugins
    dirs.push(this.getGlobalPluginDir());

    // Built-in plugins
    dirs.push(this.getBuiltInPluginDir());

    return dirs;
  }
}
```

## Summary

| Feature | Global | Project |
|---------|--------|---------|
| **Location** | Application Support folder | `.auto-claude/plugins/` |
| **Visibility** | All projects | Current project only |
| **Installation** | Default or `--global` | `--project` |
| **Override** | Overridden by project | Overrides global |
| **Use Case** | Shared tools, personal prefs | Project-specific, team |
| **Example** | LLM providers, GitHub | Team methodology, client tools |
