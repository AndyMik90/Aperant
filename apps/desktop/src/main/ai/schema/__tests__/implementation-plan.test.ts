/**
 * Tests for Implementation Plan Schema
 *
 * Verifies that Zod coercion handles common LLM field name variations
 * so plans from different models all validate successfully.
 */

import { describe, it, expect } from 'vitest';
import { ImplementationPlanSchema, PlanSubtaskSchema, PlanPhaseSchema } from '../implementation-plan';

describe('PlanSubtaskSchema', () => {
  it('validates a canonical subtask with title and description', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Create the API endpoint',
      description: 'Build REST endpoints for the analytics feature',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('1.1');
      expect(result.data.title).toBe('Create the API endpoint');
      expect(result.data.description).toBe('Build REST endpoints for the analytics feature');
      expect(result.data.status).toBe('pending');
    }
  });

  it('validates a subtask with title only (description falls back to title)', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Create canonical allowlist',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Create canonical allowlist');
      // Description falls back to title when not explicitly provided
      expect(result.data.description).toBe('Create canonical allowlist');
    }
  });

  it('coerces "name" to "title"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      name: 'Setup database',
      status: 'pending',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Setup database');
    }
  });

  it('coerces "description" to "title" when title is missing', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      description: 'Detailed notes used as title',
      status: 'pending',
    });
    // description falls back to title when no explicit title is present
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Detailed notes used as title');
      expect(result.data.description).toBe('Detailed notes used as title');
    }
  });

  it('fails when no displayable text is present', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('coerces "subtask_id" to "id"', () => {
    const result = PlanSubtaskSchema.safeParse({
      subtask_id: 'subtask-1-1',
      title: 'Test something',
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
      title: 'Task',
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
      title: 'Task',
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
      title: 'Task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
    }
  });

  it('coerces "file_paths" to "files_to_modify"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Task',
      status: 'pending',
      file_paths: ['src/main.ts'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_to_modify).toEqual(['src/main.ts']);
    }
  });

  it('fails when both id and title are missing', () => {
    const result = PlanSubtaskSchema.safeParse({
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('rejects string verification (must be an object for retry feedback)', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Add HiDPI support',
      status: 'pending',
      verification: 'Open in Chrome, canvas should render sharp on DPR=2',
    });
    // String verification should fail so the retry loop can tell the LLM what's wrong
    expect(result.success).toBe(false);
  });

  it('coerces "files_modified" to "files_to_modify"', () => {
    const result = PlanSubtaskSchema.safeParse({
      id: '1.1',
      title: 'Task',
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
      title: 'Task',
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
  const validSubtask = { id: '1.1', title: 'Task', status: 'pending' };

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

  it('coerces string task arrays to subtask objects (common cross-provider pattern)', () => {
    // Many LLMs write tasks as string arrays instead of subtask objects.
    // This pattern appears across providers (OpenAI, Gemini, Mistral, local models).
    const result = PlanPhaseSchema.safeParse({
      id: 'phase_1',
      title: 'Bootstrap modern tooling',
      tasks: [
        'Add package.json and lockfile',
        'Set up dev server (e.g., Vite)',
        'Add linting (ESLint)',
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtasks).toHaveLength(3);
      expect(result.data.subtasks[0].id).toBe('phase_1-1');
      expect(result.data.subtasks[0].title).toBe('Add package.json and lockfile');
      expect(result.data.subtasks[0].status).toBe('pending');
      expect(result.data.subtasks[0].files_to_modify).toEqual([]);
      expect(result.data.subtasks[0].files_to_create).toEqual([]);
      expect(result.data.subtasks[2].id).toBe('phase_1-3');
      expect(result.data.subtasks[2].title).toBe('Add linting (ESLint)');
    }
  });

  it('coerces mixed string and object task arrays', () => {
    // Some models mix string and object tasks in the same array
    const result = PlanPhaseSchema.safeParse({
      id: '2',
      name: 'Refactor',
      tasks: [
        'Extract constants module',
        { id: '2-2', description: 'Extract rendering module', status: 'pending' },
        'Wire modules together',
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtasks).toHaveLength(3);
      // First: string coerced to object
      expect(result.data.subtasks[0].title).toBe('Extract constants module');
      // Second: already an object, passed through
      expect(result.data.subtasks[1].id).toBe('2-2');
      // description is coerced to title when title is missing
      expect(result.data.subtasks[1].title).toBe('Extract rendering module');
      // Third: string coerced to object
      expect(result.data.subtasks[2].title).toBe('Wire modules together');
    }
  });

  it('uses phase number for string subtask IDs when phase has numeric id', () => {
    const result = PlanPhaseSchema.safeParse({
      phase: 3,
      name: 'Testing',
      tasks: ['Add unit tests', 'Add integration tests'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtasks[0].id).toBe('3-1');
      expect(result.data.subtasks[1].id).toBe('3-2');
    }
  });

  it('coerces "steps" alias to subtasks at phase level', () => {
    // Some models use "steps" within a phase (different from top-level steps)
    const result = PlanPhaseSchema.safeParse({
      id: '1',
      name: 'Setup',
      steps: [
        { id: '1-1', description: 'Initialize project', status: 'pending' },
      ],
    });
    // "steps" is not a recognized alias for subtasks at phase level (only
    // "subtasks", "chunks", "tasks" are). This should fail to avoid ambiguity.
    // The retry prompt will tell the model to use "subtasks".
    expect(result.success).toBe(false);
  });

  it('coerces "tasks" with object items (Gemini/Mistral pattern)', () => {
    // Models sometimes write "tasks" with objects that use non-standard field names
    const result = PlanPhaseSchema.safeParse({
      id: 'p1',
      title: 'Core changes',
      tasks: [
        { task_id: 'a', summary: 'Refactor entry point', status: 'todo' },
        { task_id: 'b', summary: 'Update imports', status: 'not_started' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtasks).toHaveLength(2);
      // task_id → id, summary → title (via coerceSubtask fallback chain)
      expect(result.data.subtasks[0].id).toBe('a');
      expect(result.data.subtasks[0].status).toBe('pending'); // todo → pending
      expect(result.data.subtasks[1].status).toBe('pending'); // not_started → pending
    }
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
          { id: '1.1', title: 'Create model', status: 'pending' },
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
      expect(subtask.title).toBe('Create canonical allowlist');
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
          subtasks: [{ id: '1', title: 'Task', status: 'pending' }],
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
      expect(result.data.phases[0].subtasks[0].title).toBe('script.js: Increase PARTICLE_MAX_TRAIL constant');
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

  it('validates string-tasks plan with deliverables/acceptance_criteria (real-world LLM output)', () => {
    // Real-world output where model wrote tasks as string arrays with extra phase-level
    // metadata (deliverables, acceptance_criteria, dependencies). This pattern appears
    // across multiple providers when models deviate from the subtask object format.
    const codexPlan = {
      feature: 'modernize the snake game',
      description: 'Refactor the existing static snake game into a modular, testable project.',
      phases: [
        {
          id: 'phase_1_tooling_bootstrap',
          title: 'Bootstrap modern tooling and project scripts',
          objective: 'Introduce a lightweight modern JS tooling baseline.',
          tasks: [
            'Add package.json and lockfile',
            'Set up dev server and production build (e.g., Vite)',
            'Add linting (ESLint) and formatting (Prettier optional)',
            'Add npm scripts: dev, build, test, lint, format',
          ],
          deliverables: ['package.json', 'tooling config files'],
          acceptance_criteria: ['npm install succeeds', 'npm run dev starts local server'],
          dependencies: [],
        },
        {
          id: 'phase_2_modular_architecture',
          title: 'Refactor monolithic game code into modules',
          objective: 'Separate concerns for maintainability.',
          tasks: [
            'Create src entrypoint and module directories',
            'Extract constants/config module',
            'Extract game state + update logic module',
            'Extract rendering module (canvas)',
            'Extract input and UI-binding modules',
            'Wire modules through a single bootstrap layer',
          ],
          deliverables: ['modular src codebase'],
          acceptance_criteria: ['Game runs with same features'],
          dependencies: ['phase_1_tooling_bootstrap'],
        },
        {
          id: 'phase_3_logic_tests',
          title: 'Add automated tests for core logic',
          objective: 'Protect gameplay against regressions.',
          tasks: [
            'Install/configure test runner (e.g., Vitest)',
            'Add tests for collision detection',
            'Add tests for food consumption and growth',
            'Add tests for direction-change rules',
          ],
          deliverables: ['test configuration', 'logic test files'],
          acceptance_criteria: ['npm run test executes successfully'],
          dependencies: ['phase_2_modular_architecture'],
        },
      ],
      quality_gates: {
        required_commands: ['npm run lint', 'npm run test', 'npm run build'],
      },
    };

    const result = ImplementationPlanSchema.safeParse(codexPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature).toBe('modernize the snake game');
      expect(result.data.phases).toHaveLength(3);

      // Phase 1: string tasks coerced to subtask objects
      const phase1 = result.data.phases[0];
      expect(phase1.name).toBe('Bootstrap modern tooling and project scripts');
      expect(phase1.subtasks).toHaveLength(4);
      expect(phase1.subtasks[0].id).toBe('phase_1_tooling_bootstrap-1');
      expect(phase1.subtasks[0].title).toBe('Add package.json and lockfile');
      expect(phase1.subtasks[0].status).toBe('pending');
      expect(phase1.subtasks[3].title).toBe('Add npm scripts: dev, build, test, lint, format');

      // Phase 2: 6 string tasks
      const phase2 = result.data.phases[1];
      expect(phase2.subtasks).toHaveLength(6);
      expect(phase2.subtasks[0].title).toBe('Create src entrypoint and module directories');

      // Phase 3: 4 string tasks
      const phase3 = result.data.phases[2];
      expect(phase3.subtasks).toHaveLength(4);
      expect(phase3.subtasks[1].title).toBe('Add tests for collision detection');
    }
  });

  it('validates plan with proper subtask objects (canonical format)', () => {
    // Canonical format: phases with fully-formed subtask objects including
    // verification, files_to_create, files_to_modify. This is the ideal output.
    const claudePlan = {
      feature: 'modernize-classic-snake-game',
      workflow_type: 'feature',
      phases: [
        {
          id: '1',
          name: 'Foundation — Low-Risk Additive Changes',
          subtasks: [
            {
              id: '1-1',
              title: 'Load Orbitron web font in HTML and CSS',
              description: 'Add three <link> tags to index.html for Google Fonts.',
              status: 'pending',
              files_to_create: [],
              files_to_modify: ['index.html', 'style.css'],
              verification: {
                type: 'manual',
                run: 'Open index.html in a browser. UI text should render in Orbitron.',
              },
            },
            {
              id: '1-2',
              title: 'Add WASD keys',
              description: 'Extend the keydown switch with WASD cases.',
              status: 'pending',
              files_to_create: [],
              files_to_modify: ['script.js', 'index.html'],
              verification: {
                type: 'manual',
                run: 'WASD keys should move the snake.',
              },
            },
          ],
        },
      ],
    };

    const result = ImplementationPlanSchema.safeParse(claudePlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feature).toBe('modernize-classic-snake-game');
      expect(result.data.phases[0].subtasks[0].verification?.type).toBe('manual');
      expect(result.data.phases[0].subtasks[0].files_to_modify).toEqual(['index.html', 'style.css']);
    }
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
