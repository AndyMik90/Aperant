import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { app } from 'electron';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { EventEmitter } from 'events';
import { AgentState } from './agent-state';
import { AgentEvents } from './agent-events';
import { ProcessType, ExecutionProgressData } from './types';
import type { CompletablePhase } from '../../shared/constants/phase-protocol';
import { parseTaskEvent } from './task-event-parser';
import { detectRateLimit, createSDKRateLimitInfo, getBestAvailableProfileEnv, detectAuthFailure } from '../rate-limit-detector';
import { getAPIProfileEnv } from '../services/profile';
import { projectStore } from '../project-store';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { parsePythonCommand, validatePythonPath } from '../python-detector';
import { pythonEnvManager, getConfiguredPythonPath } from '../python-env-manager';
import { buildMemoryEnvVars } from '../memory-env-builder';
import { readSettingsFile } from '../settings-utils';
import type { AppSettings } from '../../shared/types/settings';
import { getOAuthModeClearVars, normalizeEnvPathKey, mergePythonEnvPath } from './env-utils';
import { getAugmentedEnv } from '../env-utils';
import { getToolInfo, getClaudeCliPathForSdk } from '../cli-tool-manager';
import { killProcessGracefully, isWindows, getPathDelimiter } from '../platform';
import { debugLog } from '../../shared/utils/debug-logger';

/**
 * Type for supported CLI tools
 */
type CliTool = 'claude' | 'gh' | 'glab';

/**
 * Mapping of CLI tools to their environment variable names
 * This ensures type safety - tools cannot be mismatched with env vars.
 */
const CLI_TOOL_ENV_MAP: Readonly<Record<CliTool, string>> = {
  claude: 'CLAUDE_CLI_PATH',
  gh: 'GITHUB_CLI_PATH',
  glab: 'GITLAB_CLI_PATH'
} as const;


function deriveGitBashPath(gitExePath: string): string | null {
  if (!isWindows()) {
    return null;
  }

  try {
    const gitDir = path.dirname(gitExePath);  // e.g., D:\...\Git\mingw64\bin
    const gitDirName = path.basename(gitDir).toLowerCase();

    // Find Git installation root
    let gitRoot: string;

    if (gitDirName === 'cmd') {
      // .../Git/cmd/git.exe -> .../Git
      gitRoot = path.dirname(gitDir);
    } else if (gitDirName === 'bin') {
      // Could be .../Git/bin/git.exe OR .../Git/mingw64/bin/git.exe
      const parent = path.dirname(gitDir);
      const parentName = path.basename(parent).toLowerCase();
      if (parentName === 'mingw64' || parentName === 'mingw32') {
        // .../Git/mingw64/bin/git.exe -> .../Git
        gitRoot = path.dirname(parent);
      } else {
        // .../Git/bin/git.exe -> .../Git
        gitRoot = parent;
      }
    } else {
      // Unknown structure - try to find 'bin' sibling
      gitRoot = path.dirname(gitDir);
    }

    // Bash.exe is in Git/bin/bash.exe
    const bashPath = path.join(gitRoot, 'bin', 'bash.exe');

    if (existsSync(bashPath)) {
      console.log('[AgentProcess] Derived git-bash path:', bashPath);
      return bashPath;
    }

    // Fallback: check one level up if gitRoot didn't work
    const altBashPath = path.join(path.dirname(gitRoot), 'bin', 'bash.exe');
    if (existsSync(altBashPath)) {
      console.log('[AgentProcess] Found git-bash at alternate path:', altBashPath);
      return altBashPath;
    }

    console.warn('[AgentProcess] Could not find bash.exe from git path:', gitExePath);
    return null;
  } catch (error) {
    console.error('[AgentProcess] Error deriving git-bash path:', error);
    return null;
  }
}

/**
 * Process spawning and lifecycle management
 */
export class AgentProcessManager {
  private state: AgentState;
  private events: AgentEvents;
  private emitter: EventEmitter;
  // Python path will be configured by pythonEnvManager after venv is ready
  // Use null to indicate not yet configured - getPythonPath() will use fallback
  private _pythonPath: string | null = null;
  private autoBuildSourcePath: string = '';

  constructor(state: AgentState, events: AgentEvents, emitter: EventEmitter) {
    this.state = state;
    this.events = events;
    this.emitter = emitter;
  }

  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    if (pythonPath) {
      const validation = validatePythonPath(pythonPath);
      if (validation.valid) {
        this._pythonPath = validation.sanitizedPath || pythonPath;
      } else {
        console.error(`[AgentProcess] Invalid Python path rejected: ${validation.reason}`);
        console.error(`[AgentProcess] Falling back to getConfiguredPythonPath()`);
        // Don't set _pythonPath - let getPythonPath() use getConfiguredPythonPath() fallback
      }
    }
    if (autoBuildSourcePath) {
      this.autoBuildSourcePath = autoBuildSourcePath;
    }
  }

  /**
   * Detects and sets CLI tool path in environment variables.
   * Common issue: CLI tools installed via Homebrew or other non-standard locations
   * are not in subprocess PATH when app launches from Finder/Dock.
   *
   * For 'claude' tool specifically, uses getClaudeCliPathForSdk() which returns null
   * for Windows .cmd files, allowing the SDK to use its bundled claude.exe instead.
   *
   * @param toolName - Name of the CLI tool (e.g., 'claude', 'gh')
   * @returns Record with env var set if tool was detected
   */
  private detectAndSetCliPath(toolName: CliTool): Record<string, string> {
    const env: Record<string, string> = {};
    const envVarName = CLI_TOOL_ENV_MAP[toolName];
    if (!process.env[envVarName]) {
      try {
        // For 'claude' tool, use getClaudeCliPathForSdk() which returns null for Windows .cmd files
        // This allows the Claude Agent SDK to use its bundled claude.exe instead
        if (toolName === 'claude') {
          const cliPath = getClaudeCliPathForSdk();
          if (cliPath) {
            env[envVarName] = cliPath;
            console.log(`[AgentProcess] Setting ${envVarName}:`, cliPath, '(source: cli-tool-manager)');
          } else {
            console.log(`[AgentProcess] Claude CLI is .cmd file on Windows, not setting ${envVarName} - SDK will use bundled CLI`);
          }
        } else {
          // For other tools, use standard detection
          const toolInfo = getToolInfo(toolName);
          if (toolInfo.found && toolInfo.path) {
            env[envVarName] = toolInfo.path;
            console.log(`[AgentProcess] Setting ${envVarName}:`, toolInfo.path, `(source: ${toolInfo.source})`);
          }
        }
      } catch (error) {
        console.warn(`[AgentProcess] Failed to detect ${toolName} CLI path:`, error instanceof Error ? error.message : String(error));
      }
    }
    return env;
  }

  private setupProcessEnvironment(
    extraEnv: Record<string, string>
  ): NodeJS.ProcessEnv {
    // Get best available Claude profile environment (automatically handles rate limits)
    const profileResult = getBestAvailableProfileEnv();
    const profileEnv = profileResult.env;

    debugLog('[AgentProcess:setupEnv] Profile result:', {
      profileId: profileResult.profileId,
      hasOAuthToken: !!profileEnv.CLAUDE_CODE_OAUTH_TOKEN,
      hasApiKey: !!profileEnv.ANTHROPIC_API_KEY,
      hasConfigDir: !!profileEnv.CLAUDE_CONFIG_DIR,
      configDir: profileEnv.CLAUDE_CONFIG_DIR || '(not set)',
      oauthTokenPrefix: profileEnv.CLAUDE_CODE_OAUTH_TOKEN?.substring(0, 8) || '(not set)',
      apiKeyPrefix: profileEnv.ANTHROPIC_API_KEY?.substring(0, 8) || '(not set)',
    });

    // Warn if profile lacks CLAUDE_CONFIG_DIR - this means the profile has no configDir
    // and subscription metadata may not propagate correctly to the agent subprocess
    if (!profileEnv.CLAUDE_CONFIG_DIR) {
      console.warn('[AgentProcess:setupEnv] WARNING: Profile env lacks CLAUDE_CONFIG_DIR - profile may not have a configDir set. Subscription metadata may not reach agent subprocess.');
    }

    debugLog('[AgentProcess:setupEnv] extraEnv auth keys:', {
      hasOAuthToken: !!extraEnv.CLAUDE_CODE_OAUTH_TOKEN,
      hasApiKey: !!extraEnv.ANTHROPIC_API_KEY,
      hasConfigDir: !!extraEnv.CLAUDE_CONFIG_DIR,
    });

    // Use getAugmentedEnv() to ensure common tool paths (dotnet, homebrew, etc.)
    // are available even when app is launched from Finder/Dock
    const augmentedEnv = getAugmentedEnv();

    // On Windows, detect and pass git-bash path for Claude Code CLI
    // Electron can detect git via where.exe, but Python subprocess may not have the same PATH
    const gitBashEnv: Record<string, string> = {};
    if (isWindows() && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      try {
        const gitInfo = getToolInfo('git');
        if (gitInfo.found && gitInfo.path) {
          const bashPath = deriveGitBashPath(gitInfo.path);
          if (bashPath) {
            gitBashEnv['CLAUDE_CODE_GIT_BASH_PATH'] = bashPath;
            console.log('[AgentProcess] Setting CLAUDE_CODE_GIT_BASH_PATH:', bashPath);
          }
        }
      } catch (error) {
        console.warn('[AgentProcess] Failed to detect git-bash path:', error);
      }
    }

    // Detect and pass CLI tool paths to Python backend
    const claudeCliEnv = this.detectAndSetCliPath('claude');
    const ghCliEnv = this.detectAndSetCliPath('gh');
    const glabCliEnv = this.detectAndSetCliPath('glab');

    // Profile env is spread last to ensure CLAUDE_CONFIG_DIR and auth vars
    // from the active profile always win over extraEnv or augmentedEnv.
    const mergedEnv = {
      ...augmentedEnv,
      ...gitBashEnv,
      ...claudeCliEnv,
      ...ghCliEnv,
      ...glabCliEnv,
      ...extraEnv,
      ...profileEnv,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    } as NodeJS.ProcessEnv;

    // When the active profile provides CLAUDE_CONFIG_DIR, clear CLAUDE_CODE_OAUTH_TOKEN
    // from the spawn environment. CLAUDE_CONFIG_DIR lets Claude Code resolve its own
    // OAuth tokens from the config directory, making an explicit token unnecessary.
    // This matches the terminal pattern in claude-integration-handler.ts where
    // configDir is preferred over direct token injection.
    // We check profileEnv specifically (not mergedEnv) to avoid clearing the token
    // when CLAUDE_CONFIG_DIR comes from the shell environment rather than the profile.
    if (profileEnv.CLAUDE_CONFIG_DIR) {
      mergedEnv.CLAUDE_CODE_OAUTH_TOKEN = '';
      debugLog('[AgentProcess:setupEnv] Profile provides CLAUDE_CONFIG_DIR, cleared CLAUDE_CODE_OAUTH_TOKEN from spawn env');
    }

    debugLog('[AgentProcess:setupEnv] Final merged env auth state:', {
      hasOAuthToken: !!mergedEnv.CLAUDE_CODE_OAUTH_TOKEN,
      hasApiKey: !!mergedEnv.ANTHROPIC_API_KEY,
      hasConfigDir: !!mergedEnv.CLAUDE_CONFIG_DIR,
      configDir: mergedEnv.CLAUDE_CONFIG_DIR || '(not set)',
      oauthTokenPrefix: mergedEnv.CLAUDE_CODE_OAUTH_TOKEN?.substring(0, 8) || '(not set)',
      apiKeyPrefix: mergedEnv.ANTHROPIC_API_KEY?.substring(0, 8) || '(not set)',
    });

    return mergedEnv;
  }

  private handleProcessFailure(
    taskId: string,
    allOutput: string,
    processType: ProcessType
  ): boolean {
    console.log('[AgentProcess] Checking for rate limit in output (last 500 chars):', allOutput.slice(-500));

    const rateLimitDetection = detectRateLimit(allOutput);
    console.log('[AgentProcess] Rate limit detection result:', {
      isRateLimited: rateLimitDetection.isRateLimited,
      resetTime: rateLimitDetection.resetTime,
      limitType: rateLimitDetection.limitType,
      profileId: rateLimitDetection.profileId,
      suggestedProfile: rateLimitDetection.suggestedProfile
    });

    if (rateLimitDetection.isRateLimited) {
      const wasHandled = this.handleRateLimitWithAutoSwap(
        taskId,
        rateLimitDetection,
        processType
      );
      if (wasHandled) return true;

      const source = processType === 'spec-creation' ? 'roadmap' : 'task';
      const rateLimitInfo = createSDKRateLimitInfo(source, rateLimitDetection, { taskId });
      console.log('[AgentProcess] Emitting sdk-rate-limit event (manual):', rateLimitInfo);
      this.emitter.emit('sdk-rate-limit', rateLimitInfo);
      return true;
    }

    return this.handleAuthFailure(taskId, allOutput);
  }

  private handleRateLimitWithAutoSwap(
    taskId: string,
    rateLimitDetection: ReturnType<typeof detectRateLimit>,
    processType: ProcessType
  ): boolean {
    const profileManager = getClaudeProfileManager();
    const autoSwitchSettings = profileManager.getAutoSwitchSettings();

    console.log('[AgentProcess] Auto-switch settings:', {
      enabled: autoSwitchSettings.enabled,
      autoSwitchOnRateLimit: autoSwitchSettings.autoSwitchOnRateLimit,
      proactiveSwapEnabled: autoSwitchSettings.proactiveSwapEnabled
    });

    if (!autoSwitchSettings.enabled || !autoSwitchSettings.autoSwitchOnRateLimit) {
      console.log('[AgentProcess] Auto-switch disabled - showing manual modal');
      return false;
    }

    const currentProfileId = rateLimitDetection.profileId;
    const bestProfile = profileManager.getBestAvailableProfile(currentProfileId);

    console.log('[AgentProcess] Best available profile:', bestProfile ? {
      id: bestProfile.id,
      name: bestProfile.name
    } : 'NONE');

    if (!bestProfile) {
      // Single account case: let backend handle with intelligent pause
      // Don't show manual modal - backend will pause intelligently and resume when ready
      console.log('[AgentProcess] No alternative profile - backend will handle with intelligent pause');
      // Return false to let handleProcessFailure emit sdk-rate-limit event
      // The frontend can then show appropriate UI (e.g., "Paused until X time")
      return false;
    }

    console.log('[AgentProcess] AUTO-SWAP: Switching from', currentProfileId, 'to', bestProfile.id);
    profileManager.setActiveProfile(bestProfile.id);

    const source = processType === 'spec-creation' ? 'roadmap' : 'task';
    const rateLimitInfo = createSDKRateLimitInfo(source, rateLimitDetection, { taskId });
    rateLimitInfo.wasAutoSwapped = true;
    rateLimitInfo.swappedToProfile = { id: bestProfile.id, name: bestProfile.name };
    rateLimitInfo.swapReason = 'reactive';

    console.log('[AgentProcess] Emitting sdk-rate-limit event (auto-swapped):', rateLimitInfo);
    this.emitter.emit('sdk-rate-limit', rateLimitInfo);

    console.log('[AgentProcess] Emitting auto-swap-restart-task event for task:', taskId);
    this.emitter.emit('auto-swap-restart-task', taskId, bestProfile.id);
    return true;
  }

  private handleAuthFailure(taskId: string, allOutput: string): boolean {
    console.log('[AgentProcess] No rate limit detected - checking for auth failure');
    const authFailureDetection = detectAuthFailure(allOutput);

    if (!authFailureDetection.isAuthFailure) {
      console.log('[AgentProcess] Process failed but no rate limit or auth failure detected');
      return false;
    }

    console.log('[AgentProcess] Auth failure detected:', authFailureDetection);

    // Try auto-swap if enabled
    const wasHandled = this.handleAuthFailureWithAutoSwap(taskId, authFailureDetection);

    if (!wasHandled) {
      // Fall back to UI notification
      this.emitter.emit('auth-failure', taskId, {
        profileId: authFailureDetection.profileId,
        failureType: authFailureDetection.failureType,
        message: authFailureDetection.message,
        originalError: authFailureDetection.originalError
      });
    }

    return true;
  }

  /**
   * Attempt to auto-swap to another profile on authentication failure.
   * Only works when autoSwitchOnAuthFailure is enabled and an alternative
   * authenticated profile is available.
   */
  private handleAuthFailureWithAutoSwap(
    taskId: string,
    authFailureDetection: ReturnType<typeof detectAuthFailure>
  ): boolean {
    const profileManager = getClaudeProfileManager();
    const autoSwitchSettings = profileManager.getAutoSwitchSettings();

    console.log('[AgentProcess] Auth failure auto-switch settings:', {
      enabled: autoSwitchSettings.enabled,
      autoSwitchOnAuthFailure: autoSwitchSettings.autoSwitchOnAuthFailure
    });

    // Check if auto-switch on auth failure is enabled
    if (!autoSwitchSettings.enabled || !autoSwitchSettings.autoSwitchOnAuthFailure) {
      console.log('[AgentProcess] Auth failure auto-switch disabled - falling back to UI');
      return false;
    }

    const currentProfileId = authFailureDetection.profileId;
    const bestProfile = profileManager.getBestAvailableProfile(currentProfileId);

    console.log('[AgentProcess] Best available profile for auth failure swap:', bestProfile ? {
      id: bestProfile.id,
      name: bestProfile.name,
      isAuthenticated: bestProfile.isAuthenticated
    } : 'NONE');

    // Verify the best profile is actually authenticated
    if (!bestProfile || !bestProfile.isAuthenticated) {
      console.log('[AgentProcess] No authenticated alternative profile - falling back to UI');
      return false;
    }

    console.log('[AgentProcess] AUTH-FAILURE AUTO-SWAP:', currentProfileId, '->', bestProfile.id);
    profileManager.setActiveProfile(bestProfile.id);

    // Emit auth-failure event with swap metadata for UI notification
    this.emitter.emit('auth-failure', taskId, {
      profileId: authFailureDetection.profileId,
      failureType: authFailureDetection.failureType,
      message: authFailureDetection.message,
      originalError: authFailureDetection.originalError,
      wasAutoSwapped: true,
      swappedToProfile: { id: bestProfile.id, name: bestProfile.name }
    });

    // Reuse existing restart event
    console.log('[AgentProcess] Emitting auto-swap-restart-task event for auth failure:', taskId);
    this.emitter.emit('auto-swap-restart-task', taskId, bestProfile.id);
    return true;
  }

  /**
   * Get the configured Python path.
   * Returns explicitly configured path, or falls back to getConfiguredPythonPath()
   * which uses the venv Python if ready.
   */
  getPythonPath(): string {
    // If explicitly configured (by pythonEnvManager), use that
    if (this._pythonPath) {
      return this._pythonPath;
    }
    // Otherwise use the global configured path (venv if ready, else bundled/system)
    return getConfiguredPythonPath();
  }

  /**
   * Get the auto-claude source path (detects automatically if not configured)
   */
  getAutoBuildSourcePath(): string | null {
    // Use runners/spec_runner.py as the validation marker - this is the file actually needed
    const validatePath = (p: string): boolean => {
      return existsSync(p) && existsSync(path.join(p, 'runners', 'spec_runner.py'));
    };

    // If manually configured AND valid, use that
    if (this.autoBuildSourcePath && validatePath(this.autoBuildSourcePath)) {
      return this.autoBuildSourcePath;
    }

    // Auto-detect from app location (configured path was invalid or not set)
    const possiblePaths = [
      // Packaged app: backend is in extraResources (process.resourcesPath/backend)
      ...(app.isPackaged ? [path.join(process.resourcesPath, 'backend')] : []),
      // Dev mode: from dist/main -> ../../backend (apps/frontend/out/main -> apps/backend)
      path.resolve(__dirname, '..', '..', '..', 'backend'),
      // Alternative: from app root -> apps/backend
      path.resolve(app.getAppPath(), '..', 'backend'),
      // If running from repo root with apps structure
      path.resolve(process.cwd(), 'apps', 'backend')
    ];

    for (const p of possiblePaths) {
      if (validatePath(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Ensure Python environment is ready before spawning processes.
   * This is a shared method used by AgentManager and AgentQueueManager
   * to prevent race conditions where tasks start before venv initialization completes.
   *
   * @param context - Context identifier for logging (e.g., 'AgentManager', 'AgentQueue')
   * @returns Object with ready status and optional error message
   */
  async ensurePythonEnvReady(context: string): Promise<{ ready: boolean; error?: string }> {
    if (pythonEnvManager.isEnvReady()) {
      return { ready: true };
    }

    console.log(`[${context}] Python environment not ready, waiting for initialization...`);

    const autoBuildSource = this.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      const error = 'auto-build source not found';
      console.error(`[${context}] Cannot initialize Python - ${error}`);
      return { ready: false, error };
    }

    const status = await pythonEnvManager.initialize(autoBuildSource);
    if (!status.ready) {
      console.error(`[${context}] Python environment initialization failed:`, status.error);
      return { ready: false, error: status.error || 'initialization failed' };
    }

    console.log(`[${context}] Python environment now ready`);
    return { ready: true };
  }

  /**
   * Get project-specific environment variables based on project settings
   */
  private getProjectEnvVars(projectPath: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Find project by path
    const projects = projectStore.getProjects();
    const project = projects.find((p) => p.path === projectPath);

    if (project?.settings) {
      // Graphiti MCP integration
      if (project.settings.graphitiMcpEnabled) {
        const graphitiUrl = project.settings.graphitiMcpUrl || 'http://localhost:8000/mcp/';
        env['GRAPHITI_MCP_URL'] = graphitiUrl;
      }

      // CLAUDE.md integration (enabled by default)
      if (project.settings.useClaudeMd !== false) {
        env['USE_CLAUDE_MD'] = 'true';
      }
    }

    return env;
  }

  /**
   * Parse environment variables from a .env file content.
   * Filters out empty values to prevent overriding valid tokens from profiles.
   */
  private parseEnvFile(envPath: string): Record<string, string> {
    if (!existsSync(envPath)) {
      return {};
    }

    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const envVars: Record<string, string> = {};

      // Handle both Unix (\n) and Windows (\r\n) line endings
      for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          // Skip empty values to prevent overriding valid values from other sources
          if (value) {
            envVars[key] = value;
          }
        }
      }

      return envVars;
    } catch {
      return {};
    }
  }

  /**
   * Load environment variables from project's .auto-claude/.env file
   * This contains frontend-configured settings like memory/Graphiti configuration
   */
  private loadProjectEnv(projectPath: string): Record<string, string> {
    // Find project by path to get autoBuildPath
    const projects = projectStore.getProjects();
    const project = projects.find((p) => p.path === projectPath);

    if (!project?.autoBuildPath) {
      return {};
    }

    const envPath = path.join(projectPath, project.autoBuildPath, '.env');
    return this.parseEnvFile(envPath);
  }

  /**
   * Load environment variables from auto-claude .env file
   */
  loadAutoBuildEnv(): Record<string, string> {
    const autoBuildSource = this.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      return {};
    }

    const envPath = path.join(autoBuildSource, '.env');
    return this.parseEnvFile(envPath);
  }

  /**
   * Spawn a Python process for task execution
   */
  async spawnProcess(
    taskId: string,
    cwd: string,
    args: string[],
    extraEnv: Record<string, string> = {},
    processType: ProcessType = 'task-execution',
    projectId?: string
  ): Promise<void> {
    const isSpecRunner = processType === 'spec-creation';
    this.killProcess(taskId);

    const spawnId = this.state.generateSpawnId();

    // IMPORTANT: Add to tracking IMMEDIATELY, before async operations.
    // This ensures getRunningTasks() returns the task right away, preventing
    // flaky tests on slower Windows CI where async setup may take longer than
    // vi.waitFor timeout (ACS-392).
    this.state.addProcess(taskId, {
      taskId,
      process: null, // Will be set after spawn() call completes below
      startedAt: new Date(),
      spawnId
    });

    const env = this.setupProcessEnvironment(extraEnv);

    // Get Python environment (PYTHONPATH for bundled packages, etc.)
    const pythonEnv = pythonEnvManager.getPythonEnv();

    // Get active API profile environment variables
    let apiProfileEnv: Record<string, string> = {};
    try {
      apiProfileEnv = await getAPIProfileEnv();
    } catch (error) {
      console.error('[Agent Process] Failed to get API profile env:', error);
      // Continue with empty profile env (falls back to OAuth mode)
    }

    // Get OAuth mode clearing vars (clears stale ANTHROPIC_* vars when in OAuth mode)
    const oauthModeClearVars = getOAuthModeClearVars(apiProfileEnv);

    debugLog('[AgentProcess:spawnProcess] Environment merge chain for task:', taskId, {
      baseEnv: {
        hasOAuthToken: !!env.CLAUDE_CODE_OAUTH_TOKEN,
        hasApiKey: !!env.ANTHROPIC_API_KEY,
        hasConfigDir: !!env.CLAUDE_CONFIG_DIR,
        configDir: env.CLAUDE_CONFIG_DIR || '(not set)',
      },
      oauthModeClearVars: Object.keys(oauthModeClearVars),
      apiProfileEnv: {
        hasApiKey: !!apiProfileEnv.ANTHROPIC_API_KEY,
        hasBaseUrl: !!apiProfileEnv.ANTHROPIC_BASE_URL,
        apiKeyPrefix: apiProfileEnv.ANTHROPIC_API_KEY?.substring(0, 8) || '(not set)',
      },
    });

    // Merge PATH from pythonEnv with augmented PATH from env.
    // pythonEnv may contain its own PATH (e.g., on Windows with pywin32_system32 prepended).
    // Simply spreading pythonEnv after env would overwrite the augmented PATH (which includes
    // npm globals, homebrew, etc.), causing "Claude code not found" on Windows (#1661).
    // mergePythonEnvPath() normalizes PATH key casing and prepends pythonEnv-specific paths.
    const mergedPythonEnv = { ...pythonEnv };
    const pathSep = getPathDelimiter();

    mergePythonEnvPath(env as Record<string, string | undefined>, mergedPythonEnv as Record<string, string | undefined>, pathSep);

    // Parse Python command to handle space-separated commands like "py -3"
    const [pythonCommand, pythonBaseArgs] = parsePythonCommand(this.getPythonPath());
    let childProcess;
    try {
      childProcess = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
        cwd,
        env: {
          ...env, // Already includes process.env, extraEnv, profileEnv, PYTHONUNBUFFERED, PYTHONUTF8
          ...mergedPythonEnv, // Python env with merged PATH (preserves augmented PATH entries)
          ...oauthModeClearVars, // Clear stale ANTHROPIC_* vars when in OAuth mode
          ...apiProfileEnv // Include active API profile config (highest priority for ANTHROPIC_* vars)
        }
      });
    } catch (err) {
      // spawn() failed synchronously (e.g., command not found, permission denied)
      // Clean up tracking entry and propagate error
      this.state.deleteProcess(taskId);
      this.emitter.emit('error', taskId, err instanceof Error ? err.message : String(err), projectId);
      throw err;
    }

    // Update the tracked process with the actual spawned ChildProcess
    this.state.updateProcess(taskId, { process: childProcess });

    // Check if this spawn was killed during async setup (before spawn() completed).
    // If so, terminate the newly created process immediately to prevent orphaned processes.
    // Note: wasSpawnKilled() is checked AFTER updateProcess() because killProcess()
    // marks the spawn as killed before deleting the tracking entry.
    //
    // CRITICAL: The `?? spawnId` fallback is essential here because if killProcess()
    // was called during the async setup window, the taskId entry may have been deleted
    // from the process map. In that case, getProcess(taskId) returns undefined, so we
    // fall back to the local spawnId variable to check if this specific spawn was killed.
    const currentSpawnId = this.state.getProcess(taskId)?.spawnId ?? spawnId;
    if (this.state.wasSpawnKilled(currentSpawnId)) {
      console.log(`[AgentProcess] Task ${taskId} was killed during spawn setup. Terminating newly created process.`);
      killProcessGracefully(childProcess, {
        debugPrefix: '[AgentProcess]',
        debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development'
      });
      this.state.deleteProcess(taskId);
      this.state.clearKilledSpawn(currentSpawnId);
      return; // Do not proceed with this spawn
    }

    let currentPhase: ExecutionProgressData['phase'] = isSpecRunner ? 'planning' : 'planning';
    let phaseProgress = 0;
    let currentSubtask: string | undefined;
    let lastMessage: string | undefined;
    let allOutput = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let sequenceNumber = 0;
    // FIX (ACS-203): Track completed phases to prevent phase overlaps
    // When a phase completes, it's added to this array before transitioning to the next phase
    const completedPhases: CompletablePhase[] = [];

    this.emitter.emit('execution-progress', taskId, {
      phase: currentPhase,
      phaseProgress: 0,
      overallProgress: this.events.calculateOverallProgress(currentPhase, 0),
      message: isSpecRunner ? 'Starting spec creation...' : 'Starting build process...',
      sequenceNumber: ++sequenceNumber,
      completedPhases: [...completedPhases]
    }, projectId);

    const isDebug = ['true', '1', 'yes', 'on'].includes(process.env.DEBUG?.toLowerCase() ?? '');

    const processLog = (line: string) => {
      allOutput = (allOutput + line).slice(-10000);

      const hasMarker = line.includes('__EXEC_PHASE__');
      if (isDebug && hasMarker) {
        console.log(`[PhaseDebug:${taskId}] Found marker in line: "${line.substring(0, 200)}"`);
      }

      // Log all task event markers for debugging
      if (line.includes('__TASK_EVENT__')) {
        console.log(`[AgentProcess:${taskId}] Found __TASK_EVENT__ marker in line:`, line.substring(0, 300));
      }

      const taskEvent = parseTaskEvent(line);
      if (taskEvent) {
        console.log(`[AgentProcess:${taskId}] Parsed task event:`, taskEvent.type, taskEvent);
        this.emitter.emit('task-event', taskId, taskEvent, projectId);
      }

      const phaseUpdate = this.events.parseExecutionPhase(line, currentPhase, isSpecRunner);

      if (isDebug && hasMarker) {
        console.log(`[PhaseDebug:${taskId}] Parse result:`, phaseUpdate);
      }

      if (phaseUpdate) {
        const phaseChanged = phaseUpdate.phase !== currentPhase;

        if (isDebug) {
          console.log(`[PhaseDebug:${taskId}] Phase update: ${currentPhase} -> ${phaseUpdate.phase} (changed: ${phaseChanged})`);
        }

        // FIX (ACS-203): Manage completedPhases when phases transition
        // When leaving a non-terminal phase (not complete/failed), add it to completedPhases
        if (phaseChanged && currentPhase !== 'idle' && currentPhase !== phaseUpdate.phase) {
          // Type guard to narrow currentPhase to CompletablePhase
          const isCompletablePhase = (phase: ExecutionProgressData['phase']): phase is CompletablePhase => {
            return ['planning', 'coding', 'qa_review', 'qa_fixing'].includes(phase);
          };
          if (isCompletablePhase(currentPhase) && !completedPhases.includes(currentPhase)) {
            completedPhases.push(currentPhase);
            if (isDebug) {
              console.log(`[PhaseDebug:${taskId}] Marked phase as completed:`, { phase: currentPhase, completedPhases });
            }
          }
        }

        currentPhase = phaseUpdate.phase;

        if (phaseUpdate.currentSubtask) {
          currentSubtask = phaseUpdate.currentSubtask;
        }
        if (phaseUpdate.message) {
          lastMessage = phaseUpdate.message;
        }

        if (phaseChanged) {
          phaseProgress = 10;
        } else {
          phaseProgress = Math.min(90, phaseProgress + 5);
        }

        const overallProgress = this.events.calculateOverallProgress(currentPhase, phaseProgress);

        if (isDebug) {
          console.log(`[PhaseDebug:${taskId}] Emitting execution-progress:`, { phase: currentPhase, phaseProgress, overallProgress, completedPhases });
        }

        this.emitter.emit('execution-progress', taskId, {
          phase: currentPhase,
          phaseProgress,
          overallProgress,
          currentSubtask,
          message: lastMessage,
          sequenceNumber: ++sequenceNumber,
          completedPhases: [...completedPhases]
        }, projectId);
      }
    };

    const processBufferedOutput = (buffer: string, newData: string): string => {
      if (isDebug && newData.includes('__EXEC_PHASE__')) {
        console.log(`[PhaseDebug:${taskId}] Raw chunk with marker (${newData.length} bytes): "${newData.substring(0, 300)}"`);
        console.log(`[PhaseDebug:${taskId}] Current buffer before append (${buffer.length} bytes): "${buffer.substring(0, 100)}"`);
      }

      buffer += newData;
      const lines = buffer.split('\n');
      const remaining = lines.pop() || '';

      if (isDebug && newData.includes('__EXEC_PHASE__')) {
        console.log(`[PhaseDebug:${taskId}] Split into ${lines.length} complete lines, remaining buffer: "${remaining.substring(0, 100)}"`);
      }

      for (const line of lines) {
        if (line.trim()) {
          this.emitter.emit('log', taskId, line + '\n', projectId);
          processLog(line);
          if (isDebug) {
            console.log(`[Agent:${taskId}] ${line}`);
          }
        }
      }

      return remaining;
    };

    childProcess.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer = processBufferedOutput(stdoutBuffer, data.toString('utf-8'));
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      stderrBuffer = processBufferedOutput(stderrBuffer, data.toString('utf-8'));
    });

    childProcess.on('exit', (code: number | null) => {
      if (stdoutBuffer.trim()) {
        this.emitter.emit('log', taskId, stdoutBuffer + '\n', projectId);
        processLog(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        this.emitter.emit('log', taskId, stderrBuffer + '\n', projectId);
        processLog(stderrBuffer);
      }

      this.state.deleteProcess(taskId);

      if (this.state.wasSpawnKilled(spawnId)) {
        this.state.clearKilledSpawn(spawnId);
        return;
      }

      if (code !== 0) {
        console.log('[AgentProcess] Process failed with code:', code, 'for task:', taskId);
        const wasHandled = this.handleProcessFailure(taskId, allOutput, processType);

        if (wasHandled) {
          this.emitter.emit('exit', taskId, code, processType, projectId);
          return;
        }

        // Only emit 'failed' when failure was NOT handled by auto-swap
        if (currentPhase !== 'complete' && currentPhase !== 'failed') {
          this.emitter.emit('execution-progress', taskId, {
            phase: 'failed',
            phaseProgress: 0,
            overallProgress: this.events.calculateOverallProgress(currentPhase, phaseProgress),
            message: `Process exited with code ${code}`,
            sequenceNumber: ++sequenceNumber,
            completedPhases: [...completedPhases]
          }, projectId);
        }
      }

      this.emitter.emit('exit', taskId, code, processType, projectId);
    });

    // Handle process error
    childProcess.on('error', (err: Error) => {
      console.error('[AgentProcess] Process error:', err.message);
      this.state.deleteProcess(taskId);

      this.emitter.emit('execution-progress', taskId, {
        phase: 'failed',
        phaseProgress: 0,
        overallProgress: 0,
        message: `Error: ${err.message}`,
        sequenceNumber: ++sequenceNumber,
        completedPhases: [...completedPhases]
      }, projectId);

      this.emitter.emit('error', taskId, err.message, projectId);
    });
  }

  /**
   * Kill a specific task's process
   */
  killProcess(taskId: string): boolean {
    const agentProcess = this.state.getProcess(taskId);
    if (!agentProcess) return false;

    // Mark this specific spawn as killed so its exit handler knows to ignore
    this.state.markSpawnAsKilled(agentProcess.spawnId);

    // If process hasn't been spawned yet (still in async setup phase, before spawn() returns),
    // just remove from tracking. The spawn() call will still complete, but the spawned process
    // will be terminated by the post-spawn wasSpawnKilled() check (see spawnProcess() after updateProcess).
    if (!agentProcess.process) {
      this.state.deleteProcess(taskId);
      return true;
    }

    // Use shared platform-aware kill utility
    killProcessGracefully(agentProcess.process, {
      debugPrefix: '[AgentProcess]',
      debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development'
    });

    this.state.deleteProcess(taskId);
    return true;
  }

  /**
   * Kill all running processes and wait for them to exit
   */
  async killAllProcesses(): Promise<void> {
    const KILL_TIMEOUT_MS = 10000; // 10 seconds max wait

    const killPromises = this.state.getRunningTaskIds().map((taskId) => {
      return new Promise<void>((resolve) => {
        const agentProcess = this.state.getProcess(taskId);

        if (!agentProcess) {
          resolve();
          return;
        }

        // If process hasn't been spawned yet (still in async setup phase before spawn() returns),
        // just resolve immediately. The spawn() call will still complete, but the spawned process
        // will be terminated by the post-spawn wasSpawnKilled() check (see spawnProcess() after updateProcess).
        if (!agentProcess.process) {
          this.killProcess(taskId);
          resolve();
          return;
        }

        // Set up timeout to not block forever
        const timeoutId = setTimeout(() => {
          resolve();
        }, KILL_TIMEOUT_MS);

        // Listen for exit event if the process supports it
        // (process.once is available on real ChildProcess objects, but may not be in test mocks)
        if (typeof agentProcess.process.once === 'function') {
          agentProcess.process.once('exit', () => {
            clearTimeout(timeoutId);
            resolve();
          });
        }

        // Kill the process
        this.killProcess(taskId);
      });
    });

    await Promise.all(killPromises);
  }

  /**
   * Get combined environment variables for a project
   *
   * Priority (later sources override earlier):
   * 1. App-wide memory settings from settings.json (NEW - enables memory from onboarding)
   * 2. Backend source .env (apps/backend/.env) - CLI defaults
   * 3. Project's .auto-claude/.env - Frontend-configured settings (memory, integrations)
   * 4. Project settings (graphitiMcpUrl, useClaudeMd) - Runtime overrides
   */
  getCombinedEnv(projectPath: string): Record<string, string> {
    // Load app-wide memory settings from settings.json
    // This bridges onboarding config to backend agents
    const appSettings = (readSettingsFile() || {}) as Partial<AppSettings>;
    const memoryEnv = buildMemoryEnvVars(appSettings as AppSettings);

    // Existing env sources
    const autoBuildEnv = this.loadAutoBuildEnv();
    const projectFileEnv = this.loadProjectEnv(projectPath);
    const projectSettingsEnv = this.getProjectEnvVars(projectPath);

    // Priority: app-wide memory -> backend .env -> project .env -> project settings
    // Later sources override earlier ones
    return { ...memoryEnv, ...autoBuildEnv, ...projectFileEnv, ...projectSettingsEnv };
  }
}
