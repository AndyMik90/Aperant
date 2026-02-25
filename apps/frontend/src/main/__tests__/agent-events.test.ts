/**
 * Agent Events Tests
 * ===================
 * Tests phase transition logic, regression prevention, and fallback text matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEvents } from '../agent/agent-events';
import type { ExecutionProgressData } from '../agent/types';

describe('AgentEvents', () => {
  let agentEvents: AgentEvents;

  beforeEach(() => {
    agentEvents = new AgentEvents();
  });

  describe('parseExecutionPhase', () => {
    describe('Structured Event Priority', () => {
      it('should prioritize structured events over text matching', () => {
        // Line contains both structured event and text that would match fallback
        const line = '__EXEC_PHASE__:{"phase":"complete","message":"Done"} also contains qa reviewer text';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('complete');
        expect(result?.message).toBe('Done');
      });

      it('should use structured event phase value', () => {
        const line = '__EXEC_PHASE__:{"phase":"qa_fixing","message":"Fixing issues"}';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        expect(result?.phase).toBe('qa_fixing');
      });

      it('should pass through message from structured event', () => {
        const line = '__EXEC_PHASE__:{"phase":"coding","message":"Custom message here"}';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.message).toBe('Custom message here');
      });

      it('should pass through subtask from structured event', () => {
        const line = '__EXEC_PHASE__:{"phase":"coding","message":"Working","subtask":"task-123"}';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.currentSubtask).toBe('task-123');
      });
    });

    describe('Phase Regression Prevention', () => {
      it('should not regress from qa_review to coding via fallback', () => {
        const line = 'coder agent starting'; // Would normally trigger coding phase
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        // Should not change phase backwards
        expect(result).toBeNull();
      });

      it('should not regress from qa_fixing to coding via fallback', () => {
        const line = 'starting coder';
        const result = agentEvents.parseExecutionPhase(line, 'qa_fixing', false);

        expect(result).toBeNull();
      });

      it('should not regress from qa_review to planning via fallback', () => {
        const line = 'planner agent running';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        expect(result).toBeNull();
      });

      it('should not change complete phase via fallback', () => {
        const line = 'coder agent starting new work';
        const result = agentEvents.parseExecutionPhase(line, 'complete', false);

        expect(result).toBeNull();
      });

      it('should not change failed phase via fallback', () => {
        const line = 'starting qa reviewer';
        const result = agentEvents.parseExecutionPhase(line, 'failed', false);

        expect(result).toBeNull();
      });

      it('should allow forward progression via fallback', () => {
        const line = 'starting qa reviewer';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('qa_review');
      });

      it('should allow structured events to set any phase (override regression)', () => {
        // Structured events are authoritative and can set any phase
        const line = '__EXEC_PHASE__:{"phase":"coding","message":"Back to coding"}';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        // Structured events bypass regression check
        expect(result?.phase).toBe('coding');
      });
    });

    describe('Fallback Text Matching - Planning Phase', () => {
      it('should detect planning phase from planner agent text', () => {
        const line = 'Starting planner agent...';
        const result = agentEvents.parseExecutionPhase(line, 'idle', false);

        expect(result?.phase).toBe('planning');
      });

      it('should detect planning phase from creating implementation plan', () => {
        const line = 'Creating implementation plan for feature';
        const result = agentEvents.parseExecutionPhase(line, 'idle', false);

        expect(result?.phase).toBe('planning');
      });
    });

    describe('Fallback Text Matching - Coding Phase', () => {
      it('should detect coding phase from coder agent text', () => {
        const line = 'Coder agent processing subtask';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.phase).toBe('coding');
      });

      it('should detect coding phase from starting coder text', () => {
        const line = 'Starting coder for implementation';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.phase).toBe('coding');
      });

      it('should detect subtask progress', () => {
        const line = 'Working on subtask: 2/5';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('coding');
        expect(result?.currentSubtask).toBe('2/5');
      });

      it('should detect subtask completion', () => {
        const line = 'Subtask completed successfully';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.phase).toBe('coding');
      });
    });

    describe('Fallback Text Matching - QA Phases', () => {
      it('should detect qa_review phase from qa reviewer text', () => {
        const line = 'Starting QA reviewer agent';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('qa_review');
      });

      it('should detect qa_review phase from qa_reviewer text', () => {
        const line = 'qa_reviewer checking acceptance criteria';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('qa_review');
      });

      it('should detect qa_review phase from starting qa text', () => {
        const line = 'Starting QA validation';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('qa_review');
      });

      it('should detect qa_fixing phase from qa fixer text', () => {
        const line = 'QA fixer processing issues';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        expect(result?.phase).toBe('qa_fixing');
      });

      it('should detect qa_fixing phase from fixing issues text', () => {
        const line = 'Fixing issues found by QA';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        expect(result?.phase).toBe('qa_fixing');
      });
    });

    describe('Fallback Text Matching - Complete Phase (IMPORTANT)', () => {
      it('should NOT set complete from BUILD COMPLETE banner', () => {
        // This is critical - the BUILD COMPLETE banner appears after subtasks
        // finish but BEFORE QA runs. We must NOT set complete phase from this.
        const line = '=== BUILD COMPLETE ===';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        // Should NOT return complete phase
        expect(result?.phase).not.toBe('complete');
      });

      it('should NOT set complete from qa passed text via fallback', () => {
        // Complete phase should only come from structured events
        const line = 'qa passed successfully';
        const result = agentEvents.parseExecutionPhase(line, 'qa_review', false);

        // Fallback should not set complete
        expect(result?.phase).not.toBe('complete');
      });

      it('should NOT set complete from all subtasks completed text', () => {
        const line = 'All subtasks completed';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).not.toBe('complete');
      });
    });

    describe('Fallback Text Matching - Failed Phase', () => {
      it('should detect failed phase from build failed text', () => {
        const line = 'Build failed: compilation error';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('failed');
      });

      it('should detect failed phase from fatal error text', () => {
        const line = 'Fatal error: unable to continue';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('failed');
      });

      it('should detect failed phase from agent failed text', () => {
        const line = 'Agent failed to complete task';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('failed');
      });

      it('should NOT detect failed from tool errors', () => {
        // Tool errors are recoverable and shouldn't trigger failed phase
        const line = 'Tool error: file not found';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).not.toBe('failed');
      });

      it('should NOT detect failed from tool_use_error', () => {
        const line = 'tool_use_error: invalid arguments';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).not.toBe('failed');
      });
    });

    describe('Task Logger Filtering', () => {
      it('should ignore __TASK_LOG_ events', () => {
        const line = '__TASK_LOG_:{"type":"subtask_start","id":"1"}';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result).toBeNull();
      });

      it('should ignore lines containing __TASK_LOG_', () => {
        const line = 'Processing __TASK_LOG_:{"event":"progress"}';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result).toBeNull();
      });
    });

    describe('Spec Runner Mode', () => {
      it('should detect discovering phase in spec runner mode', () => {
        const line = 'Discovering project structure...';
        const result = agentEvents.parseExecutionPhase(line, 'idle', true);

        expect(result?.phase).toBe('planning');
        expect(result?.message).toContain('Discovering');
      });

      it('should detect requirements gathering in spec runner mode', () => {
        const line = 'Gathering requirements from user';
        const result = agentEvents.parseExecutionPhase(line, 'idle', true);

        expect(result?.phase).toBe('planning');
        expect(result?.message).toContain('requirements');
      });

      it('should detect spec writing in spec runner mode', () => {
        const line = 'Writing spec document...';
        const result = agentEvents.parseExecutionPhase(line, 'idle', true);

        expect(result?.phase).toBe('planning');
      });

      it('should detect validation in spec runner mode', () => {
        const line = 'Validating specification...';
        const result = agentEvents.parseExecutionPhase(line, 'idle', true);

        expect(result?.phase).toBe('planning');
      });

      it('should detect spec complete in spec runner mode', () => {
        const line = 'Spec complete, ready for implementation';
        const result = agentEvents.parseExecutionPhase(line, 'idle', true);

        expect(result?.phase).toBe('planning');
      });
    });

    describe('Case Insensitivity', () => {
      it('should match regardless of case', () => {
        const line = 'CODER AGENT Starting';
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.phase).toBe('coding');
      });

      it('should match mixed case', () => {
        const line = 'QA Reviewer starting validation';
        const result = agentEvents.parseExecutionPhase(line, 'coding', false);

        expect(result?.phase).toBe('qa_review');
      });
    });

    describe('Edge Cases', () => {
      it('should return null for empty string', () => {
        const result = agentEvents.parseExecutionPhase('', 'coding', false);
        expect(result).toBeNull();
      });

      it('should return null for whitespace only', () => {
        const result = agentEvents.parseExecutionPhase('   \n\t  ', 'coding', false);
        expect(result).toBeNull();
      });

      it('should handle very long log lines', () => {
        const longMessage = 'x'.repeat(10000);
        const line = `Starting coder ${longMessage}`;
        const result = agentEvents.parseExecutionPhase(line, 'planning', false);

        expect(result?.phase).toBe('coding');
      });
    });
  });

  describe('calculateOverallProgress', () => {
    it('should return 0 for idle phase', () => {
      const progress = agentEvents.calculateOverallProgress('idle', 50);
      expect(progress).toBe(0);
    });

    it('should calculate planning phase progress (0-20%)', () => {
      expect(agentEvents.calculateOverallProgress('planning', 0)).toBe(0);
      expect(agentEvents.calculateOverallProgress('planning', 50)).toBe(10);
      expect(agentEvents.calculateOverallProgress('planning', 100)).toBe(20);
    });

    it('should calculate coding phase progress (20-80%)', () => {
      expect(agentEvents.calculateOverallProgress('coding', 0)).toBe(20);
      expect(agentEvents.calculateOverallProgress('coding', 50)).toBe(50);
      expect(agentEvents.calculateOverallProgress('coding', 100)).toBe(80);
    });

    it('should calculate qa_review phase progress (80-95%)', () => {
      expect(agentEvents.calculateOverallProgress('qa_review', 0)).toBe(80);
      expect(agentEvents.calculateOverallProgress('qa_review', 100)).toBe(95);
    });

    it('should calculate qa_fixing phase progress (80-95%)', () => {
      expect(agentEvents.calculateOverallProgress('qa_fixing', 0)).toBe(80);
      expect(agentEvents.calculateOverallProgress('qa_fixing', 100)).toBe(95);
    });

    it('should return 100 for complete phase', () => {
      expect(agentEvents.calculateOverallProgress('complete', 0)).toBe(100);
      expect(agentEvents.calculateOverallProgress('complete', 100)).toBe(100);
    });

    it('should return 0 for failed phase', () => {
      expect(agentEvents.calculateOverallProgress('failed', 50)).toBe(0);
    });

    it('should handle unknown phase gracefully', () => {
      const progress = agentEvents.calculateOverallProgress('unknown' as ExecutionProgressData['phase'], 50);
      expect(progress).toBe(0);
    });
  });

  describe('parseIdeationProgress', () => {
    it('should detect analyzing phase', () => {
      const completedTypes = new Set<string>();
      const result = agentEvents.parseIdeationProgress(
        'PROJECT ANALYSIS starting',
        'idle',
        0,
        completedTypes,
        5
      );

      expect(result.phase).toBe('analyzing');
      expect(result.progress).toBe(10);
    });

    it('should detect discovering phase', () => {
      const completedTypes = new Set<string>();
      const result = agentEvents.parseIdeationProgress(
        'CONTEXT GATHERING in progress',
        'analyzing',
        10,
        completedTypes,
        5
      );

      expect(result.phase).toBe('discovering');
      expect(result.progress).toBe(20);
    });

    it('should detect generating phase', () => {
      const completedTypes = new Set<string>();
      const result = agentEvents.parseIdeationProgress(
        'GENERATING IDEAS (PARALLEL)',
        'discovering',
        20,
        completedTypes,
        5
      );

      expect(result.phase).toBe('generating');
      expect(result.progress).toBe(30);
    });

    it('should update progress based on completed types', () => {
      const completedTypes = new Set(['security', 'performance']);
      const result = agentEvents.parseIdeationProgress(
        'Still generating...',
        'generating',
        30,
        completedTypes,
        5
      );

      // 30% + (2/5 * 60%) = 30% + 24% = 54%
      expect(result.progress).toBe(54);
    });

    it('should detect finalizing phase', () => {
      const completedTypes = new Set<string>();
      const result = agentEvents.parseIdeationProgress(
        'MERGE AND FINALIZE',
        'generating',
        60,
        completedTypes,
        5
      );

      expect(result.phase).toBe('finalizing');
      expect(result.progress).toBe(90);
    });

    it('should detect complete phase', () => {
      const completedTypes = new Set<string>();
      const result = agentEvents.parseIdeationProgress(
        'IDEATION COMPLETE',
        'finalizing',
        90,
        completedTypes,
        5
      );

      expect(result.phase).toBe('complete');
      expect(result.progress).toBe(100);
    });
  });

  describe('parseRoadmapProgress', () => {
    it('should detect analyzing phase', () => {
      const result = agentEvents.parseRoadmapProgress(
        'PROJECT ANALYSIS starting',
        'idle',
        0
      );

      expect(result.phase).toBe('analyzing');
      // Updated to match granular progress values: PROJECT ANALYSIS → 10%
      expect(result.progress).toBe(10);
    });

    it('should detect discovering phase', () => {
      const result = agentEvents.parseRoadmapProgress(
        'PROJECT DISCOVERY in progress',
        'analyzing',
        25
      );

      expect(result.phase).toBe('discovering');
      // Updated to match granular progress values: PROJECT DISCOVERY → 30%
      expect(result.progress).toBe(30);
    });

    it('should detect generating phase', () => {
      const result = agentEvents.parseRoadmapProgress(
        'FEATURE GENERATION starting',
        'discovering',
        50
      );

      expect(result.phase).toBe('generating');
      // Updated to match granular progress values: FEATURE GENERATION → 55%
      expect(result.progress).toBe(55);
    });

    it('should detect complete phase', () => {
      const result = agentEvents.parseRoadmapProgress(
        'ROADMAP GENERATED successfully',
        'generating',
        90
      );

      expect(result.phase).toBe('complete');
      expect(result.progress).toBe(100);
    });

    it('should maintain current state for unrecognized log', () => {
      const result = agentEvents.parseRoadmapProgress(
        'Some random log message',
        'analyzing',
        25
      );

      expect(result.phase).toBe('analyzing');
      expect(result.progress).toBe(25);
    });
  });
});
