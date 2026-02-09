/**
 * Claude Code CLI Settings Module
 *
 * Reads and merges Claude Code CLI settings files from the user's system.
 * These settings are separate from Auto Claude's own settings (settings-utils.ts).
 *
 * Usage:
 *   import { getClaudeCodeEnv, readAllSettings } from './claude-code-settings';
 *
 *   // Quick: just get the merged env vars for spawning processes
 *   const env = getClaudeCodeEnv('/path/to/project');
 *
 *   // Full: get the entire settings hierarchy
 *   const hierarchy = readAllSettings('/path/to/project');
 */

export type {
  ClaudeCodeSettings,
  ClaudeCodePermissions,
  ClaudeCodeSettingsHierarchy,
} from './types';

export {
  readUserGlobalSettings,
  readProjectSharedSettings,
  readProjectLocalSettings,
  readManagedSettings,
  readAllSettings,
} from './reader';

export { mergeClaudeCodeSettings } from './merger';

export {
  sanitizeEnvVars,
  isDangerousEnvVar,
  isWarningEnvVar,
  getDangerousEnvVars,
  getWarningEnvVars,
} from './env-sanitizer';

import { readAllSettings as _readAllSettings } from './reader';

/**
 * Convenience function: read all settings levels, merge, and return just the env object.
 *
 * This is the primary API for callers that only need environment variables
 * (e.g., terminal PTY spawning, agent process spawning).
 *
 * @param projectPath - Optional project path for project-level settings.
 * @returns Merged env record, or empty object if no env vars are configured.
 */
export function getClaudeCodeEnv(projectPath?: string): Record<string, string> {
  const hierarchy = _readAllSettings(projectPath);
  return hierarchy.merged.env ?? {};
}
