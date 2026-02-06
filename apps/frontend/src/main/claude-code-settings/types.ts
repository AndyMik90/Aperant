/**
 * Claude Code CLI Settings Types
 *
 * TypeScript interfaces for Claude Code's settings.json files.
 * These settings are read from up to 4 levels (user global, shared project,
 * local project, managed) and merged with a defined precedence order.
 */

/**
 * Permission configuration for Claude Code tool usage.
 */
export interface ClaudeCodePermissions {
  /** Tool patterns that are always allowed without prompting */
  allow?: string[];
  /** Tool patterns that are always denied */
  deny?: string[];
  /** Tool patterns that require user confirmation */
  ask?: string[];
  /** Default permission mode when no specific rule matches */
  defaultMode?: 'ask' | 'acceptEdits' | 'plan';
  /** Additional directories Claude Code can access */
  additionalDirectories?: string[];
}

/**
 * A single level of Claude Code settings, as read from one settings file.
 * All fields are optional since any given file may only set a subset.
 */
export interface ClaudeCodeSettings {
  permissions?: ClaudeCodePermissions;
  /** Model override (e.g. "claude-sonnet-4-5-20250929") */
  model?: string;
  /** Whether to enable extended thinking by default */
  alwaysThinkingEnabled?: boolean;
  /** Environment variables to inject into agent processes */
  env?: Record<string, string>;
}

/**
 * The full hierarchy of settings from all levels, plus the merged result.
 */
export interface ClaudeCodeSettingsHierarchy {
  /** User-global settings from ~/.claude/settings.json */
  user?: ClaudeCodeSettings;
  /** Shared project settings from {projectPath}/.claude/settings.json */
  projectShared?: ClaudeCodeSettings;
  /** Local project settings from {projectPath}/.claude/settings.local.json */
  projectLocal?: ClaudeCodeSettings;
  /** Platform-managed settings from system-wide location */
  managed?: ClaudeCodeSettings;
  /** Final merged result (user < projectShared < projectLocal < managed) */
  merged: ClaudeCodeSettings;
}
