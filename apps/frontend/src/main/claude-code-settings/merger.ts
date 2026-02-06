/**
 * Claude Code Settings Merger
 *
 * Merges settings from multiple precedence levels into a single result.
 *
 * Precedence (lowest to highest):
 * 1. User Global
 * 2. Shared Project
 * 3. Local Project
 * 4. Managed (system-wide)
 *
 * Merge rules:
 * - Scalar values (model, alwaysThinkingEnabled, defaultMode): higher precedence wins
 * - env object: deep merge with sanitization, higher precedence wins conflicts
 * - Permission arrays (allow, deny, ask): concatenate unique values
 * - additionalDirectories: concatenate unique values
 *
 * Security:
 * - Environment variables are sanitized to prevent supply chain attacks
 * - Dangerous variables (LD_PRELOAD, NODE_OPTIONS, etc.) are blocked
 */

import type { ClaudeCodeSettings, ClaudeCodeSettingsHierarchy } from './types';
import { sanitizeEnvVars } from './env-sanitizer';

/**
 * Merge two env objects with sanitization. Values from `higher` override `lower`
 * on key conflicts. Dangerous environment variables are filtered out to prevent
 * supply chain attacks.
 *
 * @param lower - Lower precedence env vars
 * @param higher - Higher precedence env vars
 * @param lowerLevel - Source level of lower env vars (for sanitization logging)
 * @param higherLevel - Source level of higher env vars (for sanitization logging)
 */
function mergeEnv(
  lower: Record<string, string> | undefined,
  higher: Record<string, string> | undefined,
  lowerLevel: 'user' | 'projectShared' | 'projectLocal' | 'managed' = 'user',
  higherLevel: 'user' | 'projectShared' | 'projectLocal' | 'managed' = 'user'
): Record<string, string> | undefined {
  if (!lower && !higher) return undefined;
  if (!lower) return sanitizeEnvVars(higher, higherLevel);
  if (!higher) return sanitizeEnvVars(lower, lowerLevel);

  // Sanitize both levels before merging
  const sanitizedLower = sanitizeEnvVars(lower, lowerLevel);
  const sanitizedHigher = sanitizeEnvVars(higher, higherLevel);

  return { ...sanitizedLower, ...sanitizedHigher };
}

/**
 * Merge two string arrays, keeping only unique values.
 */
function mergeArrays(
  lower: string[] | undefined,
  higher: string[] | undefined,
): string[] | undefined {
  if (!lower && !higher) return undefined;
  if (!lower) return higher ? [...higher] : undefined;
  if (!higher) return [...lower];

  const combined = [...lower, ...higher];
  return [...new Set(combined)];
}

/**
 * Merge two settings levels. Higher precedence values override lower for scalars;
 * arrays are concatenated; env is deep-merged with sanitization.
 *
 * @param lower - Lower precedence settings
 * @param higher - Higher precedence settings
 * @param lowerLevel - Source level of lower settings (for env sanitization)
 * @param higherLevel - Source level of higher settings (for env sanitization)
 */
function mergeTwoLevels(
  lower: ClaudeCodeSettings | undefined,
  higher: ClaudeCodeSettings | undefined,
  lowerLevel: 'user' | 'projectShared' | 'projectLocal' | 'managed' = 'user',
  higherLevel: 'user' | 'projectShared' | 'projectLocal' | 'managed' = 'user'
): ClaudeCodeSettings {
  if (!lower && !higher) return {};
  if (!lower) {
    const result = { ...higher } as ClaudeCodeSettings;
    // Sanitize env vars from the higher level
    if (result.env) {
      result.env = sanitizeEnvVars(result.env, higherLevel);
      if (Object.keys(result.env).length === 0) {
        delete result.env;
      }
    }
    return result;
  }
  if (!higher) {
    const result = { ...lower };
    // Sanitize env vars from the lower level
    if (result.env) {
      result.env = sanitizeEnvVars(result.env, lowerLevel);
      if (Object.keys(result.env).length === 0) {
        delete result.env;
      }
    }
    return result;
  }

  const result: ClaudeCodeSettings = { ...lower };

  // Scalar overrides
  if (higher.model !== undefined) {
    result.model = higher.model;
  }
  if (higher.alwaysThinkingEnabled !== undefined) {
    result.alwaysThinkingEnabled = higher.alwaysThinkingEnabled;
  }

  // Deep merge env with sanitization
  result.env = mergeEnv(lower.env, higher.env, lowerLevel, higherLevel);
  if (!result.env || Object.keys(result.env).length === 0) {
    delete result.env;
  }

  // Merge permissions
  if (lower.permissions || higher.permissions) {
    const lp = lower.permissions ?? {};
    const hp = higher.permissions ?? {};

    result.permissions = {
      ...lp,
      // Scalar override for defaultMode
      ...(hp.defaultMode !== undefined ? { defaultMode: hp.defaultMode } : {}),
      // Array merges
      allow: mergeArrays(lp.allow, hp.allow),
      deny: mergeArrays(lp.deny, hp.deny),
      ask: mergeArrays(lp.ask, hp.ask),
      additionalDirectories: mergeArrays(lp.additionalDirectories, hp.additionalDirectories),
    };

    // Clean up undefined array fields
    if (!result.permissions.allow) delete result.permissions.allow;
    if (!result.permissions.deny) delete result.permissions.deny;
    if (!result.permissions.ask) delete result.permissions.ask;
    if (!result.permissions.additionalDirectories) delete result.permissions.additionalDirectories;
    if (!result.permissions.defaultMode) delete result.permissions.defaultMode;
  }

  return result;
}

/**
 * Merge the full settings hierarchy into a single ClaudeCodeSettings object.
 *
 * Applies precedence: user (lowest) -> projectShared -> projectLocal -> managed (highest)
 *
 * Security: Environment variables are sanitized at each level to prevent supply
 * chain attacks via malicious project settings.json files.
 */
export function mergeClaudeCodeSettings(
  hierarchy: ClaudeCodeSettingsHierarchy,
): ClaudeCodeSettings {
  let merged: ClaudeCodeSettings = {};

  // Merge with level tracking for proper env sanitization
  merged = mergeTwoLevels(merged, hierarchy.user, 'user', 'user');
  merged = mergeTwoLevels(merged, hierarchy.projectShared, 'user', 'projectShared');
  merged = mergeTwoLevels(merged, hierarchy.projectLocal, 'projectShared', 'projectLocal');
  merged = mergeTwoLevels(merged, hierarchy.managed, 'projectLocal', 'managed');

  return merged;
}
