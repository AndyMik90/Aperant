/**
 * Drift API
 *
 * Exposes generic IPC invoke and on methods for agent drift monitoring.
 * These are used by the drift-store to communicate with the main process.
 */

import { ipcRenderer } from 'electron';

export interface DriftAPI {
  /**
   * Generic invoke method for IPC communication
   */
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

  /**
   * Generic on method for IPC event listeners
   * Returns a cleanup function to remove the listener
   */
  on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => () => void;
}

export const createDriftAPI = (): DriftAPI => ({
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    return ipcRenderer.invoke(channel, ...args);
  },

  on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(_event, ...args);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
});
