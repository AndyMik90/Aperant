/**
 * Profile Swap Notifications Hook
 *
 * Listens for profile swap events from the queue routing system
 * and displays toast notifications to inform the user.
 *
 * Part of the intelligent rate limit recovery system (Phase 7: Queue UX Enhancements).
 */

import { useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from './use-toast';
import type { QueueProfileSwapEvent, QueueSessionCapturedEvent } from '../../preload/api/queue-api';

/**
 * Notification batching to prevent toast spam
 * Batches notifications within a 2-second window
 */
interface NotificationQueue {
  swaps: QueueProfileSwapEvent[];
  blocked: { reason: string; timestamp: string }[];
  timeoutId: NodeJS.Timeout | null;
}

const BATCH_WINDOW_MS = 2000;
const MAX_NOTIFICATIONS_PER_BATCH = 5;

/**
 * Toast notification durations (milliseconds)
 */
const TOAST_DURATION_SWAP_MS = 5000; // Single swap or batch swap notification
const TOAST_DURATION_BLOCKED_MS = 8000; // Queue blocked notification (longer for critical alerts)

/**
 * Hook to display toast notifications for profile swap events
 *
 * Automatically subscribes to:
 * - Profile swap events (rate limit recovery)
 * - Queue blocked events (no profiles available)
 *
 * Batches notifications to avoid toast spam when multiple events occur.
 */
export function useProfileSwapNotifications() {
  const { t } = useTranslation(['tasks']);
  const queueRef = useRef<NotificationQueue>({
    swaps: [],
    blocked: [],
    timeoutId: null,
  });

  /**
   * Process and display batched notifications
   */
  const processBatch = useCallback(() => {
    const queue = queueRef.current;
    queue.timeoutId = null;

    // Process swap notifications
    if (queue.swaps.length > 0) {
      const swapsToShow = queue.swaps.slice(0, MAX_NOTIFICATIONS_PER_BATCH);
      const remainingSwaps = queue.swaps.length - swapsToShow.length;

      if (swapsToShow.length === 1) {
        // Single swap - show detailed notification
        const swap = swapsToShow[0].swap;
        toast({
          title: t('tasks:queue.autoSwap.title', {
            defaultValue: 'Profile Swapped',
          }),
          description: t('tasks:queue.autoSwap.description', {
            from: swap.fromProfileName,
            to: swap.toProfileName,
            reason: t(`tasks:profileBadge.swapReason.${swap.reason}`),
            defaultValue: `Switched from ${swap.fromProfileName} to ${swap.toProfileName} (${swap.reason})`,
          }),
          duration: TOAST_DURATION_SWAP_MS,
        });
      } else {
        // Multiple swaps - show summary
        const profileNames = [...new Set(swapsToShow.map(s => s.swap.toProfileName))];
        toast({
          title: t('tasks:queue.autoSwap.batchTitle', {
            count: swapsToShow.length,
            defaultValue: `${swapsToShow.length} Profile Swaps`,
          }),
          description: t('tasks:queue.autoSwap.batchDescription', {
            profiles: profileNames.join(', '),
            defaultValue: `Tasks redistributed to: ${profileNames.join(', ')}`,
          }),
          duration: TOAST_DURATION_SWAP_MS,
        });
      }

      if (remainingSwaps > 0) {
        console.log(`[ProfileSwapNotifications] ${remainingSwaps} additional swaps suppressed`);
      }

      queue.swaps = [];
    }

    // Process blocked notifications
    if (queue.blocked.length > 0) {
      toast({
        title: t('tasks:queue.blocked.title', {
          defaultValue: 'Queue Blocked',
        }),
        description: t('tasks:queue.blocked.description', {
          defaultValue: 'All profiles are at capacity. Tasks will resume when a profile becomes available.',
        }),
        variant: 'destructive',
        duration: TOAST_DURATION_BLOCKED_MS,
      });
      queue.blocked = [];
    }
  }, [t]);

  /**
   * Queue a notification for batched display
   */
  const queueNotification = useCallback((
    type: 'swap' | 'blocked',
    data: QueueProfileSwapEvent | { reason: string; timestamp: string }
  ) => {
    const queue = queueRef.current;

    if (type === 'swap') {
      queue.swaps.push(data as QueueProfileSwapEvent);
    } else {
      queue.blocked.push(data as { reason: string; timestamp: string });
    }

    // Start batch window if not already started
    if (!queue.timeoutId) {
      queue.timeoutId = setTimeout(processBatch, BATCH_WINDOW_MS);
    }
  }, [processBatch]);

  useEffect(() => {
    // Check if electronAPI and queue methods are available
    if (!window.electronAPI?.queue) {
      console.log('[ProfileSwapNotifications] Queue API not available');
      return;
    }

    // Subscribe to profile swap events
    const unsubscribeSwap = window.electronAPI.queue.onQueueProfileSwapped(
      (event: QueueProfileSwapEvent) => {
        console.log('[ProfileSwapNotifications] Profile swap event:', event);
        queueNotification('swap', event);
      }
    );

    // Subscribe to queue blocked events
    const unsubscribeBlocked = window.electronAPI.queue.onQueueBlockedNoProfiles(
      (info: { reason: string; timestamp: string }) => {
        console.log('[ProfileSwapNotifications] Queue blocked event:', info);
        queueNotification('blocked', info);
      }
    );

    return () => {
      unsubscribeSwap();
      unsubscribeBlocked();
      // Clear any pending batch timeout
      if (queueRef.current.timeoutId) {
        clearTimeout(queueRef.current.timeoutId);
      }
    };
  }, [queueNotification]);
}

/**
 * Hook to listen for session capture events (useful for debugging)
 * This is separate from the main notification hook as it's primarily for internal use.
 */
export function useSessionCaptureListener(
  onSessionCaptured?: (event: QueueSessionCapturedEvent) => void
) {
  useEffect(() => {
    if (!window.electronAPI?.queue || !onSessionCaptured) {
      return;
    }

    const unsubscribe = window.electronAPI.queue.onQueueSessionCaptured(onSessionCaptured);
    return unsubscribe;
  }, [onSessionCaptured]);
}
