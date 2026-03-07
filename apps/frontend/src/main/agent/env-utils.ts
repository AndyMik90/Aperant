/**
 * Utility functions for managing environment variables in agent spawning
 */

/**
 * Normalize the PATH key in an environment object to a single uppercase 'PATH' key.
 *
 * On Windows, process.env spreads as 'Path' (the native casing) while getAugmentedEnv()
 * writes 'PATH'. Without normalization, both keys coexist in the object and the child
 * process receives duplicate PATH entries, causing tool-not-found errors like #1661.
 *
 * Mutates the provided env object in place and returns it for convenience.
 *
 * @param env - Mutable environment record to normalize
 * @returns The same env object with PATH normalized to uppercase
 */
export function normalizeEnvPathKey(env: Record<string, string | undefined>): Record<string, string | undefined> {
  // If 'PATH' already exists, delete all other case-variant keys (e.g. 'Path')
  if ('PATH' in env) {
    for (const key of Object.keys(env)) {
      if (key !== 'PATH' && key.toUpperCase() === 'PATH') {
        delete env[key];
      }
    }
    return env;
  }

  // No uppercase 'PATH' key - find the first case-variant and rename it
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH');
  if (pathKey) {
    env['PATH'] = env[pathKey];
    delete env[pathKey];
    // Remove any remaining case-variant keys
    for (const key of Object.keys(env)) {
      if (key !== 'PATH' && key.toUpperCase() === 'PATH') {
        delete env[key];
      }
    }
  }

  return env;
}

/**
 * Merge pythonEnv PATH entries with the augmented PATH in env, deduplicating entries.
 *
 * pythonEnv may carry its own PATH (e.g. pywin32_system32 prepended on Windows).
 * Simply spreading pythonEnv after env would overwrite the augmented PATH (which
 * includes npm globals, Homebrew, etc.), causing "Claude code not found" (#1661).
 *
 * Strategy:
 *  1. Normalize PATH key casing in both env and pythonEnv to uppercase 'PATH'.
 *  2. Extract only pythonEnv PATH entries that are not already in env.PATH.
 *  3. Prepend those unique entries to env.PATH and store the result in pythonEnv.PATH.
 *
 * Mutates mergedPythonEnv in place (caller should pass a shallow copy if immutability is needed).
 *
 * @param env - The base environment (already augmented with tool paths)
 * @param mergedPythonEnv - Shallow copy of pythonEnv to merge PATH into
 * @param pathSep - Platform path separator (';' on Windows, ':' elsewhere)
 */
export function mergePythonEnvPath(
  env: Record<string, string | undefined>,
  mergedPythonEnv: Record<string, string | undefined>,
  pathSep: string
): void {
  // Normalize PATH key to uppercase in both objects
  normalizeEnvPathKey(env);
  normalizeEnvPathKey(mergedPythonEnv);

  if (mergedPythonEnv['PATH'] && env['PATH']) {
    const augmentedPathEntries = new Set(
      (env['PATH'] as string).split(pathSep).filter(Boolean)
    );
    // Extract only new entries from pythonEnv.PATH that aren't already in the augmented PATH
    const pythonPathEntries = (mergedPythonEnv['PATH'] as string)
      .split(pathSep)
      .filter(entry => entry && !augmentedPathEntries.has(entry));

    // Prepend python-specific paths (e.g., pywin32_system32) to the augmented PATH
    mergedPythonEnv['PATH'] = pythonPathEntries.length > 0
      ? [...pythonPathEntries, env['PATH'] as string].join(pathSep)
      : env['PATH'] as string;
  }
}

/**
 * Get environment variables to clear ANTHROPIC_* vars when in OAuth mode
 *
 * When switching from API Profile mode to OAuth mode, residual ANTHROPIC_*
 * environment variables from process.env can cause authentication failures.
 * This function returns an object with empty strings for these vars when
 * no API profile is active, ensuring OAuth tokens are used correctly.
 *
 * **Why empty strings?** Setting environment variables to empty strings (rather than
 * undefined) ensures they override any stale values from process.env. Python's SDK
 * treats empty strings as falsy in conditional checks like `if token:`, so empty
 * strings effectively disable these authentication parameters without leaving
 * undefined values that might be ignored during object spreading.
 *
 * @param apiProfileEnv - Environment variables from getAPIProfileEnv()
 * @returns Object with empty ANTHROPIC_* vars if in OAuth mode, empty object otherwise
 */
export function getOAuthModeClearVars(apiProfileEnv: Record<string, string>): Record<string, string> {
  // If API profile is active (has ANTHROPIC_* vars), don't clear anything
  if (apiProfileEnv && Object.keys(apiProfileEnv).some(key => key.startsWith('ANTHROPIC_'))) {
    return {};
  }

  // In OAuth mode (no API profile), clear all ANTHROPIC_* vars
  // Setting to empty string ensures they override any values from process.env
  // Python's `if token:` checks treat empty strings as falsy
  //
  // IMPORTANT: ANTHROPIC_API_KEY is included to prevent Claude Code from using
  // API keys that may be present in the shell environment instead of OAuth tokens.
  // Without clearing this, Claude Code would show "Claude API" instead of "Claude Max".
  return {
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: ''
  };
}
