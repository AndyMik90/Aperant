import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { clearCodexAuth, getCodexAuthState, startCodexOAuthFlow } from '../codex-auth/codex-oauth';
import { getProviderAccountState, updateProviderAccountState } from '../services/provider-account-service';

export function registerCodexAuthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CODEX_AUTH_LOGIN, async (_event, accountId: string) => {
    try {
      const result = await startCodexOAuthFlow(accountId);
      const state = await getProviderAccountState();
      const accountIndex = state.accounts.findIndex((account) => account.id === accountId);
      if (accountIndex !== -1) {
        const nextAccounts = [...state.accounts];
        nextAccounts[accountIndex] = {
          ...nextAccounts[accountIndex],
          ...(result.email ? { email: result.email } : {}),
          updatedAt: Date.now(),
        };
        await updateProviderAccountState({ accounts: nextAccounts });
      }
      return {
        success: true,
        data: {
          isAuthenticated: true,
          expiresAt: result.expiresAt,
          ...(result.email ? { email: result.email } : {}),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_AUTH_STATUS, async (_event, accountId: string) => {
    try {
      return {
        success: true,
        data: await getCodexAuthState(accountId),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_AUTH_LOGOUT, async (_event, accountId: string) => {
    try {
      await clearCodexAuth(accountId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
