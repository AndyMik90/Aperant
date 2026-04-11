import { execFile, spawnSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isWindows } from '../index';

export type WindowsPowerShellMode = 'encoded' | 'file';

export interface WindowsPowerShellOptions {
  script: string;
  timeoutMs?: number;
  mode?: WindowsPowerShellMode;
  env?: NodeJS.ProcessEnv;
  powerShellPath?: string;
  scriptPath?: string;
}

export interface WindowsPowerShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  powerShellPath: string | null;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function decodeCliXmlFragment(fragment: string): string {
  return fragment
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/_x000D_/g, '\r')
    .replace(/_x000A_/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function sanitizePowerShellOutput(text: string | null | undefined): string {
  const raw = text?.replace(/^\uFEFF/, '').trim() ?? '';
  if (!raw) {
    return '';
  }

  if (!raw.includes('CLIXML') && !raw.includes('<Objs Version=')) {
    return raw;
  }

  const errorMatches = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((match) => decodeCliXmlFragment(match[1]).trim())
    .filter(Boolean);

  if (errorMatches.length > 0) {
    return errorMatches.join('\n').trim();
  }

  return '';
}

export function findWindowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidatePaths = [
    join(env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'pwsh.exe'),
    join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];

  try {
    for (const candidate of candidatePaths) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall through to null if fs import somehow fails.
  }

  return null;
}

export function resolveWindowsSafeTempDir(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Temp') : null,
    env.USERPROFILE ? join(env.USERPROFILE, 'AppData', 'Local', 'Temp') : null,
    join(homedir(), 'AppData', 'Local', 'Temp'),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)][0];
}

export function ensureWindowsSafeTempDir(env: NodeJS.ProcessEnv = process.env): string {
  const tempDir = resolveWindowsSafeTempDir(env);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function getWindowsSafeTempDir(env: NodeJS.ProcessEnv = process.env): string {
  return ensureWindowsSafeTempDir(env);
}

function buildWindowsPowerShellEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safeTempDir = ensureWindowsSafeTempDir(baseEnv);
  return {
    ...baseEnv,
    TEMP: safeTempDir,
    TMP: safeTempDir,
    TMPDIR: safeTempDir,
  };
}

function withRunnerDefaults(script: string): string {
  return `$ProgressPreference = 'SilentlyContinue'\n${script.trim()}\n`;
}

function createTempScriptPath(env: NodeJS.ProcessEnv = process.env): string {
  const tempDir = ensureWindowsSafeTempDir(env);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return join(tempDir, `aperant-powershell-${token}.ps1`);
}

function prepareCommand(
  options: WindowsPowerShellOptions
): { powerShellPath: string | null; args: string[]; env: NodeJS.ProcessEnv; scriptPath: string | null } {
  const baseEnv = options.env ?? process.env;
  const powerShellPath = options.powerShellPath ?? findWindowsPowerShellPath(baseEnv);
  if (!powerShellPath) {
    return {
      powerShellPath: null,
      args: [],
      env: buildWindowsPowerShellEnv(baseEnv),
      scriptPath: null,
    };
  }

  const env = buildWindowsPowerShellEnv(baseEnv);
  const preparedScript = withRunnerDefaults(options.script);
  const mode = options.mode ?? 'encoded';

  if (mode === 'file') {
    const scriptPath = options.scriptPath ?? createTempScriptPath(baseEnv);
    writeFileSync(scriptPath, `\uFEFF${preparedScript}`, 'utf8');
    return {
      powerShellPath,
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      env,
      scriptPath,
    };
  }

  return {
    powerShellPath,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(preparedScript)],
    env,
    scriptPath: null,
  };
}

function cleanupTempScript(scriptPath: string | null): void {
  if (!scriptPath) {
    return;
  }

  try {
    unlinkSync(scriptPath);
  } catch {
    // Best effort cleanup only.
  }
}

export function runWindowsPowerShellSync(options: WindowsPowerShellOptions): WindowsPowerShellResult {
  if (!isWindows()) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Windows PowerShell helpers are only available on Windows.',
      status: null,
      signal: null,
      powerShellPath: null,
    };
  }

  let command;
  try {
    command = prepareCommand(options);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: '',
      stderr: errorMessage,
      status: null,
      signal: null,
      powerShellPath: null,
    };
  }

  const { powerShellPath, args, env, scriptPath } = command;
  if (!powerShellPath) {
    cleanupTempScript(scriptPath);
    return {
      ok: false,
      stdout: '',
      stderr: 'PowerShell not found',
      status: null,
      signal: null,
      powerShellPath: null,
    };
  }

  try {
    const result = spawnSync(powerShellPath, args, {
      windowsHide: true,
      timeout: options.timeoutMs ?? 8000,
      encoding: 'utf8',
      env,
    });

    const stdout = sanitizePowerShellOutput(result.stdout);
    const stderr = sanitizePowerShellOutput(result.stderr);
    const fallbackError = result.error?.message ?? (result.status === 0 ? '' : `PowerShell exited with status ${result.status ?? 'unknown'}`);

    return {
      ok: !result.error && result.status === 0,
      stdout,
      stderr: stderr || fallbackError,
      status: result.status,
      signal: result.signal,
      powerShellPath,
    };
  } finally {
    cleanupTempScript(scriptPath);
  }
}

export function runWindowsPowerShell(options: WindowsPowerShellOptions): Promise<WindowsPowerShellResult> {
  if (!isWindows()) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: 'Windows PowerShell helpers are only available on Windows.',
      status: null,
      signal: null,
      powerShellPath: null,
    });
  }

  let command;
  try {
    command = prepareCommand(options);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: errorMessage,
      status: null,
      signal: null,
      powerShellPath: null,
    });
  }

  const { powerShellPath, args, env, scriptPath } = command;
  if (!powerShellPath) {
    cleanupTempScript(scriptPath);
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: 'PowerShell not found',
      status: null,
      signal: null,
      powerShellPath: null,
    });
  }

  return new Promise((resolve) => {
    execFile(
      powerShellPath,
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs ?? 8000,
        encoding: 'utf8',
        env,
      },
      (error, stdout, stderr) => {
        cleanupTempScript(scriptPath);
        const sanitizedStdout = sanitizePowerShellOutput(stdout);
        const sanitizedStderr = sanitizePowerShellOutput(stderr);
        resolve({
          ok: !error,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr || error?.message || '',
          status: error && typeof error.code === 'number' ? error.code : 0,
          signal: error?.signal ?? null,
          powerShellPath,
        });
      }
    );
  });
}
