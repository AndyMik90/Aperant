# Dynamic Plugin Loading - TypeScript SDK

This document describes strategies for dynamically loading TypeScript plugins at runtime in the Auto Claude application.

## The Challenge

TypeScript plugins present a unique challenge for runtime loading:

1. **TypeScript requires compilation** - Can't directly execute `.ts` files
2. **Multiple plugin sources** - Local paths, registry cache, npm packages
3. **Electron context** - Main process vs renderer process considerations
4. **Security** - Loading untrusted code safely
5. **Performance** - Fast app startup with minimal overhead

## Architecture Overview

```
App Launch
    │
    ▼
┌─────────────────────────────────────────┐
│  Plugin Discovery & Scanning            │
│  - Scan .auto-claude/plugins/           │
│  - Load plugin manifests                │
│  - Validate dependencies                │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Plugin Resolution                      │
│  - Resolve entry points                 │
│  - Check for compiled output            │
│  - Compile if needed (lazy)             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Dynamic Import                         │
│  - import() for ESM modules             │
│  - Module cache management              │
│  - Isolated plugin contexts             │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Plugin Registration                    │
│  - Register with PluginManager          │
│  - Call lifecycle hooks                 │
│  - Expose plugin capabilities           │
└─────────────────────────────────────────┘
```

## Plugin Loading Strategies

### Strategy 1: Pre-compiled Distribution (Recommended)

Plugins ship with pre-compiled JavaScript. Runtime loads only the compiled output.

**Pros:**
- Fastest startup (no compilation needed)
- Smaller plugin packages (no TypeScript source in production)
- Standard Node.js module resolution
- Source maps available for debugging

**Cons:**
- Requires build step during development
- TypeScript source not included (harder to inspect/debug)

**Plugin Structure:**
```
my-plugin/
├── package.json          # Points to compiled output
├── dist/
│   ├── index.js         # Compiled JavaScript (ESM)
│   ├── index.d.ts       # TypeScript types
│   ├── index.js.map     # Source map
│   └── plugin.js
├── src/
│   └── index.ts         # TypeScript source (dev only)
└── tsconfig.json
```

**package.json:**
```json
{
  "name": "@auto-claude/my-plugin",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./plugin": "./dist/plugin.js"
  }
}
```

**Loader Implementation:**
```typescript
// src/plugin/loader.ts

import { pathToFileURL } from 'url';
import { pathExists } from 'fs-extra';

interface LoadResult {
  plugin: any;  // The loaded plugin definition
  module: NodeModule;
  sourcePath: string;
}

export class PluginLoader {
  private loadedPlugins = new Map<string, LoadResult>();

  async loadPlugin(pluginPath: string): Promise<LoadResult> {
    // Resolve entry point
    const packageJson = await this.readPackageJson(pluginPath);
    const entryPoint = packageJson.exports?.['./plugin'] || packageJson.main;

    const fullPath = path.join(pluginPath, entryPoint);

    // Check if compiled output exists
    if (!(await pathExists(fullPath))) {
      throw new Error(
        `Plugin entry point not found: ${fullPath}. ` +
        `Ensure the plugin has been built (npm run build).`
      );
    }

    // Dynamic import (ESM only)
    const moduleUrl = pathToFileURL(fullPath).href;
    const module = await import(moduleUrl);

    const result: LoadResult = {
      plugin: module.default || module,
      module,
      sourcePath: fullPath,
    };

    this.loadedPlugins.set(pluginPath, result);
    return result;
  }

  async reloadPlugin(pluginPath: string): Promise<LoadResult> {
    // Clear module cache
    const cached = this.loadedPlugins.get(pluginPath);
    if (cached) {
      delete require.cache[require.resolve(cached.sourcePath)];
      this.loadedPlugins.delete(pluginPath);
    }

    return this.loadPlugin(pluginPath);
  }

  private async readPackageJson(pluginPath: string) {
    const jsonPath = path.join(pluginPath, 'package.json');
    const content = await fs.readFile(jsonPath, 'utf-8');
    return JSON.parse(content);
  }
}
```

### Strategy 2: Runtime TypeScript Compilation

Compile TypeScript plugins on-the-fly using `esbuild` or `swc`.

**Pros:**
- Distribute TypeScript source directly
- No build step required
- Easier debugging (source maps included)

**Cons:**
- Slower first load (compilation overhead)
- Larger runtime dependencies
- Potential version conflicts with TypeScript

**Loader with esbuild:**
```typescript
// src/plugin/loader-rtc.ts

import * as esbuild from 'esbuild';
import { pathToFileURL } from 'url';

export class RuntimeTypeScriptLoader {
  private buildCache = new Map<string, string>();

  async loadPlugin(pluginPath: string): Promise<any> {
    const packageJson = await this.readPackageJson(pluginPath);

    // Check for pre-compiled output first
    if (await this.hasCompiledOutput(pluginPath, packageJson)) {
      return this.loadCompiled(pluginPath, packageJson);
    }

    // Compile TypeScript on-the-fly
    return this.loadFromSource(pluginPath, packageJson);
  }

  private async loadFromSource(pluginPath: string, packageJson: any) {
    const tsEntry = packageJson.exports?.['./plugin'] || './src/plugin.ts';
    const tsPath = path.join(pluginPath, tsEntry);

    // Use cache if available
    if (this.buildCache.has(tsPath)) {
      const moduleUrl = this.buildCache.get(tsPath)!;
      const module = await import(moduleUrl);
      return module.default || module;
    }

    // Bundle with esbuild
    const result = await esbuild.build({
      entryPoints: [tsPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      sourcemap: 'inline',
      write: false,  // Return in-memory result
      external: [
        '@auto-claude/sdk',
        ...Object.keys(packageJson.peerDependencies || {}),
      ],
    });

    // Write to temp file for import
    const tempPath = path.join(
      os.tmpdir(),
      `auto-claude-plugin-${Date.now()}.js`
    );
    await fs.writeFile(tempPath, result.outputFiles[0].text);

    const moduleUrl = pathToFileURL(tempPath).href;
    this.buildCache.set(tsPath, moduleUrl);

    const module = await import(moduleUrl);
    return module.default || module;
  }
}
```

### Strategy 3: Build-on-Install

Compile plugins when they're installed from the registry.

**Pros:**
- Fast runtime loading (pre-compiled)
- Source preserved for inspection
- Build happens once during install

**Cons:**
- Slower installation process
- Requires TypeScript toolchain in user environment

**Installer Hook:**
```typescript
// src/plugin/installer.ts

export class PluginInstaller {
  async installFromRegistry(pluginId: string, targetPath: string) {
    // 1. Copy plugin source
    await this.copyPlugin(pluginId, targetPath);

    // 2. Check if build is needed
    const hasDist = await pathExists(path.join(targetPath, 'dist'));

    if (!hasDist) {
      console.log(`Building ${pluginId}...`);

      // 3. Install dependencies
      await this.exec('npm install', { cwd: targetPath });

      // 4. Build plugin
      await this.exec('npm run build', { cwd: targetPath });
    }

    // 5. Load and register
    return this.loader.loadPlugin(targetPath);
  }
}
```

## Recommended Hybrid Approach

Combine the best of all strategies:

1. **Prefer compiled output** - Use `dist/` if available
2. **Fallback to runtime compilation** - Compile from source if needed
3. **Cache compiled output** - Save for future loads
4. **Background build** - Async compile for next launch

```typescript
// src/plugin/loader.ts

export class HybridPluginLoader {
  private cacheDir: string;
  private runtimeLoader: RuntimeTypeScriptLoader;

  async loadPlugin(pluginPath: string): Promise<Plugin> {
    const packageJson = await this.readPackageJson(pluginPath);
    const compiledPath = path.join(pluginPath, 'dist/plugin.js');

    // Strategy 1: Load pre-compiled (preferred)
    if (await pathExists(compiledPath)) {
      return this.loadCompiled(compiledPath);
    }

    // Strategy 2: Load from cache (previous runtime compilation)
    const cachedPath = path.join(this.cacheDir, this.getCacheKey(pluginPath));
    if (await pathExists(cachedPath)) {
      return this.loadCompiled(cachedPath);
    }

    // Strategy 3: Runtime compilation
    console.log(`Compiling plugin at ${pluginPath}...`);
    const plugin = await this.runtimeLoader.loadPlugin(pluginPath);

    // Strategy 4: Cache for next time (background)
    this.saveToCache(pluginPath, cachedPath).catch(err => {
      console.warn('Failed to cache plugin:', err);
    });

    return plugin;
  }
}
```

## Electron-Specific Considerations

### Main Process Loading

Plugins should be loaded in the main process where they have access to Node.js APIs:

```typescript
// apps/frontend/src/main/plugin-manager.ts

import { BrowserWindow } from 'electron';
import { PluginLoader } from './plugin-loader';

export class ElectronPluginManager {
  private loader: PluginLoader;
  private plugins = new Map<string, Plugin>();

  async initialize(): Promise<void> {
    // Scan plugins directory
    const pluginDirs = await this.scanPluginDirectories();

    // Load each plugin
    for (const dir of pluginDirs) {
      try {
        const plugin = await this.loader.loadPlugin(dir);
        this.plugins.set(plugin.id, plugin);

        // Register UI components with renderer
        if (plugin.ui) {
          this.registerUIComponents(plugin);
        }
      } catch (err) {
        console.error(`Failed to load plugin from ${dir}:`, err);
      }
    }

    // Notify renderer process
    this.broadcastPluginList();
  }

  private registerUIComponents(plugin: Plugin): void {
    // Send UI component definitions to renderer process
    const windows = BrowserWindow.getAllWindows();

    for (const win of windows) {
      win.webContents.send('plugin:register-ui', {
        pluginId: plugin.id,
        components: plugin.ui,
      });
    }
  }
}
```

### Renderer Process Bridge

Renderer process communicates with main process for plugin capabilities:

```typescript
// apps/frontend/src/renderer/plugins/bridge.ts

import { ipcRenderer } from 'electron';

export class PluginBridge {
  // Get list of available plugins
  async listPlugins(): Promise<Plugin[]> {
    return ipcRenderer.invoke('plugin:list');
  }

  // Get plugin capabilities
  async getPluginCapabilities(pluginId: string): Promise<any> {
    return ipcRenderer.invoke('plugin:capabilities', pluginId);
  }

  // Execute plugin action
  async executePluginAction(
    pluginId: string,
    action: string,
    params: any
  ): Promise<any> {
    return ipcRenderer.invoke('plugin:execute', { pluginId, action, params });
  }

  // Listen for UI component registration
  onUIComponentsRegister(callback: (components: any) => void): () => void {
    const handler = (_event: any, components: any) => callback(components);
    ipcRenderer.on('plugin:register-ui', handler);

    return () => ipcRenderer.removeListener('plugin:register-ui', handler);
  }
}
```

## Security Considerations

Loading untrusted code requires security measures:

### 1. Isolated Context

```typescript
// Load plugins in isolated vm context
import { createContext, runInContext } from 'vm';

export class SecurePluginLoader {
  async loadPlugin(pluginPath: string): Promise<Plugin> {
    const code = await fs.readFile(pluginPath, 'utf-8');

    // Create isolated context with limited globals
    const context = createContext({
      console,
      require: this.createRestrictedRequire(),
      exports: {},
      module: { exports: {} },
    });

    // Execute in isolated context
    runInContext(code, context);

    // Validate plugin definition
    return this.validatePlugin(context.module.exports);
  }

  private createRestrictedRequire(): (id: string) => any {
    const allowed = ['@auto-claude/sdk', 'react', 'react-dom'];

    return (id: string) => {
      if (!allowed.some(allowedId => id.startsWith(allowedId))) {
        throw new Error(`Module "${id}" is not allowed`);
      }
      return require(id);
    };
  }
}
```

### 2. Manifest Validation

```typescript
// Validate plugin manifests before loading
export function validateManifest(manifest: any): ValidationResult {
  const schema = {
    type: 'object',
    required: ['id', 'name', 'version', 'type', 'author'],
    properties: {
      id: { type: 'string', pattern: '^@[a-z0-9-]+/[a-z0-9-]+$' },
      type: { enum: ['methodology', 'provider', 'integration', 'orchestration'] },
      // ...
    },
  };

  return ajv.validate(schema, manifest);
}
```

### 3. Capability Sandboxing

```typescript
// Restrict plugin capabilities based on type
export class CapabilitySandbox {
  private capabilities = {
    methodology: ['fs:read', 'fs:write', 'spawn:git'],
    provider: ['network:http'],
    integration: ['network:http', 'fs:read'],
    orchestration: ['fs:read', 'fs:write', 'spawn:any'],
  };

  checkPermission(plugin: Plugin, capability: string): boolean {
    const allowed = this.capabilities[plugin.type] || [];
    return allowed.includes(capability);
  }
}
```

## Performance Optimizations

### 1. Parallel Loading

```typescript
// Load plugins in parallel
const plugins = await Promise.all(
  pluginDirs.map(dir => this.loader.loadPlugin(dir))
);
```

### 2. Lazy Loading

```typescript
// Load core plugins immediately, defer others
const corePlugins = ['@auto-claude/core-mcp', '@auto-claude/bmad'];
const optionalPlugins = allPlugins.filter(p => !corePlugins.includes(p.id));

// Load core
await Promise.all(corePlugins.map(loadPlugin));

// Load optional in background
setImmediate(() => optionalPlugins.forEach(loadPlugin));
```

### 3. Module Cache

```typescript
// Share SDK modules across plugins
const sdkCache = new Map();

export function getSDKModule(moduleName: string) {
  if (!sdkCache.has(moduleName)) {
    sdkCache.set(moduleName, import(`@auto-claude/sdk/${moduleName}`));
  }
  return sdkCache.get(moduleName);
}
```

## Development Workflow

### Plugin Development Mode

```typescript
// Watch for changes during development
export class DevPluginLoader extends PluginLoader {
  private watchers = new Map<string, FSWatcher>();

  async loadWithWatch(pluginPath: string): Promise<Plugin> {
    const plugin = await this.loadPlugin(pluginPath);

    // Watch for source changes
    const watcher = chokidar.watch(path.join(pluginPath, 'src/**/*.ts'));
    watcher.on('change', async () => {
      console.log(`Plugin changed: ${pluginPath}`);
      await this.reloadPlugin(pluginPath);
      this.notifyPluginReloaded(plugin.id);
    });

    this.watchers.set(pluginPath, watcher);
    return plugin;
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
```

## Troubleshooting

### Common Issues

**Issue: "Cannot find module"**
```
Solution: Ensure plugin has been built (dist/ exists)
Or use runtime compilation loader
```

**Issue: "Multiple versions of @auto-claude/sdk"**
```
Solution: Use peerDependencies and dedupe
Or implement singleton SDK module cache
```

**Issue: "Plugin crashes the app"**
```
Solution: Wrap plugin loading in try-catch
Load plugins in worker processes
```

**Issue: "Hot reload not working"**
```
Solution: Clear Node.js module cache
Use unique import URLs (add timestamp query)
```

## Summary

| Strategy | Startup Speed | Dev Experience | Complexity |
|----------|--------------|----------------|------------|
| Pre-compiled | Fastest | Requires build | Low |
| Runtime Compile | Slower | No build needed | Medium |
| Build-on-Install | Fast | One-time build | High |
| Hybrid | Fast | Transparent | High |

**Recommended**: Start with pre-compiled distribution, add runtime compilation as fallback for development.
