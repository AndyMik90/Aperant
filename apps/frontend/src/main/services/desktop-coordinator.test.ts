import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadSettingsFile,
  mockWriteSettingsFile,
  mockGetCurrentVirtualDesktop,
  mockGetVirtualDesktopAvailability,
  mockPinWindowToAllDesktops,
  mockUnpinWindowFromAllDesktops,
  mockIsWindowPinnedToAllDesktops,
  mockMoveWindowToVirtualDesktop,
  mockProjectStore,
  bridgeListeners,
} = vi.hoisted(() => ({
  mockReadSettingsFile: vi.fn(),
  mockWriteSettingsFile: vi.fn(),
  mockGetCurrentVirtualDesktop: vi.fn(),
  mockGetVirtualDesktopAvailability: vi.fn(),
  mockPinWindowToAllDesktops: vi.fn(() => true),
  mockUnpinWindowFromAllDesktops: vi.fn(() => true),
  mockIsWindowPinnedToAllDesktops: vi.fn(() => false),
  mockMoveWindowToVirtualDesktop: vi.fn(() => true),
  mockProjectStore: {
    getTabState: vi.fn(() => ({
      activeProjectId: 'project-1',
    })),
    getProject: vi.fn(() => ({ id: 'project-1' })),
  },
  bridgeListeners: {
    state: null as null | ((state: {
      supported: boolean;
      running: boolean;
      healthy: boolean;
      error?: string;
      family?: 'build10240' | 'build22000' | null;
      buildNumber?: number | null;
    }) => void),
    event: null as null | ((event: {
      type: string;
      currentDesktop?: {
        id: string;
        number?: number | null;
        name?: string | null;
        visible?: boolean | null;
      } | null;
      currentDesktopId?: string | null;
      newDesktopId?: string | null;
    }) => void),
  },
}));

vi.mock('../../shared/constants', () => ({
  DEFAULT_APP_SETTINGS: {
    desktopAgnosticPinEnabled: false,
    desktopProjectAssociations: [],
  },
  IPC_CHANNELS: {
    DESKTOP_PROJECT_ACTIVATE: 'desktop:project:activate',
    DESKTOP_STATE_CHANGED: 'desktop:state:changed',
  },
}));

vi.mock('../platform', () => ({
  isWindows: vi.fn(() => true),
}));

vi.mock('../settings-utils', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile,
}));

vi.mock('../project-store', () => ({
  projectStore: mockProjectStore,
}));

vi.mock('../platform/windows/virtual-desktop', () => ({
  getCurrentVirtualDesktop: mockGetCurrentVirtualDesktop,
  getVirtualDesktopAvailability: mockGetVirtualDesktopAvailability,
  isWindowPinnedToAllDesktops: mockIsWindowPinnedToAllDesktops,
  moveWindowToVirtualDesktop: mockMoveWindowToVirtualDesktop,
  pinWindowToAllDesktops: mockPinWindowToAllDesktops,
  unpinWindowFromAllDesktops: mockUnpinWindowFromAllDesktops,
}));

vi.mock('./desktop-notification-bridge', () => ({
  desktopNotificationBridge: {
    getState: vi.fn(() => ({
      supported: true,
      running: false,
      healthy: false,
      family: null,
      buildNumber: null,
    })),
    start: vi.fn(() => ({
      supported: true,
      running: true,
      healthy: false,
      family: 'build22000',
      buildNumber: 26100,
    })),
    onStateChange: vi.fn((listener: typeof bridgeListeners.state) => {
      bridgeListeners.state = listener;
    }),
    onEvent: vi.fn((listener: typeof bridgeListeners.event) => {
      bridgeListeners.event = listener;
    }),
  },
}));

import { DesktopCoordinator } from './desktop-coordinator';

describe('desktop-coordinator', () => {
  const setIntervalSpy = vi.spyOn(global, 'setInterval');
  const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeListeners.state = null;
    bridgeListeners.event = null;

    mockReadSettingsFile.mockReturnValue({
      desktopAgnosticPinEnabled: true,
      desktopProjectAssociations: [
        {
          desktopId: 'desktop-2',
          projectId: 'project-1',
          updatedAt: '2026-04-12T00:00:00.000Z',
          source: 'ui',
        },
      ],
    });

    mockGetVirtualDesktopAvailability.mockReturnValue({ available: true });
    mockGetCurrentVirtualDesktop.mockReturnValue({
      id: 'desktop-1',
      number: 1,
      name: 'Desktop 1',
      visible: true,
    });

    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      return setTimeout(handler, 1) as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval);
    clearIntervalSpy.mockImplementation(((id: ReturnType<typeof setInterval>) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    }) as unknown as typeof clearInterval);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('starts fallback polling when notifications are unhealthy and stops it after bridge recovery', () => {
    const coordinator = new DesktopCoordinator();
    const sentMessages: Array<{ channel: string; payload: unknown }> = [];
    const window = {
      on: vi.fn(),
      isFullScreen: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      getNativeWindowHandle: vi.fn(() => Buffer.alloc(8)),
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn((channel: string, payload: unknown) => {
          sentMessages.push({ channel, payload });
        }),
      },
    };

    coordinator.setMainWindowGetter(() => window as never);
    coordinator.attachToWindow(window as never);

    expect(setIntervalSpy).toHaveBeenCalled();

    bridgeListeners.state?.({
      supported: true,
      running: true,
      healthy: true,
      family: 'build22000',
      buildNumber: 26100,
    });

    expect(clearIntervalSpy).toHaveBeenCalled();

    bridgeListeners.event?.({
      type: 'current-desktop-changed',
      currentDesktop: {
        id: 'desktop-2',
        number: 2,
        name: 'Desktop 2',
        visible: true,
      },
      currentDesktopId: 'desktop-2',
      newDesktopId: 'desktop-2',
    });

    expect(sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'desktop:state:changed' }),
        expect.objectContaining({
          channel: 'desktop:project:activate',
          payload: {
            projectId: 'project-1',
            desktopId: 'desktop-2',
            reason: 'desktop-change',
          },
        }),
      ])
    );
  });
});
