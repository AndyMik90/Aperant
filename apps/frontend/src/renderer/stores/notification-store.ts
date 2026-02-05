import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UX-1: Notification Center store
 *
 * Stores notifications with persistence, grouping by time,
 * and unread count tracking.
 */

export type NotificationType = 'success' | 'warning' | 'info' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  taskId?: string;
  taskTitle?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;

  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  clearOlderThan: (hours: number) => void;
}

// Generate unique ID
const generateId = () => `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// 24 hours in milliseconds
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,

      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: generateId(),
          timestamp: Date.now(),
          read: false,
        };

        set((state) => {
          // Clean up old notifications (older than 24 hours)
          const cutoff = Date.now() - TWENTY_FOUR_HOURS;
          const filteredNotifications = state.notifications.filter(
            (n) => n.timestamp > cutoff
          );

          return {
            notifications: [newNotification, ...filteredNotifications],
            unreadCount: state.unreadCount + 1,
          };
        });
      },

      markAsRead: (id) => {
        set((state) => {
          const notification = state.notifications.find((n) => n.id === id);
          if (!notification || notification.read) {
            return state;
          }

          const updatedNotifications = state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          );

          // Compute unread count from actual state to prevent race conditions
          const newUnreadCount = updatedNotifications.filter((n) => !n.read).length;

          return {
            notifications: updatedNotifications,
            unreadCount: newUnreadCount,
          };
        });
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        }));
      },

      removeNotification: (id) => {
        set((state) => {
          const notification = state.notifications.find((n) => n.id === id);
          const wasUnread = notification && !notification.read;

          return {
            notifications: state.notifications.filter((n) => n.id !== id),
            unreadCount: wasUnread
              ? Math.max(0, state.unreadCount - 1)
              : state.unreadCount,
          };
        });
      },

      clearAll: () => {
        set({
          notifications: [],
          unreadCount: 0,
        });
      },

      clearOlderThan: (hours) => {
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        set((state) => {
          // Single-pass: filter and count removed unread simultaneously
          const keptNotifications: typeof state.notifications = [];
          let removedUnread = 0;

          for (const n of state.notifications) {
            if (n.timestamp > cutoff) {
              keptNotifications.push(n);
            } else if (!n.read) {
              removedUnread++;
            }
          }

          return {
            notifications: keptNotifications,
            unreadCount: Math.max(0, state.unreadCount - removedUnread),
          };
        });
      },
    }),
    {
      name: 'auto-claude-notifications',
      version: 1,
    }
  )
);

/**
 * Group notifications by time period
 */
export function groupNotificationsByTime(notifications: Notification[]) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const justNow: Notification[] = [];
  const earlierToday: Notification[] = [];
  const yesterday: Notification[] = [];

  for (const notification of notifications) {
    if (notification.timestamp > oneHourAgo) {
      justNow.push(notification);
    } else if (notification.timestamp > oneDayAgo) {
      earlierToday.push(notification);
    } else {
      yesterday.push(notification);
    }
  }

  return {
    justNow,
    earlierToday,
    yesterday,
  };
}

/**
 * Helper to format relative time for notifications
 */
export function formatNotificationTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return 'Yesterday';
}
