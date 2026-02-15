import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getBounds: () => Promise<WindowBounds | null>;
  setBounds: (bounds: WindowBounds) => void;
  onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
}

export const createWindowAPI = (): WindowAPI => ({
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  getBounds: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_BOUNDS),
  setBounds: (bounds) => ipcRenderer.send(IPC_CHANNELS.WINDOW_SET_BOUNDS, bounds),
  onMaximizeChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGED, handler);
  }
});
