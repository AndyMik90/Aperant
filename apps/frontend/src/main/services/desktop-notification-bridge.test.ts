import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform', () => ({
  isWindows: vi.fn(() => true),
}));

vi.mock('../platform/windows/powershell-runner', () => ({
  findWindowsPowerShellPath: vi.fn(() => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
  getWindowsSafeTempDir: vi.fn(() => 'C:\\Users\\Tester\\AppData\\Local\\Temp'),
  sanitizePowerShellOutput: vi.fn((value: string) => value.trim()),
}));

vi.mock('../platform/windows/virtual-desktop', () => ({
  getCurrentVirtualDesktop: vi.fn(() => ({
    id: 'desktop-2',
    number: 2,
    name: 'Desktop 2',
    visible: true,
  })),
  resolveVirtualDesktopNotificationInteropInfo: vi.fn(() => ({
    buildNumber: 26100,
    family: 'build22000',
    virtualDesktopGuid: '536d3495-b208-4cc9-ae26-de8111275bf8',
    notificationGuid: 'cd403e52-deed-4c13-b437-b98380f2b1e8',
    notificationServiceGuid: '0cd45e71-d927-4f15-8b0a-8fef525337bf',
  })),
}));

import { DesktopNotificationBridge } from './desktop-notification-bridge';

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

describe('desktop-notification-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a ready event and enriches it with the current desktop snapshot', () => {
    const bridge = new DesktopNotificationBridge();
    const states: Array<ReturnType<DesktopNotificationBridge['getState']>> = [];
    const events: Array<Parameters<Parameters<DesktopNotificationBridge['onEvent']>[0]>[0]> = [];

    bridge.onStateChange((state) => {
      states.push(state);
    });
    bridge.onEvent((event) => {
      events.push(event);
    });

    (bridge as any).updateState({
      supported: true,
      running: true,
      healthy: false,
      buildNumber: 26100,
      family: 'build22000',
    });
    (bridge as any).handleStdoutLine(`ready|${encode('4321')}`);

    expect(events.at(-1)).toEqual({
      type: 'ready',
      explorerPid: 4321,
      buildNumber: 26100,
      family: 'build22000',
      currentDesktop: {
        id: 'desktop-2',
        number: 2,
        name: 'Desktop 2',
        visible: true,
      },
      currentDesktopId: 'desktop-2',
    });
    expect(states.at(-1)).toMatchObject({
      running: true,
      healthy: true,
      buildNumber: 26100,
      family: 'build22000',
    });
  });

  it('parses desktop-change, disconnected, and malformed output paths', () => {
    const bridge = new DesktopNotificationBridge();
    const events: Array<Parameters<Parameters<DesktopNotificationBridge['onEvent']>[0]>[0]> = [];

    bridge.onEvent((event) => {
      events.push(event);
    });

    (bridge as any).handleStdoutLine(
      `current-desktop-changed|${encode('desktop-1')}|${encode('desktop-2')}`
    );
    (bridge as any).handleStdoutLine(`disconnected|${encode('explorer-restarted')}`);
    (bridge as any).handleStdoutLine('unknown-event');

    expect(events[0]).toMatchObject({
      type: 'current-desktop-changed',
      oldDesktopId: 'desktop-1',
      newDesktopId: 'desktop-2',
      currentDesktopId: 'desktop-2',
    });
    expect(events[1]).toEqual({
      type: 'disconnected',
      reason: 'explorer-restarted',
    });
    expect(events[2]).toEqual({
      type: 'error',
      message: 'Failed to parse desktop bridge output: unknown event "unknown-event"',
    });
  });
});
