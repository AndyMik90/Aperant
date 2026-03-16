import { create } from 'zustand';
import type { LinearIssue } from '../../../shared/types';

export type LinearIssueFilterState = 'all' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

interface LinearIssuesState {
  // Data
  issues: LinearIssue[];

  // UI State
  isLoading: boolean;
  error: string | null;
  selectedIssueId: string | null;
  filterState: LinearIssueFilterState;

  // Actions
  setIssues: (issues: LinearIssue[]) => void;
  addIssue: (issue: LinearIssue) => void;
  updateIssue: (issueId: string, updates: Partial<LinearIssue>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectIssue: (issueId: string | null) => void;
  setFilterState: (state: LinearIssueFilterState) => void;
  clearIssues: () => void;

  // Selectors
  getSelectedIssue: () => LinearIssue | null;
  getFilteredIssues: () => LinearIssue[];
  getActiveIssuesCount: () => number;
}

export const useLinearIssuesStore = create<LinearIssuesState>((set, get) => ({
  // Initial state
  issues: [],
  isLoading: false,
  error: null,
  selectedIssueId: null,
  filterState: 'all',

  // Actions
  setIssues: (issues) => set({ issues, error: null }),

  addIssue: (issue) => set((state) => ({
    issues: [issue, ...state.issues.filter(i => i.id !== issue.id)]
  })),

  updateIssue: (issueId, updates) => set((state) => ({
    issues: state.issues.map(issue =>
      issue.id === issueId ? { ...issue, ...updates } : issue
    )
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  selectIssue: (selectedIssueId) => set({ selectedIssueId }),

  setFilterState: (filterState) => set({ filterState }),

  clearIssues: () => set({
    issues: [],
    selectedIssueId: null,
    error: null
  }),

  // Selectors
  getSelectedIssue: () => {
    const { issues, selectedIssueId } = get();
    return issues.find(i => i.id === selectedIssueId) || null;
  },

  getFilteredIssues: () => {
    const { issues, filterState } = get();
    if (filterState === 'all') return issues;
    return issues.filter(issue => issue.state.type === filterState);
  },

  getActiveIssuesCount: () => {
    const { issues } = get();
    return issues.filter(issue =>
      issue.state.type === 'started' || issue.state.type === 'unstarted'
    ).length;
  }
}));

// Action functions for use outside of React components

/**
 * Load Linear issues for a project
 * @param projectId - The project ID
 * @param teamId - Optional Linear team ID to filter by
 * @param linearProjectId - Optional Linear project ID to filter by
 */
export async function loadLinearIssues(
  projectId: string,
  teamId?: string,
  linearProjectId?: string
): Promise<void> {
  const store = useLinearIssuesStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getLinearIssues(projectId, teamId, linearProjectId);
    if (result.success && result.data) {
      store.setIssues(result.data);
    } else {
      store.setError(result.error || 'Failed to load Linear issues');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Import Linear issues as tasks
 */
export async function importLinearIssues(
  projectId: string,
  issueIds: string[]
): Promise<boolean> {
  const store = useLinearIssuesStore.getState();
  store.setLoading(true);

  try {
    const result = await window.electronAPI.importLinearIssues(projectId, issueIds);
    if (result.success) {
      return true;
    } else {
      store.setError(result.error || 'Failed to import Linear issues');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  } finally {
    store.setLoading(false);
  }
}
