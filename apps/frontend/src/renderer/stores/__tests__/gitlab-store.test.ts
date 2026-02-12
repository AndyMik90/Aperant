/**
 * Unit tests for GitLab Store (Zustand)
 * Tests state management for GitLab issues
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGitLabStore } from '../gitlab-store';
import type {
  GitLabIssue,
  GitLabSyncStatus,
  GitLabInvestigationStatus,
  GitLabInvestigationResult,
} from '@shared/types';

// Helper to create test issues
function createTestIssue(overrides: Partial<GitLabIssue> = {}): GitLabIssue {
  return {
    id: Math.floor(Math.random() * 10000),
    iid: Math.floor(Math.random() * 100),
    title: 'Test Issue',
    state: 'opened',
    labels: [],
    assignees: [],
    author: { username: 'testuser' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    webUrl: 'https://gitlab.com/test/project/-/issues/1',
    projectPathWithNamespace: 'test/project',
    userNotesCount: 0,
    ...overrides,
  };
}

// Helper to create test investigation result
function createTestInvestigationResult(
  overrides: Partial<GitLabInvestigationResult> = {}
): GitLabInvestigationResult {
  return {
    success: true,
    issueIid: 1,
    analysis: {
      summary: 'Test summary',
      proposedSolution: 'Fix it',
      affectedFiles: ['main.py'],
      estimatedComplexity: 'standard',
      acceptanceCriteria: ['Tests pass'],
    },
    ...overrides,
  };
}

describe('GitLab Store', () => {
  beforeEach(() => {
    // Reset store before each test
    useGitLabStore.setState({
      issues: [],
      syncStatus: null,
      isLoading: false,
      error: null,
      selectedIssueIid: null,
      filterState: 'opened',
      investigationStatus: {
        phase: 'idle',
        progress: 0,
        message: '',
      },
      lastInvestigationResult: null,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useGitLabStore.getState();

      expect(state.issues).toEqual([]);
      expect(state.syncStatus).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.selectedIssueIid).toBeNull();
      expect(state.filterState).toBe('opened');
      expect(state.investigationStatus.phase).toBe('idle');
      expect(state.lastInvestigationResult).toBeNull();
    });
  });

  describe('setIssues', () => {
    it('should set issues and clear error', () => {
      const issues = [createTestIssue({ iid: 1 }), createTestIssue({ iid: 2 })];

      useGitLabStore.getState().setIssues(issues);
      const state = useGitLabStore.getState();

      expect(state.issues).toEqual(issues);
      expect(state.error).toBeNull();
    });

    it('should replace existing issues', () => {
      const issue1 = createTestIssue({ iid: 1 });
      const issue2 = createTestIssue({ iid: 2 });
      const issue3 = createTestIssue({ iid: 3 });

      useGitLabStore.getState().setIssues([issue1]);
      useGitLabStore.getState().setIssues([issue2, issue3]);

      expect(useGitLabStore.getState().issues).toEqual([issue2, issue3]);
    });
  });

  describe('addIssue', () => {
    it('should add issue to the beginning', () => {
      const issue1 = createTestIssue({ iid: 1 });
      const issue2 = createTestIssue({ iid: 2 });

      useGitLabStore.getState().setIssues([issue1]);
      useGitLabStore.getState().addIssue(issue2);

      const issues = useGitLabStore.getState().issues;
      expect(issues[0]).toEqual(issue2);
      expect(issues[1]).toEqual(issue1);
    });

    it('should replace existing issue with same iid', () => {
      const issue1 = createTestIssue({ iid: 1, title: 'Original' });
      const issue1Updated = createTestIssue({ iid: 1, title: 'Updated' });

      useGitLabStore.getState().setIssues([issue1]);
      useGitLabStore.getState().addIssue(issue1Updated);

      const issues = useGitLabStore.getState().issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('Updated');
    });
  });

  describe('updateIssue', () => {
    it('should update existing issue', () => {
      const issue = createTestIssue({ iid: 1, title: 'Original' });
      useGitLabStore.getState().setIssues([issue]);

      useGitLabStore.getState().updateIssue(1, { title: 'Updated' });

      const state = useGitLabStore.getState();
      expect(state.issues[0].title).toBe('Updated');
    });

    it('should not modify other issues', () => {
      const issue1 = createTestIssue({ iid: 1, title: 'Issue 1' });
      const issue2 = createTestIssue({ iid: 2, title: 'Issue 2' });
      useGitLabStore.getState().setIssues([issue1, issue2]);

      useGitLabStore.getState().updateIssue(1, { title: 'Updated' });

      const state = useGitLabStore.getState();
      expect(state.issues[0].title).toBe('Updated');
      expect(state.issues[1].title).toBe('Issue 2');
    });

    it('should handle non-existent issue', () => {
      const issue = createTestIssue({ iid: 1 });
      useGitLabStore.getState().setIssues([issue]);

      // Should not throw
      useGitLabStore.getState().updateIssue(999, { title: 'Updated' });

      expect(useGitLabStore.getState().issues).toHaveLength(1);
    });
  });

  describe('setSyncStatus', () => {
    it('should set sync status', () => {
      const status: GitLabSyncStatus = {
        connected: true,
        instanceUrl: 'https://gitlab.com',
        projectPathWithNamespace: 'test/project',
      };

      useGitLabStore.getState().setSyncStatus(status);

      expect(useGitLabStore.getState().syncStatus).toEqual(status);
    });

    it('should allow setting null', () => {
      useGitLabStore.getState().setSyncStatus({
        connected: true,
        instanceUrl: 'https://gitlab.com',
      });

      useGitLabStore.getState().setSyncStatus(null);

      expect(useGitLabStore.getState().syncStatus).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('should set loading state', () => {
      useGitLabStore.getState().setLoading(true);
      expect(useGitLabStore.getState().isLoading).toBe(true);

      useGitLabStore.getState().setLoading(false);
      expect(useGitLabStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error and stop loading', () => {
      useGitLabStore.getState().setLoading(true);
      useGitLabStore.getState().setError('Test error');

      const state = useGitLabStore.getState();
      expect(state.error).toBe('Test error');
      expect(state.isLoading).toBe(false);
    });

    it('should allow clearing error', () => {
      useGitLabStore.getState().setError('Error');
      useGitLabStore.getState().setError(null);

      expect(useGitLabStore.getState().error).toBeNull();
    });
  });

  describe('selectIssue', () => {
    it('should select issue by iid', () => {
      useGitLabStore.getState().selectIssue(42);
      expect(useGitLabStore.getState().selectedIssueIid).toBe(42);
    });

    it('should allow deselecting', () => {
      useGitLabStore.getState().selectIssue(42);
      useGitLabStore.getState().selectIssue(null);

      expect(useGitLabStore.getState().selectedIssueIid).toBeNull();
    });
  });

  describe('setFilterState', () => {
    it('should set filter state', () => {
      useGitLabStore.getState().setFilterState('closed');
      expect(useGitLabStore.getState().filterState).toBe('closed');

      useGitLabStore.getState().setFilterState('all');
      expect(useGitLabStore.getState().filterState).toBe('all');

      useGitLabStore.getState().setFilterState('opened');
      expect(useGitLabStore.getState().filterState).toBe('opened');
    });
  });

  describe('setInvestigationStatus', () => {
    it('should set investigation status', () => {
      const status: GitLabInvestigationStatus = {
        phase: 'fetching',
        issueIid: 1,
        progress: 50,
        message: 'Fetching issue...',
      };

      useGitLabStore.getState().setInvestigationStatus(status);

      expect(useGitLabStore.getState().investigationStatus).toEqual(status);
    });
  });

  describe('setInvestigationResult', () => {
    it('should set investigation result', () => {
      const result = createTestInvestigationResult({
        taskId: 'task-123',
      });

      useGitLabStore.getState().setInvestigationResult(result);

      expect(useGitLabStore.getState().lastInvestigationResult).toEqual(result);
    });

    it('should allow clearing result', () => {
      useGitLabStore.getState().setInvestigationResult(createTestInvestigationResult());

      useGitLabStore.getState().setInvestigationResult(null);

      expect(useGitLabStore.getState().lastInvestigationResult).toBeNull();
    });
  });

  describe('clearIssues', () => {
    it('should clear all issues and reset state', () => {
      const issue = createTestIssue();
      useGitLabStore.getState().setIssues([issue]);
      useGitLabStore.getState().selectIssue(1);
      useGitLabStore.getState().setError('Error');
      useGitLabStore.getState().setInvestigationStatus({
        phase: 'analyzing',
        progress: 50,
        message: 'Analyzing...',
      });

      useGitLabStore.getState().clearIssues();

      const state = useGitLabStore.getState();
      expect(state.issues).toEqual([]);
      expect(state.syncStatus).toBeNull();
      expect(state.selectedIssueIid).toBeNull();
      expect(state.error).toBeNull();
      expect(state.investigationStatus.phase).toBe('idle');
      expect(state.lastInvestigationResult).toBeNull();
    });
  });

  describe('Selectors', () => {
    describe('getSelectedIssue', () => {
      it('should return selected issue', () => {
        const issue1 = createTestIssue({ iid: 1 });
        const issue2 = createTestIssue({ iid: 2 });
        useGitLabStore.getState().setIssues([issue1, issue2]);
        useGitLabStore.getState().selectIssue(2);

        const selected = useGitLabStore.getState().getSelectedIssue();

        expect(selected).toEqual(issue2);
      });

      it('should return null when no issue selected', () => {
        const issue = createTestIssue();
        useGitLabStore.getState().setIssues([issue]);

        expect(useGitLabStore.getState().getSelectedIssue()).toBeNull();
      });

      it('should return null when selected issue not found', () => {
        const issue = createTestIssue({ iid: 1 });
        useGitLabStore.getState().setIssues([issue]);
        useGitLabStore.getState().selectIssue(999);

        expect(useGitLabStore.getState().getSelectedIssue()).toBeNull();
      });
    });

    describe('getFilteredIssues', () => {
      it('should filter opened issues', () => {
        const opened = createTestIssue({ iid: 1, state: 'opened' });
        const closed = createTestIssue({ iid: 2, state: 'closed' });
        useGitLabStore.getState().setIssues([opened, closed]);
        useGitLabStore.getState().setFilterState('opened');

        const filtered = useGitLabStore.getState().getFilteredIssues();

        expect(filtered).toHaveLength(1);
        expect(filtered[0].state).toBe('opened');
      });

      it('should filter closed issues', () => {
        const opened = createTestIssue({ iid: 1, state: 'opened' });
        const closed = createTestIssue({ iid: 2, state: 'closed' });
        useGitLabStore.getState().setIssues([opened, closed]);
        useGitLabStore.getState().setFilterState('closed');

        const filtered = useGitLabStore.getState().getFilteredIssues();

        expect(filtered).toHaveLength(1);
        expect(filtered[0].state).toBe('closed');
      });

      it('should return all issues when filter is all', () => {
        const opened = createTestIssue({ iid: 1, state: 'opened' });
        const closed = createTestIssue({ iid: 2, state: 'closed' });
        useGitLabStore.getState().setIssues([opened, closed]);
        useGitLabStore.getState().setFilterState('all');

        const filtered = useGitLabStore.getState().getFilteredIssues();

        expect(filtered).toHaveLength(2);
      });
    });

    describe('getOpenIssuesCount', () => {
      it('should count opened issues', () => {
        const issues = [
          createTestIssue({ iid: 1, state: 'opened' }),
          createTestIssue({ iid: 2, state: 'opened' }),
          createTestIssue({ iid: 3, state: 'closed' }),
          createTestIssue({ iid: 4, state: 'opened' }),
        ];
        useGitLabStore.getState().setIssues(issues);

        expect(useGitLabStore.getState().getOpenIssuesCount()).toBe(3);
      });

      it('should return 0 for empty issues', () => {
        expect(useGitLabStore.getState().getOpenIssuesCount()).toBe(0);
      });
    });
  });

  describe('State Transitions', () => {
    it('should handle loading -> success flow', () => {
      const issue = createTestIssue();

      useGitLabStore.getState().setLoading(true);
      expect(useGitLabStore.getState().isLoading).toBe(true);

      useGitLabStore.getState().setIssues([issue]);
      expect(useGitLabStore.getState().isLoading).toBe(true); // setIssues doesn't change loading

      useGitLabStore.getState().setLoading(false);
      expect(useGitLabStore.getState().isLoading).toBe(false);
    });

    it('should handle loading -> error flow', () => {
      useGitLabStore.getState().setLoading(true);
      expect(useGitLabStore.getState().isLoading).toBe(true);

      useGitLabStore.getState().setError('Failed to load');
      expect(useGitLabStore.getState().isLoading).toBe(false);
      expect(useGitLabStore.getState().error).toBe('Failed to load');
    });

    it('should handle investigation flow', () => {
      // Start investigation
      useGitLabStore.getState().setInvestigationStatus({
        phase: 'fetching',
        issueIid: 1,
        progress: 10,
        message: 'Fetching...',
      });
      expect(useGitLabStore.getState().investigationStatus.phase).toBe('fetching');

      // Progress
      useGitLabStore.getState().setInvestigationStatus({
        phase: 'analyzing',
        issueIid: 1,
        progress: 50,
        message: 'Analyzing...',
      });
      expect(useGitLabStore.getState().investigationStatus.phase).toBe('analyzing');

      // Complete
      useGitLabStore.getState().setInvestigationStatus({
        phase: 'complete',
        issueIid: 1,
        progress: 100,
        message: 'Done',
      });
      useGitLabStore.getState().setInvestigationResult(
        createTestInvestigationResult({ taskId: 'task-123' })
      );

      expect(useGitLabStore.getState().investigationStatus.phase).toBe('complete');
      expect(useGitLabStore.getState().lastInvestigationResult?.taskId).toBe('task-123');
    });
  });
});
