/**
 * Claude Code CLI Handlers
 *
 * IPC handlers for Claude Code CLI version checking and installation.
 * Provides functionality to:
 * - Check installed vs latest version
 * - Open terminal with installation command
 */

import { ipcMain } from 'electron';
import { exec, execFileSync, spawn, execFile } from 'child_process';
import { existsSync, promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { IPC_CHANNELS, DEFAULT_APP_SETTINGS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { ClaudeCodeVersionInfo, ClaudeInstallationList, ClaudeInstallationInfo } from '../../shared/types/cli';
import { getToolInfo, configureTools, sortNvmVersionDirs, getClaudeDetectionPaths, type ExecFileAsyncOptionsWithVerbatim } from '../cli-tool-manager';
import { readSettingsFile, writeSettingsFile } from '../settings-utils';
import { isSecurePath } from '../utils/windows-paths';
import semver from 'semver';

const execFileAsync = promisify(execFile);

// Cache for latest version (avoid hammering registries)
let cachedLatestVersion: { version: string; timestamp: number } | null = null;
let cachedVersionList: { versions: string[]; timestamp: number } | null = null;
let cachedPyPILatest: { version: string; timestamp: number } | null = null;
let cachedPyPIVersionList: { versions: string[]; timestamp: number } | null = null;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const VERSION_LIST_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour for version list

/**
 * Validate a Claude CLI path and get its version
 * @param cliPath - Path to the Claude CLI executable
 * @returns Tuple of [isValid, version or null]
 */
async function validateClaudeCliAsync(cliPath: string): Promise<[boolean, string | null]> {
  try {
    const isWindows = process.platform === 'win32';

    // Security validation: reject paths with shell metacharacters or directory traversal
    if (isWindows && !isSecurePath(cliPath)) {
      throw new Error(`Claude CLI path failed security validation: ${cliPath}`);
    }

    // Augment PATH with the CLI directory for proper resolution
    const cliDir = path.dirname(cliPath);
    const env = {
      ...process.env,
      PATH: cliDir ? `${cliDir}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
    };

    let stdout: string;
    // For Windows .cmd/.bat files, use cmd.exe with proper quoting
    // /d = disable AutoRun registry commands
    // /s = strip first and last quotes, preserving inner quotes
    // /c = run command then terminate
    if (isWindows && /\.(cmd|bat)$/i.test(cliPath)) {
      // Get cmd.exe path from environment or use default
      const cmdExe = process.env.ComSpec
        || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      // Use double-quoted command line for paths with spaces
      const cmdLine = `""${cliPath}" --version"`;
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
      const result = await execFileAsync(cliPath, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env,
      });
      stdout = result.stdout;
    }

    const version = String(stdout).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    return [true, match ? match[1] : version.split('\n')[0]];
  } catch (error) {
    // Log validation errors to help debug CLI detection issues
    console.warn('[Claude Code] CLI validation failed for', cliPath, ':', error);
    return [false, null];
  }
}

/**
 * Scan all known locations for Claude CLI installations.
 * Returns all found installations with their paths, versions, and sources.
 *
 * Uses getClaudeDetectionPaths() from cli-tool-manager.ts as the single source
 * of truth for detection paths to avoid duplication and ensure consistency.
 *
 * @see cli-tool-manager.ts getClaudeDetectionPaths() for path configuration
 */
async function scanClaudeInstallations(activePath: string | null): Promise<ClaudeInstallationInfo[]> {
  const installations: ClaudeInstallationInfo[] = [];
  const seenPaths = new Set<string>();
  const homeDir = os.homedir();
  const isWindows = process.platform === 'win32';

  // Get detection paths from cli-tool-manager (single source of truth)
  const detectionPaths = getClaudeDetectionPaths(homeDir);

  const addInstallation = async (
    cliPath: string,
    source: ClaudeInstallationInfo['source']
  ) => {
    // Normalize path for comparison
    const normalizedPath = path.resolve(cliPath);
    if (seenPaths.has(normalizedPath)) return;

    if (!existsSync(cliPath)) return;

    // Security validation: reject paths with shell metacharacters or directory traversal
    if (!isSecurePath(cliPath)) {
      console.warn('[Claude Code] Rejecting insecure path:', cliPath);
      return;
    }

    const [isValid, version] = await validateClaudeCliAsync(cliPath);
    if (!isValid) return;

    seenPaths.add(normalizedPath);
    installations.push({
      path: normalizedPath,
      version,
      source,
      isActive: activePath ? path.resolve(activePath) === normalizedPath : false,
    });
  };

  // 1. Check user-configured path first (if set)
  if (activePath && existsSync(activePath)) {
    await addInstallation(activePath, 'user-config');
  }

  // 2. Check system PATH via which/where
  try {
    if (isWindows) {
      const result = await execFileAsync('where', ['claude'], { timeout: 5000 });
      const paths = result.stdout.trim().split('\n').filter(p => p.trim());
      for (const p of paths) {
        await addInstallation(p.trim(), 'system-path');
      }
    } else {
      const result = await execFileAsync('which', ['-a', 'claude'], { timeout: 5000 });
      const paths = result.stdout.trim().split('\n').filter(p => p.trim());
      for (const p of paths) {
        await addInstallation(p.trim(), 'system-path');
      }
    }
  } catch {
    // which/where failed, continue with other methods
  }

  // 3. Homebrew paths (macOS) - from getClaudeDetectionPaths
  if (process.platform === 'darwin') {
    for (const p of detectionPaths.homebrewPaths) {
      await addInstallation(p, 'homebrew');
    }
  }

  // 4. NVM paths (Unix) - check Node.js version manager
  if (!isWindows && existsSync(detectionPaths.nvmVersionsDir)) {
    try {
      const entries = await fsPromises.readdir(detectionPaths.nvmVersionsDir, { withFileTypes: true });
      const versionDirs = sortNvmVersionDirs(entries);
      for (const versionName of versionDirs) {
        const nvmClaudePath = path.join(detectionPaths.nvmVersionsDir, versionName, 'bin', 'claude');
        await addInstallation(nvmClaudePath, 'nvm');
      }
    } catch {
      // Failed to read NVM directory
    }
  }

  // 5. Platform-specific standard locations - from getClaudeDetectionPaths
  for (const p of detectionPaths.platformPaths) {
    await addInstallation(p, 'system-path');
  }

  // 6. Additional common paths not in getClaudeDetectionPaths (for broader scanning)
  const additionalPaths = isWindows
    ? [] // Windows paths are well covered by detectionPaths.platformPaths
    : [
        path.join(homeDir, '.npm-global', 'bin', 'claude'),
        path.join(homeDir, '.yarn', 'bin', 'claude'),
        path.join(homeDir, '.claude', 'local', 'claude'),
        path.join(homeDir, 'node_modules', '.bin', 'claude'),
      ];

  for (const p of additionalPaths) {
    await addInstallation(p, 'system-path');
  }

  // Mark the first installation as active if none is explicitly active
  if (installations.length > 0 && !installations.some(i => i.isActive)) {
    installations[0].isActive = true;
  }

  return installations;
}

/**
 * Fetch the latest version of Claude Code from npm registry
 */
async function fetchLatestVersion(): Promise<string> {
  // Check cache first
  if (cachedLatestVersion && Date.now() - cachedLatestVersion.timestamp < CACHE_DURATION_MS) {
    return cachedLatestVersion.version;
  }

  try {
    const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const version = data.version;

    if (!version || typeof version !== 'string') {
      throw new Error('Invalid version format from npm registry');
    }

    // Cache the result
    cachedLatestVersion = { version, timestamp: Date.now() };
    return version;
  } catch (error) {
    console.error('[Claude Code] Failed to fetch latest version:', error);
    // Return cached version if available, even if expired
    if (cachedLatestVersion) {
      return cachedLatestVersion.version;
    }
    throw error;
  }
}

/**
 * Fetch available versions of Claude Code from npm registry
 * Returns versions sorted by semver descending (newest first)
 * Limited to last 20 versions for performance
 */
async function fetchAvailableVersions(): Promise<string[]> {
  // Check cache first
  if (cachedVersionList && Date.now() - cachedVersionList.timestamp < VERSION_LIST_CACHE_DURATION_MS) {
    return cachedVersionList.versions;
  }

  try {
    const response = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code', {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const versions = Object.keys(data.versions || {});

    if (!versions.length) {
      throw new Error('No versions found in npm registry');
    }

    // Sort by semver descending (newest first) and take last 20
    const sortedVersions = versions
      .filter(v => semver.valid(v)) // Only valid semver versions
      .sort((a, b) => semver.rcompare(a, b)) // Sort descending
      .slice(0, 20); // Limit to 20 versions

    // Validate we have versions after filtering
    if (sortedVersions.length === 0) {
      throw new Error('No valid semver versions found in npm registry');
    }

    // Cache the result
    cachedVersionList = { versions: sortedVersions, timestamp: Date.now() };
    return sortedVersions;
  } catch (error) {
    console.error('[Claude Code] Failed to fetch available versions:', error);
    // Return cached versions if available, even if expired
    if (cachedVersionList) {
      return cachedVersionList.versions;
    }
    throw error;
  }
}

/**
 * Check if we're in SDK mode (autoBuildPath is set, meaning we use the bundled CLI from pip)
 */
function isSDKMode(): boolean {
  const settings = readSettingsFile();
  return !!(settings?.autoBuildPath);
}

/**
 * Get the PyPI platform tag for the current OS.
 * Used to filter releases that have a compatible wheel.
 */
function getPyPIPlatformTag(): string {
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'macosx';
    default: return 'linux';
  }
}

/**
 * Check if a PyPI release has a wheel compatible with the current platform.
 * Looks at filenames for platform-specific wheels or universal (py3-none-any) wheels.
 */
function hasCompatibleWheel(files: Array<{ filename?: string }>, platformTag: string): boolean {
  if (!files || files.length === 0) return false;
  return files.some(f => {
    const name = f.filename || '';
    if (!name.endsWith('.whl')) return false;
    // Universal wheel (works everywhere)
    if (name.includes('-none-any.whl')) return true;
    // Platform-specific wheel
    return name.toLowerCase().includes(platformTag);
  });
}

/**
 * Fetch PyPI release data (shared between latest and list fetchers).
 * Returns releases object filtered to valid semver versions with compatible wheels.
 */
let cachedPyPIData: { releases: Record<string, Array<{ filename?: string }>>; timestamp: number } | null = null;

async function fetchPyPIReleases(): Promise<Record<string, Array<{ filename?: string }>>> {
  if (cachedPyPIData && Date.now() - cachedPyPIData.timestamp < VERSION_LIST_CACHE_DURATION_MS) {
    return cachedPyPIData.releases;
  }

  const response = await fetch('https://pypi.org/pypi/claude-agent-sdk/json', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const releases = data.releases || {};
  cachedPyPIData = { releases, timestamp: Date.now() };
  return releases;
}

/**
 * Fetch the latest version of claude-agent-sdk from PyPI
 * that has a compatible wheel for the current platform.
 */
async function fetchLatestPyPIVersion(): Promise<string> {
  if (cachedPyPILatest && Date.now() - cachedPyPILatest.timestamp < CACHE_DURATION_MS) {
    return cachedPyPILatest.version;
  }

  try {
    const releases = await fetchPyPIReleases();
    const platformTag = getPyPIPlatformTag();

    // Find the newest version that has a compatible wheel
    const compatibleVersions = Object.keys(releases)
      .filter(v => semver.valid(v) && hasCompatibleWheel(releases[v], platformTag))
      .sort((a, b) => semver.rcompare(a, b));

    if (compatibleVersions.length === 0) {
      throw new Error(`No compatible PyPI versions found for platform: ${process.platform}`);
    }

    const version = compatibleVersions[0];
    cachedPyPILatest = { version, timestamp: Date.now() };
    console.log(`[Claude Code] Latest PyPI version for ${process.platform}: ${version}`);
    return version;
  } catch (error) {
    console.error('[Claude Code] Failed to fetch latest PyPI version:', error);
    if (cachedPyPILatest) return cachedPyPILatest.version;
    throw error;
  }
}

/**
 * Fetch available versions of claude-agent-sdk from PyPI
 * that have compatible wheels for the current platform.
 */
async function fetchAvailablePyPIVersions(): Promise<string[]> {
  if (cachedPyPIVersionList && Date.now() - cachedPyPIVersionList.timestamp < VERSION_LIST_CACHE_DURATION_MS) {
    return cachedPyPIVersionList.versions;
  }

  try {
    const releases = await fetchPyPIReleases();
    const platformTag = getPyPIPlatformTag();

    const sortedVersions = Object.keys(releases)
      .filter(v => semver.valid(v) && hasCompatibleWheel(releases[v], platformTag))
      .sort((a, b) => semver.rcompare(a, b))
      .slice(0, 20);

    if (sortedVersions.length === 0) {
      throw new Error(`No compatible PyPI versions found for platform: ${process.platform}`);
    }

    cachedPyPIVersionList = { versions: sortedVersions, timestamp: Date.now() };
    return sortedVersions;
  } catch (error) {
    console.error('[Claude Code] Failed to fetch PyPI versions:', error);
    if (cachedPyPIVersionList) return cachedPyPIVersionList.versions;
    throw error;
  }
}

/**
 * Get the platform-specific install command for a specific version of Claude Code
 * @param version - The version to install (e.g., "1.0.5")
 */
function getInstallVersionCommand(version: string): string {
  if (process.platform === 'win32') {
    // Windows: kill running Claude processes first, then install specific version
    return `taskkill /IM claude.exe /F 2>nul; claude install --force ${version}`;
  } else {
    // macOS/Linux: kill running Claude processes first, then install specific version
    return `pkill -x claude 2>/dev/null; sleep 1; claude install --force ${version}`;
  }
}

/**
 * Get the platform-specific install command for Claude Code
 * @param isUpdate - If true, Claude is already installed and we just need to update
 */
function getInstallCommand(isUpdate: boolean): string {
  if (process.platform === 'win32') {
    if (isUpdate) {
      // Update: kill running Claude processes first, then update with --force
      return 'taskkill /IM claude.exe /F 2>nul; claude install --force latest';
    }
    return 'irm https://claude.ai/install.ps1 | iex';
  } else {
    if (isUpdate) {
      // Update: kill running Claude processes first, then update with --force
      // pkill sends SIGTERM to gracefully stop Claude processes
      return 'pkill -x claude 2>/dev/null; sleep 1; claude install --force latest';
    }
    // Fresh install: use the full install script
    return 'curl -fsSL https://claude.ai/install.sh | bash -s -- latest';
  }
}

/**
 * Escape single quotes in a string for use in AppleScript
 */
export function escapeAppleScriptString(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Escape a string for safe use in PowerShell -Command context.
 * PowerShell requires escaping backticks, double quotes, dollar signs,
 * parentheses, semicolons, and ampersands.
 */
export function escapePowerShellCommand(str: string): string {
  return str
    .replace(/`/g, '``')      // Escape backticks (PowerShell escape char)
    .replace(/"/g, '`"')      // Escape double quotes
    .replace(/\$/g, '`$')     // Escape dollar signs (variable expansion)
    .replace(/\(/g, '`(')     // Escape opening parentheses
    .replace(/\)/g, '`)')     // Escape closing parentheses
    .replace(/;/g, '`;')      // Escape semicolons (statement separator)
    .replace(/&/g, '`&')      // Escape ampersands (call operator)
    .replace(/\r/g, '`r')     // Escape carriage returns
    .replace(/\n/g, '`n');    // Escape newlines
}

/**
 * Escape a string for safe use in Git Bash -c context.
 * Bash requires escaping single quotes, double quotes, backslashes, and other metacharacters.
 */
export function escapeGitBashCommand(str: string): string {
  // For bash -c with double quotes, escape: backslash, double quote, dollar, backtick,
  // semicolon, pipe, and exclamation mark (all bash metacharacters that could allow command injection)
  return str
    .replace(/\\/g, '\\\\')   // Escape backslashes first
    .replace(/"/g, '\\"')     // Escape double quotes
    .replace(/\$/g, '\\$')    // Escape dollar signs
    .replace(/`/g, '\\`')     // Escape backticks
    .replace(/;/g, '\\;')     // Escape semicolons (command separator)
    .replace(/\|/g, '\\|')    // Escape pipes (command piping)
    .replace(/!/g, '\\!');    // Escape exclamation marks (history expansion)
}

/**
 * Open a terminal with the given command
 * Uses the user's preferred terminal from settings
 * Supports macOS, Windows, and Linux terminals
 */
export async function openTerminalWithCommand(command: string): Promise<void> {
  const platform = process.platform;
  const settings = readSettingsFile();
  const preferredTerminal = settings?.preferredTerminal as string | undefined;

  console.log('[Claude Code] Platform:', platform);
  console.log('[Claude Code] Preferred terminal:', preferredTerminal);

  if (platform === 'darwin') {
    // macOS: Use AppleScript to open terminal with command
    const escapedCommand = escapeAppleScriptString(command);
    let script: string;

    // Map SupportedTerminal values to terminal handling
    // Values come from settings.preferredTerminal (SupportedTerminal type)
    const terminalId = preferredTerminal?.toLowerCase() || 'terminal';

    console.log('[Claude Code] Using terminal:', terminalId);

    if (terminalId === 'iterm2') {
      // iTerm2
      script = `
        tell application "iTerm"
          activate
          create window with default profile
          tell current session of current window
            write text "${escapedCommand}"
          end tell
        end tell
      `;
    } else if (terminalId === 'warp') {
      // Warp - open and send command
      script = `
        tell application "Warp"
          activate
        end tell
        delay 0.5
        tell application "System Events"
          keystroke "${escapedCommand}"
          keystroke return
        end tell
      `;
    } else if (terminalId === 'kitty') {
      // Kitty - use command line
      spawn('kitty', ['--', 'bash', '-c', command], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'alacritty') {
      // Alacritty - use command line
      spawn('open', ['-a', 'Alacritty', '--args', '-e', 'bash', '-c', command], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'wezterm') {
      // WezTerm - use command line
      spawn('wezterm', ['start', '--', 'bash', '-c', command], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'ghostty') {
      // Ghostty
      script = `
        tell application "Ghostty"
          activate
        end tell
        delay 0.3
        tell application "System Events"
          keystroke "${escapedCommand}"
          keystroke return
        end tell
      `;
    } else if (terminalId === 'hyper') {
      // Hyper
      script = `
        tell application "Hyper"
          activate
        end tell
        delay 0.3
        tell application "System Events"
          keystroke "${escapedCommand}"
          keystroke return
        end tell
      `;
    } else if (terminalId === 'tabby') {
      // Tabby (formerly Terminus)
      script = `
        tell application "Tabby"
          activate
        end tell
        delay 0.3
        tell application "System Events"
          keystroke "${escapedCommand}"
          keystroke return
        end tell
      `;
    } else {
      // Default: Terminal.app (handles 'terminal', 'system', or any unknown value)
      // IMPORTANT: do script FIRST, then activate - this prevents opening a blank default window
      // when Terminal.app isn't already running
      script = `
        tell application "Terminal"
          do script "${escapedCommand}"
          activate
        end tell
      `;
    }

    console.log('[Claude Code] Running AppleScript...');
    execFileSync('osascript', ['-e', script], { stdio: 'pipe' });

  } else if (platform === 'win32') {
    // Windows: Use appropriate terminal
    // Values match SupportedTerminal type: 'windowsterminal', 'powershell', 'cmd', 'conemu', 'cmder',
    // 'gitbash', 'alacritty', 'wezterm', 'hyper', 'tabby', 'cygwin', 'msys2'
    const terminalId = preferredTerminal?.toLowerCase() || 'powershell';

    console.log('[Claude Code] Using terminal:', terminalId);
    console.log('[Claude Code] Command to run:', command);

    // For Windows, use exec with a properly formed command string
    // This is more reliable than spawn for complex PowerShell commands with pipes
    const runWindowsCommand = (cmdString: string): Promise<void> => {
      return new Promise((resolve) => {
        console.log(`[Claude Code] Executing: ${cmdString}`);
        // Fire and forget - don't wait for the terminal to close
        // The -NoExit flag keeps the terminal open, so we can't wait for exec to complete
        const child = exec(cmdString, { windowsHide: false });

        // Detach from the child process so we don't wait for it
        child.unref?.();

        // Resolve immediately after starting the process
        // Give it a brief moment to ensure the window opens
        setTimeout(() => resolve(), 300);
      });
    };

    try {
      // Escape command for PowerShell context to prevent command injection
      const escapedCommand = escapePowerShellCommand(command);

      if (terminalId === 'windowsterminal') {
        // Windows Terminal - open new tab with PowerShell
        await runWindowsCommand(`wt new-tab powershell -NoExit -Command "${escapedCommand}"`);
      } else if (terminalId === 'gitbash') {
        // Git Bash - use the passed command (escaped for bash context)
        const escapedBashCommand = escapeGitBashCommand(command);
        const gitBashPaths = [
          'C:\\Program Files\\Git\\git-bash.exe',
          'C:\\Program Files (x86)\\Git\\git-bash.exe',
        ];
        const gitBashPath = gitBashPaths.find(p => existsSync(p));
        if (gitBashPath) {
          await runWindowsCommand(`"${gitBashPath}" -c "${escapedBashCommand}"`);
        } else {
          throw new Error('Git Bash not found');
        }
      } else if (terminalId === 'alacritty') {
        // Alacritty
        await runWindowsCommand(`start alacritty -e powershell -NoExit -Command "${escapedCommand}"`);
      } else if (terminalId === 'wezterm') {
        // WezTerm
        await runWindowsCommand(`start wezterm start -- powershell -NoExit -Command "${escapedCommand}"`);
      } else if (terminalId === 'cmd') {
        // Command Prompt - use cmd /k to run command and keep window open
        // Note: cmd.exe uses its own escaping rules, so we pass the raw command
        // and let cmd handle it. The command is typically PowerShell-formatted
        // for install scripts, so we run PowerShell from cmd.
        await runWindowsCommand(`start cmd /k "powershell -NoExit -Command ${escapedCommand}"`);
      } else if (terminalId === 'conemu') {
        // ConEmu - open with PowerShell tab running the command
        const conemuPaths = [
          'C:\\Program Files\\ConEmu\\ConEmu64.exe',
          'C:\\Program Files (x86)\\ConEmu\\ConEmu.exe',
        ];
        const conemuPath = conemuPaths.find(p => existsSync(p));
        if (conemuPath) {
          // ConEmu uses -run to specify the command to execute
          await runWindowsCommand(`start "" "${conemuPath}" -run "powershell -NoExit -Command ${escapedCommand}"`);
        } else {
          // Fall back to PowerShell if ConEmu not found
          console.warn('[Claude Code] ConEmu not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else if (terminalId === 'cmder') {
        // Cmder - portable console emulator for Windows
        const cmderPaths = [
          'C:\\cmder\\Cmder.exe',
          'C:\\tools\\cmder\\Cmder.exe',
          path.join(process.env.CMDER_ROOT || '', 'Cmder.exe'),
        ].filter(p => p); // Remove empty paths
        const cmderPath = cmderPaths.find(p => existsSync(p));
        if (cmderPath) {
          // Cmder uses /TASK for predefined tasks or /START for directory, but we can use /C for command
          await runWindowsCommand(`start "" "${cmderPath}" /SINGLE /START "" /TASK "powershell -NoExit -Command ${escapedCommand}"`);
        } else {
          // Fall back to PowerShell if Cmder not found
          console.warn('[Claude Code] Cmder not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else if (terminalId === 'hyper') {
        // Hyper - Electron-based terminal
        const hyperPaths = [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Hyper', 'Hyper.exe'),
          path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Hyper', 'Hyper.exe'),
        ];
        const hyperPath = hyperPaths.find(p => existsSync(p));
        if (hyperPath) {
          // Launch Hyper and it will pick up the shell; send command via PowerShell since Hyper
          // doesn't have a built-in way to run commands on startup
          await runWindowsCommand(`start "" "${hyperPath}"`);
          console.log('[Claude Code] Hyper opened - command must be pasted manually');
        } else {
          console.warn('[Claude Code] Hyper not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else if (terminalId === 'tabby') {
        // Tabby (formerly Terminus) - modern terminal for Windows
        const tabbyPaths = [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tabby', 'Tabby.exe'),
          path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Tabby', 'Tabby.exe'),
        ];
        const tabbyPath = tabbyPaths.find(p => existsSync(p));
        if (tabbyPath) {
          // Tabby opens with default shell; similar to Hyper, no command line arg for running commands
          await runWindowsCommand(`start "" "${tabbyPath}"`);
          console.log('[Claude Code] Tabby opened - command must be pasted manually');
        } else {
          console.warn('[Claude Code] Tabby not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else if (terminalId === 'cygwin') {
        // Cygwin terminal
        const cygwinPaths = [
          'C:\\cygwin64\\bin\\mintty.exe',
          'C:\\cygwin\\bin\\mintty.exe',
        ];
        const cygwinPath = cygwinPaths.find(p => existsSync(p));
        if (cygwinPath) {
          // mintty with bash, escaping for bash context
          const escapedBashCommand = escapeGitBashCommand(command);
          await runWindowsCommand(`"${cygwinPath}" -e /bin/bash -lc "${escapedBashCommand}"`);
        } else {
          console.warn('[Claude Code] Cygwin not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else if (terminalId === 'msys2') {
        // MSYS2 terminal
        const msys2Paths = [
          'C:\\msys64\\msys2_shell.cmd',
          'C:\\msys64\\mingw64.exe',
          'C:\\msys64\\usr\\bin\\mintty.exe',
        ];
        const msys2Path = msys2Paths.find(p => existsSync(p));
        if (msys2Path) {
          const escapedBashCommand = escapeGitBashCommand(command);
          if (msys2Path.endsWith('.cmd')) {
            // Use the shell launcher script
            await runWindowsCommand(`"${msys2Path}" -mingw64 -c "${escapedBashCommand}"`);
          } else {
            // Use mintty directly
            await runWindowsCommand(`"${msys2Path}" -e /bin/bash -lc "${escapedBashCommand}"`);
          }
        } else {
          console.warn('[Claude Code] MSYS2 not found, falling back to PowerShell');
          await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
        }
      } else {
        // Default: PowerShell (handles 'powershell', 'system', or any unknown value)
        // Use 'start' command to open a new PowerShell window
        // The command is wrapped in double quotes and passed via -Command
        await runWindowsCommand(`start powershell -NoExit -Command "${escapedCommand}"`);
      }
    } catch (err) {
      console.error('[Claude Code] Terminal execution failed:', err);
      throw new Error(`Failed to open terminal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else {
    // Linux: Use preferred terminal or try common emulators
    // Values match SupportedTerminal type: 'gnometerminal', 'konsole', 'xfce4terminal', 'tilix', etc.
    const terminalId = preferredTerminal?.toLowerCase() || '';

    console.log('[Claude Code] Using terminal:', terminalId || 'auto-detect');

    // Command to run (keep terminal open after execution)
    const bashCommand = `${command}; exec bash`;

    // Try to use preferred terminal if specified
    if (terminalId === 'gnometerminal') {
      spawn('gnome-terminal', ['--', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'konsole') {
      spawn('konsole', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'xfce4terminal') {
      spawn('xfce4-terminal', ['-e', `bash -c "${bashCommand}"`], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'lxterminal') {
      spawn('lxterminal', ['-e', `bash -c "${bashCommand}"`], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'mate-terminal') {
      spawn('mate-terminal', ['-e', `bash -c "${bashCommand}"`], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'tilix') {
      spawn('tilix', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'terminator') {
      spawn('terminator', ['-e', `bash -c "${bashCommand}"`], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'guake') {
      spawn('guake', ['-e', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'yakuake') {
      spawn('yakuake', ['-e', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'kitty') {
      spawn('kitty', ['--', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'alacritty') {
      spawn('alacritty', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'wezterm') {
      spawn('wezterm', ['start', '--', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'hyper') {
      spawn('hyper', [], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'tabby') {
      spawn('tabby', [], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'xterm') {
      spawn('xterm', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'urxvt') {
      spawn('urxvt', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'st') {
      spawn('st', ['-e', 'bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    } else if (terminalId === 'foot') {
      spawn('foot', ['bash', '-c', bashCommand], { detached: true, stdio: 'ignore' }).unref();
      return;
    }

    // Auto-detect (for 'system' or no preference): try common terminal emulators in order
    const terminals: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', bashCommand] },
      { cmd: 'konsole', args: ['-e', 'bash', '-c', bashCommand] },
      { cmd: 'xfce4-terminal', args: ['-e', `bash -c "${bashCommand}"`] },
      { cmd: 'tilix', args: ['-e', 'bash', '-c', bashCommand] },
      { cmd: 'terminator', args: ['-e', `bash -c "${bashCommand}"`] },
      { cmd: 'kitty', args: ['--', 'bash', '-c', bashCommand] },
      { cmd: 'alacritty', args: ['-e', 'bash', '-c', bashCommand] },
      { cmd: 'xterm', args: ['-e', 'bash', '-c', bashCommand] },
    ];

    let opened = false;
    for (const { cmd, args } of terminals) {
      try {
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        opened = true;
        console.log('[Claude Code] Opened terminal:', cmd);
        break;
      } catch {
      }
    }

    if (!opened) {
      throw new Error('No supported terminal emulator found');
    }
  }
}

/**
 * Register Claude Code IPC handlers
 */
export function registerClaudeCodeHandlers(): void {
  // Check Claude Code version
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_CHECK_VERSION,
    async (): Promise<IPCResult<ClaudeCodeVersionInfo>> => {
      try {
        console.log('[Claude Code] Checking version...');

        const sdkMode = isSDKMode();
        let installed: string | null = null;
        let detectionPath: string | null = null;
        let detectionResult;

        if (sdkMode) {
          // SDK mode: get version from the pip package, not the system CLI
          const settings = readSettingsFile();
          const autoBuildPath = settings?.autoBuildPath as string;
          const pythonExe = path.join(
            autoBuildPath, '.venv',
            process.platform === 'win32' ? 'Scripts' : 'bin',
            process.platform === 'win32' ? 'python.exe' : 'python'
          );

          if (existsSync(pythonExe)) {
            try {
              const result = await execFileAsync(pythonExe, [
                '-c', 'import claude_agent_sdk; print(claude_agent_sdk.__version__)'
              ], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
              installed = result.stdout.trim();
              // Find the bundled CLI path
              const bundledCli = path.join(
                autoBuildPath, '.venv', 'Lib', 'site-packages',
                'claude_agent_sdk', '_bundled',
                process.platform === 'win32' ? 'claude.exe' : 'claude'
              );
              detectionPath = existsSync(bundledCli) ? bundledCli : pythonExe;
              console.log('[Claude Code] SDK version:', installed, 'path:', detectionPath);
            } catch (err) {
              console.warn('[Claude Code] Failed to get SDK version:', err);
            }
          }

          // Build a synthetic detection result for the response
          detectionResult = {
            found: !!installed,
            version: installed || undefined,
            path: detectionPath || undefined,
            source: 'bundled' as const,
            message: installed ? `claude-agent-sdk ${installed} (bundled)` : 'SDK not found in venv',
          };
        } else {
          // System CLI mode: use cli-tool-manager
          try {
            detectionResult = getToolInfo('claude');
            console.log('[Claude Code] Detection result:', JSON.stringify(detectionResult, null, 2));
          } catch (detectionError) {
            console.error('[Claude Code] Detection error:', detectionError);
            throw new Error(`Detection failed: ${detectionError instanceof Error ? detectionError.message : 'Unknown error'}`);
          }
          installed = detectionResult.found ? detectionResult.version || null : null;
          detectionPath = detectionResult.path || null;
        }

        console.log('[Claude Code] Installed version:', installed);

        // Fetch latest version from PyPI (SDK mode) or npm (system CLI)
        let latest: string;
        try {
          const source = sdkMode ? 'PyPI' : 'npm';
          console.log(`[Claude Code] Fetching latest version from ${source}...`);
          latest = sdkMode ? await fetchLatestPyPIVersion() : await fetchLatestVersion();
          console.log('[Claude Code] Latest version:', latest);
        } catch (error) {
          console.warn('[Claude Code] Failed to fetch latest version, continuing with unknown:', error);
          return {
            success: true,
            data: {
              installed,
              latest: 'unknown',
              isOutdated: false,
              path: detectionPath || undefined,
              detectionResult,
            },
          };
        }

        // Compare versions
        let isOutdated = false;
        if (installed && latest !== 'unknown') {
          try {
            const cleanInstalled = installed.replace(/^v/, '');
            const cleanLatest = latest.replace(/^v/, '');
            isOutdated = semver.lt(cleanInstalled, cleanLatest);
          } catch {
            isOutdated = false;
          }
        }

        console.log('[Claude Code] Check complete:', { installed, latest, isOutdated });
        return {
          success: true,
          data: {
            installed,
            latest,
            isOutdated,
            path: detectionPath || undefined,
            detectionResult,
          },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Check failed:', errorMsg, error);
        return {
          success: false,
          error: `Failed to check Claude Code version: ${errorMsg}`,
        };
      }
    }
  );

  // Install Claude Code (pip upgrade for bundled SDK, or terminal for system CLI)
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_INSTALL,
    async (): Promise<IPCResult<{ command: string }>> => {
      try {
        // If autoBuildPath is set, update the SDK via pip (which bundles the CLI)
        const settings = readSettingsFile();
        const autoBuildPath = settings?.autoBuildPath as string | undefined;

        if (autoBuildPath) {
          const pythonExe = path.join(
            autoBuildPath, '.venv',
            process.platform === 'win32' ? 'Scripts' : 'bin',
            process.platform === 'win32' ? 'python.exe' : 'python'
          );

          if (existsSync(pythonExe)) {
            console.log('[Claude Code] Updating via pip in backend venv:', pythonExe);
            const command = 'python -m pip install --upgrade claude-agent-sdk';
            const result = await execFileAsync(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'claude-agent-sdk'], {
              encoding: 'utf-8',
              timeout: 120000,
              windowsHide: true,
            });
            console.log('[Claude Code] pip upgrade output:', result.stdout);
            return { success: true, data: { command } };
          }
        }

        // Fallback: open terminal for system CLI install/update
        let isUpdate = false;
        try {
          const detectionResult = getToolInfo('claude');
          isUpdate = detectionResult.found && !!detectionResult.version;
          console.log('[Claude Code] Is update:', isUpdate, 'detected version:', detectionResult.version);
        } catch {
          // Detection failed, assume fresh install
          isUpdate = false;
        }

        const command = getInstallCommand(isUpdate);
        console.log('[Claude Code] Install command:', command);
        console.log('[Claude Code] Opening terminal...');
        await openTerminalWithCommand(command);
        console.log('[Claude Code] Terminal opened successfully');

        return {
          success: true,
          data: { command },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Install failed:', errorMsg, error);
        return {
          success: false,
          error: `Failed to update Claude Code: ${errorMsg}`,
        };
      }
    }
  );

  // Get available Claude Code versions
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_GET_VERSIONS,
    async (): Promise<IPCResult<{ versions: string[] }>> => {
      try {
        const sdkMode = isSDKMode();
        const source = sdkMode ? 'PyPI' : 'npm';
        console.log(`[Claude Code] Fetching available versions from ${source}...`);
        const versions = sdkMode ? await fetchAvailablePyPIVersions() : await fetchAvailableVersions();
        console.log('[Claude Code] Found', versions.length, 'versions');
        return {
          success: true,
          data: { versions },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Failed to fetch versions:', errorMsg, error);
        return {
          success: false,
          error: `Failed to fetch available versions: ${errorMsg}`,
        };
      }
    }
  );

  // Install a specific version of Claude Code
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_INSTALL_VERSION,
    async (_event, version: string): Promise<IPCResult<{ command: string; version: string }>> => {
      try {
        // Validate version format
        if (!version || typeof version !== 'string') {
          throw new Error('Invalid version specified');
        }

        // Basic semver validation
        if (!semver.valid(version)) {
          throw new Error(`Invalid version format: ${version}`);
        }

        console.log('[Claude Code] Installing version:', version);

        // If autoBuildPath is set, install specific SDK version via pip
        const settings = readSettingsFile();
        const autoBuildPath = settings?.autoBuildPath as string | undefined;

        if (autoBuildPath) {
          const pythonExe = path.join(
            autoBuildPath, '.venv',
            process.platform === 'win32' ? 'Scripts' : 'bin',
            process.platform === 'win32' ? 'python.exe' : 'python'
          );

          if (existsSync(pythonExe)) {
            console.log('[Claude Code] Installing SDK version via pip:', version);
            const command = `python -m pip install claude-agent-sdk==${version}`;
            const result = await execFileAsync(pythonExe, ['-m', 'pip', 'install', `claude-agent-sdk==${version}`], {
              encoding: 'utf-8',
              timeout: 120000,
              windowsHide: true,
            });
            console.log('[Claude Code] pip install output:', result.stdout);
            return { success: true, data: { command, version } };
          }
        }

        // Fallback: open terminal for system CLI version switch
        const command = getInstallVersionCommand(version);
        console.log('[Claude Code] Install command:', command);
        console.log('[Claude Code] Opening terminal...');
        await openTerminalWithCommand(command);
        console.log('[Claude Code] Terminal opened successfully');

        return {
          success: true,
          data: { command, version },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Install version failed:', errorMsg, error);
        return {
          success: false,
          error: `Failed to install version: ${errorMsg}`,
        };
      }
    }
  );

  // Get all Claude CLI installations found on the system
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_GET_INSTALLATIONS,
    async (): Promise<IPCResult<ClaudeInstallationList>> => {
      try {
        console.log('[Claude Code] Scanning for installations...');

        // Get current active path from settings
        const settings = readSettingsFile();
        const activePath = settings?.claudePath as string | undefined;

        const installations = await scanClaudeInstallations(activePath || null);
        console.log('[Claude Code] Found', installations.length, 'installations');

        return {
          success: true,
          data: {
            installations,
            activePath: activePath || (installations.length > 0 ? installations[0].path : null),
          },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Failed to scan installations:', errorMsg, error);
        return {
          success: false,
          error: `Failed to scan Claude CLI installations: ${errorMsg}`,
        };
      }
    }
  );

  // Set the active Claude CLI path
  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_CODE_SET_ACTIVE_PATH,
    async (_event, cliPath: string): Promise<IPCResult<{ path: string }>> => {
      try {
        console.log('[Claude Code] Setting active path:', cliPath);

        // Security validation: reject paths with shell metacharacters or directory traversal
        if (!isSecurePath(cliPath)) {
          throw new Error('Invalid path: contains potentially unsafe characters');
        }

        // Normalize path to prevent directory traversal
        const normalizedPath = path.resolve(cliPath);

        // Validate the path exists and is executable
        if (!existsSync(normalizedPath)) {
          throw new Error('Claude CLI not found at specified path');
        }

        const [isValid, version] = await validateClaudeCliAsync(normalizedPath);
        if (!isValid) {
          throw new Error('Claude CLI at specified path is not valid or not executable');
        }

        // Save to settings using established pattern: merge with DEFAULT_APP_SETTINGS
        const currentSettings = readSettingsFile() || {};
        const mergedSettings = {
          ...DEFAULT_APP_SETTINGS,
          ...currentSettings,
          claudePath: normalizedPath,
        } as Record<string, unknown>;
        writeSettingsFile(mergedSettings);

        // Update CLI tool manager cache
        configureTools({ claudePath: normalizedPath });

        console.log('[Claude Code] Active path set:', normalizedPath, 'version:', version);

        return {
          success: true,
          data: { path: normalizedPath },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Claude Code] Failed to set active path:', errorMsg, error);
        return {
          success: false,
          error: `Failed to set active Claude CLI path: ${errorMsg}`,
        };
      }
    }
  );

  console.warn('[IPC] Claude Code handlers registered');
}
