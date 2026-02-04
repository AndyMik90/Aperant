/**
 * Platform-Specific Path Resolvers
 *
 * Handles detection of tool paths across platforms.
 * Each tool has a dedicated resolver function.
 */

import * as path from 'path';
import * as os from 'os';
import { existsSync, readdirSync } from 'fs';
import { isWindows, isMacOS, getHomebrewPath, joinPaths, getExecutableExtension } from './index';
import { getWhereExePath } from '../utils/windows-paths';

/**
 * Resolve Claude CLI executable path
 *
 * Searches in platform-specific installation directories:
 * - Windows: Program Files, AppData, npm
 * - macOS: Homebrew, /usr/local/bin
 * - Linux: ~/.local/bin, /usr/bin
 */
export function getClaudeExecutablePath(): string[] {
  const homeDir = os.homedir();
  const paths: string[] = [];

  if (isWindows()) {
    // Note: path.join('C:', 'foo') produces 'C:foo' (relative to C: drive), not 'C:\foo'
    // We must use 'C:\\' or raw paths like 'C:\\Program Files' to get absolute paths
    paths.push(
      joinPaths(homeDir, 'AppData', 'Local', 'Programs', 'claude', `claude${getExecutableExtension()}`),
      joinPaths(homeDir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      joinPaths(homeDir, '.local', 'bin', `claude${getExecutableExtension()}`),
      joinPaths('C:\\Program Files', 'Claude', `claude${getExecutableExtension()}`),
      joinPaths('C:\\Program Files (x86)', 'Claude', `claude${getExecutableExtension()}`)
    );
  } else {
    paths.push(
      joinPaths(homeDir, '.local', 'bin', 'claude'),
      joinPaths(homeDir, 'bin', 'claude')
    );

    // Add Homebrew paths on macOS
    if (isMacOS()) {
      const brewPath = getHomebrewPath();
      if (brewPath) {
        paths.push(joinPaths(brewPath, 'claude'));
      }
    }
  }

  return paths;
}

/**
 * Resolve Python executable path
 *
 * Returns command arguments as sequences so callers can pass each entry
 * directly to spawn/exec or use cmd[0] for executable lookup.
 *
 * Returns platform-specific command variations:
 * - Windows: ["py", "-3"], ["python"], ["python3"], ["py"]
 * - Unix: ["python3"], ["python"]
 */
export function getPythonCommands(): string[][] {
  if (isWindows()) {
    return [['py', '-3'], ['python'], ['python3'], ['py']];
  }
  return [['python3'], ['python']];
}

/**
 * Expand a directory pattern like "Python3*" by scanning the parent directory
 * Returns matching directory paths or empty array if none found
 */
function expandDirPattern(parentDir: string, pattern: string): string[] {
  if (!existsSync(parentDir)) {
    return [];
  }

  try {
    // Convert glob pattern to regex (only support simple * wildcard)
    const regexPattern = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
    const entries = readdirSync(parentDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && regexPattern.test(entry.name))
      .map((entry) => joinPaths(parentDir, entry.name));
  } catch {
    return [];
  }
}

/**
 * Resolve Python installation paths
 *
 * Returns actual existing directory paths (expands glob patterns on Windows)
 */
export function getPythonPaths(): string[] {
  const homeDir = os.homedir();
  const paths: string[] = [];

  if (isWindows()) {
    // User-local Python installation
    const userPythonPath = joinPaths(homeDir, 'AppData', 'Local', 'Programs', 'Python');
    if (existsSync(userPythonPath)) {
      paths.push(userPythonPath);
    }

    // System Python installations (expand Python3* patterns)
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    paths.push(...expandDirPattern(programFiles, 'Python3*'));
    paths.push(...expandDirPattern(programFilesX86, 'Python3*'));
  } else if (isMacOS()) {
    const brewPath = getHomebrewPath();
    if (brewPath) {
      paths.push(brewPath);
    }
  }

  return paths;
}

/**
 * Resolve Git executable path
 */
export function getGitExecutablePath(): string {
  if (isWindows()) {
    // Git for Windows installs to standard locations
    const candidates = [
      joinPaths('C:\\Program Files', 'Git', 'bin', 'git.exe'),
      joinPaths('C:\\Program Files (x86)', 'Git', 'bin', 'git.exe'),
      joinPaths(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'git.exe')
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return 'git';
}

/**
 * Resolve Node.js executable path
 */
export function getNodeExecutablePath(): string {
  if (isWindows()) {
    return 'node.exe';
  }
  return 'node';
}

/**
 * Resolve npm executable path
 */
export function getNpmExecutablePath(): string {
  if (isWindows()) {
    return 'npm.cmd';
  }
  return 'npm';
}

/**
 * Get all Windows shell paths for terminal selection
 *
 * Returns a map of shell types to their possible installation paths.
 * Only applies to Windows; returns empty object for other platforms.
 */
export function getWindowsShellPaths(): Record<string, string[]> {
  if (!isWindows()) {
    return {};
  }

  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';

  // Note: path.join('C:', 'foo') produces 'C:foo' (relative to C: drive), not 'C:\foo'
  // We must use 'C:\\' or raw paths like 'C:\\Program Files' to get absolute paths
  return {
    powershell: [
      path.join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    ],
    windowsterminal: [
      path.join('C:\\Program Files', 'WindowsApps', 'Microsoft.WindowsTerminal_*', 'WindowsTerminal.exe')
    ],
    cmd: [
      path.join(systemRoot, 'System32', 'cmd.exe')
    ],
    gitbash: [
      path.join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join('C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
    ],
    cygwin: [
      path.join('C:\\cygwin64', 'bin', 'bash.exe')
    ],
    msys2: [
      path.join('C:\\msys64', 'usr', 'bin', 'bash.exe')
    ],
    wsl: [
      path.join(systemRoot, 'System32', 'wsl.exe')
    ]
  };
}

/**
 * Expand Windows environment variables in a path
 *
 * Replaces patterns like %PROGRAMFILES% with actual values.
 * Only applies to Windows; returns original path for other platforms.
 */
export function expandWindowsEnvVars(pathPattern: string): string {
  if (!isWindows()) {
    return pathPattern;
  }

  const homeDir = os.homedir();
  const envVars: Record<string, string | undefined> = {
    '%PROGRAMFILES%': process.env.ProgramFiles || 'C:\\Program Files',
    '%PROGRAMFILES(X86)%': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    '%LOCALAPPDATA%': process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'),
    '%APPDATA%': process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
    '%USERPROFILE%': process.env.USERPROFILE || homeDir,
    '%SYSTEMROOT%': process.env.SystemRoot || 'C:\\Windows',
    '%TEMP%': process.env.TEMP || process.env.TMP || path.join(homeDir, 'AppData', 'Local', 'Temp'),
    '%TMP%': process.env.TMP || process.env.TEMP || path.join(homeDir, 'AppData', 'Local', 'Temp')
  };

  let expanded = pathPattern;
  for (const [pattern, value] of Object.entries(envVars)) {
    // Only replace if we have a valid value (skip replacement if empty)
    if (value) {
      expanded = expanded.replace(new RegExp(pattern, 'gi'), value);
    }
  }

  return expanded;
}

/**
 * Resolve Ollama executable paths
 *
 * Returns platform-specific paths where Ollama may be installed:
 * - Windows: LocalAppData, Program Files
 * - macOS: Homebrew paths, /usr/local/bin
 * - Linux: /usr/local/bin, /usr/bin, ~/.local/bin
 */
export function getOllamaExecutablePaths(): string[] {
  const homeDir = os.homedir();
  const paths: string[] = [];

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || joinPaths(homeDir, 'AppData', 'Local');
    paths.push(
      joinPaths(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      joinPaths(localAppData, 'Ollama', 'ollama.exe'),
      joinPaths('C:\\Program Files', 'Ollama', 'ollama.exe'),
      joinPaths('C:\\Program Files (x86)', 'Ollama', 'ollama.exe')
    );
  } else if (isMacOS()) {
    paths.push(
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      joinPaths(homeDir, '.local', 'bin', 'ollama')
    );
  } else {
    // Linux
    paths.push(
      '/usr/local/bin/ollama',
      '/usr/bin/ollama',
      joinPaths(homeDir, '.local', 'bin', 'ollama')
    );
  }

  return paths;
}

/**
 * Get the platform-specific install command for Ollama
 *
 * Windows: Uses winget (Windows Package Manager)
 * macOS: Uses Homebrew
 * Linux: Uses official install script
 */
export function getOllamaInstallCommand(): string {
  if (isWindows()) {
    return 'winget install --id Ollama.Ollama --accept-source-agreements';
  } else if (isMacOS()) {
    return 'brew install ollama';
  } else {
    return 'curl -fsSL https://ollama.com/install.sh | sh';
  }
}

/**
 * Get the command to find executables in PATH
 *
 * Windows: Full path to where.exe (C:\Windows\System32\where.exe)
 *          Using full path ensures it works even when System32 isn't in PATH,
 *          which can happen in restricted environments or when Electron doesn't
 *          inherit the full system PATH.
 * Unix: which
 */
export function getWhichCommand(): string {
  return isWindows() ? getWhereExePath() : 'which';
}

/**
 * Get Windows-specific installation paths for a tool
 *
 * @param toolName - Name of the tool (e.g., 'claude', 'python')
 * @param subPath - Optional subdirectory within Program Files
 */
export function getWindowsToolPath(toolName: string, subPath?: string): string[] {
  if (!isWindows()) {
    return [];
  }

  const homeDir = os.homedir();
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const appData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');

  const paths: string[] = [];

  // Program Files locations
  if (subPath) {
    paths.push(
      path.join(programFiles, subPath),
      path.join(programFilesX86, subPath)
    );
  } else {
    paths.push(
      path.join(programFiles, toolName),
      path.join(programFilesX86, toolName)
    );
  }

  // AppData location
  paths.push(path.join(appData, toolName));

  // Roaming AppData (for npm)
  const roamingAppData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  paths.push(path.join(roamingAppData, 'npm'));

  return paths;
}
