import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../index', () => ({
  isWindows: vi.fn(() => true),
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({
    status: 0,
    signal: null,
    stdout: 'ok',
    stderr: '',
  })),
  execFile: vi.fn((_: string, __: string[], ___: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, 'async-ok', '');
  }),
}));

import { execFile, spawnSync } from 'child_process';
import {
  resolveWindowsSafeTempDir,
  runWindowsPowerShell,
  runWindowsPowerShellSync,
  sanitizePowerShellOutput,
} from './powershell-runner';

describe('powershell-runner', () => {
  const tempRoot = join(process.cwd(), '.tmp-powershell-runner-tests');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      if (existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup only.
    }
  });

  it('prefers LOCALAPPDATA Temp even when TEMP and TMP point to C:\\Windows\\TEMP', () => {
    const resolved = resolveWindowsSafeTempDir({
      LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\Tester',
      TEMP: 'C:\\Windows\\TEMP',
      TMP: 'C:\\Windows\\TEMP',
    });

    expect(resolved).toBe('C:\\Users\\Tester\\AppData\\Local\\Temp');
  });

  it('falls back to USERPROFILE\\AppData\\Local\\Temp when LOCALAPPDATA is missing', () => {
    const resolved = resolveWindowsSafeTempDir({
      USERPROFILE: 'C:\\Users\\Tester',
      TEMP: 'C:\\Windows\\TEMP',
      TMP: 'C:\\Windows\\TEMP',
    });

    expect(resolved).toBe('C:\\Users\\Tester\\AppData\\Local\\Temp');
  });

  it('sanitizes CLIXML progress noise and preserves error text', () => {
    const sanitized = sanitizePowerShellOutput(
      '#< CLIXML\n<Objs><S S="Error">Add-Type failed_x000D__x000A_</S><Obj S="progress" RefId="0"></Obj></Objs>'
    );

    expect(sanitized).toBe('Add-Type failed');
  });

  it('overrides child TEMP variables in encoded mode', () => {
    runWindowsPowerShellSync({
      script: 'Write-Output "ok"',
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      env: {
        LOCALAPPDATA: tempRoot,
        USERPROFILE: tempRoot,
        TEMP: 'C:\\Windows\\TEMP',
        TMP: 'C:\\Windows\\TEMP',
      },
    });

    const [, args, options] = vi.mocked(spawnSync).mock.calls[0];
    expect(args).toContain('-EncodedCommand');
    expect(options?.env?.TEMP).toBe(join(tempRoot, 'Temp'));
    expect(options?.env?.TMP).toBe(join(tempRoot, 'Temp'));
    expect(options?.env?.TMPDIR).toBe(join(tempRoot, 'Temp'));
  });

  it('uses file mode with a safe temp script path', () => {
    runWindowsPowerShellSync({
      script: 'Write-Output "ok"',
      mode: 'file',
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      env: {
        LOCALAPPDATA: tempRoot,
        USERPROFILE: tempRoot,
      },
    });

    const [, args] = vi.mocked(spawnSync).mock.calls[0];
    const fileFlagIndex = args.indexOf('-File');
    const scriptPath = args[fileFlagIndex + 1];

    expect(fileFlagIndex).toBeGreaterThanOrEqual(0);
    expect(scriptPath.startsWith(join(tempRoot, 'Temp'))).toBe(true);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('uses the same safe env overrides in async file mode', async () => {
    await runWindowsPowerShell({
      script: 'Write-Output "ok"',
      mode: 'file',
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      env: {
        LOCALAPPDATA: tempRoot,
        USERPROFILE: tempRoot,
      },
    });

    const [, args, options] = vi.mocked(execFile).mock.calls[0];
    expect(args).toContain('-File');
    expect(options?.env?.TEMP).toBe(join(tempRoot, 'Temp'));
    expect(options?.env?.TMP).toBe(join(tempRoot, 'Temp'));
  });
});
