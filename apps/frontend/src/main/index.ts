// Polyfill CommonJS require for ESM compatibility
// This MUST be at the very top, before any imports that might trigger Sentry's
// require-in-the-middle hooks. Sentry's hooks expect require.cache to exist,
// which is only available in CommonJS. Without this, node-pty native module
// loading fails with "ReferenceError: require is not defined".
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Make require globally available for Sentry's require-in-the-middle hooks
globalThis.require = require;

// Load .env file FIRST before any other imports that might use process.env
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from apps/frontend directory
// In development: __dirname is out/main (compiled), so go up 2 levels
// In production: app resources directory
const possibleEnvPaths = [
  resolve(__dirname, '../../.env'),           // Development: out/main -> apps/frontend/.env
  resolve(__dirname, '../../../.env'),        // Alternative: might be in different location
  resolve(process.cwd(), 'apps/frontend/.env'), // Fallback: from workspace root
];

for (const envPath of possibleEnvPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, quiet: true });
    console.log(`[dotenv] Loaded environment from: ${envPath}`);
    break;
  }
}

import { app, BrowserWindow, shell, nativeImage, session, screen } from 'electron';
import { join } from 'path';
import { accessSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { setupIpcHandlers } from './ipc-setup';
import { AgentManager } from './agent';
import { TerminalManager } from './terminal-manager';
import { pythonEnvManager } from './python-env-manager';
import { getUsageMonitor } from './claude-profile/usage-monitor';
import { initializeUsageMonitorForwarding } from './ipc-handlers/terminal-handlers';
import { initializeAppUpdater, stopPeriodicUpdates } from './app-updater';
import { DEFAULT_APP_SETTINGS, IPC_CHANNELS } from '../shared/constants';
import { readSettingsFile } from './settings-utils';
import { setupErrorLogging } from './app-logger';
import { initSentryMain } from './sentry';
import { preWarmToolCache } from './cli-tool-manager';
import { initializeClaudeProfileManager, getClaudeProfileManager } from './claude-profile-manager';
import { isMacOS, isWindows } from './platform';
import type { AppSettings, AuthFailureInfo } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Window sizing constants
// ─────────────────────────────────────────────────────────────────────────────
/** Preferred window width on startup */
const WINDOW_PREFERRED_WIDTH: number = 1400;
/** Preferred window height on startup */
const WINDOW_PREFERRED_HEIGHT: number = 900;
/** Absolute minimum window width (supports high DPI displays with scaling) */
const WINDOW_MIN_WIDTH: number = 800;
/** Absolute minimum window height (supports high DPI displays with scaling) */
const WINDOW_MIN_HEIGHT: number = 500;
/** Margin from screen edges to avoid edge-to-edge windows */
const WINDOW_SCREEN_MARGIN: number = 20;
/** Default screen dimensions used as fallback when screen.getPrimaryDisplay() fails */
const DEFAULT_SCREEN_WIDTH: number = 1920;
const DEFAULT_SCREEN_HEIGHT: number = 1080;

// Setup error logging early (captures uncaught exceptions)
setupErrorLogging();

// Initialize Sentry for error tracking (respects user's sentryEnabled setting)
initSentryMain();

/**
 * Load app settings synchronously (for use during startup).
 * This is a simple merge with defaults - no migrations or auto-detection.
 */
function loadSettingsSync(): AppSettings {
  const savedSettings = readSettingsFile();
  return { ...DEFAULT_APP_SETTINGS, ...savedSettings } as AppSettings;
}

/**
 * Clean up stale update metadata files from the redundant source updater system.
 *
 * The old "source updater" wrote .update-metadata.json files that could persist
 * across app updates and cause version display desync. This cleanup ensures
 * we use the actual bundled version from app.getVersion().
 */
function cleanupStaleUpdateMetadata(): void {
  const userData = app.getPath('userData');
  const stalePaths = [
    join(userData, 'auto-claude-source'),
    join(userData, 'backend-source'),
  ];

  for (const stalePath of stalePaths) {
    if (existsSync(stalePath)) {
      try {
        rmSync(stalePath, { recursive: true, force: true });
        console.warn(`[main] Cleaned up stale update metadata: ${stalePath}`);
      } catch (e) {
        console.warn(`[main] Failed to clean up stale metadata at ${stalePath}:`, e);
      }
    }
  }
}

// Get icon path based on platform
function getIconPath(): string {
  // In dev mode, __dirname is out/main, so we go up to project root then into resources
  // In production, resources are in the app's resources folder
  const resourcesPath = is.dev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath);

  let iconName: string;
  if (isMacOS()) {
    // Use PNG in dev mode (works better), ICNS in production
    iconName = is.dev ? 'icon-256.png' : 'icon.icns';
  } else if (isWindows()) {
    iconName = 'icon.ico';
  } else {
    iconName = 'icon.png';
  }

  const iconPath = join(resourcesPath, iconName);
  return iconPath;
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;
let terminalManager: TerminalManager | null = null;

function createWindow(): void {
  // Get the primary display's work area (accounts for taskbar, dock, etc.)
  // Wrapped in try/catch to handle potential failures with fallback to safe defaults
  let workAreaSize: { width: number; height: number };
  try {
    const display = screen.getPrimaryDisplay();
    // Validate the returned object has expected structure with valid dimensions
    if (
      display &&
      display.workAreaSize &&
      typeof display.workAreaSize.width === 'number' &&
      typeof display.workAreaSize.height === 'number' &&
      display.workAreaSize.width > 0 &&
      display.workAreaSize.height > 0
    ) {
      workAreaSize = display.workAreaSize;
    } else {
      console.error(
        '[main] screen.getPrimaryDisplay() returned unexpected structure:',
        JSON.stringify(display)
      );
      workAreaSize = { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT };
    }
  } catch (error: unknown) {
    console.error('[main] Failed to get primary display, using fallback dimensions:', error);
    workAreaSize = { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT };
  }

  // Calculate available space with a small margin to avoid edge-to-edge windows
  const availableWidth: number = workAreaSize.width - WINDOW_SCREEN_MARGIN;
  const availableHeight: number = workAreaSize.height - WINDOW_SCREEN_MARGIN;

  // Calculate actual dimensions (preferred, but capped to margin-adjusted available space)
  const width: number = Math.min(WINDOW_PREFERRED_WIDTH, availableWidth);
  const height: number = Math.min(WINDOW_PREFERRED_HEIGHT, availableHeight);

  // Ensure minimum dimensions don't exceed the actual initial window size
  const minWidth: number = Math.min(WINDOW_MIN_WIDTH, width);
  const minHeight: number = Math.min(WINDOW_MIN_HEIGHT, height);

  // Create the browser window
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Prevent terminal lag when window loses focus
    }
  });

  // Show window when ready to avoid visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle external links with URL scheme allowlist for security
  // Note: Terminal links now use IPC via WebLinksAddon callback, but this handler
  // catches any other window.open() calls (e.g., from third-party libraries)
  const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'mailto:'];
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url);
      if (!ALLOWED_URL_SCHEMES.includes(url.protocol)) {
        console.warn('[main] Blocked URL with disallowed scheme:', details.url);
        return { action: 'deny' };
      }
    } catch {
      console.warn('[main] Blocked invalid URL:', details.url);
      return { action: 'deny' };
    }
    shell.openExternal(details.url).catch((error) => {
      console.warn('[main] Failed to open external URL:', details.url, error);
    });
    return { action: 'deny' };
  });

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development
  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  // Clean up on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Set app name before ready (for dock tooltip on macOS in dev mode)
app.setName('Auto Claude');
if (isMacOS()) {
  // Force the name to appear in dock on macOS
  app.name = 'Auto Claude';
}

// Fix Windows GPU cache permission errors (0x5 Access Denied)
if (isWindows()) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-gpu-program-cache');
  console.log('[main] Applied Windows GPU cache fixes');
}

// Initialize the application
app.whenReady().then(() => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.autoclaude.ui');

  // Clear cache on Windows to prevent permission errors from stale cache
  if (isWindows()) {
    session.defaultSession.clearCache()
      .then(() => console.log('[main] Cleared cache on startup'))
      .catch((err) => console.warn('[main] Failed to clear cache:', err));
  }

  // Clean up stale update metadata from the old source updater system
  // This prevents version display desync after electron-updater installs a new version
  cleanupStaleUpdateMetadata();

  // Set dock icon on macOS
  if (isMacOS()) {
    const iconPath = getIconPath();
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock?.setIcon(icon);
      }
    } catch (e) {
      console.warn('Could not set dock icon:', e);
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Initialize agent manager
  agentManager = new AgentManager();

  // Load settings and configure agent manager with Python and auto-claude paths
  // Uses EAFP pattern (try/catch) instead of LBYL (existsSync) to avoid TOCTOU race conditions
  const settingsPath = join(app.getPath('userData'), 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Validate and migrate autoBuildPath - must contain runners/spec_runner.py
    // Uses EAFP pattern (try/catch with accessSync) instead of existsSync to avoid TOCTOU race conditions
    let validAutoBuildPath = settings.autoBuildPath;
    if (validAutoBuildPath) {
      const specRunnerPath = join(validAutoBuildPath, 'runners', 'spec_runner.py');
      let specRunnerExists = false;
      try {
        accessSync(specRunnerPath);
        specRunnerExists = true;
      } catch {
        // File doesn't exist or isn't accessible
      }

      if (!specRunnerExists) {
        // Migration: Try to fix stale paths from old project structure
        // Old structure: /path/to/project/auto-claude
        // New structure: /path/to/project/apps/backend
        let migrated = false;
        if (validAutoBuildPath.endsWith('/auto-claude') || validAutoBuildPath.endsWith('\\auto-claude')) {
          const basePath = validAutoBuildPath.replace(/[/\\]auto-claude$/, '');
          const correctedPath = join(basePath, 'apps', 'backend');
          const correctedSpecRunnerPath = join(correctedPath, 'runners', 'spec_runner.py');

          let correctedPathExists = false;
          try {
            accessSync(correctedSpecRunnerPath);
            correctedPathExists = true;
          } catch {
            // Corrected path doesn't exist
          }

          if (correctedPathExists) {
            console.log('[main] Migrating autoBuildPath from old structure:', validAutoBuildPath, '->', correctedPath);
            settings.autoBuildPath = correctedPath;
            validAutoBuildPath = correctedPath;
            migrated = true;

            // Save the corrected setting - we're the only process modifying settings at startup
            try {
              writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
              console.log('[main] Successfully saved migrated autoBuildPath to settings');
            } catch (writeError) {
              console.warn('[main] Failed to save migrated autoBuildPath:', writeError);
            }
          }
        }

        if (!migrated) {
          console.warn('[main] Configured autoBuildPath is invalid (missing runners/spec_runner.py), will use auto-detection:', validAutoBuildPath);
          validAutoBuildPath = undefined; // Let auto-detection find the correct path
        }
      }
    }

    if (settings.pythonPath || validAutoBuildPath) {
      console.warn('[main] Configuring AgentManager with settings:', {
        pythonPath: settings.pythonPath,
        autoBuildPath: validAutoBuildPath
      });
      agentManager.configure(settings.pythonPath, validAutoBuildPath);
    }
  } catch (error: unknown) {
    // ENOENT means no settings file yet - that's fine, use defaults
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // No settings file, use defaults - this is expected on first run
    } else {
      console.warn('[main] Failed to load settings for agent configuration:', error);
    }
  }

  // Initialize terminal manager
  terminalManager = new TerminalManager(() => mainWindow);

  // Setup IPC handlers (pass pythonEnvManager for Python path management)
  setupIpcHandlers(agentManager, terminalManager, () => mainWindow, pythonEnvManager);

  // Create window
  createWindow();

  // Pre-warm CLI tool cache in background (non-blocking)
  // This ensures CLI detection is done before user needs it
  // Include all commonly used tools to prevent sync blocking on first use
  setImmediate(() => {
    preWarmToolCache(['claude', 'git', 'gh', 'python']).catch((error) => {
      console.warn('[main] Failed to pre-warm CLI cache:', error);
    });
  });

  // Initialize Claude profile manager, then start usage monitor
  // We do this sequentially to ensure profile data (including auto-switch settings)
  // is loaded BEFORE the usage monitor attempts to read settings.
  // This prevents the "UsageMonitor disabled" error due to race condition.
  initializeClaudeProfileManager()
    .then(() => {
      // Only start monitoring if window is still available (app not quitting)
      if (mainWindow) {
        // Setup event forwarding from usage monitor to renderer
        initializeUsageMonitorForwarding(mainWindow);

        // Start the usage monitor
        const usageMonitor = getUsageMonitor();
        usageMonitor.start();
        console.warn('[main] Usage monitor initialized and started (after profile load)');

        // Check for migrated profiles that need re-authentication
        // These profiles were moved from shared ~/.claude to isolated directories
        // and need new credentials since they now use a different keychain entry
        const profileManager = getClaudeProfileManager();
        const migratedProfileIds = profileManager.getMigratedProfileIds();
        const activeProfile = profileManager.getActiveProfile();

        if (migratedProfileIds.length > 0) {
          console.warn('[main] Found migrated profiles that need re-authentication:', migratedProfileIds);

          // If the active profile was migrated, show auth failure modal immediately
          if (migratedProfileIds.includes(activeProfile.id)) {
            // Wait for renderer to be ready before sending the event
            mainWindow.webContents.once('did-finish-load', () => {
              // Small delay to ensure stores are initialized
              setTimeout(() => {
                const authFailureInfo: AuthFailureInfo = {
                  profileId: activeProfile.id,
                  profileName: activeProfile.name,
                  failureType: 'missing',
                  message: `Profile "${activeProfile.name}" was migrated to an isolated directory and needs re-authentication.`,
                  detectedAt: new Date()
                };
                console.warn('[main] Sending auth failure for migrated active profile:', activeProfile.name);
                mainWindow?.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
              }, 1000);
            });
          }
        }
      }
    })
    .catch((error) => {
      console.warn('[main] Failed to initialize profile manager:', error);
      // Fallback: try starting usage monitor anyway (might use defaults)
      if (mainWindow) {
        initializeUsageMonitorForwarding(mainWindow);
        const usageMonitor = getUsageMonitor();
        usageMonitor.start();
      }
    });

  if (mainWindow) {
    // Log debug mode status
    const isDebugMode = process.env.DEBUG === 'true';
    if (isDebugMode) {
      console.warn('[main] ========================================');
      console.warn('[main] DEBUG MODE ENABLED (DEBUG=true)');
      console.warn('[main] ========================================');
    }

    // Initialize app auto-updater (only in production, or when DEBUG_UPDATER is set)
    const forceUpdater = process.env.DEBUG_UPDATER === 'true';
    if (app.isPackaged || forceUpdater) {
      // Load settings to get beta updates preference
      const settings = loadSettingsSync();
      const betaUpdates = settings.betaUpdates ?? false;

      initializeAppUpdater(mainWindow, betaUpdates);
      console.warn('[main] App auto-updater initialized');
      console.warn(`[main] Beta updates: ${betaUpdates ? 'enabled' : 'disabled'}`);
      if (forceUpdater && !app.isPackaged) {
        console.warn('[main] Updater forced in dev mode via DEBUG_UPDATER=true');
        console.warn('[main] Note: Updates won\'t actually work in dev mode');
      }
    } else {
      console.warn('[main] ========================================');
      console.warn('[main] App auto-updater DISABLED (development mode)');
      console.warn('[main] To test updater logging, set DEBUG_UPDATER=true');
      console.warn('[main] Note: Actual updates only work in packaged builds');
      console.warn('[main] ========================================');
    }
  }

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (!isMacOS()) {
    app.quit();
  }
});

// Cleanup before quit
app.on('before-quit', async () => {
  // Stop periodic update checks
  stopPeriodicUpdates();

  // Stop usage monitor
  const usageMonitor = getUsageMonitor();
  usageMonitor.stop();
  console.warn('[main] Usage monitor stopped');

  // Kill all running agent processes
  if (agentManager) {
    await agentManager.killAll();
  }
  // Kill all terminal processes
  if (terminalManager) {
    await terminalManager.killAll();
  }
});

// Note: Uncaught exceptions and unhandled rejections are now
// logged by setupErrorLogging() in app-logger.ts
