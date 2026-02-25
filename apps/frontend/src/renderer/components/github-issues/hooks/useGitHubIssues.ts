import { useEffect, useCallback, useRef, useMemo, useState } from "react";
import {
  useIssuesStore,
  useSyncStatusStore,
  loadGitHubIssues,
  loadMoreGitHubIssues,
  loadAllGitHubIssues,
  checkGitHubConnection,
} from "../../../stores/github";
import type { FilterState } from "../types";

export function useGitHubIssues(projectId: string | undefined) {
  const {
    issues,
    isLoading,
    isLoadingMore,
    error,
    selectedIssueNumber,
    filterState,
    hasMore,
    selectIssue,
    setFilterState,
    getFilteredIssues,
    getOpenIssuesCount,
  } = useIssuesStore();

  const { syncStatus } = useSyncStatusStore();

  // Track if we've checked connection for this mount
  const hasCheckedRef = useRef(false);

  // Track if search is active (need to load all issues for search)
  const [isSearchActive, setIsSearchActive] = useState(false);

  // Reset search state when projectId changes to prevent incorrect fetchAll mode
  useEffect(() => {
    setIsSearchActive(false);
  }, []);

  // Always check connection when component mounts or projectId changes
  useEffect(() => {
    if (projectId) {
      // Always check connection on mount (in case settings changed)
      checkGitHubConnection(projectId);
      hasCheckedRef.current = true;
    }
  }, [projectId]);

  // Load issues when filter changes or after connection is established
  // Note: isSearchActive is NOT in deps because handleSearchStart/handleSearchClear
  // already handle loading issues when search state changes. Including it would cause
  // duplicate API calls.
  useEffect(() => {
    if (projectId && syncStatus?.connected) {
      // If search is active, load all issues for complete search
      loadGitHubIssues(projectId, filterState, isSearchActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filterState, syncStatus?.connected, isSearchActive]);

  const handleRefresh = useCallback(() => {
    if (projectId) {
      // Re-check connection and reload issues
      checkGitHubConnection(projectId);
      loadGitHubIssues(projectId, filterState, isSearchActive);
    }
  }, [projectId, filterState, isSearchActive]);

  const handleFilterChange = useCallback(
    (state: FilterState) => {
      // Only update filter state - useEffect handles loading when filterState changes
      // This prevents duplicate API calls
      setFilterState(state);
    },
    [setFilterState]
  );

  const handleLoadMore = useCallback(() => {
    if (projectId && !isSearchActive) {
      loadMoreGitHubIssues(projectId, filterState);
    }
  }, [projectId, filterState, isSearchActive]);

  // When user starts searching, load all issues
  const handleSearchStart = useCallback(() => {
    if (!isSearchActive && projectId) {
      setIsSearchActive(true);
      // Load all issues for search
      loadAllGitHubIssues(projectId, filterState);
    }
  }, [isSearchActive, projectId, filterState]);

  // When user clears search, reset to paginated mode
  const handleSearchClear = useCallback(() => {
    if (isSearchActive && projectId) {
      setIsSearchActive(false);
      // Reset to paginated loading
      loadGitHubIssues(projectId, filterState, false);
    }
  }, [isSearchActive, projectId, filterState]);

  // Compute selectedIssue from issues array
  const selectedIssue = useMemo(() => {
    return issues.find((i) => i.number === selectedIssueNumber) || null;
  }, [issues, selectedIssueNumber]);

  return {
    issues,
    syncStatus,
    isLoading,
    isLoadingMore,
    error,
    selectedIssueNumber,
    selectedIssue,
    filterState,
    hasMore: !isSearchActive && hasMore, // No "load more" when search is active
    selectIssue,
    getFilteredIssues,
    getOpenIssuesCount,
    handleRefresh,
    handleFilterChange,
    handleLoadMore,
    handleSearchStart,
    handleSearchClear,
  };
}
