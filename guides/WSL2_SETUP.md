# WSL2/WSLg Setup Guide for Aperant

This guide documents the setup process and fixes required to run the Aperant Electron desktop app on Windows 11 WSL2 with WSLg (Windows Subsystem for Linux Graphics).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [WSLg Installation and Verification](#wslg-installation-and-verification)
3. [Technical Challenges and Solutions](#technical-challenges-and-solutions)
4. [Running the Application](#running-the-application)
5. [Troubleshooting](#troubleshooting)
6. [Architecture Changes](#architecture-changes)

## Prerequisites

### System Requirements

- Windows 11 (WSLg is built-in)
- WSL2 enabled with Ubuntu 20.04 or later
- WSLg (Windows Subsystem for Linux Graphics) v1.0.51 or later

### Required Software

```bash
# Update WSL to latest version
wsl --update

# Install Node.js (v24 or later) - use nvm for easier version management
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24

# Install Python 3.12+
sudo apt-get install -y python3.12 python3.12-venv python3-pip

# Install build tools
sudo apt-get install -y build-essential
```

## WSLg Installation and Verification

### Step 1: Verify WSLg Installation

WSLg comes pre-installed with Windows 11. Verify the installation:

```bash
# Check WSLg version
ls /mnt/wslg/versions.txt && cat /mnt/wslg/versions.txt
```

Expected output should show WSLg version (e.g., v1.0.71 or later):
```text
WSLg 1.0.71
Weston 10.0.1
Mesa 24.0.5
```

### Step 2: Verify Display Server

Check if the display server is running:

```bash
# Verify DISPLAY and WAYLAND_DISPLAY environment variables
echo $DISPLAY
echo $WAYLAND_DISPLAY

# Should output something like:
# DISPLAY=:0
# WAYLAND_DISPLAY=wayland-0
```

### Step 3: Test GUI Applications

Test with a simple GUI app:

```bash
# Install x11-apps for testing
sudo apt-get install -y x11-apps

# Test with xclock (should open a clock window)
xclock
```

If the clock appears in Windows, WSLg is working correctly.

### Step 4: Restart WSL (if needed)

If display variables are not set or GUI apps don't work:

```powershell
# From PowerShell/CMD in Windows
wsl --shutdown

# Wait 8-10 seconds, then restart WSL
wsl
```

## Technical Challenges and Solutions

The following sections document the technical challenges encountered when running Electron on WSL2 and the solutions implemented.

### Challenge 1: Electron App Initialization Timing

**Problem:** On WSL2, the Electron `app` object is not immediately available at module load time, causing errors like "app.getVersion() is not a function" or "app.getPath() is not defined".

**Root Cause:** WSLg requires additional initialization time for the graphics subsystem, which delays Electron's app initialization.

**Solution:** Implement lazy initialization patterns and safe access wrappers.

#### Files Changed:

**[apps/frontend/src/main/index.ts](../apps/frontend/src/main/index.ts)**

```typescript
import { isWindows, isMacOS, isLinux } from './platform';

// Lazy-loaded platform info to avoid @electron-toolkit/utils initialization issues
const is = {
  get dev() { return !app.isPackaged; },
  get mac() { return isMacOS(); },
  get windows() { return isWindows(); },
  get linux() { return isLinux(); }
};

// Wrap app.setName in try-catch
try {
  app.setName('Aperant');
  if (isMacOS()) {
    app.name = 'Aperant';
  }

  if (isWindows()) {
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
    app.commandLine.appendSwitch('disable-gpu-program-cache');
  }
} catch (e) {
  console.warn('[main] App not ready for pre-initialization, will set name after ready');
}

// Set app user model id using app.setAppUserModelId instead of electronApp utility
app.whenReady().then(() => {
  app.setAppUserModelId('com.autoclaude.ui');
  // ... rest of initialization
});
```

### Challenge 2: Sentry Initialization Timing

**Problem:** Sentry SDK requires initialization before `app.whenReady()` but accessing `app.getVersion()` fails on WSL2 when app is not ready.

**Error Message:**
```text
Error: Sentry SDK should be initialized before the Electron app 'ready' event is fired
```

**Solution:** Safe version detection with fallback to package.json.

#### Files Changed:

**[apps/frontend/src/main/sentry.ts](../apps/frontend/src/main/sentry.ts)**

```typescript
export function initSentryMain(): void {
  // ... DSN validation ...

  // Get version safely for WSL2 compatibility
  let appVersion = 'unknown';
  try {
    appVersion = app.getVersion();
  } catch (error) {
    // WSL2: app may not be ready yet, use fallback
    try {
      const pkg = require('../../../package.json');
      appVersion = pkg.version || 'unknown';
    } catch {
      appVersion = 'dev';
    }
  }

  Sentry.init({
    dsn: cachedDsn,
    environment: app.isPackaged ? 'production' : 'development',
    release: `auto-claude@${appVersion}`,
    // ... rest of config
  });
}
```

**[apps/frontend/src/main/index.ts](../apps/frontend/src/main/index.ts)**

```typescript
// Initialize Sentry at module level (before app.whenReady())
// WSL2 compatible: uses safe version detection with fallback to package.json
initSentryMain();
```

### Challenge 3: electron-log Preload Script Path Issues

**Problem:** electron-log's preload script path resolution fails on WSL2.

**Error Message:**
```text
Unable to load preload script: /home/user/projects/Auto-Claude/node_modules/electron-log/src/renderer/electron-log-preload.js
```

**Solution:** Disable preload script (main logging functionality still works).

#### Files Changed:

**[apps/frontend/src/main/app-logger.ts](../apps/frontend/src/main/app-logger.ts)**

```typescript
// Configure electron-log (wrapped in try-catch for re-import scenarios in tests)
try {
  log.initialize({ preload: false }); // Disable preload to avoid WSL2 path issues
} catch {
  // Already initialized, ignore
}
```

### Challenge 4: electron-updater Lazy Loading

**Problem:** `autoUpdater` was accessed before initialization, causing "autoUpdater is not defined" errors.

**Root Cause:** autoUpdater was imported at module level but needed to be lazy-loaded to avoid WSL2 initialization issues.

**Solution:** Implement module-level variable with lazy loading and null checks.

#### Files Changed:

**[apps/frontend/src/main/app-updater.ts](../apps/frontend/src/main/app-updater.ts)**

```typescript
// Lazy-loaded autoUpdater instance (WSL2 compatibility)
let autoUpdater: any = null;

export function initializeAppUpdater(window: BrowserWindow, betaUpdates = false): void {
  // Lazy-load electron-updater to avoid initialization before app is ready
  if (!autoUpdater) {
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater;
  }

  // Configure electron-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // ... rest of initialization
}

export async function checkForUpdates(): Promise<AppUpdateInfo | null> {
  if (!autoUpdater) {
    console.error('[app-updater] autoUpdater not initialized');
    return null;
  }
  // ... rest of function
}

// Use app.getVersion() instead of autoUpdater.currentVersion.version
export function getCurrentVersion(): string {
  return app.getVersion();
}
```

All functions that access autoUpdater now include null checks:
- `checkForUpdates()`
- `downloadUpdate()`
- `quitAndInstall()`
- `setUpdateChannelWithDowngradeCheck()`
- `downloadStableVersion()`

### Challenge 5: Settings Path Resolution

**Problem:** Module-level `settingsPath` constant was undefined on WSL2.

**Solution:** Use function call `getSettingsPath()` instead of module-level constant.

#### Files Changed:

**[apps/frontend/src/main/ipc-handlers/settings-handlers.ts](../apps/frontend/src/main/ipc-handlers/settings-handlers.ts)**

```typescript
// Removed module-level constant
// const settingsPath = getSettingsPath();  // REMOVED

// Use function call instead
writeFileSync(getSettingsPath(), JSON.stringify(newSettings, null, 2));
```

### Challenge 6: Singleton Initialization

**Problem:** Singleton instances (ProjectStore, ChangelogService, TitleGenerator) were created at module load time, causing WSL2 initialization errors.

**Solution:** Implement lazy initialization using JavaScript Proxy pattern.

#### Files Changed:

**[apps/frontend/src/main/project-store.ts](../apps/frontend/src/main/project-store.ts)**
**[apps/frontend/src/main/changelog/changelog-service.ts](../apps/frontend/src/main/changelog/changelog-service.ts)**
**[apps/frontend/src/main/title-generator.ts](../apps/frontend/src/main/title-generator.ts)**

```typescript
// Lazy-initialized singleton instance (WSL2 compatible)
let _projectStore: ProjectStore | null = null;

export const projectStore = new Proxy({} as ProjectStore, {
  get(target, prop) {
    if (!_projectStore) {
      _projectStore = new ProjectStore();
    }
    const value = _projectStore[prop as keyof ProjectStore];
    return typeof value === 'function' ? value.bind(_projectStore) : value;
  }
});
```

Same pattern applied to:
- `changelogService`
- `titleGenerator`

### Challenge 7: Preload Script Path Extension

**Problem:** Code referenced `index.mjs` but build output was `index.js`.

**Error:** Preload script not found.

**Solution:** Update path to match build output.

#### Files Changed:

**[apps/frontend/src/main/index.ts](../apps/frontend/src/main/index.ts)**

```typescript
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),  // Changed from .mjs
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false,
  // ...
}
```

### Challenge 8: Backend Path Detection

**Problem:** `app.getAppPath()` fails when app is not ready on WSL2.

**Solution:** Safe path detection with try-catch.

#### Files Changed:

**[apps/frontend/src/main/changelog/changelog-service.ts](../apps/frontend/src/main/changelog/changelog-service.ts)**
**[apps/frontend/src/main/title-generator.ts](../apps/frontend/src/main/title-generator.ts)**

```typescript
private getBackendPath(): string {
  const possiblePaths = [
    path.resolve(__dirname, '..', '..', '..', 'backend'),
    path.resolve(process.cwd(), 'apps', 'backend')
  ];

  // Add app path if app is ready (WSL2 compatibility)
  try {
    if (app && app.getAppPath) {
      possiblePaths.splice(1, 0, path.resolve(app.getAppPath(), '..', 'backend'));
    }
  } catch (e) {
    // App not ready yet, continue without app path
  }

  for (const p of possiblePaths) {
    if (existsSync(p) && existsSync(path.join(p, 'runners', 'spec_runner.py'))) {
      return p;
    }
  }
  // ... error handling
}
```

### Challenge 9: Build Configuration

**Problem:** ESM/CJS compatibility issues with Electron on WSL2.

**Solution:** Ensure CJS format with `.js` extensions for main and preload.

#### Files Changed:

**[apps/frontend/electron.vite.config.ts](../apps/frontend/electron.vite.config.ts)**

```typescript
export default defineConfig({
  main: {
    define: sentryDefines,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        },
        external: [
          '@lydell/node-pty',
          '@sentry/electron',
          '@sentry/core',
          '@sentry/node',
          '@electron-toolkit/utils'
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  // ... renderer config
});
```

### Challenge 10: Sentry for Subprocesses

**Problem:** Sentry environment export for subprocesses fails on WSL2.

**Solution:** Temporarily disable for WSL2 compatibility.

#### Files Changed:

**[apps/frontend/src/main/env-utils.ts](../apps/frontend/src/main/env-utils.ts)**

```typescript
// Disabled for WSL2 compatibility
// const sentryEnv = getSentryEnvForSubprocess();
// Object.assign(env, sentryEnv);
```

## Running the Application

### Development Mode

```bash
cd /path/to/Auto-Claude

# Install dependencies (first time only)
npm run install:all

# Start the Electron app in development mode
npm run dev

# The app should open in a new window
```

### Production Build

```bash
# Build the application
npm run build

# Start the built app
npm start
```

## Troubleshooting

### Issue: "app.getVersion() is not a function"

**Symptoms:** Errors during initialization about app not being defined.

**Solution:** All fixes from this PR implement lazy initialization. If you see this error, ensure you're using the latest code with all WSL2 compatibility patches.

### Issue: GPU/Graphics Errors

**Symptoms:** Console warnings about libGLESv2.so or GPU permission errors.

**Impact:** Non-critical. The app uses software rendering and works fine.

**Example:**
```text
libva error: vaGetDriverNameByIndex() failed with unknown libva error
```

**Solution:** These can be ignored. The app functions correctly with software rendering.

### Issue: Display Not Working

**Symptoms:** App doesn't appear or crashes with display errors.

**Solution:**
1. Verify WSLg is installed: `cat /mnt/wslg/versions.txt`
2. Check display variables: `echo $DISPLAY` and `echo $WAYLAND_DISPLAY`
3. Restart WSL: `wsl --shutdown` (from Windows PowerShell), wait 10 seconds, then `wsl`

### Issue: "Cannot find module" Errors

**Symptoms:** Module not found errors during startup.

**Solution:**
1. Delete node_modules and reinstall:
   ```bash
   rm -rf node_modules apps/frontend/node_modules apps/backend/.venv
   npm run install:all
   ```
2. Rebuild:
   ```bash
   npm run build
   ```

### Issue: Settings Not Persisting

**Symptoms:** Settings reset after restart.

**Check:** Settings are stored in `~/.config/Auto-Claude/settings.json`. Verify the directory exists and has write permissions:

```bash
ls -la ~/.config/Auto-Claude/
chmod 755 ~/.config/Auto-Claude
```

## Architecture Changes

### Lazy Initialization Pattern

All WSL2 fixes follow a consistent pattern:

1. **Delay module initialization** - Don't access Electron APIs at module load time
2. **Safe access wrappers** - Wrap Electron API calls in try-catch blocks
3. **Fallback mechanisms** - Provide fallbacks when APIs aren't available (e.g., package.json for version)
4. **Null checks** - Always check if objects are initialized before use
5. **Proxy pattern for singletons** - Defer singleton creation until first access

### Key Principles

1. **Never assume app is ready** - Even in main process, app may not be initialized
2. **Always provide fallbacks** - Have alternative paths when primary method fails
3. **Fail gracefully** - Log warnings instead of crashing
4. **Lazy load dependencies** - Use `require()` inside functions instead of top-level imports
5. **Test on WSL2** - All changes should be tested on WSL2 to catch initialization issues

## Testing on WSL2

### Verification Checklist

- [ ] App starts without errors
- [ ] Setup wizard completes successfully
- [ ] Settings persist across restarts
- [ ] Project creation works
- [ ] Logs are written correctly
- [ ] Updates can be checked (or gracefully skipped in dev mode)
- [ ] Backend subprocess spawns correctly
- [ ] Sentry initialization succeeds (if configured)

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
# Enable Electron debug output
export ELECTRON_ENABLE_LOGGING=1

# Enable updater debug output
export DEBUG_UPDATER=true

# Enable Node environment debug
export NODE_ENV=development

# Run the app
npm run dev
```

## Contributing

When making changes that affect WSL2 compatibility:

1. Test on WSL2/WSLg before submitting PR
2. Follow the lazy initialization pattern
3. Add comments explaining WSL2-specific workarounds
4. Update this document if adding new workarounds

## Related Issues

- WSL2 app initialization timing
- Electron app object availability
- Sentry initialization before app.whenReady()
- electron-log preload script paths
- Module-level constant initialization

## Credits

WSL2/WSLg compatibility work by:
- Initial testing and bug reports: @freakedbuntu
- Implementation and fixes: Claude Code AI Assistant
- Based on Aperant by: @AndyMik90

## License

Same as the Aperant project license (AGPL-3.0).
