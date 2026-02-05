import { IPC_CHANNELS } from '../../shared/constants';
import type {
  AppUpdateInfo,
  AppUpdateProgress,
  AppUpdateAvailableEvent,
  AppUpdateDownloadedEvent,
  AppUpdateErrorEvent,
  IPCResult
} from '../../shared/types';
import { createIpcListener, invokeIpc, IpcListenerCleanup } from './modules/ipc-utils';

/**
 * App Auto-Update API operations
 * Handles Electron app updates using electron-updater
 */
export interface AppUpdateAPI {
  // Operations
  checkAppUpdate: () => Promise<IPCResult<AppUpdateInfo | null>>;
  downloadAppUpdate: () => Promise<IPCResult>;
  downloadStableUpdate: () => Promise<IPCResult>;
  installAppUpdate: () => void;
  getAppVersion: () => Promise<string>;
  getDownloadedAppUpdate: () => Promise<IPCResult<AppUpdateInfo | null>>;

  // Event Listeners
  onAppUpdateAvailable: (
    callback: (info: AppUpdateAvailableEvent) => void
  ) => IpcListenerCleanup;
  onAppUpdateDownloaded: (
    callback: (info: AppUpdateDownloadedEvent) => void
  ) => IpcListenerCleanup;
  onAppUpdateProgress: (
    callback: (progress: AppUpdateProgress) => void
  ) => IpcListenerCleanup;
  onAppUpdateStableDowngrade: (
    callback: (info: AppUpdateInfo) => void
  ) => IpcListenerCleanup;
  onAppUpdateReadOnlyVolume: (
    callback: (info: { appPath: string }) => void
  ) => IpcListenerCleanup;
  onAppUpdateError: (
    callback: (error: AppUpdateErrorEvent) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the App Auto-Update API implementation
 */
export const createAppUpdateAPI = (): AppUpdateAPI => ({
  // Operations
  checkAppUpdate: (): Promise<IPCResult<AppUpdateInfo | null>> =>
    invokeIpc(IPC_CHANNELS.APP_UPDATE_CHECK),

  downloadAppUpdate: (): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.APP_UPDATE_DOWNLOAD),

  downloadStableUpdate: (): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.APP_UPDATE_DOWNLOAD_STABLE),

  installAppUpdate: (): void => {
    invokeIpc(IPC_CHANNELS.APP_UPDATE_INSTALL).catch((err) =>
      console.error('[app-update] Install failed:', err)
    );
  },

  getAppVersion: (): Promise<string> =>
    invokeIpc(IPC_CHANNELS.APP_UPDATE_GET_VERSION),

  getDownloadedAppUpdate: (): Promise<IPCResult<AppUpdateInfo | null>> =>
    invokeIpc(IPC_CHANNELS.APP_UPDATE_GET_DOWNLOADED),

  // Event Listeners
  onAppUpdateAvailable: (
    callback: (info: AppUpdateAvailableEvent) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_AVAILABLE, callback),

  onAppUpdateDownloaded: (
    callback: (info: AppUpdateDownloadedEvent) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_DOWNLOADED, callback),

  onAppUpdateProgress: (
    callback: (progress: AppUpdateProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_PROGRESS, callback),

  onAppUpdateStableDowngrade: (
    callback: (info: AppUpdateInfo) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_STABLE_DOWNGRADE, callback),

  onAppUpdateReadOnlyVolume: (
    callback: (info: { appPath: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_READONLY_VOLUME, callback),

  onAppUpdateError: (
    callback: (error: AppUpdateErrorEvent) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.APP_UPDATE_ERROR, callback)
});
