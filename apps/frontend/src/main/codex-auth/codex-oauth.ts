import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { app, shell } from 'electron';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const OAUTH_FLOW_TIMEOUT_MS = 30 * 60 * 1000;

export interface CodexAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  email?: string;
}

export interface CodexAuthState {
  isAuthenticated: boolean;
  expiresAt?: number;
  email?: string;
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  id_token?: string;
  email?: string;
}

function getTokenFilePath(accountId: string): string {
  return path.join(app.getPath('userData'), 'codex-auth', `${accountId}.json`);
}

function readStoredTokens(accountId: string): StoredTokens | null {
  try {
    const raw = fs.readFileSync(getTokenFilePath(accountId), 'utf8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function writeStoredTokens(accountId: string, tokens: StoredTokens): void {
  const safeTokens: StoredTokens = {
    access_token: typeof tokens.access_token === 'string' ? tokens.access_token : '',
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
    expires_at: typeof tokens.expires_at === 'number' ? tokens.expires_at : 0,
    ...(typeof tokens.id_token === 'string' ? { id_token: tokens.id_token } : {}),
    ...(typeof tokens.email === 'string' ? { email: tokens.email } : {}),
  };

  const targetPath = getTokenFilePath(accountId);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(safeTokens, null, 2), 'utf8');
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // chmod is best effort on Windows.
  }
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

function getEmailFromIdToken(idToken: string): string | undefined {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>;
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CodexAuthResult> {
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

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore malformed error bodies.
    }
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  const data = await response.json() as Record<string, unknown>;
  if (typeof data.access_token !== 'string') {
    throw new Error('Token exchange response missing access_token');
  }
  if (typeof data.refresh_token !== 'string') {
    throw new Error('Token exchange response missing refresh_token');
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    ...(typeof data.id_token === 'string' ? { idToken: data.id_token } : {}),
    ...(typeof data.id_token === 'string' ? { email: getEmailFromIdToken(data.id_token) } : {}),
  };
}

export async function refreshCodexToken(
  accountId: string,
  refreshToken: string,
  currentEmail?: string
): Promise<CodexAuthResult> {
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

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore malformed error bodies.
    }
    throw new Error(`Token refresh failed: ${errorMessage}`);
  }

  const data = await response.json() as Record<string, unknown>;
  if (typeof data.access_token !== 'string') {
    throw new Error('Token refresh response missing access_token');
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const email = typeof data.id_token === 'string' ? getEmailFromIdToken(data.id_token) : currentEmail;

  const result: CodexAuthResult = {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    ...(typeof data.id_token === 'string' ? { idToken: data.id_token } : {}),
    ...(email ? { email } : {}),
  };

  writeStoredTokens(accountId, {
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_at: result.expiresAt,
    ...(result.idToken ? { id_token: result.idToken } : {}),
    ...(result.email ? { email: result.email } : {}),
  });

  return result;
}

export async function ensureValidCodexToken(accountId: string): Promise<string | null> {
  const stored = readStoredTokens(accountId);
  if (!stored) {
    return null;
  }

  if (stored.expires_at - Date.now() > REFRESH_THRESHOLD_MS) {
    return stored.access_token;
  }

  try {
    const refreshed = await refreshCodexToken(accountId, stored.refresh_token, stored.email);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

async function ensureValidCodexTokens(accountId: string): Promise<StoredTokens | null> {
  const stored = readStoredTokens(accountId);
  if (!stored) {
    return null;
  }

  if (stored.expires_at - Date.now() > REFRESH_THRESHOLD_MS && stored.id_token) {
    return stored;
  }

  try {
    const refreshed = await refreshCodexToken(accountId, stored.refresh_token, stored.email);
    return readStoredTokens(accountId) ?? {
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expires_at: refreshed.expiresAt,
      ...(refreshed.idToken ? { id_token: refreshed.idToken } : {}),
      ...(refreshed.email ? { email: refreshed.email } : {}),
    };
  } catch {
    return null;
  }
}

function getCodexCliHomePath(accountId: string): string {
  return path.join(app.getPath('userData'), 'codex-cli-homes', accountId);
}

export async function prepareCodexCliHome(accountId: string): Promise<string> {
  const stored = await ensureValidCodexTokens(accountId);
  if (!stored?.access_token || !stored.refresh_token || !stored.id_token) {
    throw new Error('OpenAI Codex account is missing a valid OAuth session. Re-authenticate this account and try again.');
  }

  const codexHome = getCodexCliHomePath(accountId);
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(path.join(codexHome, '.tmp'), { recursive: true });

  const authPayload = {
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    OPENAI_API_KEY: null,
    tokens: {
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      id_token: stored.id_token,
    },
  };

  fs.writeFileSync(
    path.join(codexHome, 'auth.json'),
    JSON.stringify(authPayload, null, 2),
    'utf8'
  );

  return codexHome;
}

export async function getCodexAuthState(accountId: string): Promise<CodexAuthState> {
  const stored = readStoredTokens(accountId);
  if (!stored) {
    return { isAuthenticated: false };
  }

  return {
    isAuthenticated: Date.now() < stored.expires_at,
    expiresAt: stored.expires_at,
    ...(stored.email ? { email: stored.email } : {}),
  };
}

export async function clearCodexAuth(accountId: string): Promise<void> {
  try {
    fs.unlinkSync(getTokenFilePath(accountId));
  } catch {
    // File may already be gone.
  }
}

export async function startCodexOAuthFlow(accountId: string): Promise<CodexAuthResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('originator', 'auto-claude');
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true');

  return new Promise<CodexAuthResult>((resolve, reject) => {
    let server: http.Server | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (server) {
        server.close();
        server = null;
      }
    };

    const successHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication successful</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #111827; color: #f9fafb;">
  <div style="text-align: center;">
    <h2 style="color: #86efac;">Authentication successful</h2>
    <p>You can close this tab and return to Aperant.</p>
  </div>
</body>
</html>`;

    const errorHtml = (message: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication failed</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #111827; color: #f9fafb;">
  <div style="text-align: center;">
    <h2 style="color: #fca5a5;">Authentication failed</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;

    server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }

      const callbackUrl = new URL(req.url, 'http://localhost:1455');
      if (callbackUrl.pathname !== '/auth/callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      const code = callbackUrl.searchParams.get('code');
      const error = callbackUrl.searchParams.get('error');
      const errorDescription = callbackUrl.searchParams.get('error_description');
      const returnedState = callbackUrl.searchParams.get('state');

      if (error || !code) {
        const message = errorDescription ?? error ?? 'No authorization code received';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(errorHtml(message));
        cleanup();
        reject(new Error(`OAuth error: ${message}`));
        return;
      }

      if (returnedState !== state) {
        const message = 'State parameter mismatch';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(errorHtml(message));
        cleanup();
        reject(new Error(`OAuth error: ${message}`));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' }).end(successHtml);
      cleanup();

      exchangeCodeForTokens(code, codeVerifier)
        .then((result) => {
          writeStoredTokens(accountId, {
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
            expires_at: result.expiresAt,
            ...(result.idToken ? { id_token: result.idToken } : {}),
            ...(result.email ? { email: result.email } : {}),
          });
          resolve(result);
        })
        .catch(reject);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === 'EADDRINUSE') {
        reject(new Error('Port 1455 is already in use. Close the other listener and try again.'));
        return;
      }
      reject(error);
    });

    server.listen(1455, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString()).catch((error) => {
        cleanup();
        reject(new Error(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`));
      });
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('OAuth flow timed out after 30 minutes. Please try again.'));
      }, OAUTH_FLOW_TIMEOUT_MS);
    });
  });
}
