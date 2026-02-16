import { getOAuthModeClearVars } from '../../../agent/env-utils';
import { getAPIProfileEnv } from '../../../services/profile';
import { getBestAvailableProfileEnv } from '../../../rate-limit-detector';
import { pythonEnvManager } from '../../../python-env-manager';
import { getGitHubTokenForSubprocess } from '../utils';
import { getSentryEnvForSubprocess } from '../../../sentry';

/**
 * Get environment variables for Python runner subprocesses.
 *
 * Environment variable precedence (lowest to highest):
 * 1. pythonEnv - Python environment including PYTHONPATH for bundled packages (fixes #139)
 * 2. apiProfileEnv - Custom Anthropic-compatible API profile (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
 * 3. oauthModeClearVars - Clears stale ANTHROPIC_* vars when in OAuth mode
 * 4. profileEnv - Claude OAuth token from profile manager (CLAUDE_CODE_OAUTH_TOKEN)
 * 5. githubEnv - Fresh GitHub token from gh CLI (GITHUB_TOKEN) - fetched on each call to reflect account changes
 * 6. extraEnv - Caller-specific vars (e.g., USE_CLAUDE_MD)
 *
 * NOTE: extraEnv can intentionally override any of the above, including GITHUB_TOKEN.
 * This allows callers to provide their own token for testing or special cases.
 *
 * The pythonEnv is critical for packaged apps (#139) - without PYTHONPATH, Python
 * cannot find bundled dependencies like dotenv, claude_agent_sdk, etc.
 *
 * The profileEnv is critical for OAuth authentication (#563) - it retrieves the
 * decrypted OAuth token from the profile manager's encrypted storage (macOS Keychain
 * via Electron's safeStorage API).
 *
 * The githubEnv is critical for GitHub operations (#151) - it fetches a fresh token
 * from the gh CLI on each call to ensure account changes are reflected immediately.
 */
export async function getRunnerEnv(
  extraEnv?: Record<string, string>
): Promise<Record<string, string>> {
  const pythonEnv = pythonEnvManager.getPythonEnv();
  const apiProfileEnv = await getAPIProfileEnv();
  const oauthModeClearVars = getOAuthModeClearVars(apiProfileEnv);
  // Get best available Claude profile environment (automatically handles rate limits)
  const profileResult = getBestAvailableProfileEnv();
  const profileEnv = profileResult.env;

  // Fetch fresh GitHub token from gh CLI (no caching to reflect account changes)
  const githubToken = await getGitHubTokenForSubprocess();
  const githubEnv: Record<string, string> = githubToken ? { GITHUB_TOKEN: githubToken } : {};

  return {
    ...pythonEnv,  // Python environment including PYTHONPATH (fixes #139)
    ...apiProfileEnv,
    ...oauthModeClearVars,
    ...profileEnv,  // OAuth token from profile manager (fixes #563, rate-limit aware)
    ...githubEnv,  // Fresh GitHub token from gh CLI (fixes #151)
    ...getSentryEnvForSubprocess(),  // Sentry DSN + sample rates for Python subprocess
    ...extraEnv,  // extraEnv last so callers can still override
  };
}
