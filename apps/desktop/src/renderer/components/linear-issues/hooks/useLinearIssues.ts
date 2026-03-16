import { useEffect, useCallback, useRef, useMemo, useState } from "react";
import type { LinearIssue, LinearSyncStatus } from "../../../../shared/types";
import type { LinearFilterState } from "../types";

interface LinearIssuesState {
  issues: LinearIssue[];
  syncStatus: LinearSyncStatus | null;
  isLoading: boolean;
  error: string | null;
  selectedIssueId: string | null;
  filterState: LinearFilterState;
}

export function useLinearIssues(projectId: string | undefined) {
  const [state, setState] = useState<LinearIssuesState>({
    issues: [],
    syncStatus: null,
    isLoading: false,
    error: null,
    selectedIssueId: null,
    filterState: "all",
  });

  const hasCheckedRef = useRef(false);
  const knownIssueIdsRef = useRef<Set<string>>(new Set());
  const [newIssues, setNewIssues] = useState<LinearIssue[]>([]);

  const checkConnection = useCallback(async (pid: string) => {
    try {
      const result = await window.electronAPI.checkLinearConnection(pid);
      if (result.success && result.data) {
        setState((prev) => ({
          ...prev,
          syncStatus: result.data as LinearSyncStatus,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          syncStatus: {
            connected: false,
            error: result.error || "Failed to check connection",
          },
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        syncStatus: {
          connected: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      }));
    }
  }, []);

  const loadIssues = useCallback(async (pid: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await window.electronAPI.getLinearIssues(pid);
      if (result.success && result.data) {
        const issues = result.data as LinearIssue[];

        // Detect new active issues (not completed/canceled)
        const detected: LinearIssue[] = [];
        if (knownIssueIdsRef.current.size > 0) {
          for (const issue of issues) {
            if (
              !knownIssueIdsRef.current.has(issue.id) &&
              issue.state.type !== "completed" &&
              issue.state.type !== "canceled"
            ) {
              detected.push(issue);
            }
          }
        }

        // Update known IDs
        knownIssueIdsRef.current = new Set(issues.map((i) => i.id));

        if (detected.length > 0) {
          setNewIssues(detected);
        }

        setState((prev) => ({
          ...prev,
          issues,
          isLoading: false,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          error: result.error || "Failed to load Linear issues",
          isLoading: false,
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      }));
    }
  }, []);

  // Check connection when component mounts or projectId changes
  useEffect(() => {
    if (projectId) {
      checkConnection(projectId);
      hasCheckedRef.current = true;
    }
  }, [projectId, checkConnection]);

  // Load issues when connection is established
  useEffect(() => {
    if (projectId && state.syncStatus?.connected) {
      loadIssues(projectId);
    }
  }, [projectId, state.syncStatus?.connected, loadIssues]);

  // Auto-refresh issues every 60 seconds while connected
  useEffect(() => {
    if (!projectId || !state.syncStatus?.connected) return;

    const interval = setInterval(() => {
      loadIssues(projectId);
    }, 60_000);

    return () => clearInterval(interval);
  }, [projectId, state.syncStatus?.connected, loadIssues]);

  const selectIssue = useCallback((issueId: string | null) => {
    setState((prev) => ({ ...prev, selectedIssueId: issueId }));
  }, []);

  const handleRefresh = useCallback(() => {
    if (projectId) {
      checkConnection(projectId);
      loadIssues(projectId);
    }
  }, [projectId, checkConnection, loadIssues]);

  const handleFilterChange = useCallback((filterState: LinearFilterState) => {
    setState((prev) => ({ ...prev, filterState }));
  }, []);

  const handleSearchStart = useCallback(() => {
    // No-op: Linear loads all issues at once, no need to refetch
  }, []);

  const handleSearchClear = useCallback(() => {
    // No-op: Linear loads all issues at once
  }, []);

  const clearNewIssues = useCallback(() => {
    setNewIssues([]);
  }, []);

  // Filter issues by state type
  // 'all' excludes completed/canceled by default — those are done
  const getFilteredIssues = useCallback((): LinearIssue[] => {
    const { issues, filterState } = state;
    if (filterState === "all") {
      return issues.filter(
        (issue) =>
          issue.state.type !== "completed" && issue.state.type !== "canceled",
      );
    }
    return issues.filter((issue) => issue.state.type === filterState);
  }, [state]);

  // Count active (non-completed, non-canceled) issues
  const getActiveIssuesCount = useCallback((): number => {
    return state.issues.filter(
      (issue) =>
        issue.state.type !== "completed" && issue.state.type !== "canceled",
    ).length;
  }, [state.issues]);

  // Compute selectedIssue from issues array
  const selectedIssue = useMemo(() => {
    return state.issues.find((i) => i.id === state.selectedIssueId) || null;
  }, [state.issues, state.selectedIssueId]);

  return {
    issues: state.issues,
    newIssues,
    clearNewIssues,
    syncStatus: state.syncStatus,
    isLoading: state.isLoading,
    error: state.error,
    selectedIssueId: state.selectedIssueId,
    selectedIssue,
    filterState: state.filterState,
    selectIssue,
    getFilteredIssues,
    getActiveIssuesCount,
    handleRefresh,
    handleFilterChange,
    handleSearchStart,
    handleSearchClear,
  };
}
