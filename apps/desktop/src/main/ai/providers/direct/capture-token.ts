/**
 * DeepSeek Token Capture
 * =====================
 *
 * Runs the bundled `extract-ai-token.mjs` (Playwright) from ai-providers-direct
 * to obtain a DeepSeek web token without the user leaving the app.
 *
 * Two-phase flow, matching the script's contract:
 *   1. Headless run — if a signed-in browser profile already exists, the token
 *      is captured immediately.
 *   2. If not logged in, a HEADED run opens a Chrome window for the user to sign
 *      in (the session is persisted to a profile), then a final headless run
 *      captures the token.
 *
 * Runtime requirements (honest caveats):
 *   - `playwright` must be resolvable at runtime (present via the app's
 *     dev dependency in `npm run dev`; not bundled in packaged builds).
 *   - A Chromium/Chrome binary must be installed (`npx playwright install chrome`).
 * Failures surface as a structured `{ success: false, error, code }`.
 *
 * Isolation: the persistent Chrome profile and token `.env` are written under
 * Electron's userData dir (via AI_PROVIDERS_* env overrides), never the cwd.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { app } from 'electron';

export interface CaptureTokenResult {
  success: boolean;
  token?: string;
  verifiedAs?: string;
  error?: string;
  code?: string;
}

const HEADLESS_TIMEOUT_MS = 90_000;
const HEADED_TIMEOUT_MS = 240_000; // allow time for the user to sign in

/** Spawn the extractor script once and parse its single JSON result line. */
function runExtractor(
  scriptPath: string,
  headed: boolean,
  consumerRoot: string,
): Promise<CaptureTokenResult> {
  return new Promise((resolve) => {
    const args = [scriptPath];
    if (headed) args.push('--headed');

    // Run Electron's own binary as plain Node (ELECTRON_RUN_AS_NODE) so we don't
    // depend on a separate `node` being on PATH in packaged apps.
    const child = spawn(process.execPath, args, {
      cwd: consumerRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AI_PROVIDERS_CONSUMER_ROOT: consumerRoot,
        AI_PROVIDERS_DIRECT_ENV: join(consumerRoot, '.deepseek.env'),
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(
      () => {
        child.kill('SIGTERM');
        resolve({ success: false, error: 'Token capture timed out', code: 'TIMEOUT' });
      },
      headed ? HEADED_TIMEOUT_MS : HEADLESS_TIMEOUT_MS,
    );

    child.on('close', () => {
      clearTimeout(timer);
      // The script prints exactly one JSON line to stdout; take the last line.
      const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      if (!line) {
        resolve({
          success: false,
          error: stderr.slice(0, 400) || 'Token capture produced no output',
          code: 'NO_OUTPUT',
        });
        return;
      }
      try {
        resolve(JSON.parse(line) as CaptureTokenResult);
      } catch {
        resolve({ success: false, error: `Unexpected output: ${line.slice(0, 200)}`, code: 'PARSE_ERROR' });
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ success: false, error: `Failed to launch token capture: ${err.message}`, code: 'SPAWN_ERROR' });
    });
  });
}

/** True when a result indicates the persistent browser session isn't signed in. */
function isNotLoggedIn(result: CaptureTokenResult): boolean {
  return result.code === 'NOT_LOGGED_IN' || /not logged in/i.test(result.error ?? '');
}

/**
 * Capture a DeepSeek web token. Tries headless first; if no signed-in session
 * exists, opens a headed window for sign-in then captures headlessly.
 */
export async function captureDeepSeekToken(): Promise<CaptureTokenResult> {
  let scriptPath: string;
  try {
    const { deepseek } = await import('ai-providers-direct');
    scriptPath = deepseek.getScriptPath();
  } catch (err) {
    return {
      success: false,
      error: `ai-providers-direct is unavailable: ${(err as Error).message}`,
      code: 'LIBRARY_MISSING',
    };
  }

  const consumerRoot = app.getPath('userData');

  // 1) Fast path: capture from an existing signed-in session.
  let result = await runExtractor(scriptPath, false, consumerRoot);
  if (result.success) return result;

  // 2) Need sign-in → open a headed window, then 3) capture headlessly.
  if (isNotLoggedIn(result)) {
    await runExtractor(scriptPath, true, consumerRoot);
    result = await runExtractor(scriptPath, false, consumerRoot);
  }

  return result;
}
