import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import type { ProviderAccount, ProviderAccountsPayload } from '../../shared/types';

function orderProviderAccounts(payload: ProviderAccountsPayload): ProviderAccount[] {
  const accountMap = new Map(payload.accounts.map((account) => [account.id, account]));
  const ordered = [
    ...payload.globalPriorityOrder,
    ...payload.disabledAutoSwitchAccountIds,
  ]
    .map((accountId) => accountMap.get(accountId))
    .filter((account): account is ProviderAccount => !!account);

  const orderedIds = new Set(ordered.map((account) => account.id));
  const remaining = payload.accounts.filter((account) => !orderedIds.has(account.id));

  return [...ordered, ...remaining];
}

export function useEffectiveExecutionProvider() {
  const activeProfileId = useSettingsStore((state) => state.activeProfileId);
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const loadProviderContext = async () => {
      try {
        const [switchResult, providerResult] = await Promise.all([
          window.electronAPI.getAutoSwitchSettings?.(),
          window.electronAPI.getProviderAccounts?.(),
        ]);

        if (cancelled) {
          return;
        }

        setDefaultProviderId(
          switchResult?.success ? switchResult.data?.defaultProviderId : undefined
        );

        if (providerResult?.success && providerResult.data) {
          setProviderAccounts(orderProviderAccounts(providerResult.data));
          return;
        }

        setProviderAccounts([]);
      } catch {
        if (!cancelled) {
          setProviderAccounts([]);
          setDefaultProviderId(undefined);
        }
      }
    };

    void loadProviderContext();

    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveProviderAccount = useMemo(() => {
    if (defaultProviderId) {
      const defaultAccount = providerAccounts.find((account) => account.id === defaultProviderId);
      if (defaultAccount) {
        return defaultAccount;
      }
    }

    if (activeProfileId) {
      const activeApiAccount = providerAccounts.find(
        (account) => account.provider === 'openai-compatible' && account.apiProfileId === activeProfileId
      );
      if (activeApiAccount) {
        return activeApiAccount;
      }
    }

    return providerAccounts[0];
  }, [activeProfileId, defaultProviderId, providerAccounts]);

  return {
    effectiveProviderAccount,
    providerAccounts,
  };
}
