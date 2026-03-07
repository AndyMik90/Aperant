/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Profile Swap Notifications Hook
 *
 * Tests notification batching, toast display, and event subscriptions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfileSwapNotifications, useSessionCaptureListener } from './use-profile-swap-notifications';
import type { QueueProfileSwapEvent, } from '../../preload/api/queue-api';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return options.defaultValue;
      return key;
    }
  })
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('./use-toast', () => ({
  toast: (props: unknown) => mockToast(props)
}));

// Setup mock electronAPI
const mockOnQueueProfileSwapped = vi.fn();
const mockOnQueueBlockedNoProfiles = vi.fn();
const mockOnQueueSessionCaptured = vi.fn();

describe('useProfileSwapNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup window.electronAPI mock
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      queue: {
        onQueueProfileSwapped: mockOnQueueProfileSwapped.mockReturnValue(() => {}),
        onQueueBlockedNoProfiles: mockOnQueueBlockedNoProfiles.mockReturnValue(() => {}),
        onQueueSessionCaptured: mockOnQueueSessionCaptured.mockReturnValue(() => {})
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  describe('subscription', () => {
    it('should subscribe to profile swap events on mount', () => {
      renderHook(() => useProfileSwapNotifications());

      expect(mockOnQueueProfileSwapped).toHaveBeenCalledTimes(1);
      expect(mockOnQueueBlockedNoProfiles).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe on unmount', () => {
      const unsubSwap = vi.fn();
      const unsubBlocked = vi.fn();
      mockOnQueueProfileSwapped.mockReturnValue(unsubSwap);
      mockOnQueueBlockedNoProfiles.mockReturnValue(unsubBlocked);

      const { unmount } = renderHook(() => useProfileSwapNotifications());
      unmount();

      expect(unsubSwap).toHaveBeenCalled();
      expect(unsubBlocked).toHaveBeenCalled();
    });

    it('should not subscribe when electronAPI is not available', () => {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;

      renderHook(() => useProfileSwapNotifications());

      expect(mockOnQueueProfileSwapped).not.toHaveBeenCalled();
    });
  });

  describe('single swap notification', () => {
    it('should show detailed notification for single swap', () => {
      let swapCallback: ((event: QueueProfileSwapEvent) => void) | undefined;
      mockOnQueueProfileSwapped.mockImplementation((cb) => {
        swapCallback = cb;
        return () => {};
      });

      renderHook(() => useProfileSwapNotifications());

      const swapEvent: QueueProfileSwapEvent = {
        taskId: 'task-1',
        swap: {
          fromProfileId: 'profile-1',
          fromProfileName: 'Profile 1',
          toProfileId: 'profile-2',
          toProfileName: 'Profile 2',
          swappedAt: new Date().toISOString(),
          reason: 'rate_limit',
          sessionResumed: false
        }
      };

      act(() => {
        swapCallback?.(swapEvent);
      });

      // Advance timer to trigger batch processing
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Profile Swapped',
          duration: 5000
        })
      );
    });
  });

  describe('batched notifications', () => {
    it('should batch multiple swap events within window', () => {
      let swapCallback: ((event: QueueProfileSwapEvent) => void) | undefined;
      mockOnQueueProfileSwapped.mockImplementation((cb) => {
        swapCallback = cb;
        return () => {};
      });

      renderHook(() => useProfileSwapNotifications());

      const createSwapEvent = (taskId: string, toProfile: string): QueueProfileSwapEvent => ({
        taskId,
        swap: {
          fromProfileId: 'profile-1',
          fromProfileName: 'Profile 1',
          toProfileId: toProfile,
          toProfileName: `Profile ${toProfile}`,
          swappedAt: new Date().toISOString(),
          reason: 'capacity',
          sessionResumed: false
        }
      });

      // Trigger multiple swaps
      act(() => {
        swapCallback?.(createSwapEvent('task-1', 'p2'));
        swapCallback?.(createSwapEvent('task-2', 'p2'));
        swapCallback?.(createSwapEvent('task-3', 'p3'));
      });

      // Should not show toast yet
      expect(mockToast).not.toHaveBeenCalled();

      // Advance timer to trigger batch processing
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Should show batch notification
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('3 Profile Swaps')
        })
      );
    });

    it('should limit notifications to max per batch', () => {
      let swapCallback: ((event: QueueProfileSwapEvent) => void) | undefined;
      mockOnQueueProfileSwapped.mockImplementation((cb) => {
        swapCallback = cb;
        return () => {};
      });

      renderHook(() => useProfileSwapNotifications());

      const createSwapEvent = (taskId: string): QueueProfileSwapEvent => ({
        taskId,
        swap: {
          fromProfileId: 'profile-1',
          fromProfileName: 'Profile 1',
          toProfileId: 'profile-2',
          toProfileName: 'Profile 2',
          swappedAt: new Date().toISOString(),
          reason: 'rate_limit',
          sessionResumed: false
        }
      });

      // Trigger 7 swaps (more than MAX_NOTIFICATIONS_PER_BATCH = 5)
      act(() => {
        for (let i = 0; i < 7; i++) {
          swapCallback?.(createSwapEvent(`task-${i}`));
        }
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Should only show one batched notification
      expect(mockToast).toHaveBeenCalledTimes(1);
    });
  });

  describe('queue blocked notification', () => {
    it('should show destructive toast for queue blocked', () => {
      let blockedCallback: ((info: { reason: string; timestamp: string }) => void) | undefined;
      mockOnQueueBlockedNoProfiles.mockImplementation((cb) => {
        blockedCallback = cb;
        return () => {};
      });

      renderHook(() => useProfileSwapNotifications());

      act(() => {
        blockedCallback?.({
          reason: 'all_rate_limited',
          timestamp: new Date().toISOString()
        });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Queue Blocked',
          variant: 'destructive',
          duration: 8000
        })
      );
    });
  });

  describe('cleanup', () => {
    it('should clear pending timeout on unmount', () => {
      let swapCallback: ((event: QueueProfileSwapEvent) => void) | undefined;
      mockOnQueueProfileSwapped.mockImplementation((cb) => {
        swapCallback = cb;
        return () => {};
      });

      const { unmount } = renderHook(() => useProfileSwapNotifications());

      // Trigger a swap to start the batch timeout
      act(() => {
        swapCallback?.({
          taskId: 'task-1',
          swap: {
            fromProfileId: 'p1',
            fromProfileName: 'Profile 1',
            toProfileId: 'p2',
            toProfileName: 'Profile 2',
            swappedAt: new Date().toISOString(),
            reason: 'rate_limit',
            sessionResumed: false
          }
        });
      });

      // Unmount before timeout fires
      unmount();

      // Advance timer - should not cause errors or show toast
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockToast).not.toHaveBeenCalled();
    });
  });
});

describe('useSessionCaptureListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      queue: {
        onQueueSessionCaptured: mockOnQueueSessionCaptured.mockReturnValue(() => {})
      }
    };
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('should subscribe when callback provided', () => {
    const callback = vi.fn();
    renderHook(() => useSessionCaptureListener(callback));

    expect(mockOnQueueSessionCaptured).toHaveBeenCalledWith(callback);
  });

  it('should not subscribe when callback is undefined', () => {
    renderHook(() => useSessionCaptureListener(undefined));

    expect(mockOnQueueSessionCaptured).not.toHaveBeenCalled();
  });

  it('should not subscribe when electronAPI is not available', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const callback = vi.fn();

    renderHook(() => useSessionCaptureListener(callback));

    expect(mockOnQueueSessionCaptured).not.toHaveBeenCalled();
  });

  it('should unsubscribe on unmount', () => {
    const unsubscribe = vi.fn();
    mockOnQueueSessionCaptured.mockReturnValue(unsubscribe);

    const callback = vi.fn();
    const { unmount } = renderHook(() => useSessionCaptureListener(callback));
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
