import { useEffect, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitHubIssue, MultiRepoGitHubStatus } from '@shared/types';
import type { FilterState } from '@/components/github-issues/types';

/**
 * Creates a composite issue ID from repo name and issue number.
 * Format: `repoFullName#number` (e.g., `org/repo#123`)
 * Falls back to `#number` when repoFullName is empty (single-repo compat).
 */
export function makeIssueId(repoFullName: string | undefined, number: number): string {
  return `${repoFullName || ''}#${number}`;
}

/**
 * Parses a composite issue ID back into its parts.
 * Handles both `repoFullName#number` and `#number` formats.
 */
export function parseIssueId(id: string): { repo: string; number: number } {
  const hashIndex = id.lastIndexOf('#');
  if (hashIndex === -1) {
    return { repo: '', number: Number.parseInt(id, 10) || 0 };
  }
  return {
    repo: id.slice(0, hashIndex),
    number: Number.parseInt(id.slice(hashIndex + 1), 10) || 0,
  };
}

interface MultiRepoState {
  issues: GitHubIssue[];
  repos: string[];
  selectedRepo: string; // 'all' or repoFullName
  isLoading: boolean;
  error: string | null;
  syncStatus: MultiRepoGitHubStatus | null;
  selectedIssueId: string | null;
  filterState: FilterState;
}

export function useMultiRepoGitHubIssues(customerId: string | undefined) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<MultiRepoState>({
    issues: [],
    repos: [],
    selectedRepo: 'all',
    isLoading: false,
    error: null,
    syncStatus: null,
    selectedIssueId: null,
    filterState: 'open',
  });

  // Check multi-repo connection on mount/customerId change
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;

    const checkConnection = async () => {
      try {
        const result = await window.electronAPI.github.checkMultiRepoConnection(customerId);
        if (cancelled) return;
        if (result.success && result.data) {
          const data = result.data;
          setState(prev => ({
            ...prev,
            syncStatus: data,
            repos: data.repos.map((r: { projectId: string; repoFullName: string }) => r.repoFullName),
          }));
        } else {
          setState(prev => ({
            ...prev,
            syncStatus: { connected: false, repos: [], error: result.error },
            error: result.error || t('issues.multiRepo.failedToCheckConnection'),
          }));
        }
      } catch (error) {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : t('issues.multiRepo.unknownError'),
        }));
      }
    };

    checkConnection();
    return () => { cancelled = true; };
  }, [customerId, t]);

  // Load issues when connected or filter changes
  useEffect(() => {
    if (!customerId || !state.syncStatus?.connected) return;
    let cancelled = false;

    const loadIssues = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await window.electronAPI.github.getMultiRepoIssues(
          customerId,
          state.filterState
        );

        if (cancelled) return;
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
            error: result.error || t('issues.multiRepo.failedToLoadIssues'),
            isLoading: false,
          }));
        }
      } catch (error) {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : t('issues.multiRepo.unknownError'),
          isLoading: false,
        }));
      }
    };

    loadIssues();
    return () => { cancelled = true; };
  }, [customerId, state.syncStatus?.connected, state.filterState, t]);

  const selectIssue = useCallback((issueId: string | null) => {
    setState(prev => ({ ...prev, selectedIssueId: issueId }));
  }, []);

  const setSelectedRepo = useCallback((repo: string) => {
    setState(prev => ({ ...prev, selectedRepo: repo, selectedIssueId: null }));
  }, []);

  const handleFilterChange = useCallback((filterState: FilterState) => {
    setState(prev => ({ ...prev, filterState, selectedIssueId: null }));
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
            error: result.error || t('issues.multiRepo.failedToRefreshIssues'),
            isLoading: false,
          }));
        }
      } catch (error) {
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : t('issues.multiRepo.unknownError'),
          isLoading: false,
        }));
      }
    };

    refresh();
  }, [customerId, state.filterState, t]);

  // Get filtered issues based on selected repo
  // Note: state filtering is already done by the API via the `state` parameter
  const getFilteredIssues = useCallback((): GitHubIssue[] => {
    const { issues, selectedRepo } = state;

    // Filter by repo
    if (selectedRepo !== 'all') {
      return issues.filter(issue => issue.repoFullName === selectedRepo);
    }

    return issues;
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
    if (!state.selectedIssueId) return null;
    const { repo, number } = parseIssueId(state.selectedIssueId);
    return state.issues.find(i =>
      i.number === number && (repo === '' || i.repoFullName === repo)
    ) || null;
  }, [state.issues, state.selectedIssueId]);

  return {
    issues: state.issues,
    syncStatus: state.syncStatus,
    isLoading: state.isLoading,
    isLoadingMore: false,
    error: state.error,
    selectedIssueId: state.selectedIssueId,
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
