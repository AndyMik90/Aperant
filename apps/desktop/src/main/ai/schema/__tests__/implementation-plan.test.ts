/**
 * Tests for Implementation Plan Schema
 *
 * Verifies that Zod coercion handles common LLM field name variations
 * so plans from different models all validate successfully.
 */

import { describe, it, expect } from 'vitest';
import { ImplementationPlanSchema, PlanSubtaskSchema, PlanPhaseSchema } from '../implementation-plan';

describe('PlanSubtaskSchema', () => {
  it('validates a canonical subtask', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Create the API endpoint',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('1.1');
      expect(result.data.description).toBe('Create the API endpoint');
      expect(result.data.status).toBe('pending');
    }
  });

  it('coerces "title" to "description"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Create canonical allowlist',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Create canonical allowlist');
    }
  });

  it('coerces "name" to "description"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      name: 'Setup database',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Setup database');
    }
  });

  it('coerces "subtask_id" to "id"', () => {
    const result = PlanSubtaskSchema.safeParse({
      subtask_id: 'subtask-1-1',
      description: 'Test something',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('subtask-1-1');
    }
  });

  it('normalizes "done" status to "completed"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
      status: 'done',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
  });

  it('normalizes "todo" status to "pending"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
      status: 'todo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
    }
  });

  it('defaults missing status to "pending"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
    }
  });

  it('coerces "file_paths" to "files_to_modify"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
      status: 'pending',
      file_paths: ['src/main.ts'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_to_modify).toEqual(['src/main.ts']);
    }
  });

  it('fails when both id and description are missing', () => {
    const result = PlanSubtaskSchema.safeParse({
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('rejects string verification (must be an object for retry feedback)', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Add HiDPI support',
      status: 'pending',
      verification: 'Open in Chrome, canvas should render sharp on DPR=2',
    });
    // String verification should fail so the retry loop can tell the LLM what's wrong
    expect(result.success).toBe(false);
  });

  it('coerces "files_modified" to "files_to_modify"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
      status: 'pending',
      files_modified: ['script.js', 'style.css'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_to_modify).toEqual(['script.js', 'style.css']);
    }
  });

  it('preserves unknown fields via passthrough', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Task',
      status: 'pending',
      deliverable: 'A working feature',
      details: ['step 1', 'step 2'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).deliverable).toBe('A working feature');
    }
  });
});

describe('PlanPhaseSchema', () => {
  const validSubtask = { id: '1.1', description: 'Task', status: 'pending' };

  it('validates a canonical phase', () => {
    const result = PlanPhaseSchema.safeParse({
      id: 'phase-1',
      name: 'Backend API',
      subtasks: [validSubtask],
    });
    expect(result.success).toBe(true);
  });

  it('coerces "title" to "name"', () => {
    const result = PlanPhaseSchema.safeParse({
      id: 'phase-1',
      title: 'Backend API',
      subtasks: [validSubtask],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Backend API');
    }
  });

  it('coerces phase number to id', () => {
    const result = PlanPhaseSchema.safeParse({
      phase: 1,
      name: 'Backend',
      subtasks: [validSubtask],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('1');
    }
  });

  it('coerces "chunks" to "subtasks"', () => {
    const result = PlanPhaseSchema.safeParse({
      id: 'phase-1',
      name: 'Backend',
      chunks: [validSubtask],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtasks).toHaveLength(1);
    }
  });

  it('fails when subtasks is empty', () => {
    const result = PlanPhaseSchema.safeParse({
      id: 'phase-1',
      name: 'Backend',
      subtasks: [],
    });
    expect(result.success).toBe(false);
  });

  it('fails when neither id nor phase is present', () => {
    const result = PlanPhaseSchema.safeParse({
      name: 'Backend',
      subtasks: [validSubtask],
    });
    // coercePhase should produce id=undefined and phase=undefined
    // The refine check should fail
    expect(result.success).toBe(false);
  });
});

describe('ImplementationPlanSchema', () => {
  const validPlan = {
    feature: 'Add user auth',
    workflow_type: 'feature',
    phases: [
      {
        id: 'phase-1',
        name: 'Backend',
        subtasks: [
          { id: '1.1', description: 'Create model', status: 'pending' },
        ],
      },
    ],
  };

  it('validates a canonical plan', () => {
    const result = ImplementationPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it('validates a plan with LLM field variations (title, subtask_id, done status)', () => {
    const llmPlan = {
      title: 'Restrict web access',
      type: 'feature',
      phases: [
        {
          phase: 1,
          name: 'Define route policy',
          objective: 'Establish allowlist',
          subtasks: [
            {
              id: '1.1',
              title: 'Create canonical allowlist',
              details: ['Page routes', 'Metadata routes'],
              deliverable: 'Documented allowlist',
              status: 'completed',
              completed_at: '2026-02-26T12:35:32.451Z',
            },
            {
              id: '1.2',
              title: 'Define deny behavior',
              status: 'done',
            },
          ],
        },
      ],
    };

    const result = ImplementationPlanSchema.safeParse(llmPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature).toBe('Restrict web access');
      expect(result.data.workflow_type).toBe('feature');
      const subtask = result.data.phases[0].subtasks[0];
      expect(subtask.description).toBe('Create canonical allowlist');
      expect(result.data.phases[0].subtasks[1].status).toBe('completed');
    }
  });

  it('coerces "title" to "feature" at top level', () => {
    const result = ImplementationPlanSchema.safeParse({
      title: 'My Feature',
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          subtasks: [{ id: '1', description: 'Task', status: 'pending' }],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature).toBe('My Feature');
    }
  });

  it('coerces flat files_to_modify/implementation_order format into phases', () => {
    // This is the format some models (especially quick_spec) produce:
    // flat files_to_modify with changes + implementation_order strings
    const flatPlan = {
      files_to_modify: [
        {
          path: 'script.js',
          changes: [
            { description: 'Increase PARTICLE_MAX_TRAIL from 100 to 150', location: 'line 40' },
            { description: 'Modify renderParticles to accept glow parameter', location: 'lines 97-117' },
          ],
        },
      ],
      files_to_create: [],
      implementation_order: [
        'script.js: Increase PARTICLE_MAX_TRAIL constant',
        'script.js: Modify renderParticles to support glow parameter',
        'script.js: Update render() to pass glow flag',
      ],
      estimated_effort: 'small',
    };

    const result = ImplementationPlanSchema.safeParse(flatPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phases).toHaveLength(1);
      expect(result.data.phases[0].subtasks).toHaveLength(3);
      expect(result.data.phases[0].subtasks[0].id).toBe('1-1');
      expect(result.data.phases[0].subtasks[0].description).toBe('script.js: Increase PARTICLE_MAX_TRAIL constant');
      expect(result.data.phases[0].subtasks[0].files_to_modify).toEqual(['script.js']);
      expect(result.data.phases[0].subtasks[0].status).toBe('pending');
    }
  });

  it('coerces flat files_to_modify with changes[] when no implementation_order', () => {
    const flatPlan = {
      feature: 'Add glow effect',
      files_to_modify: [
        {
          path: 'src/main.ts',
          changes: [
            { description: 'Add import statement' },
            { description: 'Initialize glow renderer' },
          ],
        },
        {
          path: 'src/render.ts',
          changes: [
            { description: 'Apply glow shader pass' },
          ],
        },
      ],
    };

    const result = ImplementationPlanSchema.safeParse(flatPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature).toBe('Add glow effect');
      expect(result.data.phases).toHaveLength(1);
      expect(result.data.phases[0].name).toBe('Add glow effect');
      expect(result.data.phases[0].subtasks).toHaveLength(3);
      expect(result.data.phases[0].subtasks[0].files_to_modify).toEqual(['src/main.ts']);
      expect(result.data.phases[0].subtasks[2].files_to_modify).toEqual(['src/render.ts']);
    }
  });

  it('fails when phases is missing', () => {
    const result = ImplementationPlanSchema.safeParse({
      feature: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('fails when phases is empty', () => {
    const result = ImplementationPlanSchema.safeParse({
      feature: 'Test',
      phases: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects phases without subtasks (retry feedback tells LLM to add subtasks)', () => {
    // Phases without subtasks should fail validation so the retry loop
    // can tell the LLM: "Phase must have a subtasks array"
    const flatPhasePlan = {
      phases: [
        {
          phase: 1,
          title: 'Game State Machine',
          description: 'Refactor game to use a state machine',
          files_to_modify: ['script.js'],
          key_changes: ['Add mode selection'],
          verification: 'Mode selection screen appears on load.',
        },
      ],
    };

    const result = ImplementationPlanSchema.safeParse(flatPhasePlan);
    expect(result.success).toBe(false);
  });

  it('coerces flat steps[] into phases with subtasks (steps become subtasks)', () => {
    // steps[] → single phase with subtasks is a valid structural alias
    // because steps ARE subtasks wrapped in a phase
    const stepsPlan = {
      steps: [
        {
          step: 1,
          title: 'Disable canvas alpha',
          description: 'Apply canvas changes',
          files_modified: ['script.js'],
        },
        {
          step: 2,
          title: 'Pre-render background',
          description: 'Create offscreen canvas',
          files_modified: ['script.js'],
        },
      ],
    };

    const result = ImplementationPlanSchema.safeParse(stepsPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phases).toHaveLength(1);
      expect(result.data.phases[0].subtasks).toHaveLength(2);
      expect(result.data.phases[0].subtasks[0].id).toBe('1');
      expect(result.data.phases[0].subtasks[0].files_to_modify).toEqual(['script.js']);
    }
  });
});
