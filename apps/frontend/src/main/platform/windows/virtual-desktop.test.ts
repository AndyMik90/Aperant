import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('os', () => ({
  release: vi.fn(() => '10.0.26100'),
}));

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
import { release as osRelease } from 'os';
import {
  getCurrentVirtualDesktop,
  getWindowVirtualDesktopId,
  moveWindowToVirtualDesktop,
  pinWindowToAllDesktops,
  resolveVirtualDesktopNotificationInteropInfo,
} from './virtual-desktop';

describe('virtual-desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(osRelease).mockReturnValue('10.0.26100');
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

  it('resolves Windows 11 24H2 notification interop metadata without a PowerShell registry crawl', () => {
    expect(resolveVirtualDesktopNotificationInteropInfo()).toEqual({
      buildNumber: 26100,
      family: 'build22621',
      virtualDesktopGuid: '3f07f4be-b107-441a-af0f-39d82529072c',
      notificationGuid: 'b9e5e94d-233e-49ab-af5c-2b4541c3aade',
      notificationServiceGuid: '0cd45e71-d927-4f15-8b0a-8fef525337bf',
    });
    expect(runWindowsPowerShellSync).not.toHaveBeenCalled();
  });

  it('resolves Windows 10 notification interop metadata from the build number', () => {
    vi.mocked(osRelease).mockReturnValue('10.0.19045');

    expect(resolveVirtualDesktopNotificationInteropInfo()).toEqual({
      buildNumber: 19045,
      family: 'build10240',
      virtualDesktopGuid: 'ff72ffdd-be7e-43fc-9c03-ad81681e88e4',
      notificationGuid: 'c179334c-4295-40d3-bea1-c654d965605a',
      notificationServiceGuid: '0cd45e71-d927-4f15-8b0a-8fef525337bf',
    });
    expect(runWindowsPowerShellSync).not.toHaveBeenCalled();
  });

  it('falls back to a fast registry build lookup when os.release is unusable', () => {
    vi.mocked(osRelease).mockReturnValue('invalid');
    vi.mocked(runWindowsPowerShellSync).mockReturnValueOnce({
      ok: true,
      stdout: JSON.stringify({
        buildNumber: 26100,
      }),
      stderr: '',
      status: 0,
      signal: null,
      powerShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });

    expect(resolveVirtualDesktopNotificationInteropInfo()).toEqual({
      buildNumber: 26100,
      family: 'build22621',
      virtualDesktopGuid: '3f07f4be-b107-441a-af0f-39d82529072c',
      notificationGuid: 'b9e5e94d-233e-49ab-af5c-2b4541c3aade',
      notificationServiceGuid: '0cd45e71-d927-4f15-8b0a-8fef525337bf',
    });
    expect(runWindowsPowerShellSync).toHaveBeenCalledTimes(1);
  });
});
