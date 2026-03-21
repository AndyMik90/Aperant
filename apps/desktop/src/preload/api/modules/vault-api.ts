import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * Vault Integration API operations
 */
export interface VaultAPI {
  vaultValidatePath: (vaultPath: string) => Promise<IPCResult<{ valid: boolean; error?: string }>>;
  vaultListFiles: (vaultPath: string, subdir?: string) => Promise<IPCResult<Array<{ name: string; path: string; size: number; modified: string; isDirectory: boolean }>>>;
  vaultReadFile: (vaultPath: string, filePath: string) => Promise<IPCResult<{ content: string }>>;
  vaultSearch: (vaultPath: string, query: string) => Promise<IPCResult<Array<{ name: string; path: string }>>>;
  vaultGetContext: (vaultPath: string) => Promise<IPCResult<{ claudeMd?: string; learnings: string[] }>>;
  vaultSaveLearning: (vaultPath: string, filename: string, content: string) => Promise<IPCResult>;
}

/**
 * Creates the Vault Integration API implementation
 */
export const createVaultAPI = (): VaultAPI => ({
  vaultValidatePath: (vaultPath: string): Promise<IPCResult<{ valid: boolean; error?: string }>> =>
    invokeIpc(IPC_CHANNELS.VAULT_VALIDATE_PATH, vaultPath),

  vaultListFiles: (vaultPath: string, subdir?: string): Promise<IPCResult<Array<{ name: string; path: string; size: number; modified: string; isDirectory: boolean }>>> =>
    invokeIpc(IPC_CHANNELS.VAULT_LIST_FILES, vaultPath, subdir),

  vaultReadFile: (vaultPath: string, filePath: string): Promise<IPCResult<{ content: string }>> =>
    invokeIpc(IPC_CHANNELS.VAULT_READ_FILE, vaultPath, filePath),

  vaultSearch: (vaultPath: string, query: string): Promise<IPCResult<Array<{ name: string; path: string }>>> =>
    invokeIpc(IPC_CHANNELS.VAULT_SEARCH, vaultPath, query),

  vaultGetContext: (vaultPath: string): Promise<IPCResult<{ claudeMd?: string; learnings: string[] }>> =>
    invokeIpc(IPC_CHANNELS.VAULT_GET_CONTEXT, vaultPath),

  vaultSaveLearning: (vaultPath: string, filename: string, content: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.VAULT_SAVE_LEARNING, vaultPath, filename, content),
});
