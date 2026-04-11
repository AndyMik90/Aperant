import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../index', () => ({
  isWindows: vi.fn(() => true),
}));

vi.mock('./powershell-runner', () => ({
  getWindowsSafeTempDir: vi.fn(() => join(process.cwd(), '.tmp-window-manager-tests')),
  runWindowsPowerShellSync: vi.fn(() => ({
    ok: true,
    stdout: '[]',
    stderr: '',
    status: 0,
    signal: null,
    powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  })),
  runWindowsPowerShell: vi.fn(async () => ({
    ok: true,
    stdout: 'Message sent successfully',
    stderr: '',
    status: 0,
    signal: null,
    powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  })),
}));

import { runWindowsPowerShell, runWindowsPowerShellSync } from './powershell-runner';
import { getVSCodeWindows, sendMessageToWindow } from './window-manager';

describe('window-manager', () => {
  const tempRoot = join(process.cwd(), '.tmp-window-manager-tests');

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(tempRoot, { recursive: true });
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

  it('parses VS Code windows from PowerShell JSON output', () => {
    vi.mocked(runWindowsPowerShellSync).mockReturnValueOnce({
      ok: true,
      stdout: '[{"handle":100,"title":"Repo - Visual Studio Code","processId":999}]',
      stderr: '',
      status: 0,
      signal: null,
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    expect(getVSCodeWindows()).toEqual([
      { handle: 100, title: 'Repo - Visual Studio Code', processId: 999 },
    ]);
  });

  it('returns success when the window message PowerShell script succeeds', async () => {
    vi.mocked(runWindowsPowerShellSync)
      .mockReturnValueOnce({
        ok: true,
        stdout: '[{"handle":200,"title":"Repo - Visual Studio Code","processId":1234}]',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      })
      .mockReturnValueOnce({
        ok: true,
        stdout: '[{"handle":200,"title":"Repo - Visual Studio Code","processId":1234}]',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      });

    const result = await sendMessageToWindow(1234, 'hello from RDR');

    expect(result).toEqual({ success: true });
    expect(vi.mocked(runWindowsPowerShell)).toHaveBeenCalledTimes(1);
  });

  it('returns the PowerShell error when window messaging fails', async () => {
    vi.mocked(runWindowsPowerShellSync)
      .mockReturnValueOnce({
        ok: true,
        stdout: '[{"handle":200,"title":"Repo - Visual Studio Code","processId":1234}]',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      })
      .mockReturnValueOnce({
        ok: true,
        stdout: '[{"handle":200,"title":"Repo - Visual Studio Code","processId":1234}]',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      });
    vi.mocked(runWindowsPowerShell).mockResolvedValueOnce({
      ok: false,
      stdout: '',
      stderr: 'Failed to focus window',
      status: 1,
      signal: null,
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    const result = await sendMessageToWindow(1234, 'hello from RDR');

    expect(result).toEqual({ success: false, error: 'Failed to focus window' });
  });
});
