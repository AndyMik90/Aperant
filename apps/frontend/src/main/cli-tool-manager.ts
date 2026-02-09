/**
 * CLI Tool Manager
 *
 * Centralized management for CLI tools (Python, Git, GitHub CLI, Claude CLI) used throughout
 * the application. Provides intelligent multi-level detection with user
 * configuration support.
 *
 * Detection Priority (for each tool):
 * 1. User configuration (from settings.json)
 * 2. Virtual environment (Python only - project-specific venv)
 * 3. Homebrew (macOS - architecture-aware for Apple Silicon vs Intel)
 * 4. System PATH (augmented with common binary locations)
 * 5. Platform-specific standard locations
 *
 * Features:
 * - Session-based caching (no TTL - cache persists until app restart or settings
 *   change)
 * - Version validation (Python 3.10+ required for claude-agent-sdk)
 * - Platform-aware detection (macOS, Windows, Linux)
 * - Graceful fallbacks when tools not found
 */

import { execFileSync, execFile, type ExecFileOptionsWithStringEncoding, type ExecFileSyncOptions } from 'child_process';
import { existsSync, readdirSync, promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { app } from 'electron';
import { findExecutable, findExecutableAsync, getAugmentedEnv, getAugmentedEnvAsync, shouldUseShell, existsAsync } from './env-utils';
import { isWindows, isMacOS, isUnix, joinPaths, getExecutableExtension } from './platform';
import type { ToolDetectionResult } from '../shared/types';
import { findHomebrewPython as findHomebrewPythonUtil } from './utils/homebrew-python';

const execFileAsync = promisify(execFile);

export type ExecFileSyncOptionsWithVerbatim = ExecFileSyncOptions & {
  windowsVerbatimArguments?: boolean;
};
export type ExecFileAsyncOptionsWithVerbatim = ExecFileOptionsWithStringEncoding & {
  windowsVerbatimArguments?: boolean;
};

const normalizeExecOutput = (output: string | Buffer): string =>
  typeof output === 'string' ? output : output.toString('utf-8');
import {
  getWindowsExecutablePaths,
  getWindowsExecutablePathsAsync,
  WINDOWS_GIT_PATHS,
  WINDOWS_GLAB_PATHS,
  findWindowsExecutableViaWhere,
  findWindowsExecutableViaWhereAsync,
  isSecurePath,
} from './utils/windows-paths';

/**
 * Supported CLI tools managed by this system
 */
export type CLITool = 'python' | 'git' | 'gh' | 'glab' | 'claude';

/**
 * User configuration for CLI tool paths
 * Maps to settings stored in settings.json
 */
export interface ToolConfig {
  pythonPath?: string;
  gitPath?: string;
  githubCLIPath?: string;
  gitlabCLIPath?: string;
  claudePath?: string;
}

/**
 * Internal validation result for a CLI tool
 */
interface ToolValidation {
  valid: boolean;
  version?: string;
  message: string;
}

/**
 * Cache entry for detected tool path
 * No timestamp - cache persists for entire app session
 */
interface CacheEntry {
  path: string;
  version?: string;
  source: string;
}

/**
 * Check if a path appears to be from a different platform.
 * Detects Windows paths on Unix and Unix paths on Windows.
 *
 * @param pathStr - The path to check
 * @returns true if the path is from a different platform
 */
function isWrongPlatformPath(pathStr: string | undefined): boolean {
  if (!pathStr) return false;

  if (isWindows()) {
    // On Windows, reject Unix-style absolute paths (starting with /)
    // but allow relative paths and Windows paths
    if (pathStr.startsWith('/') && !pathStr.startsWith('//')) {
      // Unix absolute path on Windows
      return true;
    }
  } else {
    // On Unix (macOS/Linux), reject Windows-style paths
    // Windows paths have: drive letter (C:), backslashes, or specific Windows paths
    if (/^[A-Za-z]:[/\\]/.test(pathStr)) {
      // Drive letter path (C:\, D:/, etc.)
      return true;
    }
    if (pathStr.includes('\\')) {
      // Contains backslashes (Windows path separators)
      return true;
    }
    if (pathStr.includes('AppData') || pathStr.includes('Program Files')) {
      // Contains Windows-specific directory names
      return true;
    }
  }

  return false;
}

// ============================================================================
// SHARED HELPERS - Used by both sync and async Claude detection
// ============================================================================

/**
 * Configuration for Claude CLI detection paths
 */
interface ClaudeDetectionPaths {
  /** Homebrew paths for macOS (Apple Silicon and Intel) */
  homebrewPaths: string[];
  /** Platform-specific standard installation paths */
  platformPaths: string[];
  /** Path to NVM versions directory for Node.js-installed Claude */
  nvmVersionsDir: string;
}

/**
 * Get all candidate paths for Claude CLI detection.
 *
 * Returns platform-specific paths where Claude CLI might be installed.
 * This pure function consolidates path configuration used by both sync
 * and async detection methods.
 *
 * Note: This is the single source of truth for CLI detection paths.
 * The Python backend relies on the Claude Agent SDK's bundled CLI,
 * so it no longer needs its own path detection logic.
 *
 * @param homeDir - User's home directory (from os.homedir())
 * @returns Object containing homebrew, platform, and NVM paths
 *
 * @example
 * const paths = getClaudeDetectionPaths('/Users/john');
 * // On macOS: { homebrewPaths: ['/opt/homebrew/bin/claude', ...], ... }
 */
export function getClaudeDetectionPaths(homeDir: string): ClaudeDetectionPaths {
  const homebrewPaths = [
    '/opt/homebrew/bin/claude', // Apple Silicon
    '/usr/local/bin/claude',    // Intel Mac
  ];

  const platformPaths = isWindows()
    ? [
        joinPaths(homeDir, 'AppData', 'Local', 'Programs', 'claude', `claude${getExecutableExtension()}`),
        joinPaths(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        joinPaths(homeDir, '.local', 'bin', `claude${getExecutableExtension()}`),
        'C:\\Program Files\\Claude\\claude.exe',
        'C:\\Program Files (x86)\\Claude\\claude.exe',
      ]
    : [
        joinPaths(homeDir, '.local', 'bin', 'claude'),
        joinPaths(homeDir, 'bin', 'claude'),
      ];

  const nvmVersionsDir = joinPaths(homeDir, '.nvm', 'versions', 'node');

  return { homebrewPaths, platformPaths, nvmVersionsDir };
}

/**
 * Sort NVM version directories by semantic version (newest first).
 *
 * Filters entries to only include directories starting with 'v' (version directories)
 * and sorts them in descending order so the newest Node.js version is checked first.
 *
 * @param entries - Directory entries from readdir with { name, isDirectory() }
 * @returns Array of version directory names sorted newest first
 *
 * @example
 * const entries = [
 *   { name: 'v18.0.0', isDirectory: () => true },
 *   { name: 'v20.0.0', isDirectory: () => true },
 *   { name: '.DS_Store', isDirectory: () => false },
 * ];
 * sortNvmVersionDirs(entries); // ['v20.0.0', 'v18.0.0']
 */
export function sortNvmVersionDirs(
  entries: Array<{ name: string; isDirectory(): boolean }>
): string[] {
  // Regex to match valid semver directories: v20.0.0, v18.17.1, etc.
  // This prevents NaN from malformed versions (e.g., v20.abc.1) breaking sort
  const semverRegex = /^v\d+\.\d+\.\d+$/;

  return entries
    .filter((entry) => entry.isDirectory() && semverRegex.test(entry.name))
    .sort((a, b) => {
      // Parse version numbers: v20.0.0 -> [20, 0, 0]
      const vA = a.name.slice(1).split('.').map(Number);
      const vB = b.name.slice(1).split('.').map(Number);
      // Compare major, minor, patch in order (descending)
      for (let i = 0; i < 3; i++) {
        const diff = (vB[i] ?? 0) - (vA[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .map((entry) => entry.name);
}

/**
 * Build a ToolDetectionResult from a validation result.
 *
 * Returns null if validation failed, otherwise constructs the full result object.
 * This helper consolidates the result-building logic used throughout detection.
 *
 * @param claudePath - The path that was validated
 * @param validation - The validation result from validateClaude/validateClaudeAsync
 * @param source - The source of detection ('user-config', 'homebrew', 'system-path', 'nvm')
 * @param messagePrefix - Prefix for the success message (e.g., 'Using Homebrew Claude CLI')
 * @returns ToolDetectionResult if valid, null if validation failed
 *
 * @example
 * const result = buildClaudeDetectionResult(
 *   '/opt/homebrew/bin/claude',
 *   { valid: true, version: '1.0.0', message: 'OK' },
 *   'homebrew',
 *   'Using Homebrew Claude CLI'
 * );
 * // Returns: { found: true, path: '/opt/homebrew/bin/claude', version: '1.0.0', ... }
 */
export function buildClaudeDetectionResult(
  claudePath: string,
  validation: ToolValidation,
  source: ToolDetectionResult['source'],
  messagePrefix: string
): ToolDetectionResult | null {
  if (!validation.valid) {
    return null;
  }
  return {
    found: true,
    path: claudePath,
    version: validation.version,
    source,
    message: `${messagePrefix}: ${claudePath}`,
  };
}

/**
 * Centralized CLI Tool Manager
 *
 * Singleton class that manages detection, validation, and caching of CLI tool
 * paths. Supports user configuration overrides and intelligent auto-detection.
 *
 * Usage:
 *   import { getToolPath, configureTools } from './cli-tool-manager';
 *
 *   // Configure with user settings (optional)
 *   configureTools({ pythonPath: '/custom/python3', gitPath: '/custom/git' });
 *
 *   // Get tool path (auto-detects if not configured)
 *   const pythonPath = getToolPath('python');
 *   const gitPath = getToolPath('git');
 */
class CLIToolManager {
  private cache: Map<CLITool, CacheEntry> = new Map();
  private userConfig: ToolConfig = {};

  /**
   * Configure the tool manager with user settings
   *
   * Clears the cache to force re-detection with new configuration.
   * Call this when user changes CLI tool paths in Settings.
   *
   * @param config - User configuration for CLI tool paths
   */
  configure(config: ToolConfig): void {
    this.userConfig = config;
    this.cache.clear();
    console.warn('[CLI Tools] Configuration updated, cache cleared');
  }

  /**
   * Get the path for a specific CLI tool
   *
   * Uses cached path if available, otherwise detects and caches.
   * Cache persists for entire app session (no expiration).
   *
   * @param tool - The CLI tool to get the path for
   * @returns The resolved path to the tool executable
   */
  getToolPath(tool: CLITool): string {
    // Check cache first
    const cached = this.cache.get(tool);
    if (cached) {
      console.debug(
        `[CLI Tools] Using cached ${tool}: ${cached.path} (${cached.source})`
      );
      return cached.path;
    }

    // Detect and cache
    const result = this.detectToolPath(tool);
    if (result.found && result.path) {
      this.cache.set(tool, {
        path: result.path,
        version: result.version,
        source: result.source,
      });
      console.warn(`[CLI Tools] Detected ${tool}: ${result.path} (${result.source})`);
      return result.path;
    }

    // Fallback to tool name (let system PATH resolve it)
    console.warn(`[CLI Tools] ${tool} not found, using fallback: "${tool}"`);
    return tool;
  }

  /**
   * Get Claude CLI path for SDK usage
   *
   * Returns null when a .cmd file is detected on Windows, so the SDK
   * can use its bundled claude.exe instead. The SDK's bundled CLI is
   * a proper Windows executable that can be spawned by anyio.open_process().
   *
   * @returns Claude CLI path, or null if SDK should use bundled CLI
   */
  getClaudeCliPathForSdk(): string | null {
    const claudePath = this.getToolPath('claude');

    // On Windows, .cmd files cannot be executed by anyio.open_process() / asyncio.create_subprocess_exec().
    // Return null so the Claude Agent SDK uses its bundled claude.exe instead.
    if (isWindows() && claudePath.toLowerCase().endsWith('.cmd')) {
      console.warn(
        `[CLI Tools] Claude CLI is .cmd file, returning null so SDK uses bundled CLI: ${claudePath}`
      );
      return null;
    }

    return claudePath;
  }

  /**
   * Detect the path for a specific CLI tool
   *
   * Implements multi-level detection strategy based on tool type.
   *
   * @param tool - The tool to detect
   * @returns Detection result with path and metadata
   */
  private detectToolPath(tool: CLITool): ToolDetectionResult {
    switch (tool) {
      case 'python':
        return this.detectPython();
      case 'git':
        return this.detectGit();
      case 'gh':
        return this.detectGitHubCLI();
      case 'glab':
        return this.detectGitLabCLI();
      case 'claude':
        return this.detectClaude();
      default:
        return {
          found: false,
          source: 'fallback',
          message: `Unknown tool: ${tool}`,
        };
    }
  }

  /**
   * Detect Python with multi-level priority
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Bundled Python (packaged apps only)
   * 3. Homebrew Python (macOS)
   * 4. System PATH (py -3, python3, python)
   *
   * Validates Python version >= 3.10.0 (required by claude-agent-sdk)
   *
   * @returns Detection result for Python
   */
  private detectPython(): ToolDetectionResult {
    const MINIMUM_VERSION = '3.10.0';

    // 1. User configuration
    if (this.userConfig.pythonPath) {
      // Check if path is from wrong platform (e.g., Windows path on macOS)
      if (isWrongPlatformPath(this.userConfig.pythonPath)) {
        console.warn(
          `[Python] User-configured path is from different platform, ignoring: ${this.userConfig.pythonPath}`
        );
      } else {
        const validation = this.validatePython(this.userConfig.pythonPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.pythonPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured Python: ${this.userConfig.pythonPath}`,
          };
        }
        console.warn(
          `[Python] User-configured path invalid: ${validation.message}`
        );
      }
    }

    // 2. Bundled Python (packaged apps only)
    if (app.isPackaged) {
      const bundledPath = this.getBundledPythonPath();
      if (bundledPath) {
        const validation = this.validatePython(bundledPath);
        if (validation.valid) {
          return {
            found: true,
            path: bundledPath,
            version: validation.version,
            source: 'bundled',
            message: `Using bundled Python: ${bundledPath}`,
          };
        }
      }
    }

    // 3. Homebrew Python (macOS)
    if (isMacOS()) {
      const homebrewPath = this.findHomebrewPython();
      if (homebrewPath) {
        const validation = this.validatePython(homebrewPath);
        if (validation.valid) {
          return {
            found: true,
            path: homebrewPath,
            version: validation.version,
            source: 'homebrew',
            message: `Using Homebrew Python: ${homebrewPath}`,
          };
        }
      }
    }

    // 4. System PATH (augmented)
    const candidates =
      isWindows()
        ? ['py -3', 'python', 'python3', 'py']
        : ['python3', 'python'];

    for (const cmd of candidates) {
      // Special handling for Windows 'py -3' launcher
      if (cmd.startsWith('py ')) {
        const validation = this.validatePython(cmd);
        if (validation.valid) {
          return {
            found: true,
            path: cmd,
            version: validation.version,
            source: 'system-path',
            message: `Using system Python: ${cmd}`,
          };
        }
      } else {
        // For regular python/python3, find the actual path
        const pythonPath = findExecutable(cmd);
        if (pythonPath) {
          const validation = this.validatePython(pythonPath);
          if (validation.valid) {
            return {
              found: true,
              path: pythonPath,
              version: validation.version,
              source: 'system-path',
              message: `Using system Python: ${pythonPath}`,
            };
          }
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message:
        `Python ${MINIMUM_VERSION}+ not found. ` +
        'Please install Python or configure in Settings.',
    };
  }

  /**
   * Detect Git with multi-level priority
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Homebrew Git (macOS)
   * 3. System PATH
   *
   * @returns Detection result for Git
   */
  private detectGit(): ToolDetectionResult {
    // 1. User configuration
    if (this.userConfig.gitPath) {
      // Check if path is from wrong platform (e.g., Windows path on macOS)
      if (isWrongPlatformPath(this.userConfig.gitPath)) {
        console.warn(
          `[Git] User-configured path is from different platform, ignoring: ${this.userConfig.gitPath}`
        );
      } else {
        const validation = this.validateGit(this.userConfig.gitPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.gitPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured Git: ${this.userConfig.gitPath}`,
          };
        }
        console.warn(`[Git] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/git', // Apple Silicon
        '/usr/local/bin/git', // Intel Mac
      ];

      for (const gitPath of homebrewPaths) {
        if (existsSync(gitPath)) {
          const validation = this.validateGit(gitPath);
          if (validation.valid) {
            return {
              found: true,
              path: gitPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew Git: ${gitPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const gitPath = findExecutable('git');
    if (gitPath) {
      const validation = this.validateGit(gitPath);
      if (validation.valid) {
        return {
          found: true,
          path: gitPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system Git: ${gitPath}`,
        };
      }
    }

    // 4. Windows-specific detection using 'where' command (most reliable for custom installs)
    if (isWindows()) {
      // First try 'where' command - finds git regardless of installation location
      const whereGitPath = findWindowsExecutableViaWhere('git', '[Git]');
      if (whereGitPath) {
        const validation = this.validateGit(whereGitPath);
        if (validation.valid) {
          return {
            found: true,
            path: whereGitPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows Git: ${whereGitPath}`,
          };
        }
      }

      // Fallback to checking common installation paths
      const windowsPaths = getWindowsExecutablePaths(WINDOWS_GIT_PATHS, '[Git]');
      for (const winGitPath of windowsPaths) {
        const validation = this.validateGit(winGitPath);
        if (validation.valid) {
          return {
            found: true,
            path: winGitPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows Git: ${winGitPath}`,
          };
        }
      }
    }

    // 5. Not found - fallback to 'git'
    return {
      found: false,
      source: 'fallback',
      message: 'Git not found in standard locations. Using fallback "git".',
    };
  }

  /**
   * Detect GitHub CLI with multi-level priority
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Homebrew gh (macOS)
   * 3. System PATH
   * 4. Windows Program Files
   *
   * @returns Detection result for GitHub CLI
   */
  private detectGitHubCLI(): ToolDetectionResult {
    // 1. User configuration
    if (this.userConfig.githubCLIPath) {
      // Check if path is from wrong platform (e.g., Windows path on macOS)
      if (isWrongPlatformPath(this.userConfig.githubCLIPath)) {
        console.warn(
          `[GitHub CLI] User-configured path is from different platform, ignoring: ${this.userConfig.githubCLIPath}`
        );
      } else {
        const validation = this.validateGitHubCLI(this.userConfig.githubCLIPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.githubCLIPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured GitHub CLI: ${this.userConfig.githubCLIPath}`,
          };
        }
        console.warn(
          `[GitHub CLI] User-configured path invalid: ${validation.message}`
        );
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/gh', // Apple Silicon
        '/usr/local/bin/gh', // Intel Mac
      ];

      for (const ghPath of homebrewPaths) {
        if (existsSync(ghPath)) {
          const validation = this.validateGitHubCLI(ghPath);
          if (validation.valid) {
            return {
              found: true,
              path: ghPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew GitHub CLI: ${ghPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const ghPath = findExecutable('gh');
    if (ghPath) {
      const validation = this.validateGitHubCLI(ghPath);
      if (validation.valid) {
        return {
          found: true,
          path: ghPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system GitHub CLI: ${ghPath}`,
        };
      }
    }

    // 4. Windows Program Files
    if (isWindows()) {
      const windowsPaths = [
        'C:\\Program Files\\GitHub CLI\\gh.exe',
        'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
      ];

      for (const ghPath of windowsPaths) {
        if (existsSync(ghPath)) {
          const validation = this.validateGitHubCLI(ghPath);
          if (validation.valid) {
            return {
              found: true,
              path: ghPath,
              version: validation.version,
              source: 'system-path',
              message: `Using Windows GitHub CLI: ${ghPath}`,
            };
          }
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'GitHub CLI (gh) not found. Install from https://cli.github.com',
    };
  }

  /**
   * Detect GitLab CLI with multi-level priority
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Homebrew glab (macOS)
   * 3. System PATH
   * 4. Windows Program Files
   *
   * @returns Detection result for GitLab CLI
   */
  private detectGitLabCLI(): ToolDetectionResult {
    // 1. User configuration
    if (this.userConfig.gitlabCLIPath) {
      // Check if path is from wrong platform (e.g., Windows path on macOS)
      if (isWrongPlatformPath(this.userConfig.gitlabCLIPath)) {
        console.warn(
          `[GitLab CLI] User-configured path is from different platform, ignoring: ${this.userConfig.gitlabCLIPath}`
        );
      } else {
        const validation = this.validateGitLabCLI(this.userConfig.gitlabCLIPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.gitlabCLIPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured GitLab CLI: ${this.userConfig.gitlabCLIPath}`,
          };
        }
        console.warn(
          `[GitLab CLI] User-configured path invalid: ${validation.message}`
        );
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/glab', // Apple Silicon
        '/usr/local/bin/glab', // Intel Mac
      ];

      for (const glabPath of homebrewPaths) {
        if (existsSync(glabPath)) {
          const validation = this.validateGitLabCLI(glabPath);
          if (validation.valid) {
            return {
              found: true,
              path: glabPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew GitLab CLI: ${glabPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const glabPath = findExecutable('glab');
    if (glabPath) {
      const validation = this.validateGitLabCLI(glabPath);
      if (validation.valid) {
        return {
          found: true,
          path: glabPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system GitLab CLI: ${glabPath}`,
        };
      }
    }

    // 4. Windows Program Files
    if (isWindows()) {
      const windowsPaths = getWindowsExecutablePaths(WINDOWS_GLAB_PATHS, '[GitLab CLI]');
      for (const glabPath of windowsPaths) {
        const validation = this.validateGitLabCLI(glabPath);
        if (validation.valid) {
          return {
            found: true,
            path: glabPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows GitLab CLI: ${glabPath}`,
          };
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'GitLab CLI (glab) not found. Install from https://gitlab.com/gitlab-org/cli',
    };
  }

  /**
   * Detect Claude CLI with multi-level priority
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Homebrew claude (macOS)
   * 3. System PATH
   * 4. Windows where.exe (Windows only - finds executables via PATH + Registry)
   * 5. NVM paths (Unix only - checks Node.js version managers)
   * 6. Platform-specific standard locations
   *
   * @returns Detection result for Claude CLI
   */
  private detectClaude(): ToolDetectionResult {
    const homeDir = os.homedir();
    const paths = getClaudeDetectionPaths(homeDir);

    // 1. User configuration
    if (this.userConfig.claudePath) {
      if (isWrongPlatformPath(this.userConfig.claudePath)) {
        console.warn(
          `[Claude CLI] User-configured path is from different platform, ignoring: ${this.userConfig.claudePath}`
        );
      } else if (isWindows() && !isSecurePath(this.userConfig.claudePath)) {
        console.warn(
          `[Claude CLI] User-configured path failed security validation, ignoring: ${this.userConfig.claudePath}`
        );
      } else {
        const validation = this.validateClaude(this.userConfig.claudePath);
        const result = buildClaudeDetectionResult(
          this.userConfig.claudePath, validation, 'user-config', 'Using user-configured Claude CLI'
        );
        if (result) return result;
        console.warn(`[Claude CLI] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      for (const claudePath of paths.homebrewPaths) {
        if (existsSync(claudePath)) {
          const validation = this.validateClaude(claudePath);
          const result = buildClaudeDetectionResult(claudePath, validation, 'homebrew', 'Using Homebrew Claude CLI');
          if (result) return result;
        }
      }
    }

    // 3. System PATH (augmented)
    const systemClaudePath = findExecutable('claude');
    if (systemClaudePath) {
      const validation = this.validateClaude(systemClaudePath);
      const result = buildClaudeDetectionResult(systemClaudePath, validation, 'system-path', 'Using system Claude CLI');
      if (result) return result;
    }

    // 4. Windows where.exe detection (Windows only - most reliable for custom installs)
    if (isWindows()) {
      const whereClaudePath = findWindowsExecutableViaWhere('claude', '[Claude CLI]');
      if (whereClaudePath) {
        const validation = this.validateClaude(whereClaudePath);
        const result = buildClaudeDetectionResult(whereClaudePath, validation, 'system-path', 'Using Windows Claude CLI');
        if (result) return result;
      }
    }

    // 5. NVM paths (Unix only) - check before platform paths for better Node.js integration
    if (isUnix()) {
      try {
        if (existsSync(paths.nvmVersionsDir)) {
          const nodeVersions = readdirSync(paths.nvmVersionsDir, { withFileTypes: true });
          const versionNames = sortNvmVersionDirs(nodeVersions);

          for (const versionName of versionNames) {
            const nvmClaudePath = path.join(paths.nvmVersionsDir, versionName, 'bin', 'claude');
            if (existsSync(nvmClaudePath)) {
              const validation = this.validateClaude(nvmClaudePath);
              const result = buildClaudeDetectionResult(nvmClaudePath, validation, 'nvm', 'Using NVM Claude CLI');
              if (result) return result;
            }
          }
        }
      } catch (error) {
        console.warn(`[Claude CLI] Unable to read NVM directory: ${error}`);
      }
    }

    // 6. Platform-specific standard locations
    for (const claudePath of paths.platformPaths) {
      if (existsSync(claudePath)) {
        const validation = this.validateClaude(claudePath);
        const result = buildClaudeDetectionResult(claudePath, validation, 'system-path', 'Using Claude CLI');
        if (result) return result;
      }
    }

    // 7. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'Claude CLI not found. Install from https://claude.ai/download',
    };
  }

  /**
   * Validate Python version and availability
   *
   * Checks that Python executable exists and meets minimum version requirement
   * (3.10.0+) for claude-agent-sdk compatibility.
   *
   * @param pythonCmd - The Python command to validate
   * @returns Validation result with version information
   */
  private validatePython(pythonCmd: string): ToolValidation {
    const MINIMUM_VERSION = '3.10.0';

    try {
      // Parse command to handle cases like 'py -3' on Windows
      // This avoids command injection by using execFileSync instead of execSync
      const parts = pythonCmd.split(' ');
      const cmd = parts[0];
      const args = [...parts.slice(1), '--version'];

      const version = execFileSync(cmd, args, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: getAugmentedEnv(),
      }).trim();

      const match = version.match(/Python (\d+\.\d+\.\d+)/);
      if (!match) {
        return {
          valid: false,
          message: 'Unable to detect Python version',
        };
      }

      const versionStr = match[1];
      const [major, minor] = versionStr.split('.').map(Number);
      const [reqMajor, reqMinor] = MINIMUM_VERSION.split('.').map(Number);

      const meetsRequirement =
        major > reqMajor || (major === reqMajor && minor >= reqMinor);

      if (!meetsRequirement) {
        return {
          valid: false,
          version: versionStr,
          message: `Python ${versionStr} is too old. Requires ${MINIMUM_VERSION}+`,
        };
      }

      return {
        valid: true,
        version: versionStr,
        message: `Python ${versionStr} meets requirements`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Python: ${error}`,
      };
    }
  }

  /**
   * Validate Git availability and version
   *
   * @param gitCmd - The Git command to validate
   * @returns Validation result with version information
   */
  private validateGit(gitCmd: string): ToolValidation {
    try {
      const version = execFileSync(gitCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: getAugmentedEnv(),
      }).trim();

      const match = version.match(/git version (\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version;

      return {
        valid: true,
        version: versionStr,
        message: `Git ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Git: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate GitHub CLI availability and version
   *
   * @param ghCmd - The GitHub CLI command to validate
   * @returns Validation result with version information
   */
  private validateGitHubCLI(ghCmd: string): ToolValidation {
    try {
      const version = execFileSync(ghCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: getAugmentedEnv(),
      }).trim();

      const match = version.match(/gh version (\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `GitHub CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate GitHub CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate GitLab CLI availability and version
   *
   * @param glabCmd - The GitLab CLI command to validate
   * @returns Validation result with version information
   */
  private validateGitLabCLI(glabCmd: string): ToolValidation {
    try {
      const version = execFileSync(glabCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: getAugmentedEnv(),
      }).trim();

      // glab version output format: "glab X.Y.Z (hash)" - note: no "version" word
      const match = version.match(/glab\s+(\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `GitLab CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate GitLab CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate Claude CLI availability and version
   *
   * @param claudeCmd - The Claude CLI command to validate
   * @returns Validation result with version information
   */
  private validateClaude(claudeCmd: string): ToolValidation {
    try {
      const trimmedCmd = claudeCmd.trim();
      const unquotedCmd =
        trimmedCmd.startsWith('"') && trimmedCmd.endsWith('"')
          ? trimmedCmd.slice(1, -1)
          : trimmedCmd;

      const needsShell = shouldUseShell(trimmedCmd);
      const cmdDir = path.dirname(unquotedCmd);
      const env = getAugmentedEnv(cmdDir && cmdDir !== '.' ? [cmdDir] : []);

      let version: string;

      if (needsShell) {
        // For .cmd/.bat files on Windows, use cmd.exe with a quoted command line
        // /s preserves quotes so paths with spaces are handled correctly.
        if (!isSecurePath(unquotedCmd)) {
          return {
            valid: false,
            message: `Claude CLI path failed security validation: ${unquotedCmd}`,
          };
        }
        const cmdExe = process.env.ComSpec
          || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
        const cmdLine = `""${unquotedCmd}" --version"`;
        const execOptions: ExecFileSyncOptionsWithVerbatim = {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
          windowsVerbatimArguments: true,
          env,
        };
        version = normalizeExecOutput(
          execFileSync(cmdExe, ['/d', '/s', '/c', cmdLine], execOptions)
        ).trim();
      } else {
        // For .exe files and non-Windows, use execFileSync
        version = normalizeExecOutput(
          execFileSync(unquotedCmd, ['--version'], {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
            shell: false,
            env,
          })
        ).trim();
      }

      // Claude CLI version output format: "claude-code version X.Y.Z" or similar
      const match = version.match(/(\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `Claude CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Claude CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ============================================================================
  // ASYNC METHODS - Non-blocking alternatives for Electron main process
  // ============================================================================

  /**
   * Get the path for a CLI tool asynchronously (non-blocking)
   *
   * Uses cached path if available, otherwise detects asynchronously.
   * Safe to call from Electron main process without blocking.
   *
   * @param tool - The CLI tool to get the path for
   * @returns Promise resolving to the tool path
   */
  async getToolPathAsync(tool: CLITool): Promise<string> {
    // Check cache first (instant return if cached)
    const cached = this.cache.get(tool);
    if (cached) {
      console.debug(
        `[CLI Tools] Using cached ${tool}: ${cached.path} (${cached.source})`
      );
      return cached.path;
    }

    // Detect asynchronously
    const result = await this.detectToolPathAsync(tool);
    if (result.found && result.path) {
      this.cache.set(tool, {
        path: result.path,
        version: result.version,
        source: result.source,
      });
      console.warn(`[CLI Tools] Detected ${tool}: ${result.path} (${result.source})`);
      return result.path;
    }

    // Fallback to tool name (let system PATH resolve it)
    console.warn(`[CLI Tools] ${tool} not found, using fallback: "${tool}"`);
    return tool;
  }

  /**
   * Get Claude CLI path for SDK usage asynchronously (non-blocking)
   *
   * Returns null when a .cmd file is detected on Windows, so the SDK
   * can use its bundled claude.exe instead.
   *
   * @returns Promise resolving to Claude CLI path, or null if SDK should use bundled CLI
   */
  async getClaudeCliPathForSdkAsync(): Promise<string | null> {
    const claudePath = await this.getToolPathAsync('claude');

    // On Windows, .cmd files cannot be executed by anyio.open_process() / asyncio.create_subprocess_exec().
    // Return null so the Claude Agent SDK uses its bundled claude.exe instead.
    if (isWindows() && claudePath.toLowerCase().endsWith('.cmd')) {
      console.warn(
        `[CLI Tools] Claude CLI is .cmd file, returning null so SDK uses bundled CLI: ${claudePath}`
      );
      return null;
    }

    return claudePath;
  }

  /**
   * Detect tool path asynchronously
   *
   * All tools now use async detection methods to prevent blocking the main process.
   *
   * @param tool - The tool to detect
   * @returns Promise resolving to detection result
   */
  private async detectToolPathAsync(tool: CLITool): Promise<ToolDetectionResult> {
    switch (tool) {
      case 'claude':
        return this.detectClaudeAsync();
      case 'python':
        return this.detectPythonAsync();
      case 'git':
        return this.detectGitAsync();
      case 'gh':
        return this.detectGitHubCLIAsync();
      case 'glab':
        return this.detectGitLabCLIAsync();
      default:
        return {
          found: false,
          source: 'fallback',
          message: `Unknown tool: ${tool}`,
        };
    }
  }

  /**
   * Validate Claude CLI asynchronously (non-blocking)
   *
   * @param claudeCmd - The Claude CLI command to validate
   * @returns Promise resolving to validation result
   */
  private async validateClaudeAsync(claudeCmd: string): Promise<ToolValidation> {
    try {
      const trimmedCmd = claudeCmd.trim();
      const unquotedCmd =
        trimmedCmd.startsWith('"') && trimmedCmd.endsWith('"')
          ? trimmedCmd.slice(1, -1)
          : trimmedCmd;

      const needsShell = shouldUseShell(trimmedCmd);
      const cmdDir = path.dirname(unquotedCmd);
      const env = await getAugmentedEnvAsync(cmdDir && cmdDir !== '.' ? [cmdDir] : []);

      let stdout: string;

      if (needsShell) {
        // For .cmd/.bat files on Windows, use cmd.exe with a quoted command line
        // /s preserves quotes so paths with spaces are handled correctly.
        if (!isSecurePath(unquotedCmd)) {
          return {
            valid: false,
            message: `Claude CLI path failed security validation: ${unquotedCmd}`,
          };
        }
        const cmdExe = process.env.ComSpec
          || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
        const cmdLine = `""${unquotedCmd}" --version"`;
        const execOptions: ExecFileAsyncOptionsWithVerbatim = {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
          windowsVerbatimArguments: true,
          env,
        };
        const result = await execFileAsync(cmdExe, ['/d', '/s', '/c', cmdLine], execOptions);
        stdout = result.stdout;
      } else {
        // For .exe files and non-Windows, use execFileAsync
        const result = await execFileAsync(unquotedCmd, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
          shell: false,
          env,
        });
        stdout = result.stdout;
      }

      const version = normalizeExecOutput(stdout).trim();
      const match = version.match(/(\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `Claude CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Claude CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate Python version asynchronously (non-blocking)
   *
   * @param pythonCmd - The Python command to validate
   * @returns Promise resolving to validation result
   */
  private async validatePythonAsync(pythonCmd: string): Promise<ToolValidation> {
    const MINIMUM_VERSION = '3.10.0';

    try {
      const parts = pythonCmd.split(' ');
      const cmd = parts[0];
      const args = [...parts.slice(1), '--version'];

      const { stdout } = await execFileAsync(cmd, args, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: await getAugmentedEnvAsync(),
      });

      const version = stdout.trim();
      const match = version.match(/Python (\d+\.\d+\.\d+)/);
      if (!match) {
        return {
          valid: false,
          message: 'Unable to detect Python version',
        };
      }

      const versionStr = match[1];
      const [major, minor] = versionStr.split('.').map(Number);
      const [reqMajor, reqMinor] = MINIMUM_VERSION.split('.').map(Number);

      const meetsRequirement =
        major > reqMajor || (major === reqMajor && minor >= reqMinor);

      if (!meetsRequirement) {
        return {
          valid: false,
          version: versionStr,
          message: `Python ${versionStr} is too old. Requires ${MINIMUM_VERSION}+`,
        };
      }

      return {
        valid: true,
        version: versionStr,
        message: `Python ${versionStr} meets requirements`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Python: ${error}`,
      };
    }
  }

  /**
   * Validate Git asynchronously (non-blocking)
   *
   * @param gitCmd - The Git command to validate
   * @returns Promise resolving to validation result
   */
  private async validateGitAsync(gitCmd: string): Promise<ToolValidation> {
    try {
      const { stdout } = await execFileAsync(gitCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: await getAugmentedEnvAsync(),
      });

      const version = stdout.trim();
      const match = version.match(/git version (\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version;

      return {
        valid: true,
        version: versionStr,
        message: `Git ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate Git: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate GitHub CLI asynchronously (non-blocking)
   *
   * @param ghCmd - The GitHub CLI command to validate
   * @returns Promise resolving to validation result
   */
  private async validateGitHubCLIAsync(ghCmd: string): Promise<ToolValidation> {
    try {
      const { stdout } = await execFileAsync(ghCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: await getAugmentedEnvAsync(),
      });

      const version = stdout.trim();
      const match = version.match(/gh version (\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `GitHub CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate GitHub CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate GitLab CLI availability and version asynchronously (non-blocking)
   *
   * @param glabCmd - The GitLab CLI command to validate
   * @returns Promise resolving to validation result
   */
  private async validateGitLabCLIAsync(glabCmd: string): Promise<ToolValidation> {
    try {
      const { stdout } = await execFileAsync(glabCmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: await getAugmentedEnvAsync(),
      });

      const version = stdout.trim();
      // glab version output format: "glab X.Y.Z (hash)" - note: no "version" word
      const match = version.match(/glab\s+(\d+\.\d+\.\d+)/);
      const versionStr = match ? match[1] : version.split('\n')[0];

      return {
        valid: true,
        version: versionStr,
        message: `GitLab CLI ${versionStr} is available`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Failed to validate GitLab CLI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Detect Claude CLI asynchronously (non-blocking)
   *
   * Priority order:
   * 1. User configuration (if valid for current platform)
   * 2. Homebrew claude (macOS)
   * 3. System PATH
   * 4. Windows where.exe (Windows only - finds executables via PATH + Registry)
   * 5. NVM paths (Unix only - checks Node.js version managers)
   * 6. Platform-specific standard locations
   *
   * @returns Promise resolving to detection result
   */
  private async detectClaudeAsync(): Promise<ToolDetectionResult> {
    const homeDir = os.homedir();
    const paths = getClaudeDetectionPaths(homeDir);

    // 1. User configuration
    if (this.userConfig.claudePath) {
      if (isWrongPlatformPath(this.userConfig.claudePath)) {
        console.warn(
          `[Claude CLI] User-configured path is from different platform, ignoring: ${this.userConfig.claudePath}`
        );
      } else if (isWindows() && !isSecurePath(this.userConfig.claudePath)) {
        console.warn(
          `[Claude CLI] User-configured path failed security validation, ignoring: ${this.userConfig.claudePath}`
        );
      } else {
        const validation = await this.validateClaudeAsync(this.userConfig.claudePath);
        const result = buildClaudeDetectionResult(
          this.userConfig.claudePath, validation, 'user-config', 'Using user-configured Claude CLI'
        );
        if (result) return result;
        console.warn(`[Claude CLI] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      for (const claudePath of paths.homebrewPaths) {
        if (await existsAsync(claudePath)) {
          const validation = await this.validateClaudeAsync(claudePath);
          const result = buildClaudeDetectionResult(claudePath, validation, 'homebrew', 'Using Homebrew Claude CLI');
          if (result) return result;
        }
      }
    }

    // 3. System PATH (augmented) - using async findExecutable
    const systemClaudePath = await findExecutableAsync('claude');
    if (systemClaudePath) {
      const validation = await this.validateClaudeAsync(systemClaudePath);
      const result = buildClaudeDetectionResult(systemClaudePath, validation, 'system-path', 'Using system Claude CLI');
      if (result) return result;
    }

    // 4. Windows where.exe detection (async, non-blocking)
    if (isWindows()) {
      const whereClaudePath = await findWindowsExecutableViaWhereAsync('claude', '[Claude CLI]');
      if (whereClaudePath) {
        const validation = await this.validateClaudeAsync(whereClaudePath);
        const result = buildClaudeDetectionResult(whereClaudePath, validation, 'system-path', 'Using Windows Claude CLI');
        if (result) return result;
      }
    }

    // 5. NVM paths (Unix only) - check before platform paths for better Node.js integration
    if (isUnix()) {
      try {
        if (await existsAsync(paths.nvmVersionsDir)) {
          const nodeVersions = await fsPromises.readdir(paths.nvmVersionsDir, { withFileTypes: true });
          const versionNames = sortNvmVersionDirs(nodeVersions);

          for (const versionName of versionNames) {
            const nvmClaudePath = path.join(paths.nvmVersionsDir, versionName, 'bin', 'claude');
            if (await existsAsync(nvmClaudePath)) {
              const validation = await this.validateClaudeAsync(nvmClaudePath);
              const result = buildClaudeDetectionResult(nvmClaudePath, validation, 'nvm', 'Using NVM Claude CLI');
              if (result) return result;
            }
          }
        }
      } catch (error) {
        console.warn(`[Claude CLI] Unable to read NVM directory: ${error}`);
      }
    }

    // 6. Platform-specific standard locations
    for (const claudePath of paths.platformPaths) {
      if (await existsAsync(claudePath)) {
        const validation = await this.validateClaudeAsync(claudePath);
        const result = buildClaudeDetectionResult(claudePath, validation, 'system-path', 'Using Claude CLI');
        if (result) return result;
      }
    }

    // 7. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'Claude CLI not found. Install from https://claude.ai/download',
    };
  }

  /**
   * Detect Python asynchronously (non-blocking)
   *
   * Same detection logic as detectPython but uses async validation.
   *
   * @returns Promise resolving to detection result
   */
  private async detectPythonAsync(): Promise<ToolDetectionResult> {
    const MINIMUM_VERSION = '3.10.0';

    // 1. User configuration
    if (this.userConfig.pythonPath) {
      if (isWrongPlatformPath(this.userConfig.pythonPath)) {
        console.warn(
          `[Python] User-configured path is from different platform, ignoring: ${this.userConfig.pythonPath}`
        );
      } else {
        const validation = await this.validatePythonAsync(this.userConfig.pythonPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.pythonPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured Python: ${this.userConfig.pythonPath}`,
          };
        }
        console.warn(`[Python] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Bundled Python (packaged apps only)
    if (app.isPackaged) {
      const bundledPath = this.getBundledPythonPath();
      if (bundledPath) {
        const validation = await this.validatePythonAsync(bundledPath);
        if (validation.valid) {
          return {
            found: true,
            path: bundledPath,
            version: validation.version,
            source: 'bundled',
            message: `Using bundled Python: ${bundledPath}`,
          };
        }
      }
    }

    // 3. Homebrew Python (macOS) - simplified async version
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/python3',
        '/opt/homebrew/bin/python3.12',
        '/opt/homebrew/bin/python3.11',
        '/opt/homebrew/bin/python3.10',
        '/usr/local/bin/python3',
      ];
      for (const pythonPath of homebrewPaths) {
        if (await existsAsync(pythonPath)) {
          const validation = await this.validatePythonAsync(pythonPath);
          if (validation.valid) {
            return {
              found: true,
              path: pythonPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew Python: ${pythonPath}`,
            };
          }
        }
      }
    }

    // 4. System PATH (augmented)
    const candidates =
      isWindows()
        ? ['py -3', 'python', 'python3', 'py']
        : ['python3', 'python'];

    for (const cmd of candidates) {
      if (cmd.startsWith('py ')) {
        const validation = await this.validatePythonAsync(cmd);
        if (validation.valid) {
          return {
            found: true,
            path: cmd,
            version: validation.version,
            source: 'system-path',
            message: `Using system Python: ${cmd}`,
          };
        }
      } else {
        const pythonPath = await findExecutableAsync(cmd);
        if (pythonPath) {
          const validation = await this.validatePythonAsync(pythonPath);
          if (validation.valid) {
            return {
              found: true,
              path: pythonPath,
              version: validation.version,
              source: 'system-path',
              message: `Using system Python: ${pythonPath}`,
            };
          }
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message:
        `Python ${MINIMUM_VERSION}+ not found. ` +
        'Please install Python or configure in Settings.',
    };
  }

  /**
   * Detect Git asynchronously (non-blocking)
   *
   * Same detection logic as detectGit but uses async validation.
   *
   * @returns Promise resolving to detection result
   */
  private async detectGitAsync(): Promise<ToolDetectionResult> {
    // 1. User configuration
    if (this.userConfig.gitPath) {
      if (isWrongPlatformPath(this.userConfig.gitPath)) {
        console.warn(
          `[Git] User-configured path is from different platform, ignoring: ${this.userConfig.gitPath}`
        );
      } else {
        const validation = await this.validateGitAsync(this.userConfig.gitPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.gitPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured Git: ${this.userConfig.gitPath}`,
          };
        }
        console.warn(`[Git] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/git',
        '/usr/local/bin/git',
      ];

      for (const gitPath of homebrewPaths) {
        if (await existsAsync(gitPath)) {
          const validation = await this.validateGitAsync(gitPath);
          if (validation.valid) {
            return {
              found: true,
              path: gitPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew Git: ${gitPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const gitPath = await findExecutableAsync('git');
    if (gitPath) {
      const validation = await this.validateGitAsync(gitPath);
      if (validation.valid) {
        return {
          found: true,
          path: gitPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system Git: ${gitPath}`,
        };
      }
    }

    // 4. Windows-specific detection (async to avoid blocking main process)
    if (isWindows()) {
      const whereGitPath = await findWindowsExecutableViaWhereAsync('git', '[Git]');
      if (whereGitPath) {
        const validation = await this.validateGitAsync(whereGitPath);
        if (validation.valid) {
          return {
            found: true,
            path: whereGitPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows Git: ${whereGitPath}`,
          };
        }
      }

      const windowsPaths = await getWindowsExecutablePathsAsync(WINDOWS_GIT_PATHS, '[Git]');
      for (const winGitPath of windowsPaths) {
        const validation = await this.validateGitAsync(winGitPath);
        if (validation.valid) {
          return {
            found: true,
            path: winGitPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows Git: ${winGitPath}`,
          };
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'Git not found in standard locations. Using fallback "git".',
    };
  }

  /**
   * Detect GitHub CLI asynchronously (non-blocking)
   *
   * Same detection logic as detectGitHubCLI but uses async validation.
   *
   * @returns Promise resolving to detection result
   */
  private async detectGitHubCLIAsync(): Promise<ToolDetectionResult> {
    // 1. User configuration
    if (this.userConfig.githubCLIPath) {
      if (isWrongPlatformPath(this.userConfig.githubCLIPath)) {
        console.warn(
          `[GitHub CLI] User-configured path is from different platform, ignoring: ${this.userConfig.githubCLIPath}`
        );
      } else {
        const validation = await this.validateGitHubCLIAsync(this.userConfig.githubCLIPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.githubCLIPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured GitHub CLI: ${this.userConfig.githubCLIPath}`,
          };
        }
        console.warn(`[GitHub CLI] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/gh',
        '/usr/local/bin/gh',
      ];

      for (const ghPath of homebrewPaths) {
        if (await existsAsync(ghPath)) {
          const validation = await this.validateGitHubCLIAsync(ghPath);
          if (validation.valid) {
            return {
              found: true,
              path: ghPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew GitHub CLI: ${ghPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const ghPath = await findExecutableAsync('gh');
    if (ghPath) {
      const validation = await this.validateGitHubCLIAsync(ghPath);
      if (validation.valid) {
        return {
          found: true,
          path: ghPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system GitHub CLI: ${ghPath}`,
        };
      }
    }

    // 4. Windows Program Files
    if (isWindows()) {
      const windowsPaths = [
        'C:\\Program Files\\GitHub CLI\\gh.exe',
        'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
      ];

      for (const winGhPath of windowsPaths) {
        if (await existsAsync(winGhPath)) {
          const validation = await this.validateGitHubCLIAsync(winGhPath);
          if (validation.valid) {
            return {
              found: true,
              path: winGhPath,
              version: validation.version,
              source: 'system-path',
              message: `Using Windows GitHub CLI: ${winGhPath}`,
            };
          }
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'GitHub CLI (gh) not found. Install from https://cli.github.com',
    };
  }

  /**
   * Detect GitLab CLI asynchronously (non-blocking)
   *
   * Same detection logic as detectGitLabCLI but uses async validation.
   *
   * @returns Promise resolving to detection result
   */
  private async detectGitLabCLIAsync(): Promise<ToolDetectionResult> {
    // 1. User configuration
    if (this.userConfig.gitlabCLIPath) {
      if (isWrongPlatformPath(this.userConfig.gitlabCLIPath)) {
        console.warn(
          `[GitLab CLI] User-configured path is from different platform, ignoring: ${this.userConfig.gitlabCLIPath}`
        );
      } else {
        const validation = await this.validateGitLabCLIAsync(this.userConfig.gitlabCLIPath);
        if (validation.valid) {
          return {
            found: true,
            path: this.userConfig.gitlabCLIPath,
            version: validation.version,
            source: 'user-config',
            message: `Using user-configured GitLab CLI: ${this.userConfig.gitlabCLIPath}`,
          };
        }
        console.warn(`[GitLab CLI] User-configured path invalid: ${validation.message}`);
      }
    }

    // 2. Homebrew (macOS)
    if (isMacOS()) {
      const homebrewPaths = [
        '/opt/homebrew/bin/glab',
        '/usr/local/bin/glab',
      ];

      for (const glabPath of homebrewPaths) {
        if (await existsAsync(glabPath)) {
          const validation = await this.validateGitLabCLIAsync(glabPath);
          if (validation.valid) {
            return {
              found: true,
              path: glabPath,
              version: validation.version,
              source: 'homebrew',
              message: `Using Homebrew GitLab CLI: ${glabPath}`,
            };
          }
        }
      }
    }

    // 3. System PATH (augmented)
    const glabPath = await findExecutableAsync('glab');
    if (glabPath) {
      const validation = await this.validateGitLabCLIAsync(glabPath);
      if (validation.valid) {
        return {
          found: true,
          path: glabPath,
          version: validation.version,
          source: 'system-path',
          message: `Using system GitLab CLI: ${glabPath}`,
        };
      }
    }

    // 4. Windows Program Files
    if (isWindows()) {
      const windowsPaths = await getWindowsExecutablePathsAsync(WINDOWS_GLAB_PATHS, '[GitLab CLI]');
      for (const winGlabPath of windowsPaths) {
        const validation = await this.validateGitLabCLIAsync(winGlabPath);
        if (validation.valid) {
          return {
            found: true,
            path: winGlabPath,
            version: validation.version,
            source: 'system-path',
            message: `Using Windows GitLab CLI: ${winGlabPath}`,
          };
        }
      }
    }

    // 5. Not found
    return {
      found: false,
      source: 'fallback',
      message: 'GitLab CLI (glab) not found. Install from https://gitlab.com/gitlab-org/cli',
    };
  }

  /**
   * Get bundled Python path for packaged apps
   *
   * Only available in packaged Electron apps where Python is bundled
   * in the resources directory.
   *
   * @returns Path to bundled Python or null if not found
   */
  private getBundledPythonPath(): string | null {
    if (!app.isPackaged) {
      return null;
    }

    const resourcesPath = process.resourcesPath;
    const pythonPath = isWindows()
      ? path.join(resourcesPath, 'python', 'python.exe')
      : path.join(resourcesPath, 'python', 'bin', 'python3');

    return existsSync(pythonPath) ? pythonPath : null;
  }

  /**
   * Find Homebrew Python on macOS
   * Delegates to shared utility function.
   *
   * @returns Path to Homebrew Python or null if not found
   */
  private findHomebrewPython(): string | null {
    return findHomebrewPythonUtil(
      (pythonPath) => this.validatePython(pythonPath),
      '[CLI Tools]'
    );
  }

  /**
   * Clear cache manually
   *
   * Useful for testing or forcing re-detection.
   * Normally not needed as cache is cleared automatically on settings change.
   */
  clearCache(): void {
    this.cache.clear();
    console.warn('[CLI Tools] Cache cleared');
  }

  /**
   * Get tool detection info for diagnostics
   *
   * Performs fresh detection without using cache.
   * Useful for Settings UI to show current detection status.
   *
   * @param tool - The tool to get detection info for
   * @returns Detection result with full metadata
   */
  getToolInfo(tool: CLITool): ToolDetectionResult {
    return this.detectToolPath(tool);
  }
}

// Singleton instance
const cliToolManager = new CLIToolManager();

/**
 * Get the path for a CLI tool
 *
 * Convenience function for accessing the tool manager singleton.
 * Uses cached path if available, otherwise auto-detects.
 *
 * @param tool - The CLI tool to get the path for
 * @returns The resolved path to the tool executable
 *
 * @example
 * ```typescript
 * import { getToolPath } from './cli-tool-manager';
 *
 * const pythonPath = getToolPath('python');
 * const gitPath = getToolPath('git');
 * const ghPath = getToolPath('gh');
 *
 * execSync(`${gitPath} status`, { cwd: projectPath });
 * ```
 */
export function getToolPath(tool: CLITool): string {
  return cliToolManager.getToolPath(tool);
}

/**
 * Get Claude CLI path for SDK usage
 *
 * Returns null when a .cmd file is detected on Windows, so the SDK
 * can use its bundled claude.exe instead. The SDK's bundled CLI is
 * a proper Windows executable that can be spawned by anyio.open_process().
 *
 * Use this function when passing a CLI path to the Claude Agent SDK.
 * For other uses (like spawning claude directly), use getToolPath('claude').
 *
 * @returns Claude CLI path, or null if SDK should use bundled CLI
 *
 * @example
 * ```typescript
 * import { getClaudeCliPathForSdk } from './cli-tool-manager';
 *
 * const cliPath = getClaudeCliPathForSdk();
 * // Pass to Python backend which uses Claude Agent SDK
 * // If null, SDK will use its bundled claude.exe
 * ```
 */
export function getClaudeCliPathForSdk(): string | null {
  return cliToolManager.getClaudeCliPathForSdk();
}

/**
 * Configure CLI tools with user settings
 *
 * Call this when user updates CLI tool paths in Settings.
 * Clears cache to force re-detection with new configuration.
 *
 * @param config - User configuration for CLI tool paths
 *
 * @example
 * ```typescript
 * import { configureTools } from './cli-tool-manager';
 *
 * // When settings are loaded or updated
 * configureTools({
 *   pythonPath: settings.pythonPath,
 *   gitPath: settings.gitPath,
 *   githubCLIPath: settings.githubCLIPath,
 * });
 * ```
 */
export function configureTools(config: ToolConfig): void {
  cliToolManager.configure(config);
}

/**
 * Get tool detection info for diagnostics
 *
 * Performs fresh detection and returns full metadata.
 * Useful for Settings UI to show detection status and version.
 *
 * @param tool - The tool to get detection info for
 * @returns Detection result with path, version, and source
 *
 * @example
 * ```typescript
 * import { getToolInfo } from './cli-tool-manager';
 *
 * const pythonInfo = getToolInfo('python');
 * console.log(`Found: ${pythonInfo.found}`);
 * console.log(`Path: ${pythonInfo.path}`);
 * console.log(`Version: ${pythonInfo.version}`);
 * console.log(`Source: ${pythonInfo.source}`);
 * ```
 */
export function getToolInfo(tool: CLITool): ToolDetectionResult {
  return cliToolManager.getToolInfo(tool);
}

/**
 * Clear tool path cache manually
 *
 * Forces re-detection on next getToolPath() call.
 * Normally not needed as cache is cleared automatically on settings change.
 *
 * @example
 * ```typescript
 * import { clearToolCache } from './cli-tool-manager';
 *
 * // Force re-detection (e.g., after installing new tools)
 * clearToolCache();
 * ```
 */
export function clearToolCache(): void {
  cliToolManager.clearCache();
}

/**
 * Check if a path appears to be from a different platform.
 * Useful for detecting cross-platform path issues in settings.
 *
 * @param pathStr - The path to check
 * @returns true if the path is from a different platform
 *
 * @example
 * ```typescript
 * import { isPathFromWrongPlatform } from './cli-tool-manager';
 *
 * // On macOS, this returns true for Windows paths
 * isPathFromWrongPlatform('C:\\Program Files\\claude.exe'); // true
 * isPathFromWrongPlatform('/usr/local/bin/claude'); // false
 * ```
 */
export function isPathFromWrongPlatform(pathStr: string | undefined): boolean {
  return isWrongPlatformPath(pathStr);
}

// ============================================================================
// ASYNC EXPORTS - Non-blocking alternatives for Electron main process
// ============================================================================

/**
 * Get the path for a CLI tool asynchronously (non-blocking)
 *
 * Safe to call from Electron main process without blocking the event loop.
 * Uses cached path if available, otherwise detects asynchronously.
 *
 * @param tool - The CLI tool to get the path for
 * @returns Promise resolving to the tool path
 *
 * @example
 * ```typescript
 * import { getToolPathAsync } from './cli-tool-manager';
 *
 * const claudePath = await getToolPathAsync('claude');
 * ```
 */
export async function getToolPathAsync(tool: CLITool): Promise<string> {
  return cliToolManager.getToolPathAsync(tool);
}

/**
 * Get Claude CLI path for SDK usage asynchronously (non-blocking)
 *
 * Returns null when a .cmd file is detected on Windows, so the SDK
 * can use its bundled claude.exe instead.
 *
 * @returns Promise resolving to Claude CLI path, or null if SDK should use bundled CLI
 *
 * @example
 * ```typescript
 * import { getClaudeCliPathForSdkAsync } from './cli-tool-manager';
 *
 * const cliPath = await getClaudeCliPathForSdkAsync();
 * // Pass to Python backend which uses Claude Agent SDK
 * ```
 */
export async function getClaudeCliPathForSdkAsync(): Promise<string | null> {
  return cliToolManager.getClaudeCliPathForSdkAsync();
}

/**
 * Pre-warm the CLI tool cache asynchronously
 *
 * Call this during app startup to detect tools in the background.
 * Subsequent calls to getToolPath/getToolPathAsync will use cached values.
 *
 * @param tools - Array of tools to pre-warm (defaults to ['claude'])
 *
 * @example
 * ```typescript
 * import { preWarmToolCache } from './cli-tool-manager';
 *
 * // In app startup
 * app.whenReady().then(() => {
 *   // ... setup code ...
 *   preWarmToolCache(['claude', 'git', 'gh']);
 * });
 * ```
 */
export async function preWarmToolCache(tools: CLITool[] = ['claude']): Promise<void> {
  console.warn('[CLI Tools] Pre-warming cache for:', tools.join(', '));
  await Promise.all(tools.map(tool => cliToolManager.getToolPathAsync(tool)));
  console.warn('[CLI Tools] Cache pre-warming complete');
}
