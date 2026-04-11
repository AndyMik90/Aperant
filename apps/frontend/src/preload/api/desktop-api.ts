import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  DesktopProjectActivation,
  DesktopStateSnapshot,
  IPCResult,
} from '../../shared/types';

export interface DesktopAPI {
  getDesktopState: () => Promise<IPCResult<DesktopStateSnapshot>>;
  setDesktopPinEnabled: (enabled: boolean) => Promise<IPCResult<DesktopStateSnapshot>>;
  associateProjectToCurrentDesktop: (projectId: string) => Promise<IPCResult<DesktopStateSnapshot>>;
  clearProjectDesktopAssociation: (projectId: string) => Promise<IPCResult<DesktopStateSnapshot>>;
  onDesktopStateChanged: (
    callback: (state: DesktopStateSnapshot) => void
  ) => (() => void);
  onDesktopProjectActivated: (
    callback: (activation: DesktopProjectActivation) => void
  ) => (() => void);
}

export const createDesktopAPI = (): DesktopAPI => ({
  getDesktopState: (): Promise<IPCResult<DesktopStateSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_STATE_GET),

  setDesktopPinEnabled: (enabled: boolean): Promise<IPCResult<DesktopStateSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_PIN_SET, enabled),

  associateProjectToCurrentDesktop: (projectId: string): Promise<IPCResult<DesktopStateSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_PROJECT_ASSOCIATE, projectId),

  clearProjectDesktopAssociation: (projectId: string): Promise<IPCResult<DesktopStateSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_PROJECT_CLEAR, projectId),

  onDesktopStateChanged: (
    callback: (state: DesktopStateSnapshot) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopStateSnapshot): void => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.DESKTOP_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DESKTOP_STATE_CHANGED, handler);
  },

  onDesktopProjectActivated: (
    callback: (activation: DesktopProjectActivation) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activation: DesktopProjectActivation): void => {
      callback(activation);
    };
    ipcRenderer.on(IPC_CHANNELS.DESKTOP_PROJECT_ACTIVATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DESKTOP_PROJECT_ACTIVATE, handler);
  },
});
