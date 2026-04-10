/**
 * Mock implementation for settings and app info operations
 */

import type { AppSettings, ProviderAccount, ProviderAccountsPayload } from '../../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../shared/constants';

let mockSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };
let mockProviderAccounts: ProviderAccount[] = [];
let mockGlobalPriorityOrder: string[] = [];
let mockDisabledAutoSwitchAccountIds: string[] = [];
const mockCodexStates = new Map<string, { isAuthenticated: boolean; email?: string; expiresAt?: number }>();

function createMockProviderAccountId(): string {
  return `mock-provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getProviderAccountsPayload(): ProviderAccountsPayload {
  return {
    accounts: mockProviderAccounts,
    globalPriorityOrder: mockGlobalPriorityOrder,
    disabledAutoSwitchAccountIds: mockDisabledAutoSwitchAccountIds,
  };
}

export const settingsMock = {
  // Settings
  getSettings: async () => ({
    success: true,
    data: mockSettings
  }),

  saveSettings: async (settings: Partial<AppSettings>) => {
    mockSettings = { ...mockSettings, ...settings };
    return { success: true };
  },

  // Sentry error reporting
  notifySentryStateChanged: (_enabled: boolean) => {
    console.warn('[browser-mock] notifySentryStateChanged called');
  },
  getSentryDsn: async () => '',  // No DSN in browser mode
  getSentryConfig: async () => ({ dsn: '', tracesSampleRate: 0, profilesSampleRate: 0 }),

  // Spell check (no-op in browser mode)
  setSpellCheckLanguages: async () => ({ success: true, data: { success: true } }),

  // Auto shutdown (browser mock)
  getAutoShutdownStatus: async () => ({
    success: true,
    data: {
      enabled: false,
      monitoring: false,
      tasksRemaining: 0,
      shutdownPending: false
    }
  }),

  setAutoShutdown: async (enabled: boolean) => ({
    success: true,
    data: {
      enabled,
      monitoring: enabled,
      tasksRemaining: 0,
      shutdownPending: false
    }
  }),

  cancelAutoShutdown: async () => ({
    success: true,
    data: undefined
  }),

  getCliToolsInfo: async () => ({
    success: true,
    data: {
      python: { found: false, source: 'fallback' as const, message: 'Not available in browser mode' },
      git: { found: false, source: 'fallback' as const, message: 'Not available in browser mode' },
      gh: { found: false, source: 'fallback' as const, message: 'Not available in browser mode' },
      glab: { found: false, source: 'fallback' as const, message: 'Not available in browser mode' },
      claude: { found: false, source: 'fallback' as const, message: 'Not available in browser mode' }
    }
  }),

  // Claude Code onboarding status (mock - always returns false in browser mode)
  getClaudeCodeOnboardingStatus: async () => ({
    success: true,
    data: { hasCompletedOnboarding: false }
  }),

  // Unified provider accounts
  getProviderAccounts: async () => ({
    success: true,
    data: getProviderAccountsPayload()
  }),

  saveProviderAccount: async (account: Omit<ProviderAccount, 'id' | 'createdAt' | 'updatedAt'>) => {
    const nextAccount: ProviderAccount = {
      ...account,
      id: createMockProviderAccountId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mockProviderAccounts = [...mockProviderAccounts, nextAccount];
    mockGlobalPriorityOrder = [...mockGlobalPriorityOrder, nextAccount.id];

    return {
      success: true,
      data: nextAccount
    };
  },

  updateProviderAccount: async (id: string, updates: Partial<ProviderAccount>) => {
    const existingAccount = mockProviderAccounts.find((account) => account.id === id);
    if (!existingAccount) {
      return {
        success: false,
        error: 'Provider account not found'
      };
    }

    const nextAccount: ProviderAccount = {
      ...existingAccount,
      ...updates,
      id,
      updatedAt: Date.now(),
    };
    mockProviderAccounts = mockProviderAccounts.map((account) => account.id === id ? nextAccount : account);

    return {
      success: true,
      data: nextAccount
    };
  },

  deleteProviderAccount: async (id: string) => {
    mockProviderAccounts = mockProviderAccounts.filter((account) => account.id !== id);
    mockGlobalPriorityOrder = mockGlobalPriorityOrder.filter((accountId) => accountId !== id);
    mockDisabledAutoSwitchAccountIds = mockDisabledAutoSwitchAccountIds.filter((accountId) => accountId !== id);
    mockCodexStates.delete(id);
    return { success: true };
  },

  setProviderAccountOrder: async (order: string[], disabledIds: string[]) => {
    mockGlobalPriorityOrder = [...order];
    mockDisabledAutoSwitchAccountIds = [...disabledIds];
    return {
      success: true,
      data: getProviderAccountsPayload()
    };
  },

  // OpenAI Codex OAuth (mock)
  codexAuthLogin: async (accountId: string) => {
    const state = {
      isAuthenticated: true,
      email: 'codex@example.com',
      expiresAt: Date.now() + (60 * 60 * 1000)
    };
    mockCodexStates.set(accountId, state);
    return {
      success: true,
      data: state
    };
  },

  codexAuthStatus: async (accountId: string) => ({
    success: true,
    data: mockCodexStates.get(accountId) ?? {
      isAuthenticated: false
    }
  }),

  codexAuthLogout: async (accountId: string) => {
    mockCodexStates.delete(accountId);
    return {
      success: true
    };
  },

  // App Info
  getAppVersion: async () => '0.1.0-browser',

  // App Update Operations (mock - no updates in browser mode)
  checkAppUpdate: async () => ({ success: true, data: null }),
  downloadAppUpdate: async () => ({ success: true }),
  downloadStableUpdate: async () => ({ success: true }),
  installAppUpdate: () => { console.warn('[browser-mock] installAppUpdate called'); },
  getDownloadedAppUpdate: async () => ({ success: true, data: null }),

  // App Update Event Listeners (no-op in browser mode)
  onAppUpdateAvailable: () => () => {},
  onAppUpdateDownloaded: () => () => {},
  onAppUpdateProgress: () => () => {},
  onAppUpdateStableDowngrade: () => () => {},
  onAppUpdateReadOnlyVolume: () => () => {},
  onAppUpdateError: () => () => {}
};
