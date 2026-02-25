/**
 * Queue Routing IPC Handlers
 *
 * Handles IPC communication for the rate limit recovery queue routing system.
 * Provides profile-aware task distribution to enable overnight autonomous operation.
 *
 * v3 Enhancement: Unified Account Support
 * - Supports both OAuth profiles and API profiles in unified selection
 * - New QUEUE_GET_BEST_UNIFIED_ACCOUNT handler for cross-type account switching
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentManager } from '../agent/agent-manager';
import type { ProfileAssignmentReason, RunningTasksByProfile, ClaudeProfile } from '../../shared/types';
import type { UnifiedAccount } from '../../shared/types/unified-account';
import type { ClaudeProfileManager } from '../claude-profile-manager';

/**
 * Register queue routing IPC handlers
 */
export function registerQueueRoutingHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
  profileManager?: ClaudeProfileManager
): void {
  // Get running tasks grouped by profile
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_RUNNING_TASKS_BY_PROFILE,
    async (): Promise<{ success: boolean; data?: RunningTasksByProfile; error?: string }> => {
      try {
        const data = agentManager.getRunningTasksByProfile();
        return { success: true, data };
      } catch (error) {
        console.error('[QueueRouting] Failed to get running tasks by profile:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get best profile for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_BEST_PROFILE_FOR_TASK,
    async (
      _event,
      options?: {
        excludeProfileId?: string;
        perProfileMaxTasks?: number;
        profileThreshold?: number;
      }
    ): Promise<{ success: boolean; data?: ClaudeProfile | null; error?: string }> => {
      try {
        // If no profile manager is available, return null (no preference)
        if (!profileManager) {
          console.log('[QueueRouting] Profile manager not available, returning null');
          return { success: true, data: null };
        }

        // Get auto-switch settings to check if enabled
        const settings = profileManager.getAutoSwitchSettings();

        // If auto-switching is disabled, return null (no preference)
        if (!settings.enabled) {
          console.log('[QueueRouting] Auto-switching disabled, returning null');
          return { success: true, data: null };
        }

        // Use getBestAvailableProfile which internally handles:
        // - User's configured priority order
        // - Profile authentication status
        // - Rate limit status
        // - Usage thresholds (session and weekly)
        const bestProfile = profileManager.getBestAvailableProfile(
          options?.excludeProfileId
        );

        if (bestProfile) {
          console.log('[QueueRouting] Best profile selected:', {
            profileId: bestProfile.id,
            profileName: bestProfile.name,
            excludedId: options?.excludeProfileId
          });
        } else {
          console.log('[QueueRouting] No suitable profile found for task routing');
        }

        return { success: true, data: bestProfile };
      } catch (error) {
        console.error('[QueueRouting] Failed to get best profile for task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get best unified account for a task (OAuth + API profiles)
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_BEST_UNIFIED_ACCOUNT,
    async (
      _event,
      options?: {
        excludeAccountId?: string;
      }
    ): Promise<{ success: boolean; data?: UnifiedAccount | null; error?: string }> => {
      try {
        // If no profile manager is available, return null (no preference)
        if (!profileManager) {
          console.log('[QueueRouting] Profile manager not available, returning null');
          return { success: true, data: null };
        }

        // Get auto-switch settings to check if enabled
        const settings = profileManager.getAutoSwitchSettings();

        // If auto-switching is disabled, return null (no preference)
        if (!settings.enabled) {
          console.log('[QueueRouting] Auto-switching disabled, returning null');
          return { success: true, data: null };
        }

        // Use getBestAvailableUnifiedAccount which handles:
        // - User's configured priority order
        // - OAuth profiles (with usage thresholds)
        // - API profiles (always available if authenticated)
        const bestAccount = await profileManager.getBestAvailableUnifiedAccount(
          options?.excludeAccountId
        );

        if (bestAccount) {
          console.log('[QueueRouting] Best unified account selected:', {
            accountId: bestAccount.id,
            accountName: bestAccount.displayName,
            accountType: bestAccount.type,
            excludedId: options?.excludeAccountId
          });
        } else {
          console.log('[QueueRouting] No suitable unified account found for task routing');
        }

        return { success: true, data: bestAccount };
      } catch (error) {
        console.error('[QueueRouting] Failed to get best unified account for task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Assign a profile to a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_ASSIGN_PROFILE_TO_TASK,
    async (
      _event,
      taskId: string,
      profileId: string,
      profileName: string,
      reason: ProfileAssignmentReason
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        agentManager.assignProfileToTask(taskId, profileId, profileName, reason);
        return { success: true };
      } catch (error) {
        console.error('[QueueRouting] Failed to assign profile to task:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Update session ID for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_UPDATE_TASK_SESSION,
    async (
      _event,
      taskId: string,
      sessionId: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        agentManager.updateTaskSession(taskId, sessionId);
        return { success: true };
      } catch (error) {
        console.error('[QueueRouting] Failed to update task session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get session ID for a task
  ipcMain.handle(
    IPC_CHANNELS.QUEUE_GET_TASK_SESSION,
    async (
      _event,
      taskId: string
    ): Promise<{ success: boolean; data?: string | null; error?: string }> => {
      try {
        const sessionId = agentManager.getTaskSessionId(taskId);
        return { success: true, data: sessionId ?? null };
      } catch (error) {
        console.error('[QueueRouting] Failed to get task session:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Forward events from agent manager to renderer

  // Profile swapped event
  agentManager.on('profile-swapped', (taskId: string, swap: unknown) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_PROFILE_SWAPPED, { taskId, swap });
    }
  });

  // Session captured event
  agentManager.on('session-captured', (taskId: string, sessionId: string) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_SESSION_CAPTURED, {
        taskId,
        sessionId,
        capturedAt: new Date().toISOString()
      });
    }
  });

  // Queue blocked event (no available profiles)
  agentManager.on('queue-blocked-no-profiles', (info: { reason: string }) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.QUEUE_BLOCKED_NO_PROFILES, {
        ...info,
        timestamp: new Date().toISOString()
      });
    }
  });

  console.log('[QueueRouting] IPC handlers registered');
}
