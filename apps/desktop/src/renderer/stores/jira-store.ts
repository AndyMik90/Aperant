import { create } from 'zustand';

export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: string;
  priority?: string;
  issueType: string;
  created: string;
  updated: string;
  labels: string[];
}

export interface JiraInvestigationStatus {
  phase: 'idle' | 'fetching' | 'analyzing' | 'creating' | 'complete' | 'error';
  issueKey?: string;
  progress: number;
  message: string;
  error?: string;
}

interface JiraState {
  // Data
  issues: JiraIssue[];
  connected: boolean;

  // UI State
  isLoading: boolean;
  error: string | null;
  selectedIssueKey: string | null;
  filterState: 'open' | 'closed' | 'all';
  searchQuery: string;

  // Investigation state
  investigationStatus: JiraInvestigationStatus;

  // Actions
  setIssues: (issues: JiraIssue[]) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectIssue: (key: string | null) => void;
  setFilterState: (state: 'open' | 'closed' | 'all') => void;
  setSearchQuery: (query: string) => void;
  setInvestigationStatus: (status: JiraInvestigationStatus) => void;
  clearIssues: () => void;

  // Selectors
  getSelectedIssue: () => JiraIssue | null;
  getFilteredIssues: () => JiraIssue[];
  getOpenIssuesCount: () => number;
}

// Statuses considered "closed/done" - everything else is "open"
const CLOSED_STATUSES = ['done', 'closed', 'resolved', 'complete', 'completed', 'cancelled', 'won\'t do', 'declined'];

function isOpenStatus(status: string): boolean {
  // Anything NOT closed is open (avoids missing custom JIRA statuses)
  return !CLOSED_STATUSES.includes(status.toLowerCase());
}

function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.includes(status.toLowerCase());
}

export const useJiraStore = create<JiraState>((set, get) => ({
  // Initial state
  issues: [],
  connected: false,
  isLoading: false,
  error: null,
  selectedIssueKey: null,
  filterState: 'open',
  searchQuery: '',
  investigationStatus: {
    phase: 'idle',
    progress: 0,
    message: ''
  },

  // Actions
  setIssues: (issues) => set({ issues, error: null }),

  setConnected: (connected) => set({ connected }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  selectIssue: (selectedIssueKey) => set({ selectedIssueKey }),

  setFilterState: (filterState) => set({ filterState }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setInvestigationStatus: (investigationStatus) => set({ investigationStatus }),

  clearIssues: () => set({
    issues: [],
    connected: false,
    selectedIssueKey: null,
    error: null,
    searchQuery: '',
    investigationStatus: { phase: 'idle', progress: 0, message: '' }
  }),

  // Selectors
  getSelectedIssue: () => {
    const { issues, selectedIssueKey } = get();
    return issues.find(i => i.key === selectedIssueKey) || null;
  },

  getFilteredIssues: () => {
    const { issues, filterState, searchQuery } = get();
    let filtered = issues;

    // Filter by status
    if (filterState === 'open') {
      filtered = filtered.filter(issue => isOpenStatus(issue.status));
    } else if (filterState === 'closed') {
      filtered = filtered.filter(issue => isClosedStatus(issue.status));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(issue =>
        issue.key.toLowerCase().includes(query) ||
        issue.summary.toLowerCase().includes(query) ||
        (issue.assignee && issue.assignee.toLowerCase().includes(query))
      );
    }

    return filtered;
  },

  getOpenIssuesCount: () => {
    const { issues } = get();
    return issues.filter(issue => isOpenStatus(issue.status)).length;
  }
}));

/**
 * Build JQL from the current filter state.
 */
function buildJql(projectKey: string, state: 'open' | 'closed' | 'all'): string {
  let jql = `project = "${projectKey}"`;
  if (state === 'open') {
    jql += ' AND statusCategory != Done';
  } else if (state === 'closed') {
    jql += ' AND statusCategory = Done';
  }
  jql += ' ORDER BY updated DESC';
  return jql;
}

/**
 * Parse a raw JIRA issue response into our JiraIssue shape.
 */
function parseJiraIssue(raw: Record<string, unknown>): JiraIssue {
  // Backend already transforms the issue (flattened, no fields wrapper)
  return {
    key: (raw.key as string) || '',
    summary: (raw.summary as string) || '',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    status: (raw.status as string) || 'Unknown',
    assignee: (raw.assignee as string) || undefined,
    priority: (raw.priority as string) || undefined,
    issueType: (raw.issueType as string) || 'Task',
    created: (raw.created as string) || '',
    updated: (raw.updated as string) || '',
    labels: (raw.labels as string[]) || []
  };
}

// Action functions for use outside of React components
export async function loadJiraIssues(projectId: string, projectKey: string, state?: 'open' | 'closed' | 'all'): Promise<void> {
  const store = useJiraStore.getState();
  store.setLoading(true);
  store.setError(null);

  if (state) {
    store.setFilterState(state);
  }

  const filterState = state || store.filterState;
  const jql = buildJql(projectKey, filterState);

  try {
    const result = await window.electronAPI.jiraSearchIssues(projectId, jql);
    if (result.success && result.data) {
      const issues = (result.data.issues || []).map(parseJiraIssue);
      store.setIssues(issues);
    } else {
      store.setError(result.error || 'Failed to load JIRA issues');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

export async function checkJiraConnection(projectId: string): Promise<boolean> {
  const store = useJiraStore.getState();

  try {
    const result = await window.electronAPI.jiraTestConnection(projectId);
    if (result.success) {
      store.setConnected(true);
      return true;
    } else {
      store.setConnected(false);
      store.setError(result.error || 'Failed to connect to JIRA');
      return false;
    }
  } catch (error) {
    store.setConnected(false);
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

export function investigateJiraIssue(projectId: string, issueKey: string): void {
  const store = useJiraStore.getState();
  store.setInvestigationStatus({
    phase: 'fetching',
    issueKey,
    progress: 0,
    message: 'Starting investigation...'
  });

  // TODO: Call window.electronAPI.jiraInvestigateIssue(projectId, issueKey) when IPC is available
  // For now, this is a placeholder. The InvestigationDialog handles the full flow.
}
