import { useEffect, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MultiRepoGitHubStatus, MultiRepoPRData } from '@shared/types';

/**
 * Creates a composite PR ID from repo name and PR number.
 * Format: `repoFullName#number` (e.g., `org/repo#123`)
 * Falls back to `#number` when repoFullName is empty (single-repo compat).
 */
export function makePRId(repoFullName: string | undefined, number: number): string {
  return `${repoFullName || ''}#${number}`;
}

/**
 * Parses a composite PR ID back into its parts.
 * Handles both `repoFullName#number` and `#number` formats.
 */
export function parsePRId(id: string): { repo: string; number: number } {
  const hashIndex = id.lastIndexOf('#');
  if (hashIndex === -1) {
    return { repo: '', number: Number.parseInt(id, 10) };
  }
  return {
    repo: id.slice(0, hashIndex),
    number: Number.parseInt(id.slice(hashIndex + 1), 10),
  };
}

interface MultiRepoPRState {
  prs: MultiRepoPRData[];
  repos: string[];
  selectedRepo: string; // 'all' or repoFullName
  isLoading: boolean;
  error: string | null;
  syncStatus: MultiRepoGitHubStatus | null;
  selectedPRId: string | null;
}

export function useMultiRepoGitHubPRs(customerId: string | undefined) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<MultiRepoPRState>({
    prs: [],
    repos: [],
    selectedRepo: 'all',
    isLoading: false,
    error: null,
    syncStatus: null,
    selectedPRId: null,
  });

  // Check multi-repo connection on mount/customerId change
  useEffect(() => {
    if (!customerId) return;

    const checkConnection = async () => {
      try {
        const result = await window.electronAPI.github.checkMultiRepoConnection(customerId);
        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            syncStatus: data,
            repos: data.repos.map(r => r.repoFullName),
          }));
        } else {
          setState(prev => ({
            ...prev,
            syncStatus: { connected: false, repos: [], error: result.error },
            error: result.error || t('prReview.multiRepo.failedToCheckConnection'),
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          syncStatus: { connected: false, repos: [], error: error instanceof Error ? error.message : t('prReview.multiRepo.unknownError') },
          error: error instanceof Error ? error.message : t('prReview.multiRepo.unknownError'),
        }));
      }
    };

    checkConnection();
  }, [customerId, t]);

  // Load PRs when connected
  useEffect(() => {
    if (!customerId || !state.syncStatus?.connected) return;

    const loadPRs = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await window.electronAPI.github.getMultiRepoPRs(customerId);

        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            prs: data.prs,
            repos: data.repos.length > 0 ? data.repos : prev.repos,
            isLoading: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            error: result.error || t('prReview.multiRepo.failedToLoadPRs'),
            isLoading: false,
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : t('prReview.multiRepo.unknownError'),
          isLoading: false,
        }));
      }
    };

    loadPRs();
  }, [customerId, state.syncStatus?.connected, t]);

  const selectPR = useCallback((prId: string | null) => {
    setState(prev => ({ ...prev, selectedPRId: prId }));
  }, []);

  const setSelectedRepo = useCallback((repo: string) => {
    setState(prev => ({ ...prev, selectedRepo: repo, selectedPRId: null }));
  }, []);

  const handleRefresh = useCallback(() => {
    if (!customerId) return;

    const refresh = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const connResult = await window.electronAPI.github.checkMultiRepoConnection(customerId);
        if (connResult.success && connResult.data) {
          const connData = connResult.data;
          setState(prev => ({
            ...prev,
            syncStatus: connData,
            repos: connData.repos.map(r => r.repoFullName),
          }));
        }

        const result = await window.electronAPI.github.getMultiRepoPRs(customerId);

        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            prs: data.prs,
            repos: data.repos.length > 0 ? data.repos : prev.repos,
            isLoading: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            error: result.error || t('prReview.multiRepo.failedToRefreshPRs'),
            isLoading: false,
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : t('prReview.multiRepo.unknownError'),
          isLoading: false,
        }));
      }
    };

    refresh();
  }, [customerId, t]);

  // Get filtered PRs based on selected repo
  const filteredPRs = useMemo((): MultiRepoPRData[] => {
    const { prs, selectedRepo } = state;
    if (selectedRepo === 'all') return prs;
    return prs.filter(pr => pr.repoFullName === selectedRepo);
  }, [state.prs, state.selectedRepo]);

  const selectedPR = useMemo(() => {
    if (!state.selectedPRId) return null;
    const { repo, number } = parsePRId(state.selectedPRId);
    return state.prs.find(pr =>
      pr.number === number && (repo === '' || pr.repoFullName === repo)
    ) || null;
  }, [state.prs, state.selectedPRId]);

  return {
    prs: filteredPRs,
    syncStatus: state.syncStatus,
    isLoading: state.isLoading,
    error: state.error,
    selectedPRId: state.selectedPRId,
    selectedPR,
    isConnected: state.syncStatus?.connected ?? false,
    selectPR,
    refresh: handleRefresh,
    // Multi-repo specific
    repos: state.repos,
    selectedRepo: state.selectedRepo,
    setSelectedRepo,
    isMultiRepo: true,
  };
}
