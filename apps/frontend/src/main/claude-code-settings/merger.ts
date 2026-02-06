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
 * - env object: deep merge, higher precedence wins conflicts
 * - Permission arrays (allow, deny, ask): concatenate unique values
 * - additionalDirectories: concatenate unique values
 */

import type { ClaudeCodeSettings, ClaudeCodeSettingsHierarchy } from './types';

/**
 * Merge two env objects. Values from `higher` override `lower` on key conflicts.
 */
function mergeEnv(
  lower: Record<string, string> | undefined,
  higher: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!lower && !higher) return undefined;
  if (!lower) return { ...higher };
  if (!higher) return { ...lower };
  return { ...lower, ...higher };
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
 * arrays are concatenated; env is deep-merged.
 */
function mergeTwoLevels(
  lower: ClaudeCodeSettings | undefined,
  higher: ClaudeCodeSettings | undefined,
): ClaudeCodeSettings {
  if (!lower && !higher) return {};
  if (!lower) return { ...higher } as ClaudeCodeSettings;
  if (!higher) return { ...lower };

  const result: ClaudeCodeSettings = { ...lower };

  // Scalar overrides
  if (higher.model !== undefined) {
    result.model = higher.model;
  }
  if (higher.alwaysThinkingEnabled !== undefined) {
    result.alwaysThinkingEnabled = higher.alwaysThinkingEnabled;
  }

  // Deep merge env
  result.env = mergeEnv(lower.env, higher.env);
  if (!result.env) delete result.env;

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
 */
export function mergeClaudeCodeSettings(
  hierarchy: ClaudeCodeSettingsHierarchy,
): ClaudeCodeSettings {
  let merged: ClaudeCodeSettings = {};

  merged = mergeTwoLevels(merged, hierarchy.user);
  merged = mergeTwoLevels(merged, hierarchy.projectShared);
  merged = mergeTwoLevels(merged, hierarchy.projectLocal);
  merged = mergeTwoLevels(merged, hierarchy.managed);

  return merged;
}
