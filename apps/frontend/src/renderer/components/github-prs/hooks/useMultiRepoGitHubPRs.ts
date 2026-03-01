import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import type { MultiRepoGitHubStatus, MultiRepoPRData } from '../../../../shared/types';

interface MultiRepoPRState {
  prs: MultiRepoPRData[];
  repos: string[];
  selectedRepo: string; // 'all' or repoFullName
  isLoading: boolean;
  error: string | null;
  syncStatus: MultiRepoGitHubStatus | null;
  selectedPRNumber: number | null;
}

export function useMultiRepoGitHubPRs(customerId: string | undefined) {
  const [state, setState] = useState<MultiRepoPRState>({
    prs: [],
    repos: [],
    selectedRepo: 'all',
    isLoading: false,
    error: null,
    syncStatus: null,
    selectedPRNumber: null,
  });

  const hasCheckedRef = useRef(false);

  // Check multi-repo connection on mount/customerId change
  useEffect(() => {
    if (!customerId) return;

    hasCheckedRef.current = false;

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
          hasCheckedRef.current = true;
        } else {
          setState(prev => ({
            ...prev,
            syncStatus: { connected: false, repos: [], error: result.error },
            error: result.error || 'Failed to check multi-repo connection',
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    };

    checkConnection();
  }, [customerId]);

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
            error: result.error || 'Failed to load PRs',
            isLoading: false,
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Unknown error',
          isLoading: false,
        }));
      }
    };

    loadPRs();
  }, [customerId, state.syncStatus?.connected]);

  const selectPR = useCallback((prNumber: number | null) => {
    setState(prev => ({ ...prev, selectedPRNumber: prNumber }));
  }, []);

  const setSelectedRepo = useCallback((repo: string) => {
    setState(prev => ({ ...prev, selectedRepo: repo, selectedPRNumber: null }));
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
            error: result.error || 'Failed to refresh PRs',
            isLoading: false,
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Unknown error',
          isLoading: false,
        }));
      }
    };

    refresh();
  }, [customerId]);

  // Get filtered PRs based on selected repo
  const filteredPRs = useMemo((): MultiRepoPRData[] => {
    const { prs, selectedRepo } = state;
    if (selectedRepo === 'all') return prs;
    return prs.filter(pr => pr.repoFullName === selectedRepo);
  }, [state]);

  const selectedPR = useMemo(() => {
    return state.prs.find(pr => pr.number === state.selectedPRNumber &&
      (state.selectedRepo === 'all' || pr.repoFullName === state.selectedRepo)
    ) || null;
  }, [state.prs, state.selectedPRNumber, state.selectedRepo]);

  return {
    prs: filteredPRs,
    syncStatus: state.syncStatus,
    isLoading: state.isLoading,
    error: state.error,
    selectedPRNumber: state.selectedPRNumber,
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
