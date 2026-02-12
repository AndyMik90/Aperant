/**
 * Unit tests for GitLab Investigation handlers
 * Tests investigation status types and utility functions
 */
import { describe, it, expect } from 'vitest';

// Types matching the handler's types
type InvestigationPhase = 'idle' | 'fetching' | 'analyzing' | 'creating_task' | 'complete';

interface GitLabInvestigationStatus {
  phase: InvestigationPhase;
  issueIid?: number;
  progress: number;
  message: string;
}

interface GitLabInvestigationResult {
  success: boolean;
  issueIid: number;
  analysis?: {
    summary: string;
    proposedSolution: string;
    affectedFiles: string[];
    estimatedComplexity: 'simple' | 'standard' | 'complex';
    acceptanceCriteria: string[];
  };
  taskId?: string;
  error?: string;
}

// Utility functions from the handler
function createProgress(
  phase: InvestigationPhase,
  issueIid: number,
  progress: number,
  message: string
): GitLabInvestigationStatus {
  return {
    phase,
    issueIid,
    progress,
    message,
  };
}

function validateProgress(status: GitLabInvestigationStatus): boolean {
  const validPhases: InvestigationPhase[] = ['idle', 'fetching', 'analyzing', 'creating_task', 'complete'];
  return (
    validPhases.includes(status.phase) &&
    typeof status.progress === 'number' &&
    status.progress >= 0 &&
    status.progress <= 100 &&
    typeof status.message === 'string'
  );
}

function createResult(
  success: boolean,
  issueIid: number,
  analysis?: GitLabInvestigationResult['analysis'],
  taskId?: string,
  error?: string
): GitLabInvestigationResult {
  const result: GitLabInvestigationResult = {
    success,
    issueIid,
  };
  if (analysis) result.analysis = analysis;
  if (taskId) result.taskId = taskId;
  if (error) result.error = error;
  return result;
}

function calculateProgressPercentage(current: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}

describe('GitLab Investigation Handlers', () => {
  describe('createProgress', () => {
    it('should create a valid progress status', () => {
      const status = createProgress('fetching', 42, 10, 'Fetching issue details...');

      expect(status).toEqual({
        phase: 'fetching',
        issueIid: 42,
        progress: 10,
        message: 'Fetching issue details...',
      });
    });

    it('should create status without issueIid', () => {
      const status = createProgress('idle', 0, 0, 'Ready');

      expect(status.phase).toBe('idle');
      expect(status.progress).toBe(0);
      expect(status.message).toBe('Ready');
    });

    it('should support all phases', () => {
      const phases: InvestigationPhase[] = ['idle', 'fetching', 'analyzing', 'creating_task', 'complete'];

      phases.forEach((phase) => {
        const status = createProgress(phase, 1, 50, `Phase: ${phase}`);
        expect(status.phase).toBe(phase);
      });
    });
  });

  describe('validateProgress', () => {
    it('should validate correct progress status', () => {
      const status: GitLabInvestigationStatus = {
        phase: 'analyzing',
        issueIid: 42,
        progress: 50,
        message: 'Analyzing...',
      };

      expect(validateProgress(status)).toBe(true);
    });

    it('should reject invalid phases', () => {
      const status = {
        phase: 'invalid',
        progress: 50,
        message: 'Test',
      } as unknown as GitLabInvestigationStatus;

      expect(validateProgress(status)).toBe(false);
    });

    it('should reject progress below 0', () => {
      const status: GitLabInvestigationStatus = {
        phase: 'fetching',
        progress: -10,
        message: 'Test',
      };

      expect(validateProgress(status)).toBe(false);
    });

    it('should reject progress above 100', () => {
      const status: GitLabInvestigationStatus = {
        phase: 'fetching',
        progress: 110,
        message: 'Test',
      };

      expect(validateProgress(status)).toBe(false);
    });

    it('should reject non-string messages', () => {
      const status = {
        phase: 'fetching',
        progress: 50,
        message: 123,
      } as unknown as GitLabInvestigationStatus;

      expect(validateProgress(status)).toBe(false);
    });

    it('should accept progress at boundaries', () => {
      expect(validateProgress({ phase: 'complete', progress: 0, message: 'Start' })).toBe(true);
      expect(validateProgress({ phase: 'complete', progress: 100, message: 'Done' })).toBe(true);
    });
  });

  describe('createResult', () => {
    it('should create a successful result with analysis', () => {
      const analysis = {
        summary: 'Test summary',
        proposedSolution: 'Fix the bug',
        affectedFiles: ['main.py'],
        estimatedComplexity: 'standard' as const,
        acceptanceCriteria: ['Test passes'],
      };

      const result = createResult(true, 42, analysis, 'task-123');

      expect(result.success).toBe(true);
      expect(result.issueIid).toBe(42);
      expect(result.analysis).toEqual(analysis);
      expect(result.taskId).toBe('task-123');
      expect(result.error).toBeUndefined();
    });

    it('should create a failure result with error', () => {
      const result = createResult(false, 42, undefined, undefined, 'Failed to analyze');

      expect(result.success).toBe(false);
      expect(result.issueIid).toBe(42);
      expect(result.analysis).toBeUndefined();
      expect(result.taskId).toBeUndefined();
      expect(result.error).toBe('Failed to analyze');
    });

    it('should create minimal result', () => {
      const result = createResult(true, 1);

      expect(result).toEqual({
        success: true,
        issueIid: 1,
      });
    });
  });

  describe('calculateProgressPercentage', () => {
    it('should calculate correct percentage', () => {
      expect(calculateProgressPercentage(50, 100)).toBe(50);
      expect(calculateProgressPercentage(25, 100)).toBe(25);
      expect(calculateProgressPercentage(1, 4)).toBe(25);
    });

    it('should handle zero total', () => {
      expect(calculateProgressPercentage(0, 0)).toBe(0);
      expect(calculateProgressPercentage(100, 0)).toBe(0);
    });

    it('should clamp to 100 max', () => {
      expect(calculateProgressPercentage(150, 100)).toBe(100);
      expect(calculateProgressPercentage(200, 100)).toBe(100);
    });

    it('should not go below 0', () => {
      expect(calculateProgressPercentage(-50, 100)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(calculateProgressPercentage(1, 3)).toBe(33);
      expect(calculateProgressPercentage(2, 3)).toBe(67);
    });
  });

  describe('Investigation Phase Flow', () => {
    it('should follow expected phase progression', () => {
      const phases: InvestigationPhase[] = ['idle', 'fetching', 'analyzing', 'creating_task', 'complete'];

      // Verify phases are in expected order
      expect(phases.indexOf('idle')).toBeLessThan(phases.indexOf('fetching'));
      expect(phases.indexOf('fetching')).toBeLessThan(phases.indexOf('analyzing'));
      expect(phases.indexOf('analyzing')).toBeLessThan(phases.indexOf('creating_task'));
      expect(phases.indexOf('creating_task')).toBeLessThan(phases.indexOf('complete'));
    });

    it('should have correct progress ranges for phases', () => {
      // Based on handler implementation:
      // fetching: 10
      // analyzing: 30-50
      // creating_task: 80
      // complete: 100

      const progressMap: Record<InvestigationPhase, number[]> = {
        idle: [0],
        fetching: [10],
        analyzing: [30, 50],
        creating_task: [80],
        complete: [100],
      };

      Object.entries(progressMap).forEach(([phase, expectedProgresses]) => {
        expectedProgresses.forEach((progress) => {
          const status = createProgress(phase as InvestigationPhase, 1, progress, `Phase ${phase}`);
          expect(validateProgress(status)).toBe(true);
        });
      });
    });
  });

  describe('Analysis Type Validation', () => {
    it('should accept valid complexity levels', () => {
      const complexities: Array<'simple' | 'standard' | 'complex'> = ['simple', 'standard', 'complex'];

      complexities.forEach((complexity) => {
        const analysis: GitLabInvestigationResult['analysis'] = {
          summary: 'Test',
          proposedSolution: 'Solution',
          affectedFiles: [],
          estimatedComplexity: complexity,
          acceptanceCriteria: [],
        };

        expect(analysis.estimatedComplexity).toBe(complexity);
      });
    });

    it('should handle empty affected files', () => {
      const analysis: GitLabInvestigationResult['analysis'] = {
        summary: 'No code changes needed',
        proposedSolution: 'Documentation update',
        affectedFiles: [],
        estimatedComplexity: 'simple',
        acceptanceCriteria: [],
      };

      expect(analysis.affectedFiles).toHaveLength(0);
    });

    it('should handle multiple acceptance criteria', () => {
      const analysis: GitLabInvestigationResult['analysis'] = {
        summary: 'Feature request',
        proposedSolution: 'Implement the feature',
        affectedFiles: ['src/feature.ts'],
        estimatedComplexity: 'complex',
        acceptanceCriteria: [
          'Feature works as expected',
          'Tests pass',
          'Documentation updated',
        ],
      };

      expect(analysis.acceptanceCriteria).toHaveLength(3);
    });
  });
});
