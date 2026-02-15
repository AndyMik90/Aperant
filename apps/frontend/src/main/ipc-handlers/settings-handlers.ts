import { ipcMain, dialog, app, shell, session } from 'electron';
import { existsSync, writeFileSync, mkdirSync, statSync, readFileSync } from 'fs';
import { execFileSync } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { is } from '@electron-toolkit/utils';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { IPC_CHANNELS, DEFAULT_APP_SETTINGS, DEFAULT_AGENT_PROFILES, SPELL_CHECK_LANGUAGE_MAP, DEFAULT_SPELL_CHECK_LANGUAGE, sanitizeThinkingLevel, VALID_THINKING_LEVELS } from '../../shared/constants';
import { setAppLanguage } from '../app-language';
import type {
  AppSettings,
  IPCResult,
  SourceEnvConfig,
  SourceEnvCheckResult
} from '../../shared/types';
import { AgentManager } from '../agent';
import type { BrowserWindow } from 'electron';
import { setUpdateChannel, setUpdateChannelWithDowngradeCheck } from '../app-updater';
import { getSettingsPath, readSettingsFile } from '../settings-utils';
import { configureTools, getToolPath, getToolInfo, isPathFromWrongPlatform, preWarmToolCache } from '../cli-tool-manager';
import { parseEnvFile } from './utils';

const settingsPath = getSettingsPath();

/**
 * Auto-detect the auto-claude source path relative to the app location.
 * Works across platforms (macOS, Windows, Linux) in both dev and production modes.
 */
const detectAutoBuildSourcePath = (): string | null => {
  const possiblePaths: string[] = [];

  // Development mode paths
  if (is.dev) {
    // In dev, __dirname is typically apps/frontend/out/main
    // We need to go up to find apps/backend
    possiblePaths.push(
      path.resolve(__dirname, '..', '..', '..', 'backend'),      // From out/main -> apps/backend
      path.resolve(process.cwd(), 'apps', 'backend')             // From cwd (repo root)
    );
  } else {
    // Production mode paths (packaged app)
    // The backend is bundled as extraResources/backend
    // On all platforms, it should be at process.resourcesPath/backend
    possiblePaths.push(
      path.resolve(process.resourcesPath, 'backend')             // Primary: extraResources/backend
    );
    // Fallback paths for different app structures
    const appPath = app.getAppPath();
    possiblePaths.push(
      path.resolve(appPath, '..', 'backend'),                    // Sibling to asar
      path.resolve(appPath, '..', '..', 'Resources', 'backend')  // macOS bundle structure
    );
  }

  // Add process.cwd() as last resort on all platforms
  possiblePaths.push(path.resolve(process.cwd(), 'apps', 'backend'));

  // Enable debug logging with DEBUG=1
  const debug = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

  if (debug) {
    console.warn('[detectAutoBuildSourcePath] Platform:', process.platform);
    console.warn('[detectAutoBuildSourcePath] Is dev:', is.dev);
    console.warn('[detectAutoBuildSourcePath] __dirname:', __dirname);
    console.warn('[detectAutoBuildSourcePath] app.getAppPath():', app.getAppPath());
    console.warn('[detectAutoBuildSourcePath] process.cwd():', process.cwd());
    console.warn('[detectAutoBuildSourcePath] Checking paths:', possiblePaths);
  }

  for (const p of possiblePaths) {
    // Use runners/spec_runner.py as marker - this is the file actually needed for task execution
    // This prevents matching legacy 'auto-claude/' directories that don't have the runners
    const markerPath = path.join(p, 'runners', 'spec_runner.py');
    const exists = existsSync(p) && existsSync(markerPath);

    if (debug) {
      console.warn(`[detectAutoBuildSourcePath] Checking ${p}: ${exists ? '✓ FOUND' : '✗ not found'}`);
    }

    if (exists) {
      console.warn(`[detectAutoBuildSourcePath] Auto-detected source path: ${p}`);
      return p;
    }
  }

  console.warn('[detectAutoBuildSourcePath] Could not auto-detect Auto Claude source path. Please configure manually in settings.');
  console.warn('[detectAutoBuildSourcePath] Set DEBUG=1 environment variable for detailed path checking.');
  return null;
};

/**
 * Register all settings-related IPC handlers
 */
export function registerSettingsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Settings Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET,
    async (): Promise<IPCResult<AppSettings>> => {
      // Load settings using shared helper and merge with defaults
      const savedSettings = readSettingsFile();
      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...savedSettings };
      let needsSave = false;

      // Migration: Set agent profile to 'auto' for users who haven't made a selection (one-time)
      // This ensures new users get the optimized 'auto' profile as the default
      // while preserving existing user preferences
      if (!settings._migratedAgentProfileToAuto) {
        // Only set 'auto' if user hasn't made a selection yet
        if (!settings.selectedAgentProfile) {
          settings.selectedAgentProfile = 'auto';
        }
        settings._migratedAgentProfileToAuto = true;
        needsSave = true;
      }

      // Migration: Sync defaultModel with selectedAgentProfile (#414)
      // Fixes bug where defaultModel was stuck at 'opus' regardless of profile selection
      if (!settings._migratedDefaultModelSync) {
        if (settings.selectedAgentProfile) {
          const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === settings.selectedAgentProfile);
          if (profile) {
            settings.defaultModel = profile.model;
          }
        }
        settings._migratedDefaultModelSync = true;
        needsSave = true;
      }

      // Migration: Replace legacy thinking levels with valid equivalents
      // The 'ultrathink' value was removed but may persist in stored customPhaseThinking
      if (!settings._migratedUltrathinkToHigh) {
        if (settings.customPhaseThinking) {
          let changed = false;
          for (const phase of Object.keys(settings.customPhaseThinking) as Array<keyof typeof settings.customPhaseThinking>) {
            if (!(VALID_THINKING_LEVELS as readonly string[]).includes(settings.customPhaseThinking[phase])) {
              const mapped = sanitizeThinkingLevel(settings.customPhaseThinking[phase]);
              settings.customPhaseThinking[phase] = mapped as import('../../shared/types/settings').ThinkingLevel;
              changed = true;
            }
          }
          if (changed) {
            console.warn('[SETTINGS_GET] Migrated invalid thinking levels in customPhaseThinking');
          }
        }
        if (settings.featureThinking) {
          let changed = false;
          for (const feature of Object.keys(settings.featureThinking) as Array<keyof typeof settings.featureThinking>) {
            if (!(VALID_THINKING_LEVELS as readonly string[]).includes(settings.featureThinking[feature])) {
              const mapped = sanitizeThinkingLevel(settings.featureThinking[feature]);
              settings.featureThinking[feature] = mapped as import('../../shared/types/settings').ThinkingLevel;
              changed = true;
            }
          }
          if (changed) {
            console.warn('[SETTINGS_GET] Migrated invalid thinking levels in featureThinking');
          }
        }
        settings._migratedUltrathinkToHigh = true;
        needsSave = true;
      }

      // Migration: Clear CLI tool paths that are from a different platform
      // Fixes issue where Windows paths persisted on macOS (and vice versa)
      // when settings were synced/transferred between platforms
      // See: https://github.com/AndyMik90/Auto-Claude/issues/XXX
      const pathFields = ['pythonPath', 'gitPath', 'githubCLIPath', 'gitlabCLIPath', 'claudePath', 'autoBuildPath'] as const;
      for (const field of pathFields) {
        const pathValue = settings[field];
        if (pathValue && isPathFromWrongPlatform(pathValue)) {
          console.warn(
            `[SETTINGS_GET] Clearing ${field} - path from different platform: ${pathValue}`
          );
          delete settings[field];
          needsSave = true;
        }
      }

      // If no manual autoBuildPath is set, try to auto-detect
      if (!settings.autoBuildPath) {
        const detectedPath = detectAutoBuildSourcePath();
        if (detectedPath) {
          settings.autoBuildPath = detectedPath;
        }
      }

      // Persist migration changes
      if (needsSave) {
        try {
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        } catch (error) {
          console.error('[SETTINGS_GET] Failed to persist migration:', error);
          // Continue anyway - settings will be migrated in-memory for this session
        }
      }

      // Configure CLI tools with current settings
      configureTools({
        pythonPath: settings.pythonPath,
        gitPath: settings.gitPath,
        githubCLIPath: settings.githubCLIPath,
        gitlabCLIPath: settings.gitlabCLIPath,
        claudePath: settings.claudePath,
      });

      // Re-warm cache asynchronously after configuring (non-blocking)
      preWarmToolCache(['claude']).catch((error) => {
        console.warn('[SETTINGS_GET] Failed to re-warm CLI cache:', error);
      });

      return { success: true, data: settings as AppSettings };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SAVE,
    async (_, settings: Partial<AppSettings>): Promise<IPCResult> => {
      try {
        // Load current settings using shared helper
        const savedSettings = readSettingsFile();
        const currentSettings = { ...DEFAULT_APP_SETTINGS, ...savedSettings };
        const newSettings = { ...currentSettings, ...settings };

        // Sync defaultModel when agent profile changes (#414)
        if (settings.selectedAgentProfile) {
          const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === settings.selectedAgentProfile);
          if (profile) {
            newSettings.defaultModel = profile.model;
          }
        }

        writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8');

        // Apply Python path if changed
        if (settings.pythonPath || settings.autoBuildPath) {
          agentManager.configure(settings.pythonPath, settings.autoBuildPath);
        }

        // Configure CLI tools if any paths changed
        if (
          settings.pythonPath !== undefined ||
          settings.gitPath !== undefined ||
          settings.githubCLIPath !== undefined ||
          settings.gitlabCLIPath !== undefined ||
          settings.claudePath !== undefined
        ) {
          configureTools({
            pythonPath: newSettings.pythonPath,
            gitPath: newSettings.gitPath,
            githubCLIPath: newSettings.githubCLIPath,
            gitlabCLIPath: newSettings.gitlabCLIPath,
            claudePath: newSettings.claudePath,
          });

          // Re-warm cache asynchronously after configuring (non-blocking)
          preWarmToolCache(['claude']).catch((error) => {
            console.warn('[SETTINGS_SAVE] Failed to re-warm CLI cache:', error);
          });
        }

        // Update auto-updater channel if betaUpdates setting changed
        if (settings.betaUpdates !== undefined) {
          if (settings.betaUpdates) {
            // Enabling beta updates - just switch channel
            setUpdateChannel('beta');
          } else {
            // Disabling beta updates - switch to stable and check if downgrade is available
            // This will notify the renderer if user is on a prerelease and stable version exists
            setUpdateChannelWithDowngradeCheck('latest', true).catch((err) => {
              console.error('[settings-handlers] Failed to check for stable downgrade:', err);
            });
          }
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save settings'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET_CLI_TOOLS_INFO,
    async (): Promise<IPCResult<{
      python: ReturnType<typeof getToolInfo>;
      git: ReturnType<typeof getToolInfo>;
      gh: ReturnType<typeof getToolInfo>;
      glab: ReturnType<typeof getToolInfo>;
      claude: ReturnType<typeof getToolInfo>;
    }>> => {
      try {
        return {
          success: true,
          data: {
            python: getToolInfo('python'),
            git: getToolInfo('git'),
            gh: getToolInfo('gh'),
            glab: getToolInfo('glab'),
            claude: getToolInfo('claude'),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get CLI tools info',
        };
      }
    }
  );

  /**
   * Read ~/.claude.json to check if Claude Code onboarding is complete.
   * This allows Auto-Claude to respect Claude Code's onboarding status and
   * avoid showing the onboarding wizard to users who have already completed it.
   */
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_CLAUDE_CODE_GET_ONBOARDING_STATUS,
    async (): Promise<IPCResult<{ hasCompletedOnboarding: boolean }>> => {
      try {
        const homeDir = app.getPath('home');
        const claudeJsonPath = path.join(homeDir, '.claude.json');

        // If file doesn't exist, user hasn't completed Claude Code onboarding
        if (!existsSync(claudeJsonPath)) {
          return {
            success: true,
            data: { hasCompletedOnboarding: false }
          };
        }

        const content = readFileSync(claudeJsonPath, 'utf-8');
        const claudeConfig = JSON.parse(content);

        // Check for hasCompletedOnboarding field
        const hasCompletedOnboarding = claudeConfig.hasCompletedOnboarding === true;

        return {
          success: true,
          data: { hasCompletedOnboarding }
        };
      } catch (error) {
        // On error (parse error, read error, etc.), log and return false
        // This ensures we don't block onboarding due to corrupted .claude.json
        console.warn('[SETTINGS_CLAUDE_CODE_GET_ONBOARDING_STATUS] Error reading ~/.claude.json:', error);
        return {
          success: true,
          data: { hasCompletedOnboarding: false }
        };
      }
    }
  );

  // ============================================
  // Dialog Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.DIALOG_SELECT_DIRECTORY,
    async (): Promise<string | null> => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return null;

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Project Directory'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG_CREATE_PROJECT_FOLDER,
    async (
      _,
      location: string,
      name: string,
      initGit: boolean
    ): Promise<IPCResult<{ path: string; name: string; gitInitialized: boolean }>> => {
      try {
        // Validate inputs
        if (!location || !name) {
          return { success: false, error: 'Location and name are required' };
        }

        // Sanitize project name (convert to kebab-case, remove invalid chars)
        const sanitizedName = name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-_]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        if (!sanitizedName) {
          return { success: false, error: 'Invalid project name' };
        }

        const projectPath = path.join(location, sanitizedName);

        // Check if folder already exists
        if (existsSync(projectPath)) {
          return { success: false, error: `Folder "${sanitizedName}" already exists at this location` };
        }

        // Create the directory
        mkdirSync(projectPath, { recursive: true });

        // Initialize git if requested
        let gitInitialized = false;
        if (initGit) {
          try {
            execFileSync(getToolPath('git'), ['init'], { cwd: projectPath, stdio: 'ignore' });
            gitInitialized = true;
          } catch {
            // Git init failed, but folder was created - continue without git
            console.warn('Failed to initialize git repository');
          }
        }

        return {
          success: true,
          data: {
            path: projectPath,
            name: sanitizedName,
            gitInitialized
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create project folder'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG_GET_DEFAULT_PROJECT_LOCATION,
    async (): Promise<string | null> => {
      try {
        // Return user's home directory + common project folders
        const homeDir = app.getPath('home');
        const commonPaths = [
          path.join(homeDir, 'Projects'),
          path.join(homeDir, 'Developer'),
          path.join(homeDir, 'Code'),
          path.join(homeDir, 'Documents')
        ];

        // Return the first one that exists, or Documents as fallback
        for (const p of commonPaths) {
          if (existsSync(p)) {
            return p;
          }
        }

        return path.join(homeDir, 'Documents');
      } catch {
        return null;
      }
    }
  );

  // ============================================
  // App Info
  // ============================================

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, async (): Promise<string> => {
    // Return the actual bundled version from package.json
    const version = app.getVersion();
    console.log('[settings-handlers] APP_VERSION returning:', version);
    return version;
  });

  // ============================================
  // Shell Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.SHELL_OPEN_EXTERNAL,
    async (_, url: string): Promise<void> => {
      // Validate URL scheme to prevent opening dangerous protocols
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          console.warn(`[SHELL_OPEN_EXTERNAL] Blocked URL with unsafe protocol: ${parsedUrl.protocol}`);
          throw new Error(`Unsafe URL protocol: ${parsedUrl.protocol}`);
        }
        await shell.openExternal(url);
      } catch (error) {
        if (error instanceof TypeError) {
          // Invalid URL format
          console.warn(`[SHELL_OPEN_EXTERNAL] Invalid URL format: ${url}`);
          throw new Error('Invalid URL format');
        }
        throw error;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SHELL_OPEN_TERMINAL,
    async (_, dirPath: string): Promise<IPCResult<void>> => {
      try {
        // Validate dirPath input
        if (!dirPath || typeof dirPath !== 'string' || dirPath.trim() === '') {
          return {
            success: false,
            error: 'Directory path is required and must be a non-empty string'
          };
        }

        // Resolve to absolute path
        const resolvedPath = path.resolve(dirPath);

        // Verify path exists
        if (!existsSync(resolvedPath)) {
          return {
            success: false,
            error: `Directory does not exist: ${resolvedPath}`
          };
        }

        // Verify it's a directory
        try {
          if (!statSync(resolvedPath).isDirectory()) {
            return {
              success: false,
              error: `Path is not a directory: ${resolvedPath}`
            };
          }
        } catch (_statError) {
          return {
            success: false,
            error: `Cannot access path: ${resolvedPath}`
          };
        }

        const platform = process.platform;

        if (platform === 'darwin') {
          // macOS: Use execFileSync with argument array to prevent injection
          execFileSync('open', ['-a', 'Terminal', resolvedPath], { stdio: 'ignore' });
        } else if (platform === 'win32') {
          // Windows: Use cmd.exe directly with argument array
          // /C tells cmd to execute the command and terminate
          // /K keeps the window open after executing cd
          execFileSync('cmd.exe', ['/K', 'cd', '/d', resolvedPath], {
            stdio: 'ignore',
            windowsHide: false,
            shell: false  // Explicitly disable shell to prevent injection
          });
        } else {
          // Linux: Try common terminal emulators with argument arrays
          // Note: xterm uses cwd option to avoid shell injection vulnerabilities
          const terminals: Array<{ cmd: string; args: string[]; useCwd?: boolean }> = [
            { cmd: 'gnome-terminal', args: ['--working-directory', resolvedPath] },
            { cmd: 'konsole', args: ['--workdir', resolvedPath] },
            { cmd: 'xfce4-terminal', args: ['--working-directory', resolvedPath] },
            { cmd: 'xterm', args: ['-e', 'bash'], useCwd: true }
          ];

          let opened = false;
          for (const { cmd, args, useCwd } of terminals) {
            try {
              execFileSync(cmd, args, {
                stdio: 'ignore',
                ...(useCwd ? { cwd: resolvedPath } : {})
              });
              opened = true;
              break;
            } catch {
            }
          }

          if (!opened) {
            return {
              success: false,
              error: 'No supported terminal emulator found. Please install gnome-terminal, konsole, xfce4-terminal, or xterm.'
            };
          }
        }

        return { success: true };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `Failed to open terminal: ${errorMsg}`
        };
      }
    }
  );

  // ============================================
  // Auto-Build Source Environment Operations
  // ============================================

  /**
   * Helper to get source .env path from settings
   *
   * In production mode, the .env file is NOT bundled (excluded in electron-builder config).
   * We store the source .env in app userData directory instead, which is writable.
   * The sourcePath points to the bundled backend for reference, but envPath is in userData.
   */
  const getSourceEnvPath = (): {
    sourcePath: string | null;
    envPath: string | null;
    isProduction: boolean;
  } => {
    const savedSettings = readSettingsFile();
    const settings = { ...DEFAULT_APP_SETTINGS, ...savedSettings };

    // Get autoBuildPath from settings or try to auto-detect
    let sourcePath: string | null = settings.autoBuildPath || null;
    if (!sourcePath) {
      sourcePath = detectAutoBuildSourcePath();
    }

    if (!sourcePath) {
      return { sourcePath: null, envPath: null, isProduction: !is.dev };
    }

    // In production, use userData directory for .env since resources may be read-only
    // In development, use the actual source path
    let envPath: string;
    if (is.dev) {
      envPath = path.join(sourcePath, '.env');
    } else {
      // Production: store .env in userData/backend/.env
      const userDataBackendDir = path.join(app.getPath('userData'), 'backend');
      if (!existsSync(userDataBackendDir)) {
        mkdirSync(userDataBackendDir, { recursive: true });
      }
      envPath = path.join(userDataBackendDir, '.env');
    }

    return {
      sourcePath,
      envPath,
      isProduction: !is.dev
    };
  };

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_GET,
    async (): Promise<IPCResult<SourceEnvConfig>> => {
      try {
        const { sourcePath, envPath } = getSourceEnvPath();

        // Load global settings to check for global token fallback
        const savedSettings = readSettingsFile();
        const globalSettings = { ...DEFAULT_APP_SETTINGS, ...savedSettings };

        if (!sourcePath) {
          // Even without source path, check global token
          const globalToken = globalSettings.globalClaudeOAuthToken;
          return {
            success: true,
            data: {
              hasClaudeToken: !!globalToken && globalToken.length > 0,
              claudeOAuthToken: globalToken,
              envExists: false
            }
          };
        }

        const envExists = envPath ? existsSync(envPath) : false;
        let hasClaudeToken = false;
        let claudeOAuthToken: string | undefined;

        // First, check source .env file
        if (envExists && envPath) {
          const content = readFileSync(envPath, 'utf-8');
          const vars = parseEnvFile(content);
          claudeOAuthToken = vars['CLAUDE_CODE_OAUTH_TOKEN'];
          hasClaudeToken = !!claudeOAuthToken && claudeOAuthToken.length > 0;
        }

        // Fallback to global settings if no token in source .env
        if (!hasClaudeToken && globalSettings.globalClaudeOAuthToken) {
          claudeOAuthToken = globalSettings.globalClaudeOAuthToken;
          hasClaudeToken = true;
        }

        return {
          success: true,
          data: {
            hasClaudeToken,
            claudeOAuthToken,
            sourcePath,
            envExists
          }
        };
      } catch (error) {
        // Log the error for debugging in production
        console.error('[AUTOBUILD_SOURCE_ENV_GET] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get source env'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_UPDATE,
    async (_, config: { claudeOAuthToken?: string }): Promise<IPCResult> => {
      try {
        const { sourcePath, envPath } = getSourceEnvPath();

        if (!sourcePath || !envPath) {
          return {
            success: false,
            error: 'Auto-build source path not configured. Please set it in Settings.'
          };
        }

        // Read existing content or start fresh (avoiding TOCTOU race condition)
        let existingVars: Record<string, string> = {};
        try {
          const content = readFileSync(envPath, 'utf-8');
          existingVars = parseEnvFile(content);
        } catch (_readError) {
          // File doesn't exist or can't be read - start with empty vars
          // This is expected for first-time setup
        }

        // Update with new values
        if (config.claudeOAuthToken !== undefined) {
          existingVars['CLAUDE_CODE_OAUTH_TOKEN'] = config.claudeOAuthToken;
        }

        // Generate content
        const lines: string[] = [
          '# Auto Claude Framework Environment Variables',
          '# Managed by Auto Claude UI',
          '',
          '# Claude Code OAuth Token (REQUIRED)',
          `CLAUDE_CODE_OAUTH_TOKEN=${existingVars['CLAUDE_CODE_OAUTH_TOKEN'] || ''}`,
          ''
        ];

        // Preserve other existing variables
        for (const [key, value] of Object.entries(existingVars)) {
          if (key !== 'CLAUDE_CODE_OAUTH_TOKEN') {
            lines.push(`${key}=${value}`);
          }
        }

        writeFileSync(envPath, lines.join('\n'), 'utf-8');

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update source env'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_CHECK_TOKEN,
    async (): Promise<IPCResult<SourceEnvCheckResult>> => {
      try {
        const { sourcePath, envPath, isProduction } = getSourceEnvPath();

        // Load global settings to check for global token fallback
        const savedSettings = readSettingsFile();
        const globalSettings = { ...DEFAULT_APP_SETTINGS, ...savedSettings };

        // Check global token first as it's the primary method
        const globalToken = globalSettings.globalClaudeOAuthToken;
        const hasGlobalToken = !!globalToken && globalToken.length > 0;

        if (!sourcePath) {
          // In production, no source path is acceptable if global token exists
          if (hasGlobalToken) {
            return {
              success: true,
              data: {
                hasToken: true,
                sourcePath: isProduction ? app.getPath('userData') : undefined
              }
            };
          }
          return {
            success: true,
            data: {
              hasToken: false,
              error: isProduction
                ? 'Please configure Claude OAuth token in Settings > API Configuration'
                : 'Auto-build source path not configured'
            }
          };
        }

        // Check source .env file
        let hasEnvToken = false;
        if (envPath && existsSync(envPath)) {
          const content = readFileSync(envPath, 'utf-8');
          const vars = parseEnvFile(content);
          const token = vars['CLAUDE_CODE_OAUTH_TOKEN'];
          hasEnvToken = !!token && token.length > 0;
        }

        // Token exists if either source .env has it OR global settings has it
        const hasToken = hasEnvToken || hasGlobalToken;

        return {
          success: true,
          data: {
            hasToken,
            sourcePath
          }
        };
      } catch (error) {
        // Log the error for debugging in production
        console.error('[AUTOBUILD_SOURCE_ENV_CHECK_TOKEN] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check source token'
        };
      }
    }
  );

  // ============================================
  // Spell Check Operations
  // ============================================

  /**
   * Set spell check languages based on app language.
   * Called when renderer's i18n language changes to sync spell checker.
   */
  ipcMain.handle(
    IPC_CHANNELS.SPELLCHECK_SET_LANGUAGES,
    async (_, language: string): Promise<IPCResult<{ success: boolean }>> => {
      try {
        // Validate language parameter
        if (!language || typeof language !== 'string') {
          return {
            success: false,
            error: 'Invalid language parameter'
          };
        }

        // Update tracked app language for context menu labels
        setAppLanguage(language);

        // Get spell check languages for this app language
        const spellCheckLanguages = SPELL_CHECK_LANGUAGE_MAP[language] || [DEFAULT_SPELL_CHECK_LANGUAGE];

        // Get available languages on this system
        const availableLanguages = session.defaultSession.availableSpellCheckerLanguages;

        // Filter to only available languages
        const validLanguages = spellCheckLanguages.filter(lang =>
          availableLanguages.includes(lang)
        );

        // Fallback to default if none of the preferred languages are available
        const languagesToSet = validLanguages.length > 0
          ? validLanguages
          : (availableLanguages.includes(DEFAULT_SPELL_CHECK_LANGUAGE) ? [DEFAULT_SPELL_CHECK_LANGUAGE] : []);

        if (languagesToSet.length > 0) {
          session.defaultSession.setSpellCheckerLanguages(languagesToSet);
          console.log(`[SPELLCHECK] Languages set to: ${languagesToSet.join(', ')} for app language: ${language}`);
        } else {
          console.warn(`[SPELLCHECK] No valid spell check languages available for: ${language}`);
        }

        return {
          success: true,
          data: { success: true }
        };
      } catch (error) {
        console.error('[SPELLCHECK_SET_LANGUAGES] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set spell check languages'
        };
      }
    }
  );
}
