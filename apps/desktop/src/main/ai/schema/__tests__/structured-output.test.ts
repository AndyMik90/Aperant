/**
 * Tests for Structured Output Validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateStructuredOutput,
  validateJsonFile,
  validateAndNormalizeJsonFile,
  formatZodErrors,
  buildValidationRetryPrompt,
  IMPLEMENTATION_PLAN_SCHEMA_HINT,
} from '../structured-output';
import { ImplementationPlanSchema } from '../implementation-plan';

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string()).optional(),
});

describe('validateStructuredOutput', () => {
  it('returns valid with coerced data on success', () => {
    const result = validateStructuredOutput({ name: 'Alice', age: 30 }, testSchema);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
    expect(result.errors).toEqual([]);
  });

  it('returns errors on failure', () => {
    const result = validateStructuredOutput({ name: 123 }, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.data).toBeUndefined();
  });
});

describe('validateJsonFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'schema-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('validates a well-formed JSON file', async () => {
    const filePath = join(testDir, 'good.json');
    writeFileSync(filePath, JSON.stringify({ name: 'Bob', age: 25 }));

    const result = await validateJsonFile(filePath, testSchema);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: 'Bob', age: 25 });
  });

  it('returns error for missing file', async () => {
    const result = await validateJsonFile(join(testDir, 'missing.json'), testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('File not found');
  });

  it('returns error for invalid JSON syntax', async () => {
    const filePath = join(testDir, 'bad.json');
    writeFileSync(filePath, '{ this is not json at all!!!');

    const result = await validateJsonFile(filePath, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON syntax');
  });

  it('repairs JSON with trailing commas before validating', async () => {
    const filePath = join(testDir, 'trailing.json');
    writeFileSync(filePath, '{ "name": "Eve", "age": 28, }');

    const result = await validateJsonFile(filePath, testSchema);
    expect(result.valid).toBe(true);
    expect(result.data?.name).toBe('Eve');
  });

  it('repairs JSON with markdown fences before validating', async () => {
    const filePath = join(testDir, 'fenced.json');
    writeFileSync(filePath, '```json\n{ "name": "Eve", "age": 28 }\n```');

    const result = await validateJsonFile(filePath, testSchema);
    expect(result.valid).toBe(true);
    expect(result.data?.name).toBe('Eve');
  });
});

describe('validateAndNormalizeJsonFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'normalize-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes back normalized data', async () => {
    const schema = z.preprocess(
      (val: unknown) => {
        if (!val || typeof val !== 'object') return val;
        const raw = val as Record<string, unknown>;
        return { ...raw, name: raw.name ?? raw.title };
      },
      z.object({ name: z.string(), age: z.number() }),
    );

    const filePath = join(testDir, 'normalize.json');
    writeFileSync(filePath, JSON.stringify({ title: 'Alice', age: 30 }));

    const result = await validateAndNormalizeJsonFile(filePath, schema);
    expect(result.valid).toBe(true);

    // Read back the file — should have the normalized field name
    const { readFileSync } = await import('node:fs');
    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written.name).toBe('Alice');
  });
});

describe('formatZodErrors', () => {
  it('formats invalid_type errors', () => {
    const result = testSchema.safeParse({ name: 123, age: 'not a number' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors.length).toBeGreaterThan(0);
      errors.forEach((e) => {
        expect(typeof e).toBe('string');
        expect(e.length).toBeGreaterThan(0);
      });
    }
  });

  it('formats custom refine errors', () => {
    const schema = z.object({ x: z.number() }).refine((v) => v.x > 0, {
      message: 'x must be positive',
    });
    const result = schema.safeParse({ x: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors.some((e) => e.includes('x must be positive'))).toBe(true);
    }
  });
});

describe('buildValidationRetryPrompt', () => {
  it('includes file name and errors', () => {
    const prompt = buildValidationRetryPrompt('plan.json', [
      'At "phases.0.subtasks.0.title": expected string, received undefined',
    ]);
    expect(prompt).toContain('plan.json');
    expect(prompt).toContain('expected string');
    expect(prompt).toContain('INVALID');
  });

  it('includes schema hint when provided', () => {
    const prompt = buildValidationRetryPrompt('plan.json', ['error'], '{ "phases": [...] }');
    expect(prompt).toContain('{ "phases": [...] }');
    expect(prompt).toContain('Required schema');
  });

  it('includes common field name guidance', () => {
    const prompt = buildValidationRetryPrompt('plan.json', ['error']);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('do NOT use plain strings');
  });
});

describe('end-to-end: validation → retry → self-correction', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'e2e-validation-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('validates and normalizes a string-tasks plan written to a file', async () => {
    // Simulate: LLM writes a plan with string tasks (common across providers)
    const filePath = join(testDir, 'implementation_plan.json');
    const llmOutput = {
      feature: 'modernize app',
      phases: [
        {
          id: 'phase-1',
          title: 'Setup tooling',
          tasks: ['Add build system', 'Configure linter', 'Add test runner'],
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(llmOutput));

    // Import the actual schema used in production
    // ImplementationPlanSchema imported at top level

    // Step 1: Validate — should succeed because coercion handles string tasks
    const result = await validateAndNormalizeJsonFile(filePath, ImplementationPlanSchema);
    expect(result.valid).toBe(true);
    if (result.data) {
      expect(result.data.phases[0].subtasks).toHaveLength(3);
      expect(result.data.phases[0].subtasks[0].title).toBe('Add build system');
      expect(result.data.phases[0].subtasks[0].status).toBe('pending');
    }

    // Step 2: Read back the normalized file — should have canonical structure
    const { readFileSync } = await import('node:fs');
    const normalized = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(normalized.phases[0].subtasks[0].id).toBe('phase-1-1');
    expect(normalized.phases[0].subtasks[0].title).toBe('Add build system');
  });

  it('generates actionable retry prompt when validation fails', async () => {
    // Simulate: LLM writes a plan with no subtasks at all (just phase-level data)
    const filePath = join(testDir, 'implementation_plan.json');
    const badOutput = {
      phases: [
        {
          phase: 1,
          title: 'Refactor game code',
          description: 'Split monolith into modules',
          // No subtasks, no tasks — this should fail
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(badOutput));

    // ImplementationPlanSchema imported at top level
    // IMPLEMENTATION_PLAN_SCHEMA_HINT imported at top level

    // Step 1: Validation should fail
    const result = await validateJsonFile(filePath, ImplementationPlanSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Step 2: Build retry prompt — should be actionable for any LLM
    const retryPrompt = buildValidationRetryPrompt(
      'implementation_plan.json',
      result.errors,
      IMPLEMENTATION_PLAN_SCHEMA_HINT,
    );

    // The retry prompt should tell the model exactly what's wrong
    expect(retryPrompt).toContain('INVALID');
    expect(retryPrompt).toContain('implementation_plan.json');
    expect(retryPrompt).toContain('subtasks');
    expect(retryPrompt).toContain('Required schema');
    // Should include the fix instructions
    expect(retryPrompt).toContain('Read the current');
    expect(retryPrompt).toContain('Fix each error');
    expect(retryPrompt).toContain('Rewrite the file');
  });

  it('full cycle: invalid → retry prompt → corrected output validates', async () => {
    // ImplementationPlanSchema imported at top level
    // IMPLEMENTATION_PLAN_SCHEMA_HINT imported at top level

    // Step 1: First LLM attempt — broken structure (no subtask objects)
    const firstAttempt = {
      phases: [{
        id: '1',
        name: 'Setup',
        // Missing subtasks entirely
      }],
    };

    const firstResult = validateStructuredOutput(firstAttempt, ImplementationPlanSchema);
    expect(firstResult.valid).toBe(false);

    // Step 2: Generate retry prompt
    const retryPrompt = buildValidationRetryPrompt(
      'implementation_plan.json',
      firstResult.errors,
      IMPLEMENTATION_PLAN_SCHEMA_HINT,
    );
    expect(retryPrompt.length).toBeGreaterThan(100); // Substantial feedback

    // Step 3: Simulated corrected output from the LLM after seeing retry prompt
    const correctedAttempt = {
      feature: 'Setup project',
      phases: [{
        id: '1',
        name: 'Setup',
        subtasks: [{
          id: '1-1',
          title: 'Initialize build system',
          status: 'pending',
          files_to_create: ['package.json'],
          files_to_modify: [],
        }],
      }],
    };

    const secondResult = validateStructuredOutput(correctedAttempt, ImplementationPlanSchema);
    expect(secondResult.valid).toBe(true);
    if (secondResult.data) {
      expect(secondResult.data.phases[0].subtasks[0].title).toBe('Initialize build system');
    }
  });
});
