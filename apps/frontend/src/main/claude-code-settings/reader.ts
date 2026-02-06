/**
 * Claude Code CLI Settings Reader
 *
 * Reads Claude Code settings files from the 3 file-based levels plus
 * optional managed (system-wide) settings. Follows the same synchronous
 * read pattern as settings-utils.ts for consistency.
 *
 * Settings hierarchy (lowest to highest precedence):
 * 1. User Global:    ~/.claude/settings.json (or CLAUDE_CONFIG_DIR/settings.json)
 * 2. Shared Project: {projectPath}/.claude/settings.json
 * 3. Local Project:  {projectPath}/.claude/settings.local.json
 * 4. Managed:        Platform-specific system path (highest precedence)
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { isWindows, isMacOS } from '../platform';
import type { ClaudeCodeSettings, ClaudeCodeSettingsHierarchy } from './types';
import { mergeClaudeCodeSettings } from './merger';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

const LOG_PREFIX = '[ClaudeCodeSettings]';

/**
 * Validate that a parsed JSON object has the expected structure for ClaudeCodeSettings.
 */
function isValidSettings(obj: unknown): obj is ClaudeCodeSettings {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Safely read and parse a JSON settings file.
 * Returns undefined if the file doesn't exist or fails to parse.
 */
function readJsonFile(filePath: string): ClaudeCodeSettings | undefined {
  if (!existsSync(filePath)) {
    debugLog(`${LOG_PREFIX} File not found:`, filePath);
    return undefined;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidSettings(parsed)) {
      debugError(`${LOG_PREFIX} Invalid settings structure (expected object):`, filePath);
      return undefined;
    }

    debugLog(`${LOG_PREFIX} Read settings from:`, filePath);
    return parsed;
  } catch (error) {
    debugError(`${LOG_PREFIX} Failed to parse settings file:`, filePath, error);
    return undefined;
  }
}

/**
 * Resolve the user-global Claude config directory.
 *
 * Priority:
 * 1. Active Claude profile's configDir (from ClaudeProfileManager)
 * 2. CLAUDE_CONFIG_DIR environment variable
 * 3. Default: ~/.claude
 */
function getUserConfigDir(): string {
  // Try to get configDir from the active Claude profile.
  // We use a lazy import to avoid circular dependencies and to handle
  // the case where ClaudeProfileManager hasn't been initialized yet.
  try {
    // Dynamic require to avoid circular dependency at module load time
    const { getClaudeProfileManager } = require('../claude-profile-manager');
    const manager = getClaudeProfileManager();
    if (manager.isInitialized()) {
      const activeProfile = manager.getActiveProfile();
      if (activeProfile?.configDir) {
        const configDir = activeProfile.configDir.startsWith('~/')
          || activeProfile.configDir === '~'
          ? activeProfile.configDir.replace(/^~/, homedir())
          : activeProfile.configDir;
        debugLog(`${LOG_PREFIX} Using active profile configDir:`, configDir);
        return configDir;
      }
    }
  } catch {
    debugLog(`${LOG_PREFIX} ClaudeProfileManager not available, using fallback`);
  }

  // Fall back to CLAUDE_CONFIG_DIR env var
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (envConfigDir) {
    debugLog(`${LOG_PREFIX} Using CLAUDE_CONFIG_DIR:`, envConfigDir);
    return envConfigDir;
  }

  // Default: ~/.claude
  const defaultDir = path.join(homedir(), '.claude');
  debugLog(`${LOG_PREFIX} Using default config dir:`, defaultDir);
  return defaultDir;
}

/**
 * Read user-global settings.
 * Path: {configDir}/settings.json
 */
export function readUserGlobalSettings(): ClaudeCodeSettings | undefined {
  const configDir = getUserConfigDir();
  const settingsPath = path.join(configDir, 'settings.json');
  debugLog(`${LOG_PREFIX} Reading user global settings:`, settingsPath);
  return readJsonFile(settingsPath);
}

/**
 * Read shared project settings.
 * Path: {projectPath}/.claude/settings.json
 */
export function readProjectSharedSettings(projectPath: string): ClaudeCodeSettings | undefined {
  const settingsPath = path.join(projectPath, '.claude', 'settings.json');
  debugLog(`${LOG_PREFIX} Reading project shared settings:`, settingsPath);
  return readJsonFile(settingsPath);
}

/**
 * Read local project settings (gitignored, user-specific overrides).
 * Path: {projectPath}/.claude/settings.local.json
 */
export function readProjectLocalSettings(projectPath: string): ClaudeCodeSettings | undefined {
  const settingsPath = path.join(projectPath, '.claude', 'settings.local.json');
  debugLog(`${LOG_PREFIX} Reading project local settings:`, settingsPath);
  return readJsonFile(settingsPath);
}

/**
 * Get the platform-specific path for managed settings.
 *
 * - macOS:   /Library/Application Support/ClaudeCode/managed-settings.json
 * - Linux:   /etc/claude-code/managed-settings.json
 * - Windows: C:\Program Files\ClaudeCode\managed-settings.json
 */
function getManagedSettingsPath(): string {
  if (isWindows()) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return path.join(programFiles, 'ClaudeCode', 'managed-settings.json');
  }

  if (isMacOS()) {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }

  // Linux
  return '/etc/claude-code/managed-settings.json';
}

/**
 * Read managed (system-wide) settings.
 * Path: platform-specific (see getManagedSettingsPath)
 */
export function readManagedSettings(): ClaudeCodeSettings | undefined {
  const settingsPath = getManagedSettingsPath();
  debugLog(`${LOG_PREFIX} Reading managed settings:`, settingsPath);
  return readJsonFile(settingsPath);
}

/**
 * Read all settings levels and return the full hierarchy with merged result.
 *
 * @param projectPath - Optional project path. If not provided, only user-global
 *                      and managed settings are read.
 * @returns The full settings hierarchy including the merged result.
 */
export function readAllSettings(projectPath?: string): ClaudeCodeSettingsHierarchy {
  const validProjectPath = projectPath && projectPath.trim().length > 0 ? projectPath : undefined;

  debugLog(
    `${LOG_PREFIX} Reading all settings`,
    validProjectPath ? { projectPath: validProjectPath } : undefined
  );

  const user = readUserGlobalSettings();
  const projectShared = validProjectPath ? readProjectSharedSettings(validProjectPath) : undefined;
  const projectLocal = validProjectPath ? readProjectLocalSettings(validProjectPath) : undefined;
  const managed = readManagedSettings();

  const hierarchy: ClaudeCodeSettingsHierarchy = {
    user,
    projectShared,
    projectLocal,
    managed,
    merged: {} as ClaudeCodeSettings, // placeholder, replaced below
  };

  hierarchy.merged = mergeClaudeCodeSettings(hierarchy);

  debugLog(`${LOG_PREFIX} Merged settings result:`, hierarchy.merged);
  return hierarchy;
}
