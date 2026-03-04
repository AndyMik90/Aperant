/**
 * useActiveProvider - Shared hook resolving the active provider from the global priority queue
 *
 * Eliminates duplicated ordered-accounts logic in AuthStatusIndicator and UsageIndicator.
 * Returns the first provider account by priority order, plus helper booleans.
 */
import { useMemo } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import type { ProviderAccount, BuiltinProvider } from '../../shared/types/provider-account';

export interface ActiveProviderInfo {
  /** The highest-priority account (first in globalPriorityOrder), or null */
  account: ProviderAccount | null;
  /** Shorthand for account.provider */
  provider: BuiltinProvider | null;
  /** True when the active account is Anthropic (useful for Fast Mode gating) */
  isAnthropic: boolean;
  /** Unique set of providers across all connected accounts */
  connectedProviders: BuiltinProvider[];
  /** All accounts sorted by priority order */
  orderedAccounts: ProviderAccount[];
  /** Accounts ordered by cross-provider priority (falls back to global order) */
  crossProviderOrderedAccounts: ProviderAccount[];
}

/**
 * Build an ordered account list from a priority order array,
 * appending any accounts not in the order at the end.
 */
function buildOrderedAccounts(accounts: ProviderAccount[], order: string[]): ProviderAccount[] {
  const ordered: ProviderAccount[] = [];
  for (const id of order) {
    const account = accounts.find(a => a.id === id);
    if (account) ordered.push(account);
  }
  for (const account of accounts) {
    if (!ordered.some(a => a.id === account.id)) {
      ordered.push(account);
    }
  }
  return ordered;
}

export function useActiveProvider(): ActiveProviderInfo {
  const { providerAccounts, settings } = useSettingsStore();

  return useMemo(() => {
    const globalOrder = settings.globalPriorityOrder ?? [];
    const ordered = buildOrderedAccounts(providerAccounts, globalOrder);

    const cpOrder = settings.crossProviderPriorityOrder ?? globalOrder;
    const crossProviderOrdered = buildOrderedAccounts(providerAccounts, cpOrder);

    const activeAccount = ordered[0] ?? null;
    const uniqueProviders = [...new Set(providerAccounts.map(a => a.provider))];

    return {
      account: activeAccount,
      provider: activeAccount?.provider ?? null,
      isAnthropic: activeAccount?.provider === 'anthropic',
      connectedProviders: uniqueProviders,
      orderedAccounts: ordered,
      crossProviderOrderedAccounts: crossProviderOrdered,
    };
  }, [providerAccounts, settings.globalPriorityOrder, settings.crossProviderPriorityOrder]);
}
