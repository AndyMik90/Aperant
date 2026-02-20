import { describe, it, expect, beforeEach, } from 'vitest';
import { act } from '@testing-library/react';
import { useInvestigationStore } from '../investigation-store';

describe('Investigation Store', () => {
  beforeEach(() => {
    // Reset store before each test
    useInvestigationStore.setState({ investigations: {}, settings: {} });
  });

  describe('getDerivedState', () => {
    it('returns new for non-existent investigation', () => {
      const state = useInvestigationStore.getState().getDerivedState('test-project', 999);
      expect(state).toBe('new');
    });

    it('returns queued when investigation is queued', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      // Manually set to queued phase
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              progress: { issueNumber: 42, phase: 'queued', progress: 0, message: 'Queued', agentStatuses: [], startedAt: new Date().toISOString() }
            }
          }
        });
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('queued');
    });

    it('returns investigating when investigation is in progress', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('investigating');
    });

    it('returns findings_ready when report exists without specId', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
        useInvestigationStore.getState().setResult('test-project', {
          issueNumber: 42,
          report: {
            rootCause: { agentType: 'root_cause', rootCause: 'test', codePaths: [], relatedIssues: [], summary: '', findings: [], codeReferences: [] },
            impact: { agentType: 'impact', severity: 'medium', affectedComponents: [], userImpact: '', riskIfUnfixed: '', summary: '', findings: [], codeReferences: [] },
            fixAdvice: { agentType: 'fix_advisor', suggestedApproaches: [], recommendedApproach: 0, patternsToFollow: [], summary: '', findings: [], codeReferences: [] },
            reproduction: { agentType: 'reproducer', reproducible: 'unknown', existingTests: [], testGaps: [], suggestedTests: [], summary: '', findings: [], codeReferences: [] },
            summary: 'Test',
            severity: 'medium',
            suggestedLabels: [],
            likelyResolved: false,
            linkedPRs: [],
            timestamp: new Date().toISOString(),
          },
          completedAt: new Date().toISOString(),
        });
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('findings_ready');
    });

    it('returns resolved when likelyResolved and no specId', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
        useInvestigationStore.getState().setResult('test-project', {
          issueNumber: 42,
          report: {
            rootCause: { agentType: 'root_cause', rootCause: 'test', codePaths: [], relatedIssues: [], summary: '', findings: [], codeReferences: [] },
            impact: { agentType: 'impact', severity: 'medium', affectedComponents: [], userImpact: '', riskIfUnfixed: '', summary: '', findings: [], codeReferences: [] },
            fixAdvice: { agentType: 'fix_advisor', suggestedApproaches: [], recommendedApproach: 0, patternsToFollow: [], summary: '', findings: [], codeReferences: [] },
            reproduction: { agentType: 'reproducer', reproducible: 'unknown', existingTests: [], testGaps: [], suggestedTests: [], summary: '', findings: [], codeReferences: [] },
            summary: 'Test',
            severity: 'medium',
            suggestedLabels: [],
            likelyResolved: true,
            linkedPRs: [],
            timestamp: new Date().toISOString(),
          },
          completedAt: new Date().toISOString(),
        });
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('resolved');
    });

    it('prioritizes linkedTaskStatus over likelyResolved when specId exists', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      // Add specId and likelyResolved
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              report: {
                rootCause: { agentType: 'root_cause', rootCause: 'test', codePaths: [], relatedIssues: [], summary: '', findings: [], codeReferences: [] },
                impact: { agentType: 'impact', severity: 'medium', affectedComponents: [], userImpact: '', riskIfUnfixed: '', summary: '', findings: [], codeReferences: [] },
                fixAdvice: { agentType: 'fix_advisor', suggestedApproaches: [], recommendedApproach: 0, patternsToFollow: [], summary: '', findings: [], codeReferences: [] },
                reproduction: { agentType: 'reproducer', reproducible: 'unknown', existingTests: [], testGaps: [], suggestedTests: [], summary: '', findings: [], codeReferences: [] },
                summary: 'Test',
                severity: 'medium',
                suggestedLabels: [],
                likelyResolved: true,
                linkedPRs: [],
                timestamp: new Date().toISOString(),
              },
              isInvestigating: false,
            }
          }
        });
      });
      // With specId but no linkedTaskStatus, should be task_created
      let state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('task_created');
      expect(state).not.toBe('resolved');

      // With linkedTaskStatus=building, should be building
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('building');
    });

    it('returns building when linkedTaskStatus is building', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('building');
    });

    it('returns done when linkedTaskStatus is done', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'done');
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('done');
    });

    it('returns task_created when specId exists but no linkedTaskStatus', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('task_created');
    });

    it('returns interrupted when error is investigation.interrupted and no specId', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
        useInvestigationStore.getState().setError('test-project', 42, 'investigation.interrupted');
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('interrupted');
    });

    it('returns failed when error exists and no specId', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
        useInvestigationStore.getState().setError('test-project', 42, 'Investigation failed');
      });
      const state = useInvestigationStore.getState().getDerivedState('test-project', 42);
      expect(state).toBe('failed');
    });
  });

  describe('syncTaskState', () => {
    it('should map in_progress status to building', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('building');
    });

    it('should map ai_review status to building', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'ai_review');
      });
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('building');
    });

    it('should map done status to done', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'done');
      });
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('done');
    });

    it('should map pr_created status to done', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'pr_created');
      });
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('done');
    });

    it('should map error status to failed', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'error');
      });
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('failed');
    });

    it('should not update when investigation has no specId', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      const key = 'test-project:42';
      const inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBeNull();
    });

    it('should prevent backward transition from done to building', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      // First transition to done
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'done');
      });
      let inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('done');

      // Try to go back to building (should be blocked)
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('done'); // Should remain done
    });

    it('should prevent backward transition from building to task_created', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      // Transition to building
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'in_progress');
      });
      let inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('building');

      // Try to set unknown status (would map to nothing, should not update)
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'unknown' as never);
      });
      inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('building'); // Should remain building
    });

    it('should allow failed status to override any state', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });
      const { investigations } = useInvestigationStore.getState();
      const key = 'test-project:42';
      act(() => {
        useInvestigationStore.setState({
          investigations: {
            ...investigations,
            [key]: {
              ...investigations[key]!,
              specId: '001',
              isInvestigating: false,
            }
          }
        });
      });
      // First transition to done
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'done');
      });
      let inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('done');

      // Error should override done
      act(() => {
        useInvestigationStore.getState().syncTaskState('test-project', 42, 'error');
      });
      inv = useInvestigationStore.getState().investigations[key];
      expect(inv?.linkedTaskStatus).toBe('failed');
    });
  });

  describe('loadPersistedInvestigations', () => {
    it('restores investigating status from persisted data', () => {
      act(() => {
        useInvestigationStore.getState().loadPersistedInvestigations('test-project', [{
          issueNumber: 42,
          status: 'investigating',
          hasResumeSessions: true,
          activityLog: [{ event: 'Investigation started', timestamp: '2026-02-20T11:01:43.307Z' }],
        }]);
      });

      const inv = useInvestigationStore.getState().getInvestigationState('test-project', 42);
      expect(inv?.isInvestigating).toBe(true);
      expect(inv?.error).toBeNull();
      expect(inv?.hasResumeSessions).toBe(true);
      expect(useInvestigationStore.getState().getDerivedState('test-project', 42)).toBe('investigating');
    });

    it('does not overwrite active in-memory investigation with failed persisted state', () => {
      act(() => {
        useInvestigationStore.getState().startInvestigation('test-project', 42);
      });

      act(() => {
        useInvestigationStore.getState().loadPersistedInvestigations('test-project', [{
          issueNumber: 42,
          status: 'failed',
        }]);
      });

      const inv = useInvestigationStore.getState().getInvestigationState('test-project', 42);
      expect(inv?.isInvestigating).toBe(true);
      expect(inv?.error).toBeNull();
    });
  });
});
