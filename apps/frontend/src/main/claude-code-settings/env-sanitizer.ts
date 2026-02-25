/**
 * Environment Variable Sanitizer
 *
 * Filters dangerous environment variables from Claude Code settings to prevent
 * supply chain attacks via malicious project settings.json files.
 *
 * Attack Vector:
 * A malicious repository can include .claude/settings.json (committed file) with
 * dangerous env vars like LD_PRELOAD, NODE_OPTIONS, etc. When a user opens the
 * project and creates a terminal, these vars get injected into the PTY process,
 * enabling arbitrary code execution.
 *
 * Defense Strategy:
 * - Block environment variables that enable code injection
 * - Log warnings for blocked variables
 * - Special handling for PATH (warn but don't block)
 */

import { debugLog, debugError } from '../../shared/utils/debug-logger';

const LOG_PREFIX = '[EnvSanitizer]';

/**
 * Environment variables that enable arbitrary code execution and MUST be blocked.
 * These variables allow attackers to inject malicious libraries, scripts, or commands
 * into the runtime environment.
 *
 * Categories:
 * - Dynamic linker injection (LD_*, DYLD_*)
 * - Runtime module loaders (NODE_OPTIONS, PYTHON*, RUBY*, PERL*)
 * - Shell initialization (BASH_ENV, ENV, ZDOTDIR, INPUTRC)
 * - JVM injection (JAVA_TOOL_OPTIONS, MAVEN_OPTS, GRADLE_OPTS)
 * - Package manager hijacking (NPM_CONFIG_PREFIX, YARN_RC_FILENAME, COMPOSER_HOME)
 * - Path manipulation that can hijack commands (CDPATH)
 */
const DANGEROUS_ENV_VARS = new Set([
  // Linux/Unix dynamic linker - allows loading arbitrary shared libraries
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'LD_BIND_NOW',
  'LD_DEBUG',

  // macOS dynamic linker - allows loading arbitrary dylibs/frameworks
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
  'DYLD_VERSIONED_LIBRARY_PATH',
  'DYLD_VERSIONED_FRAMEWORK_PATH',

  // Node.js - allows arbitrary module loading and flag injection
  'NODE_OPTIONS',
  'NODE_PATH',

  // Python - allows running arbitrary Python code at startup
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'PYTHONINSPECT',

  // Ruby - allows injecting arbitrary Ruby code
  'RUBYOPT',
  'RUBYLIB',

  // Perl - allows injecting arbitrary Perl code
  'PERL5OPT',
  'PERLLIB',
  'PERL5LIB',

  // Shell initialization - allows running arbitrary commands
  'BASH_ENV',
  'ENV',
  'ZDOTDIR', // zsh startup directory hijacking
  'PROMPT_COMMAND',
  'INPUTRC', // readline command injection

  // Path manipulation - can cause 'cd' to execute malicious code
  'CDPATH',

  // JVM injection - allows arbitrary agent/code loading
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'MAVEN_OPTS',
  'GRADLE_OPTS',

  // Python additional - user site-packages hijacking
  'PYTHONUSERBASE',

  // Package manager hijacking
  'NPM_CONFIG_PREFIX',
  'YARN_RC_FILENAME',
  'COMPOSER_HOME',

  // Git injection
  'GIT_TRACE',
  'GIT_TRACE_PACKET',
  'GIT_TRACE_PERFORMANCE',
  'GIT_SSH_COMMAND',
  'GIT_ALLOW_PROTOCOL',
]);

/**
 * Environment variables that should trigger warnings when set from project-level
 * settings (shared or local), but are not blocked entirely since they may be
 * legitimately needed.
 */
const WARNING_ENV_VARS = new Set([
  'PATH', // Can hijack command execution if malicious paths are prepended
  'SHELL', // Changing shell can affect command execution
  'TERM', // Can affect terminal behavior in unexpected ways
]);

/**
 * Sanitize environment variables by removing dangerous entries that could enable
 * supply chain attacks.
 *
 * @param env - Raw environment variables from settings.json
 * @param sourceLevel - The settings level these vars came from (for logging)
 * @returns Sanitized environment variables with dangerous entries removed
 */
export function sanitizeEnvVars(
  env: Record<string, string> | undefined,
  sourceLevel: 'user' | 'projectShared' | 'projectLocal' | 'managed' = 'user'
): Record<string, string> {
  if (!env || typeof env !== 'object') {
    return {};
  }

  const sanitized: Record<string, string> = {};
  const blocked: string[] = [];
  const warned: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    // Validate key and value types
    if (typeof key !== 'string' || typeof value !== 'string') {
      debugError(`${LOG_PREFIX} Invalid env var type: ${typeof key}=${typeof value}`);
      continue;
    }

    const upperKey = key.toUpperCase();

    // Block dangerous variables
    if (DANGEROUS_ENV_VARS.has(upperKey)) {
      blocked.push(key);
      debugError(
        `${LOG_PREFIX} BLOCKED dangerous env var from ${sourceLevel}: ${key}`,
        '(prevents code injection attack)'
      );
      continue;
    }

    // Warn about potentially dangerous variables when set from project-level settings
    // (User-level and managed settings are considered trusted)
    if (
      (sourceLevel === 'projectShared' || sourceLevel === 'projectLocal') &&
      WARNING_ENV_VARS.has(upperKey)
    ) {
      warned.push(key);
      debugLog(
        `${LOG_PREFIX} WARNING: ${key} set from ${sourceLevel} settings`,
        '(can affect command execution, verify this is intentional)'
      );
    }

    sanitized[key] = value;
  }

  // Log summary if any variables were filtered
  if (blocked.length > 0) {
    debugError(
      `${LOG_PREFIX} Blocked ${blocked.length} dangerous env var(s) from ${sourceLevel}:`,
      blocked.join(', ')
    );
  }

  if (warned.length > 0) {
    debugLog(
      `${LOG_PREFIX} ${warned.length} potentially dangerous env var(s) from ${sourceLevel}:`,
      warned.join(', ')
    );
  }

  return sanitized;
}

/**
 * Check if an environment variable is considered dangerous.
 * Useful for validation and testing.
 */
export function isDangerousEnvVar(key: string): boolean {
  return DANGEROUS_ENV_VARS.has(key.toUpperCase());
}

/**
 * Check if an environment variable should trigger a warning when set from
 * project-level settings.
 */
export function isWarningEnvVar(key: string): boolean {
  return WARNING_ENV_VARS.has(key.toUpperCase());
}

/**
 * Get the complete list of blocked environment variable names.
 * Useful for documentation and testing.
 */
export function getDangerousEnvVars(): string[] {
  return Array.from(DANGEROUS_ENV_VARS).sort();
}

/**
 * Get the complete list of warning environment variable names.
 * Useful for documentation and testing.
 */
export function getWarningEnvVars(): string[] {
  return Array.from(WARNING_ENV_VARS).sort();
}
