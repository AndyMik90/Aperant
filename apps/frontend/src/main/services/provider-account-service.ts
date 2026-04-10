import type { AppSettings, ProviderAccount, ClaudeProfile, APIProfile } from '../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../shared/constants';
import { readSettingsFile, writeSettingsFile } from '../settings-utils';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { loadProfilesFile } from './profile/profile-manager';

export interface ProviderAccountState {
  settings: AppSettings;
  accounts: ProviderAccount[];
  globalPriorityOrder: string[];
  disabledAutoSwitchAccountIds: string[];
}

interface PersistedProviderState {
  providerAccounts?: ProviderAccount[];
  globalPriorityOrder?: string[];
  disabledAutoSwitchAccountIds?: string[];
  _migratedProviderAccounts?: boolean;
}

const PROVIDER_ACCOUNT_ID_PREFIX = 'pa_';

function generateProviderAccountId(): string {
  return `${PROVIDER_ACCOUNT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTimestamp(value: Date | number | undefined, fallback: number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function sanitizePriorityState(
  accounts: ProviderAccount[],
  globalPriorityOrder?: string[],
  disabledAutoSwitchAccountIds?: string[]
): { globalPriorityOrder: string[]; disabledAutoSwitchAccountIds: string[] } {
  const validIds = new Set(accounts.map((account) => account.id));
  const nextPriorityOrder: string[] = [];
  const seenPriorityIds = new Set<string>();

  for (const accountId of globalPriorityOrder ?? []) {
    if (!validIds.has(accountId) || seenPriorityIds.has(accountId)) {
      continue;
    }
    nextPriorityOrder.push(accountId);
    seenPriorityIds.add(accountId);
  }

  const nextDisabledIds: string[] = [];
  const seenDisabledIds = new Set<string>();
  for (const accountId of disabledAutoSwitchAccountIds ?? []) {
    if (!validIds.has(accountId) || seenPriorityIds.has(accountId) || seenDisabledIds.has(accountId)) {
      continue;
    }
    nextDisabledIds.push(accountId);
    seenDisabledIds.add(accountId);
  }

  for (const account of accounts) {
    if (seenPriorityIds.has(account.id) || seenDisabledIds.has(account.id)) {
      continue;
    }
    nextPriorityOrder.push(account.id);
    seenPriorityIds.add(account.id);
  }

  return {
    globalPriorityOrder: nextPriorityOrder,
    disabledAutoSwitchAccountIds: nextDisabledIds,
  };
}

function translateProviderQueueToLegacyUnifiedIds(
  accounts: ProviderAccount[],
  globalPriorityOrder: string[]
): string[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const translated: string[] = [];

  for (const accountId of globalPriorityOrder) {
    const account = accountMap.get(accountId);
    if (!account) {
      continue;
    }

    if (account.provider === 'anthropic' && account.claudeProfileId) {
      translated.push(`oauth-${account.claudeProfileId}`);
      continue;
    }

    if (account.provider === 'openai-compatible' && account.apiProfileId) {
      translated.push(`api-${account.apiProfileId}`);
    }
  }

  return translated;
}

function buildAnthropicProviderAccount(
  profile: ClaudeProfile,
  existingAccount: ProviderAccount | undefined,
  now: number
): ProviderAccount {
  return {
    id: existingAccount?.id ?? generateProviderAccountId(),
    provider: 'anthropic',
    name: profile.name,
    authType: 'oauth',
    billingModel: 'subscription',
    ...(profile.email ? { email: profile.email } : {}),
    createdAt: existingAccount?.createdAt ?? normalizeTimestamp(profile.createdAt, now),
    updatedAt: now,
    claudeProfileId: profile.id,
  };
}

function buildCustomEndpointProviderAccount(
  profile: APIProfile,
  existingAccount: ProviderAccount | undefined,
  now: number
): ProviderAccount {
  return {
    id: existingAccount?.id ?? generateProviderAccountId(),
    provider: 'openai-compatible',
    name: profile.name,
    authType: 'api-key',
    billingModel: 'pay-per-use',
    baseUrl: profile.baseUrl,
    createdAt: existingAccount?.createdAt ?? normalizeTimestamp(profile.createdAt, now),
    updatedAt: now,
    apiProfileId: profile.id,
  };
}

function buildLegacyPrioritySeed(
  existingAccounts: ProviderAccount[],
  legacyPriorityOrder: string[]
): string[] {
  if (legacyPriorityOrder.length === 0) {
    return [];
  }

  const claudeProfileMap = new Map(
    existingAccounts
      .filter((account) => account.provider === 'anthropic' && account.claudeProfileId)
      .map((account) => [`oauth-${account.claudeProfileId!}`, account.id])
  );
  const apiProfileMap = new Map(
    existingAccounts
      .filter((account) => account.provider === 'openai-compatible' && account.apiProfileId)
      .map((account) => [`api-${account.apiProfileId!}`, account.id])
  );

  const prioritySeed: string[] = [];
  const seen = new Set<string>();

  for (const legacyId of legacyPriorityOrder) {
    const providerAccountId = claudeProfileMap.get(legacyId) ?? apiProfileMap.get(legacyId);
    if (!providerAccountId || seen.has(providerAccountId)) {
      continue;
    }
    prioritySeed.push(providerAccountId);
    seen.add(providerAccountId);
  }

  return prioritySeed;
}

function translateLegacyDefaultProviderId(
  accounts: ProviderAccount[],
  defaultProviderId: string | undefined
): string | undefined {
  if (!defaultProviderId) {
    return undefined;
  }

  if (accounts.some((account) => account.id === defaultProviderId)) {
    return defaultProviderId;
  }

  const legacyOAuthId = accounts.find(
    (account) =>
      account.provider === 'anthropic' &&
      (defaultProviderId === `oauth-${account.claudeProfileId}` || defaultProviderId === account.claudeProfileId)
  );
  if (legacyOAuthId) {
    return legacyOAuthId.id;
  }

  const legacyApiId = accounts.find(
    (account) =>
      account.provider === 'openai-compatible' &&
      (defaultProviderId === `api-${account.apiProfileId}` || defaultProviderId === account.apiProfileId)
  );
  if (legacyApiId) {
    return legacyApiId.id;
  }

  return undefined;
}

function toPersistedProviderState(state: ProviderAccountState): PersistedProviderState {
  return {
    providerAccounts: state.accounts,
    globalPriorityOrder: state.globalPriorityOrder,
    disabledAutoSwitchAccountIds: state.disabledAutoSwitchAccountIds,
    _migratedProviderAccounts: true,
  };
}

function writeProviderState(state: ProviderAccountState): void {
  const existingSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...(readSettingsFile() ?? {}),
  } as AppSettings;

  const nextSettings: AppSettings = {
    ...existingSettings,
    ...toPersistedProviderState(state),
  };

  writeSettingsFile(nextSettings as unknown as Record<string, unknown>);
}

function syncLegacyPriorityOrder(accounts: ProviderAccount[], globalPriorityOrder: string[]): void {
  const profileManager = getClaudeProfileManager();
  profileManager.setAccountPriorityOrder(
    translateProviderQueueToLegacyUnifiedIds(accounts, globalPriorityOrder)
  );
}

export async function getProviderAccountState(): Promise<ProviderAccountState> {
  const rawSettings = readSettingsFile();
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    ...(rawSettings ?? {}),
  } as AppSettings;
  const profileManager = getClaudeProfileManager();
  const claudeProfiles = profileManager.getSettings().profiles;
  const apiProfilesFile = await loadProfilesFile();
  const apiProfiles = apiProfilesFile.profiles;
  const now = Date.now();

  const existingAccounts = settings.providerAccounts ?? [];
  const reconciledAccounts: ProviderAccount[] = [];
  let changed = !settings._migratedProviderAccounts;

  const independentAccounts = existingAccounts.filter(
    (account) => !account.claudeProfileId && !account.apiProfileId
  );
  reconciledAccounts.push(...independentAccounts);

  for (const profile of claudeProfiles) {
    const existingAccount = existingAccounts.find((account) => account.claudeProfileId === profile.id);
    reconciledAccounts.push(buildAnthropicProviderAccount(profile, existingAccount, now));
    if (!existingAccount) {
      changed = true;
    }
  }

  for (const profile of apiProfiles) {
    const existingAccount = existingAccounts.find((account) => account.apiProfileId === profile.id);
    reconciledAccounts.push(buildCustomEndpointProviderAccount(profile, existingAccount, now));
    if (!existingAccount) {
      changed = true;
    }
  }

  const legacyPrioritySeed = buildLegacyPrioritySeed(
    reconciledAccounts,
    profileManager.getAccountPriorityOrder()
  );

  const desiredPrioritySource = (settings.globalPriorityOrder ?? []).length > 0
    ? settings.globalPriorityOrder
    : legacyPrioritySeed;

  const { globalPriorityOrder, disabledAutoSwitchAccountIds } = sanitizePriorityState(
    reconciledAccounts,
    desiredPrioritySource,
    settings.disabledAutoSwitchAccountIds ?? []
  );

  if (
    existingAccounts.length !== reconciledAccounts.length ||
    JSON.stringify(existingAccounts) !== JSON.stringify(reconciledAccounts) ||
    JSON.stringify(settings.globalPriorityOrder ?? []) !== JSON.stringify(globalPriorityOrder) ||
    JSON.stringify(settings.disabledAutoSwitchAccountIds ?? []) !== JSON.stringify(disabledAutoSwitchAccountIds)
  ) {
    changed = true;
  }

  const nextSettings: AppSettings = {
    ...settings,
    providerAccounts: reconciledAccounts,
    globalPriorityOrder,
    disabledAutoSwitchAccountIds,
    _migratedProviderAccounts: true,
  };

  const normalizedDefaultProviderId = translateLegacyDefaultProviderId(
    reconciledAccounts,
    profileManager.getAutoSwitchSettings().defaultProviderId
  );
  if (profileManager.getAutoSwitchSettings().defaultProviderId !== normalizedDefaultProviderId) {
    profileManager.updateAutoSwitchSettings({ defaultProviderId: normalizedDefaultProviderId });
  }

  const state: ProviderAccountState = {
    settings: nextSettings,
    accounts: reconciledAccounts,
    globalPriorityOrder,
    disabledAutoSwitchAccountIds,
  };

  if (changed) {
    writeProviderState(state);
  }

  syncLegacyPriorityOrder(reconciledAccounts, globalPriorityOrder);
  return state;
}

export async function updateProviderAccountState(
  updates: {
    accounts?: ProviderAccount[];
    globalPriorityOrder?: string[];
    disabledAutoSwitchAccountIds?: string[];
  }
): Promise<ProviderAccountState> {
  const currentState = await getProviderAccountState();
  const nextAccounts = updates.accounts ?? currentState.accounts;
  const { globalPriorityOrder, disabledAutoSwitchAccountIds } = sanitizePriorityState(
    nextAccounts,
    updates.globalPriorityOrder ?? currentState.globalPriorityOrder,
    updates.disabledAutoSwitchAccountIds ?? currentState.disabledAutoSwitchAccountIds
  );

  const nextState: ProviderAccountState = {
    settings: {
      ...currentState.settings,
      providerAccounts: nextAccounts,
      globalPriorityOrder,
      disabledAutoSwitchAccountIds,
      _migratedProviderAccounts: true,
    },
    accounts: nextAccounts,
    globalPriorityOrder,
    disabledAutoSwitchAccountIds,
  };

  writeProviderState(nextState);
  syncLegacyPriorityOrder(nextAccounts, globalPriorityOrder);
  return nextState;
}

export async function getProviderAccountById(accountId: string): Promise<ProviderAccount | null> {
  const state = await getProviderAccountState();
  return state.accounts.find((account) => account.id === accountId) ?? null;
}
