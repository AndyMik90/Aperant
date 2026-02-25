import { create } from 'zustand';
import type { GitHubIssue } from '../../../shared/types';

export type IssueFilterState = 'open' | 'closed' | 'all';

interface IssuesState {
  // Data
  issues: GitHubIssue[];

  // UI State
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  selectedIssueNumber: number | null;
  filterState: IssueFilterState;

  // Pagination
  currentPage: number;
  hasMore: boolean;

  // Actions
  setIssues: (issues: GitHubIssue[]) => void;
  appendIssues: (issues: GitHubIssue[]) => void;
  addIssue: (issue: GitHubIssue) => void;
  updateIssue: (issueNumber: number, updates: Partial<GitHubIssue>) => void;
  setLoading: (loading: boolean) => void;
  setLoadingMore: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectIssue: (issueNumber: number | null) => void;
  setFilterState: (state: IssueFilterState) => void;
  setHasMore: (hasMore: boolean) => void;
  setCurrentPage: (page: number) => void;
  clearIssues: () => void;
  resetPagination: () => void;

  // Selectors
  getSelectedIssue: () => GitHubIssue | null;
  getFilteredIssues: () => GitHubIssue[];
  getOpenIssuesCount: () => number;
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  // Initial state
  issues: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  selectedIssueNumber: null,
  filterState: 'open',
  currentPage: 1,
  hasMore: true,

  // Actions
  setIssues: (issues) => set({ issues, error: null }),

  appendIssues: (newIssues) => set((state) => {
    // Deduplicate by issue number
    const existingNumbers = new Set(state.issues.map(i => i.number));
    const uniqueNewIssues = newIssues.filter(i => !existingNumbers.has(i.number));
    return { issues: [...state.issues, ...uniqueNewIssues] };
  }),

  addIssue: (issue) => set((state) => ({
    issues: [issue, ...state.issues.filter(i => i.number !== issue.number)]
  })),

  updateIssue: (issueNumber, updates) => set((state) => ({
    issues: state.issues.map(issue =>
      issue.number === issueNumber ? { ...issue, ...updates } : issue
    )
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setLoadingMore: (isLoadingMore) => set({ isLoadingMore }),

  setError: (error) => set({ error, isLoading: false, isLoadingMore: false }),

  selectIssue: (selectedIssueNumber) => set({ selectedIssueNumber }),

  setFilterState: (filterState) => set({ filterState }),

  setHasMore: (hasMore) => set({ hasMore }),

  setCurrentPage: (currentPage) => set({ currentPage }),

  clearIssues: () => set({
    issues: [],
    selectedIssueNumber: null,
    error: null,
    currentPage: 1,
    hasMore: true
  }),

  resetPagination: () => set({
    currentPage: 1,
    hasMore: true,
    // Clear selection when resetting pagination to prevent orphaned selections
    // (e.g., when clearing search, the selected issue may no longer be in the results)
    selectedIssueNumber: null
  }),

  // Selectors
  getSelectedIssue: () => {
    const { issues, selectedIssueNumber } = get();
    return issues.find(i => i.number === selectedIssueNumber) || null;
  },

  getFilteredIssues: () => {
    const { issues, filterState } = get();
    if (filterState === 'all') return issues;
    return issues.filter(issue => issue.state === filterState);
  },

  getOpenIssuesCount: () => {
    const { issues } = get();
    return issues.filter(issue => issue.state === 'open').length;
  }
}));

// Action functions for use outside of React components

/**
 * Load GitHub issues with pagination support
 * @param projectId - The project ID
 * @param state - Filter state (open/closed/all)
 * @param fetchAll - If true, fetches all issues (for search). Default: false (paginated)
 */
export async function loadGitHubIssues(
  projectId: string,
  state?: IssueFilterState,
  fetchAll: boolean = false
): Promise<void> {
  const store = useIssuesStore.getState();
  store.setLoading(true);
  store.setError(null);
  store.resetPagination();

  try {
    const result = await window.electronAPI.getGitHubIssues(projectId, state, 1, fetchAll);
    if (result.success && result.data) {
      store.setIssues(result.data.issues);
      store.setHasMore(result.data.hasMore);
      store.setCurrentPage(1);
    } else {
      store.setError(result.error || 'Failed to load GitHub issues');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Load more issues (for infinite scroll)
 */
export async function loadMoreGitHubIssues(
  projectId: string,
  state?: IssueFilterState
): Promise<void> {
  const store = useIssuesStore.getState();

  // Don't load more if already loading or no more to load
  if (store.isLoadingMore || store.isLoading || !store.hasMore) {
    return;
  }

  // Capture filter state at request start to detect if it changes during the async call
  const originalFilterState = store.filterState;
  const nextPage = store.currentPage + 1;

  store.setLoadingMore(true);

  try {
    const result = await window.electronAPI.getGitHubIssues(projectId, state, nextPage, false);

    // Verify filter state hasn't changed during the async operation
    // This prevents appending stale data from a different filter
    const currentState = useIssuesStore.getState();
    if (currentState.filterState !== originalFilterState) {
      // Filter changed while loading - discard results
      return;
    }

    if (result.success && result.data) {
      store.appendIssues(result.data.issues);
      store.setHasMore(result.data.hasMore);
      store.setCurrentPage(nextPage);
    } else {
      store.setError(result.error || 'Failed to load more issues');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoadingMore(false);
  }
}

/**
 * Load ALL issues (for search functionality)
 * This fetches all pages so search can work across all issues
 */
export async function loadAllGitHubIssues(
  projectId: string,
  state?: IssueFilterState
): Promise<void> {
  return loadGitHubIssues(projectId, state, true);
}

export async function importGitHubIssues(
  projectId: string,
  issueNumbers: number[]
): Promise<boolean> {
  const store = useIssuesStore.getState();
  store.setLoading(true);

  try {
    const result = await window.electronAPI.importGitHubIssues(projectId, issueNumbers);
    if (result.success) {
      return true;
    } else {
      store.setError(result.error || 'Failed to import GitHub issues');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  } finally {
    store.setLoading(false);
  }
}
