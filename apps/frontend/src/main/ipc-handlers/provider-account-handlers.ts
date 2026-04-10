import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, ProviderAccount, ProviderAccountsPayload } from '../../shared/types';
import {
  getProviderAccountState,
  updateProviderAccountState,
} from '../services/provider-account-service';

function toPayload(state: Awaited<ReturnType<typeof getProviderAccountState>>): ProviderAccountsPayload {
  return {
    accounts: state.accounts,
    globalPriorityOrder: state.globalPriorityOrder,
    disabledAutoSwitchAccountIds: state.disabledAutoSwitchAccountIds,
  };
}

function generateProviderAccountId(): string {
  return `pa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function registerProviderAccountHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_ACCOUNTS_GET,
    async (): Promise<IPCResult<ProviderAccountsPayload>> => {
      try {
        const state = await getProviderAccountState();
        return { success: true, data: toPayload(state) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get provider accounts',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_ACCOUNTS_SAVE,
    async (
      _event,
      account: Omit<ProviderAccount, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<IPCResult<ProviderAccount>> => {
      try {
        const state = await getProviderAccountState();
        const now = Date.now();
        const nextAccount: ProviderAccount = {
          ...account,
          id: generateProviderAccountId(),
          name: account.name.trim(),
          createdAt: now,
          updatedAt: now,
        };
        const nextState = await updateProviderAccountState({
          accounts: [...state.accounts, nextAccount],
          globalPriorityOrder: [...state.globalPriorityOrder, nextAccount.id],
        });
        const createdAccount = nextState.accounts.find((candidate) => candidate.id === nextAccount.id);
        return { success: true, data: createdAccount ?? nextAccount };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save provider account',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_ACCOUNTS_UPDATE,
    async (
      _event,
      id: string,
      updates: Partial<ProviderAccount>
    ): Promise<IPCResult<ProviderAccount>> => {
      try {
        const state = await getProviderAccountState();
        const accountIndex = state.accounts.findIndex((account) => account.id === id);
        if (accountIndex === -1) {
          return { success: false, error: `Provider account not found: ${id}` };
        }

        const currentAccount = state.accounts[accountIndex];
        const nextAccount: ProviderAccount = {
          ...currentAccount,
          ...updates,
          id: currentAccount.id,
          createdAt: currentAccount.createdAt,
          updatedAt: Date.now(),
        };
        if (typeof nextAccount.name === 'string') {
          nextAccount.name = nextAccount.name.trim();
        }

        const nextAccounts = [...state.accounts];
        nextAccounts[accountIndex] = nextAccount;
        const nextState = await updateProviderAccountState({ accounts: nextAccounts });
        const updatedAccount = nextState.accounts.find((account) => account.id === id);
        return { success: true, data: updatedAccount ?? nextAccount };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update provider account',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_ACCOUNTS_DELETE,
    async (_event, id: string): Promise<IPCResult> => {
      try {
        const state = await getProviderAccountState();
        const account = state.accounts.find((candidate) => candidate.id === id);
        if (!account) {
          return { success: false, error: `Provider account not found: ${id}` };
        }
        if (account.claudeProfileId || account.apiProfileId) {
          return {
            success: false,
            error: 'Linked Claude and Custom Endpoint accounts must be deleted from their provider section.',
          };
        }

        await updateProviderAccountState({
          accounts: state.accounts.filter((candidate) => candidate.id !== id),
          globalPriorityOrder: state.globalPriorityOrder.filter((accountId) => accountId !== id),
          disabledAutoSwitchAccountIds: state.disabledAutoSwitchAccountIds.filter((accountId) => accountId !== id),
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete provider account',
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_ACCOUNTS_SET_ORDER,
    async (
      _event,
      order: string[],
      disabledIds: string[]
    ): Promise<IPCResult<ProviderAccountsPayload>> => {
      try {
        const nextState = await updateProviderAccountState({
          globalPriorityOrder: order,
          disabledAutoSwitchAccountIds: disabledIds,
        });
        return { success: true, data: toPayload(nextState) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update provider account order',
        };
      }
    }
  );
}
