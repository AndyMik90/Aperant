/**
 * OpenAI Codex OAuth PKCE Authentication
 *
 * Handles the full OAuth 2.0 PKCE flow for OpenAI Codex subscriptions.
 * Uses Node.js built-ins only: crypto, http, fs, path, url.
 * Uses Electron APIs: shell, app.
 *
 * Flow:
 * 1. Generate PKCE code verifier + challenge + state
 * 2. Start local HTTP server on port 1455
 * 3. Open browser to OpenAI auth URL
 * 4. Receive callback with authorization code
 * 5. Verify state parameter matches
 * 6. Exchange code for tokens
 * 7. Store tokens securely (chmod 600)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as url from 'url';

// Electron APIs loaded lazily to avoid crashing in worker threads
// (workers don't have access to Electron main-process modules)
let _app: typeof import('electron').app | null = null;
let _shell: typeof import('electron').shell | null = null;

async function getElectronApp() {
  if (!_app) {
    const electron = await import('electron');
    _app = electron.app;
  }
  return _app;
}

async function getElectronShell() {
  if (!_shell) {
    const electron = await import('electron');
    _shell = electron.shell;
  }
  return _shell;
}

// =============================================================================
// Debug Logging
// =============================================================================

const DEBUG = process.env.DEBUG === 'true' || process.argv.includes('--debug');
const VERBOSE = process.env.VERBOSE === 'true';

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const prefix = `[CodexOAuth ${timestamp}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function verboseLog(message: string, data?: unknown): void {
  if (!VERBOSE) return;
  const timestamp = new Date().toISOString();
  const prefix = `[CodexOAuth ${timestamp}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

// =============================================================================
// Constants
// =============================================================================

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';

/** How far before expiry to consider a token "near expiry" and trigger refresh */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Timeout for the OAuth browser flow before giving up */
const OAUTH_FLOW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// =============================================================================
// Types
// =============================================================================

export interface CodexAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  email?: string;
}

export interface CodexAuthState {
  isAuthenticated: boolean;
  expiresAt?: number;
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

// =============================================================================
// Token Storage
// =============================================================================

async function getTokenFilePath(): Promise<string> {
  const electronApp = await getElectronApp();
  return path.join(electronApp.getPath('userData'), 'codex-auth.json');
}

async function readStoredTokens(explicitPath?: string): Promise<StoredTokens | null> {
  try {
    const filePath = explicitPath ?? await getTokenFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    const tokens = JSON.parse(raw) as StoredTokens;
    verboseLog('Read stored tokens', { expiresAt: tokens.expires_at, hasAccess: !!tokens.access_token, hasRefresh: !!tokens.refresh_token });
    return tokens;
  } catch {
    debugLog('No stored tokens found');
    return null;
  }
}

async function writeStoredTokens(tokens: StoredTokens): Promise<void> {
  const filePath = await getTokenFilePath();
  // CodeQL: network data validated before write - validate token fields match expected StoredTokens schema
  const safeTokens: StoredTokens = {
    access_token: typeof tokens.access_token === 'string' ? tokens.access_token : '',
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
    expires_at: typeof tokens.expires_at === 'number' ? tokens.expires_at : 0,
  };
  fs.writeFileSync(filePath, JSON.stringify(safeTokens, null, 2), 'utf8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on Windows; non-critical
  }
  debugLog('Wrote tokens to disk', { path: filePath, expiresAt: tokens.expires_at });
}

// =============================================================================
// PKCE Helpers
// =============================================================================

function generateCodeVerifier(): string {
  const verifier = crypto.randomBytes(32).toString('base64url');
  debugLog('Generated PKCE code verifier', { length: verifier.length });
  return verifier;
}

function generateCodeChallenge(verifier: string): string {
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  debugLog('Generated PKCE code challenge', { length: challenge.length });
  return challenge;
}

function generateState(): string {
  const state = crypto.randomBytes(16).toString('hex');
  debugLog('Generated OAuth state', { state });
  return state;
}

// =============================================================================
// OAuth Flow
// =============================================================================

/**
 * Start the OpenAI Codex OAuth PKCE flow.
 *
 * Opens a browser window for authentication, listens on port 1455 for the
 * callback, exchanges the authorization code for tokens, stores them, and
 * returns the result.
 */
export async function startCodexOAuthFlow(): Promise<CodexAuthResult> {
  debugLog('Starting Codex OAuth PKCE flow');

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = new url.URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('originator', 'auto-claude');
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true');

  debugLog('Built authorization URL', { url: authUrl.toString() });

  return new Promise<CodexAuthResult>((resolve, reject) => {
    let server: http.Server | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (server !== null) {
        server.close();
        server = null;
      }
      debugLog('Cleaned up OAuth server and timeout');
    };

    server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }

      const parsedUrl = new url.URL(req.url, 'http://localhost:1455');
      debugLog('Received request', { pathname: parsedUrl.pathname, search: parsedUrl.search });

      if (parsedUrl.pathname !== '/auth/callback') {
        debugLog('Non-callback request, returning 404', { pathname: parsedUrl.pathname });
        res.writeHead(404).end('Not found');
        return;
      }

      const code = parsedUrl.searchParams.get('code');
      const error = parsedUrl.searchParams.get('error');
      const errorDescription = parsedUrl.searchParams.get('error_description');
      const returnedState = parsedUrl.searchParams.get('state');

      debugLog('Callback received', {
        hasCode: !!code,
        error,
        errorDescription,
        returnedState,
        expectedState: state,
        stateMatch: returnedState === state,
      });

      // Respond to browser immediately
      const successHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication successful</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: #e0e0e0;">
  <div style="text-align: center;">
    <h2 style="color: #4ade80;">Authentication successful!</h2>
    <p>You can close this tab and return to Auto Claude.</p>
  </div>
</body>
</html>`;
      const errorHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication failed</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: #e0e0e0;">
  <div style="text-align: center;">
    <h2 style="color: #f87171;">Authentication failed</h2>
    <p>${errorDescription ?? error ?? 'Unknown error'}</p>
  </div>
</body>
</html>`;

      if (error || !code) {
        const errorMsg = errorDescription ?? error ?? 'No authorization code received';
        debugLog('OAuth callback error', { error, errorDescription });
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(errorHtml);
        cleanup();
        reject(new Error(`OAuth error: ${errorMsg}`));
        return;
      }

      // Verify state parameter to prevent CSRF attacks
      if (returnedState !== state) {
        debugLog('State mismatch!', { expected: state, received: returnedState });
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(errorHtml);
        cleanup();
        reject(new Error('OAuth error: State parameter mismatch — possible CSRF attack'));
        return;
      }

      debugLog('State verified, exchanging code for tokens');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(successHtml);
      cleanup();

      // Exchange code for tokens
      exchangeCodeForTokens(code, codeVerifier)
        .then(async (result) => {
          debugLog('Token exchange successful', { expiresAt: result.expiresAt });
          await writeStoredTokens({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
            expires_at: result.expiresAt,
          });
          resolve(result);
        })
        .catch((err) => {
          debugLog('Token exchange failed', { error: err instanceof Error ? err.message : String(err) });
          reject(err);
        });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      debugLog('Server error', { code: err.code, message: err.message });
      cleanup();
      if (err.code === 'EADDRINUSE') {
        reject(new Error('Port 1455 is already in use. Please close any other application using this port and try again.'));
      } else {
        reject(err);
      }
    });

    server.listen(1455, '127.0.0.1', () => {
      debugLog('OAuth callback server listening on port 1455');

      // Open the browser
      getElectronShell().then(s => s.openExternal(authUrl.toString())).then(() => {
        debugLog('Browser opened for OpenAI authentication');
      }).catch((err) => {
        debugLog('Failed to open browser', { error: err instanceof Error ? err.message : String(err) });
        cleanup();
        reject(new Error(`Failed to open browser: ${err instanceof Error ? err.message : String(err)}`));
      });

      // Set 30-minute timeout
      timeoutHandle = setTimeout(() => {
        debugLog('OAuth flow timed out after 30 minutes');
        cleanup();
        reject(new Error('OAuth flow timed out after 30 minutes. Please try again.'));
      }, OAUTH_FLOW_TIMEOUT_MS);
    });
  });
}

// =============================================================================
// Token Exchange
// =============================================================================

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CodexAuthResult> {
  debugLog('Exchanging authorization code for tokens');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  debugLog('Token exchange response', { status: response.status, ok: response.ok });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      debugLog('Token exchange error response', errorData);
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore parse errors
    }
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  const data = await response.json() as Record<string, unknown>;
  debugLog('Token exchange success', {
    hasAccessToken: !!data.access_token,
    hasRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  });

  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error('Token exchange response missing access_token');
  }
  if (!data.refresh_token || typeof data.refresh_token !== 'string') {
    throw new Error('Token exchange response missing refresh_token');
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  const email =
    typeof data.id_token === 'string' ? getEmailFromIdToken(data.id_token) : undefined;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    email,
  };
}

// =============================================================================
// Token Refresh
// =============================================================================

/**
 * Refresh a Codex access token using the stored refresh token.
 */
export async function refreshCodexToken(refreshToken: string): Promise<CodexAuthResult> {
  debugLog('Refreshing Codex access token');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  debugLog('Token refresh response', { status: response.status, ok: response.ok });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      debugLog('Token refresh error response', errorData);
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore parse errors
    }
    throw new Error(`Token refresh failed: ${errorMessage}`);
  }

  const data = await response.json() as Record<string, unknown>;
  debugLog('Token refresh success', {
    hasAccessToken: !!data.access_token,
    hasNewRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in,
  });

  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error('Token refresh response missing access_token');
  }

  // Token rotation: new refresh token may be issued; fall back to the existing one
  const newRefreshToken =
    typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken;

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  const result: CodexAuthResult = {
    accessToken: data.access_token,
    refreshToken: newRefreshToken,
    expiresAt,
    ...(typeof data.id_token === 'string' ? { email: getEmailFromIdToken(data.id_token) } : {}),
  };

  await writeStoredTokens({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_at: result.expiresAt,
  });

  return result;
}

function getEmailFromIdToken(idToken: string): string | undefined {
  const parts = idToken.split('.');
  if (parts.length !== 3) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>;
    const email = payload.email;
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * Ensure a valid Codex access token is available.
 *
 * - Returns null if no tokens are stored.
 * - If the token expires within 5 minutes, auto-refreshes.
 * - Returns the valid access token.
 */
export async function ensureValidCodexToken(tokenFilePath?: string): Promise<string | null> {
  verboseLog('Ensuring valid Codex token');
  const stored = await readStoredTokens(tokenFilePath);
  if (!stored) {
    debugLog('No stored tokens — returning null');
    return null;
  }

  const expiresIn = stored.expires_at - Date.now();
  verboseLog('Token expiry check', { expiresInMs: expiresIn, thresholdMs: REFRESH_THRESHOLD_MS });

  if (expiresIn > REFRESH_THRESHOLD_MS) {
    verboseLog('Token still valid, returning stored token');
    return stored.access_token;
  }

  // Token expired or near expiry — attempt refresh
  debugLog('Token expired or near expiry, attempting refresh');
  try {
    const refreshed = await refreshCodexToken(stored.refresh_token);
    debugLog('Token refreshed successfully');
    return refreshed.accessToken;
  } catch (err) {
    debugLog('Token refresh failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// =============================================================================
// Auth State
// =============================================================================

/**
 * Return the current Codex authentication state without refreshing.
 */
export async function getCodexAuthState(): Promise<CodexAuthState> {
  const stored = await readStoredTokens();
  if (!stored) {
    debugLog('getCodexAuthState: not authenticated');
    return { isAuthenticated: false };
  }

  const isAuthenticated = Date.now() < stored.expires_at;
  debugLog('getCodexAuthState', { isAuthenticated, expiresAt: stored.expires_at });
  return {
    isAuthenticated,
    expiresAt: stored.expires_at,
  };
}

// =============================================================================
// Clear Auth
// =============================================================================

/**
 * Delete stored Codex tokens, effectively logging the user out.
 */
export async function clearCodexAuth(): Promise<void> {
  debugLog('Clearing Codex auth tokens');
  try {
    const filePath = await getTokenFilePath();
    fs.unlinkSync(filePath);
    debugLog('Token file deleted');
  } catch {
    debugLog('No token file to delete');
    // File may not exist; non-critical
  }
}
