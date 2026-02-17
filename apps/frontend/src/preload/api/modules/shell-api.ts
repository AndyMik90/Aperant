import { IPC_CHANNELS } from '../../../shared/constants';
import { invokeIpc } from './ipc-utils';
import type { IPCResult } from '../../../shared/types';

/**
 * Shell Operations API
 */
export interface ShellAPI {
  openExternal: (url: string) => Promise<void>;
  openTerminal: (dirPath: string) => Promise<IPCResult<void>>;
  openFolder: (dirPath: string) => Promise<IPCResult<void>>;
}

/**
 * Creates the Shell Operations API implementation
 */
export const createShellAPI = (): ShellAPI => ({
  openExternal: (url: string): Promise<void> =>
    invokeIpc(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
  openTerminal: (dirPath: string): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.SHELL_OPEN_TERMINAL, dirPath),
  openFolder: (dirPath: string): Promise<IPCResult<void>> =>
    invokeIpc(IPC_CHANNELS.SHELL_OPEN_FOLDER, dirPath)
});
