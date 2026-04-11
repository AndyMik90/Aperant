import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { DesktopStateSnapshot, IPCResult } from '../../shared/types';
import { desktopCoordinator } from '../services/desktop-coordinator';

export function registerDesktopHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.DESKTOP_STATE_GET,
    async (): Promise<IPCResult<DesktopStateSnapshot>> => ({
      success: true,
      data: desktopCoordinator.getStateSnapshot(),
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.DESKTOP_PIN_SET,
    async (_event, enabled: boolean): Promise<IPCResult<DesktopStateSnapshot>> => ({
      success: true,
      data: desktopCoordinator.setPinEnabled(Boolean(enabled)),
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.DESKTOP_PROJECT_ASSOCIATE,
    async (_event, projectId: string): Promise<IPCResult<DesktopStateSnapshot>> => ({
      success: true,
      data: desktopCoordinator.associateProjectToCurrentDesktop(projectId, 'ui'),
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.DESKTOP_PROJECT_CLEAR,
    async (_event, projectId: string): Promise<IPCResult<DesktopStateSnapshot>> => ({
      success: true,
      data: desktopCoordinator.clearProjectAssociation(projectId),
    })
  );
}
