import { Notification } from 'electron';
import type { BrowserWindow } from 'electron';
import { projectStore } from './project-store';
import { IPC_CHANNELS } from '../shared/constants';
import type { NotificationSoundType } from '../shared/types';

export type NotificationType = 'task-complete' | 'task-failed' | 'review-needed';

interface NotificationOptions {
  title: string;
  body: string;
  projectId?: string;
  taskId?: string;
}

/**
 * Service for sending system notifications with optional sound
 */
class NotificationService {
  private mainWindow: (() => BrowserWindow | null) | null = null;

  /**
   * Initialize the notification service with the main window getter
   */
  initialize(getMainWindow: () => BrowserWindow | null): void {
    this.mainWindow = getMainWindow;
  }

  /**
   * Send a notification for task completion
   */
  notifyTaskComplete(taskTitle: string, projectId: string, taskId: string): void {
    this.sendNotification('task-complete', {
      title: 'Task Complete',
      body: `"${taskTitle}" has completed and is ready for review`,
      projectId,
      taskId
    });
  }

  /**
   * Send a notification for task failure
   */
  notifyTaskFailed(taskTitle: string, projectId: string, taskId: string): void {
    this.sendNotification('task-failed', {
      title: 'Task Failed',
      body: `"${taskTitle}" encountered an error`,
      projectId,
      taskId
    });
  }

  /**
   * Send a notification for review needed
   */
  notifyReviewNeeded(taskTitle: string, projectId: string, taskId: string): void {
    this.sendNotification('review-needed', {
      title: 'Review Needed',
      body: `"${taskTitle}" is ready for your review`,
      projectId,
      taskId
    });
  }

  /**
   * Play notification sound via renderer process (safe, no native crashes)
   * Uses Web Audio API in the renderer to generate tones
   */
  private playNotificationSound(soundType: NotificationSoundType = 'chime'): void {
    try {
      const window = this.mainWindow?.();
      if (window?.webContents) {
        window.webContents.send(IPC_CHANNELS.PLAY_NOTIFICATION_SOUND, soundType);
      }
    } catch (err) {
      console.error('[NotificationService] Failed to send sound IPC:', err);
    }
  }

  /**
   * Send a system notification with optional sound
   */
  private sendNotification(type: NotificationType, options: NotificationOptions): void {
    try {
      // Get notification settings
      const settings = this.getNotificationSettings(options.projectId);

      // Check if this notification type is enabled
      if (!this.isNotificationEnabled(type, settings)) {
        return;
      }

      // Create and show the notification
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: options.title,
          body: options.body,
          silent: true // Always silent - we handle sound via Web Audio API
        });

        // Focus window when notification is clicked
        notification.on('click', () => {
          try {
            const window = this.mainWindow?.();
            if (window) {
              if (window.isMinimized()) {
                window.restore();
              }
              window.focus();
            }
          } catch (err) {
            console.error('[NotificationService] Click handler error:', err);
          }
        });

        notification.show();
      }

      // Play sound via renderer if enabled
      if (settings.sound) {
        this.playNotificationSound(settings.soundType || 'chime');
      }
    } catch (error) {
      console.error('[NotificationService] Error sending notification:', error);
    }
  }

  /**
   * Get notification settings for a project or fall back to defaults
   */
  private getNotificationSettings(projectId?: string): {
    onTaskComplete: boolean;
    onTaskFailed: boolean;
    onReviewNeeded: boolean;
    sound: boolean;
    soundType?: NotificationSoundType;
  } {
    // Try to get project-specific settings
    if (projectId) {
      const projects = projectStore.getProjects();
      const project = projects.find(p => p.id === projectId);
      if (project?.settings?.notifications) {
        return project.settings.notifications;
      }
    }

    // Fall back to defaults
    return {
      onTaskComplete: true,
      onTaskFailed: true,
      onReviewNeeded: true,
      sound: false,
      soundType: 'chime'
    };
  }

  /**
   * Check if a notification type is enabled in settings
   */
  private isNotificationEnabled(
    type: NotificationType,
    settings: {
      onTaskComplete: boolean;
      onTaskFailed: boolean;
      onReviewNeeded: boolean;
      sound: boolean;
    }
  ): boolean {
    switch (type) {
      case 'task-complete':
        return settings.onTaskComplete;
      case 'task-failed':
        return settings.onTaskFailed;
      case 'review-needed':
        return settings.onReviewNeeded;
      default:
        return false;
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
