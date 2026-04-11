import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../index', () => ({
  isWindows: vi.fn(() => true),
}));

vi.mock('./powershell-runner', () => ({
  runWindowsPowerShellSync: vi.fn(() => ({
    ok: true,
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  })),
}));

import { runWindowsPowerShellSync } from './powershell-runner';
import {
  getCurrentVirtualDesktop,
  getWindowVirtualDesktopId,
  moveWindowToVirtualDesktop,
  pinWindowToAllDesktops,
} from './virtual-desktop';

describe('virtual-desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the current desktop from registry state', () => {
    vi.mocked(runWindowsPowerShellSync).mockReturnValueOnce({
      ok: true,
      stdout: JSON.stringify({
        currentDesktopId: 'desktop-2',
        desktops: [
          { id: 'desktop-1', number: 1, name: 'One', visible: false },
          { id: 'desktop-2', number: 2, name: 'Two', visible: true },
        ],
      }),
      stderr: '',
      status: 0,
      signal: null,
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    expect(getCurrentVirtualDesktop()).toEqual({
      id: 'desktop-2',
      number: 2,
      name: 'Two',
      visible: true,
    });
  });

  it('reads a window desktop id through the interop runner', () => {
    vi.mocked(runWindowsPowerShellSync).mockReturnValueOnce({
      ok: true,
      stdout: 'desktop-3',
      stderr: '',
      status: 0,
      signal: null,
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    expect(getWindowVirtualDesktopId(1234)).toBe('desktop-3');
  });

  it('returns true for move and pin interop actions when PowerShell returns true', () => {
    vi.mocked(runWindowsPowerShellSync)
      .mockReturnValueOnce({
        ok: true,
        stdout: 'true',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      })
      .mockReturnValueOnce({
        ok: true,
        stdout: 'true',
        stderr: '',
        status: 0,
        signal: null,
        powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      });

    expect(moveWindowToVirtualDesktop(1234, 'desktop-2')).toBe(true);
    expect(pinWindowToAllDesktops(1234)).toBe(true);
  });
});
