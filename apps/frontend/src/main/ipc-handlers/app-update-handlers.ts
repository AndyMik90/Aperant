/**
 * App Update IPC Handlers
 *
 * Handles IPC communication for Electron app auto-updates.
 * Provides manual controls for checking, downloading, and installing updates.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, AppUpdateInfo } from '../../shared/types';
import {
  checkForUpdates,
  downloadUpdate,
  downloadStableVersion,
  quitAndInstall,
  getCurrentVersion,
  getDownloadedUpdateInfo
} from '../app-updater';

/**
 * Register all app-update-related IPC handlers
 */
export function registerAppUpdateHandlers(): void {
  console.warn('[IPC] Registering app update handlers');

  // ============================================
  // App Update Operations
  // ============================================

  /**
   * APP_UPDATE_CHECK: Manually check for updates
   * Returns update availability and version information
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_CHECK,
    async (): Promise<IPCResult<AppUpdateInfo | null>> => {
      try {
        const result = await checkForUpdates();
        return { success: true, data: result };
      } catch (error) {
        console.error('[app-update-handlers] Check for updates failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check for updates'
        };
      }
    }
  );

  /**
   * APP_UPDATE_DOWNLOAD: Manually download update
   * Triggers download of available update
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_DOWNLOAD,
    async (): Promise<IPCResult> => {
      try {
        await downloadUpdate();
        return { success: true };
      } catch (error) {
        console.error('[app-update-handlers] Download update failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to download update'
        };
      }
    }
  );

  /**
   * APP_UPDATE_DOWNLOAD_STABLE: Download stable version (for downgrade from beta)
   * Uses allowDowngrade to download an older stable version
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_DOWNLOAD_STABLE,
    async (): Promise<IPCResult> => {
      try {
        await downloadStableVersion();
        return { success: true };
      } catch (error) {
        console.error('[app-update-handlers] Download stable version failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to download stable version'
        };
      }
    }
  );

  /**
   * APP_UPDATE_INSTALL: Quit and install update
   * Quits the app and installs the downloaded update
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_INSTALL,
    async (): Promise<IPCResult> => {
      try {
        // quitAndInstall() returns false if blocked by read-only volume,
        // but the user is notified via APP_UPDATE_READONLY_VOLUME event instead.
        // The preload fires this as fire-and-forget, so the return value is
        // only consumed by the .catch() handler for unexpected errors.
        quitAndInstall();
        return { success: true };
      } catch (error) {
        console.error('[app-update-handlers] Install update failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to install update'
        };
      }
    }
  );

  /**
   * APP_UPDATE_GET_VERSION: Get current app version
   * Returns the current application version
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_GET_VERSION,
    async (): Promise<string> => {
      try {
        const version = getCurrentVersion();
        return version;
      } catch (error) {
        console.error('[app-update-handlers] Get version failed:', error);
        throw error;
      }
    }
  );

  /**
   * APP_UPDATE_GET_DOWNLOADED: Get downloaded update info
   * Returns info about a downloaded update that's ready to install,
   * or null if no update has been downloaded yet.
   * This allows the UI to show "Install and Restart" even if the user
   * opens Settings after the download completed in the background.
   */
  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_GET_DOWNLOADED,
    async (): Promise<IPCResult<AppUpdateInfo | null>> => {
      try {
        const downloadedInfo = getDownloadedUpdateInfo();
        return { success: true, data: downloadedInfo };
      } catch (error) {
        console.error('[app-update-handlers] Get downloaded update info failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get downloaded update info'
        };
      }
    }
  );

  console.warn('[IPC] App update handlers registered successfully');
}
