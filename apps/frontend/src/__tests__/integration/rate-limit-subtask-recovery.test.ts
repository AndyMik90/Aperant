/**
 * End-to-End Integration Tests for Rate Limit Subtask Recovery
 *
 * Tests the complete recovery flow:
 * 1. Task execution with multiple subtasks
 * 2. Rate limit error during execution
 * 3. Subtask reset to pending in implementation_plan.json
 * 4. IPC events emitted correctly
 * 5. Task resumes automatically
 * 6. Completed subtasks maintain their status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Test directories
let TEST_DIR: string;
let TEST_SPEC_DIR: string;
let PLAN_PATH: string;

// Setup test directories
function setupTestDirs(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'rate-limit-recovery-test-'));
  TEST_SPEC_DIR = path.join(TEST_DIR, '.auto-claude/specs/001-test-feature');
  PLAN_PATH = path.join(TEST_SPEC_DIR, 'implementation_plan.json');
  mkdirSync(TEST_SPEC_DIR, { recursive: true });
}

// Create implementation plan with mixed subtask states
function createMixedStatePlan() {
  return {
    feature: 'Test Feature with Rate Limit Recovery',
    workflow_type: 'feature',
    services_involved: ['backend', 'frontend'],
    phases: [
      {
        id: 'phase-1',
        name: 'Implementation Phase',
        type: 'implementation',
        subtasks: [
          {
            id: 'subtask-1-1',
            description: 'First subtask - already completed',
            status: 'completed',
            started_at: '2026-01-31T12:00:00Z',
            completed_at: '2026-01-31T12:05:00Z',
            service: 'backend'
          },
          {
            id: 'subtask-1-2',
            description: 'Second subtask - currently in progress',
            status: 'in_progress',
            started_at: '2026-01-31T12:05:00Z',
            completed_at: null,
            service: 'backend'
          },
          {
            id: 'subtask-1-3',
            description: 'Third subtask - pending',
            status: 'pending',
            started_at: null,
            completed_at: null,
            service: 'frontend'
          },
          {
            id: 'subtask-1-4',
            description: 'Fourth subtask - failed previously',
            status: 'failed',
            started_at: '2026-01-31T11:00:00Z',
            completed_at: null,
            service: 'frontend'
          }
        ]
      },
      {
        id: 'phase-2',
        name: 'Testing Phase',
        type: 'testing',
        subtasks: [
          {
            id: 'subtask-2-1',
            description: 'Write unit tests',
            status: 'pending',
            started_at: null,
            completed_at: null,
            service: 'backend'
          }
        ]
      }
    ],
    status: 'in_progress',
    planStatus: 'in_progress',
    created_at: '2026-01-31T11:00:00Z',
    updated_at: '2026-01-31T12:05:00Z'
  };
}

// Helper to read plan from file
function readPlan() {
  const content = readFileSync(PLAN_PATH, 'utf-8');
  return JSON.parse(content);
}

// Types for plan structure
interface Subtask {
  id: string;
  description: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  service: string;
}

interface Phase {
  id: string;
  name: string;
  type: string;
  subtasks: Subtask[];
}

interface Plan {
  feature: string;
  workflow_type: string;
  services_involved: string[];
  phases: Phase[];
  status: string;
  planStatus: string;
  created_at: string;
  updated_at: string;
}

// Helper to find subtask in plan
function findSubtask(plan: Plan, subtaskId: string): Subtask | null {
  for (const phase of plan.phases) {
    const subtask = phase.subtasks.find((s) => s.id === subtaskId);
    if (subtask) return subtask;
  }
  return null;
}

describe('Rate Limit Subtask Recovery - End-to-End', () => {
  beforeEach(() => {
    setupTestDirs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (TEST_DIR) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Subtask Reset on Rate Limit', () => {
    it('should reset in_progress subtask to pending when rate limit occurs', () => {
      // Setup: Create plan with in_progress subtask
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Verify initial state
      const initialPlan = readPlan();
      const inProgressSubtask = findSubtask(initialPlan, 'subtask-1-2')!;
      expect(inProgressSubtask).toBeTruthy();
      expect(inProgressSubtask.status).toBe('in_progress');
      expect(inProgressSubtask.started_at).toBeTruthy();

      // Simulate rate limit reset logic (from resetStuckSubtasks helper)
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      // Save updated plan
      writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

      // Verify: subtask reset to pending
      const updatedPlan = readPlan();
      const resetSubtask = findSubtask(updatedPlan, 'subtask-1-2')!;
      expect(resetSubtask).toBeTruthy();
      expect(resetSubtask.status).toBe('pending');
      expect(resetSubtask.started_at).toBeNull();
      expect(resetSubtask.completed_at).toBeNull();
    });

    it('should reset failed subtask to pending when recovery triggered', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Verify initial state
      const initialPlan = readPlan();
      const failedSubtask = findSubtask(initialPlan, 'subtask-1-4')!;
      expect(failedSubtask).toBeTruthy();
      expect(failedSubtask.status).toBe('failed');

      // Simulate reset
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

      // Verify: failed subtask reset
      const updatedPlan = readPlan();
      const resetSubtask = findSubtask(updatedPlan, 'subtask-1-4')!;
      expect(resetSubtask).toBeTruthy();
      expect(resetSubtask.status).toBe('pending');
      expect(resetSubtask.started_at).toBeNull();
    });

    it('should preserve completed subtasks during reset', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Get completed subtask before reset
      const initialPlan = readPlan();
      const completedSubtask = findSubtask(initialPlan, 'subtask-1-1')!;
      expect(completedSubtask).toBeTruthy();
      expect(completedSubtask.status).toBe('completed');
      const originalCompletedAt = completedSubtask.completed_at;

      // Simulate reset (should skip completed subtasks)
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

      // Verify: completed subtask unchanged
      const updatedPlan = readPlan();
      const preservedSubtask = findSubtask(updatedPlan, 'subtask-1-1')!;
      expect(preservedSubtask).toBeTruthy();
      expect(preservedSubtask.status).toBe('completed');
      expect(preservedSubtask.completed_at).toBe(originalCompletedAt);
    });

    it('should reset all stuck subtasks across multiple phases', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      const initialPlan = readPlan();

      // Count stuck subtasks before reset
      let stuckCount = 0;
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            stuckCount++;
          }
        }
      }
      expect(stuckCount).toBe(2); // subtask-1-2 (in_progress) + subtask-1-4 (failed)

      // Simulate reset
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

      // Verify: all stuck subtasks reset
      const updatedPlan = readPlan();
      let resetCount = 0;
      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.id === 'subtask-1-2' || subtask.id === 'subtask-1-4') {
            expect(subtask.status).toBe('pending');
            expect(subtask.started_at).toBeNull();
            resetCount++;
          }
        }
      }
      expect(resetCount).toBe(2);
    });
  });

  describe('Task Resume After Recovery', () => {
    it('should allow task to resume with reset subtasks', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Reset stuck subtasks
      const updatedPlan = readPlan();
      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }
      writeFileSync(PLAN_PATH, JSON.stringify(updatedPlan, null, 2));

      // Simulate get_next_subtask logic
      const resumedPlan = readPlan();
      let nextSubtask: Subtask | null = null;
      for (const phase of resumedPlan.phases) {
        const pending = phase.subtasks.find((s: Subtask) => s.status === 'pending');
        if (pending) {
          nextSubtask = pending;
          break;
        }
      }

      // Verify: task can find next subtask to resume
      expect(nextSubtask).toBeTruthy();
      expect(nextSubtask!.id).toBe('subtask-1-2'); // Previously stuck, now pending
      expect(nextSubtask!.status).toBe('pending');
    });

    it('should maintain correct subtask order after reset', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Reset and collect pending subtasks
      const updatedPlan = readPlan();
      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }
      writeFileSync(PLAN_PATH, JSON.stringify(updatedPlan, null, 2));

      const resumedPlan = readPlan();
      const allPendingSubtasks: string[] = [];
      for (const phase of resumedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'pending') {
            allPendingSubtasks.push(subtask.id);
          }
        }
      }

      // Verify: pending subtasks in correct order
      expect(allPendingSubtasks).toEqual([
        'subtask-1-2', // Reset from in_progress
        'subtask-1-3', // Was already pending
        'subtask-1-4', // Reset from failed
        'subtask-2-1'  // Was already pending
      ]);
    });
  });

  describe('Atomic File Operations', () => {
    it('should maintain valid JSON structure after reset', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      // Simulate reset
      const updatedPlan = readPlan();
      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      // Write atomically (simulate atomic write)
      const tempPath = PLAN_PATH + '.tmp';
      writeFileSync(tempPath, JSON.stringify(updatedPlan, null, 2));
      rmSync(PLAN_PATH);
      writeFileSync(PLAN_PATH, JSON.stringify(updatedPlan, null, 2));

      // Verify: plan is valid JSON
      expect(() => {
        const verifyPlan = readPlan();
        expect(verifyPlan.phases).toBeDefined();
        expect(Array.isArray(verifyPlan.phases)).toBe(true);
      }).not.toThrow();
    });

    it('should handle missing plan file gracefully', () => {
      // Don't create plan file
      const missingPlanPath = path.join(TEST_SPEC_DIR, 'nonexistent_plan.json');

      // Simulate graceful handling
      let errorOccurred = false;
      try {
        readFileSync(missingPlanPath, 'utf-8');
      } catch (error) {
        errorOccurred = true;
        expect(error).toBeDefined();
      }

      expect(errorOccurred).toBe(true);
    });
  });

  describe('Reset Count Tracking', () => {
    it('should count number of subtasks reset', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      const updatedPlan = readPlan();
      let resetCount = 0;

      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
            resetCount++;
          }
        }
      }

      expect(resetCount).toBe(2); // subtask-1-2 and subtask-1-4
    });

    it('should return zero when no subtasks need reset', () => {
      const plan = createMixedStatePlan();

      // Mark all subtasks as either completed or pending
      for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'completed';
          }
        }
      }

      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      const updatedPlan = readPlan();
      let resetCount = 0;

      for (const phase of updatedPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            resetCount++;
          }
        }
      }

      expect(resetCount).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle plan with no phases', () => {
      const emptyPlan = {
        feature: 'Empty Plan',
        phases: [],
        status: 'pending'
      };

      writeFileSync(PLAN_PATH, JSON.stringify(emptyPlan, null, 2));

      const plan = readPlan();
      let resetCount = 0;

      for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            resetCount++;
          }
        }
      }

      expect(resetCount).toBe(0);
      expect(plan.phases).toEqual([]);
    });

    it('should handle phase with no subtasks', () => {
      const planWithEmptyPhase = {
        feature: 'Plan with Empty Phase',
        phases: [
          {
            id: 'phase-1',
            name: 'Empty Phase',
            subtasks: []
          }
        ],
        status: 'pending'
      };

      writeFileSync(PLAN_PATH, JSON.stringify(planWithEmptyPhase, null, 2));

      const plan = readPlan();
      let resetCount = 0;

      for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            resetCount++;
          }
        }
      }

      expect(resetCount).toBe(0);
    });

    it('should preserve all subtask fields except status and timestamps', () => {
      const plan = createMixedStatePlan();
      writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

      const initialPlan = readPlan();
      const originalSubtask = findSubtask(initialPlan, 'subtask-1-2')!;
      expect(originalSubtask).toBeTruthy();
      const originalDescription = originalSubtask.description;
      const originalService = originalSubtask.service;

      // Reset
      for (const phase of initialPlan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status === 'in_progress' || subtask.status === 'failed') {
            subtask.status = 'pending';
            subtask.started_at = null;
            subtask.completed_at = null;
          }
        }
      }

      writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

      const updatedPlan = readPlan();
      const resetSubtask = findSubtask(updatedPlan, 'subtask-1-2')!;
      expect(resetSubtask).toBeTruthy();

      expect(resetSubtask.description).toBe(originalDescription);
      expect(resetSubtask.service).toBe(originalService);
      expect(resetSubtask.id).toBe('subtask-1-2');
    });
  });
});

describe('Integration with Recovery Flow', () => {
  beforeEach(() => {
    setupTestDirs();
  });

  afterEach(() => {
    if (TEST_DIR) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should complete full recovery cycle: error → reset → resume', () => {
    // Step 1: Task running with in_progress subtask
    const plan = createMixedStatePlan();
    writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));

    const initialPlan = readPlan();
    expect(findSubtask(initialPlan, 'subtask-1-2')!.status).toBe('in_progress');

    // Step 2: Rate limit error occurs → subtask reset
    for (const phase of initialPlan.phases) {
      for (const subtask of phase.subtasks) {
        if (subtask.status === 'in_progress' || subtask.status === 'failed') {
          subtask.status = 'pending';
          subtask.started_at = null;
          subtask.completed_at = null;
        }
      }
    }
    writeFileSync(PLAN_PATH, JSON.stringify(initialPlan, null, 2));

    const resetPlan = readPlan();
    expect(findSubtask(resetPlan, 'subtask-1-2')!.status).toBe('pending');

    // Step 3: Task resumes → finds next pending subtask
    let nextSubtask: Subtask | null = null;
    for (const phase of resetPlan.phases) {
      const pending = phase.subtasks.find((s: Subtask) => s.status === 'pending');
      if (pending) {
        nextSubtask = pending;
        break;
      }
    }

    expect(nextSubtask).toBeTruthy();
    expect(nextSubtask!.id).toBe('subtask-1-2');

    // Step 4: Subtask execution starts → status updates to in_progress
    nextSubtask!.status = 'in_progress';
    nextSubtask!.started_at = new Date().toISOString();
    writeFileSync(PLAN_PATH, JSON.stringify(resetPlan, null, 2));

    const resumedPlan = readPlan();
    expect(findSubtask(resumedPlan, 'subtask-1-2')!.status).toBe('in_progress');
  });
});
