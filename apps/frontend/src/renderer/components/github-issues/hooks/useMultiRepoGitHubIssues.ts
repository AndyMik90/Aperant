import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import type { GitHubIssue, MultiRepoGitHubStatus } from '../../../../shared/types';
import type { FilterState } from '../types';

interface MultiRepoState {
  issues: GitHubIssue[];
  repos: string[];
  selectedRepo: string; // 'all' or repoFullName
  isLoading: boolean;
  error: string | null;
  syncStatus: MultiRepoGitHubStatus | null;
  selectedIssueNumber: number | null;
  filterState: FilterState;
}

export function useMultiRepoGitHubIssues(customerId: string | undefined) {
  const [state, setState] = useState<MultiRepoState>({
    issues: [],
    repos: [],
    selectedRepo: 'all',
    isLoading: false,
    error: null,
    syncStatus: null,
    selectedIssueNumber: null,
    filterState: 'open',
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

  // Load issues when connected or filter changes
  useEffect(() => {
    if (!customerId || !state.syncStatus?.connected) return;

    const loadIssues = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await window.electronAPI.github.getMultiRepoIssues(
          customerId,
          state.filterState
        );

        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            issues: data.issues,
            repos: data.repos.length > 0 ? data.repos : prev.repos,
            isLoading: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            error: result.error || 'Failed to load issues',
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

    loadIssues();
  }, [customerId, state.syncStatus?.connected, state.filterState]);

  const selectIssue = useCallback((issueNumber: number | null) => {
    setState(prev => ({ ...prev, selectedIssueNumber: issueNumber }));
  }, []);

  const setSelectedRepo = useCallback((repo: string) => {
    setState(prev => ({ ...prev, selectedRepo: repo, selectedIssueNumber: null }));
  }, []);

  const handleFilterChange = useCallback((filterState: FilterState) => {
    setState(prev => ({ ...prev, filterState, selectedIssueNumber: null }));
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

        const result = await window.electronAPI.github.getMultiRepoIssues(
          customerId,
          state.filterState
        );

        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            issues: data.issues,
            repos: data.repos.length > 0 ? data.repos : prev.repos,
            isLoading: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            error: result.error || 'Failed to refresh issues',
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
  }, [customerId, state.filterState]);

  // Get filtered issues based on selected repo
  const getFilteredIssues = useCallback((): GitHubIssue[] => {
    const { issues, selectedRepo, filterState } = state;
    let filtered = issues;

    // Filter by state
    if (filterState !== 'all') {
      filtered = filtered.filter(issue => issue.state === filterState);
    }

    // Filter by repo
    if (selectedRepo !== 'all') {
      filtered = filtered.filter(issue => issue.repoFullName === selectedRepo);
    }

    return filtered;
  }, [state]);

  const getOpenIssuesCount = useCallback((): number => {
    const { issues, selectedRepo } = state;
    let filtered = issues.filter(issue => issue.state === 'open');
    if (selectedRepo !== 'all') {
      filtered = filtered.filter(issue => issue.repoFullName === selectedRepo);
    }
    return filtered.length;
  }, [state]);

  const selectedIssue = useMemo(() => {
    return state.issues.find(i => i.number === state.selectedIssueNumber &&
      (state.selectedRepo === 'all' || i.repoFullName === state.selectedRepo)
    ) || null;
  }, [state.issues, state.selectedIssueNumber, state.selectedRepo]);

  return {
    issues: state.issues,
    syncStatus: state.syncStatus,
    isLoading: state.isLoading,
    isLoadingMore: false,
    error: state.error,
    selectedIssueNumber: state.selectedIssueNumber,
    selectedIssue,
    filterState: state.filterState,
    hasMore: false,
    selectIssue,
    getFilteredIssues,
    getOpenIssuesCount,
    handleRefresh,
    handleFilterChange,
    handleLoadMore: undefined,
    handleSearchStart: () => { /* no-op: multi-repo fetches all issues at once */ },
    handleSearchClear: () => { /* no-op: multi-repo fetches all issues at once */ },
    // Multi-repo specific
    repos: state.repos,
    selectedRepo: state.selectedRepo,
    setSelectedRepo,
    isMultiRepo: true,
  };
}
