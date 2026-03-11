/**
 * Structured Output Validation
 * ============================
 *
 * Provider-agnostic validation for LLM-generated structured data.
 *
 * Two approaches for different scenarios:
 *
 * 1. **Post-session file validation** — For agents that write JSON files via tools
 *    (planner, roadmap, etc.). Read the file, validate with Zod, retry with
 *    error feedback if invalid.
 *
 * 2. **Inline Output.object()** — For agents that return structured text
 *    (complexity assessor, PR scan, etc.). Uses AI SDK's built-in structured
 *    output which validates against Zod at the provider level.
 *
 * This module provides the post-session validation utility. The inline approach
 * is handled by passing `outputSchema` in SessionConfig → runner.ts.
 */

import type { ZodSchema, ZodError } from 'zod';
import type { LanguageModel } from 'ai';
import { readFile, writeFile, mkdtemp, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeParseJson } from '../../utils/json-repair';

// =============================================================================
// LLM Text → Typed Data Helper
// =============================================================================

/**
 * Parse LLM text output into a typed object via Zod schema.
 *
 * Handles the common pattern where an LLM returns JSON in its text response
 * (possibly wrapped in markdown fences, with trailing commas, etc.).
 *
 * Steps:
 * 1. Strip markdown code fences (`\`\`\`json ... \`\`\``)
 * 2. Repair common JSON syntax issues (trailing commas, missing brackets)
 * 3. Validate and coerce via Zod schema
 *
 * Returns null if parsing or validation fails — callers should provide
 * their own fallback value.
 */
export function parseLLMJson<T>(text: string, schema: ZodSchema<T>): T | null {
  if (!text?.trim()) return null;

  // Strip markdown fences
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1];
  }

  // Repair + parse
  const parsed = safeParseJson<unknown>(cleaned);
  if (parsed === null) return null;

  // Validate with Zod schema (includes coercion transforms)
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

// =============================================================================
// Validation Result
// =============================================================================

export interface StructuredOutputValidation<T> {
  /** Whether the data passed validation */
  valid: boolean;
  /** The validated and coerced data (only when valid=true) */
  data?: T;
  /** Human-readable error messages for LLM feedback */
  errors: string[];
  /** The raw data before validation (for debugging) */
  raw?: unknown;
}

// =============================================================================
// Core Validation
// =============================================================================

/**
 * Validate raw data against a Zod schema.
 * Returns coerced data on success, human-readable errors on failure.
 */
export function validateStructuredOutput<T>(
  raw: unknown,
  schema: ZodSchema<T>,
): StructuredOutputValidation<T> {
  const result = schema.safeParse(raw);

  if (result.success) {
    return { valid: true, data: result.data, errors: [], raw };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
    raw,
  };
}

/**
 * Read a JSON file, repair syntax if needed, then validate against a Zod schema.
 * This is the primary entry point for post-session file validation.
 *
 * @param filePath - Path to the JSON file written by an agent
 * @param schema - Zod schema to validate against
 * @returns Validation result with coerced data or human-readable errors
 */
export async function validateJsonFile<T>(
  filePath: string,
  schema: ZodSchema<T>,
): Promise<StructuredOutputValidation<T>> {
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, 'utf-8');
  } catch {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  // Step 1: Parse JSON (with syntax repair for LLM quirks)
  const parsed = safeParseJson<unknown>(rawContent);
  if (parsed === null) {
    return {
      valid: false,
      errors: [
        'Invalid JSON syntax that could not be auto-repaired.',
        'The file must contain valid JSON. Common issues:',
        '- Trailing commas after the last item in arrays/objects',
        '- Missing commas between items',
        '- Unquoted property names',
        '- Markdown code fences (```json) wrapping the content',
      ],
    };
  }

  // Step 2: Validate against schema (with coercion)
  return validateStructuredOutput(parsed, schema);
}

/**
 * Validate a JSON file and write the coerced (normalized) data back.
 * This replaces both normalizeSubtaskIds() and validateImplementationPlan()
 * in build-orchestrator — Zod coercion handles field normalization, and
 * writing back ensures the file matches the canonical schema.
 *
 * @param filePath - Path to the JSON file
 * @param schema - Zod schema with coercion transforms
 * @returns Validation result
 */
export async function validateAndNormalizeJsonFile<T>(
  filePath: string,
  schema: ZodSchema<T>,
): Promise<StructuredOutputValidation<T>> {
  const result = await validateJsonFile(filePath, schema);

  if (result.valid && result.data) {
    // Write back the coerced data so downstream consumers get canonical field names.
    // Use a secure temp file + atomic rename to avoid TOCTOU races on the target path.
    const tempDir = await mkdtemp(join(tmpdir(), 'auto-claude-normalize-'));
    const tempFile = join(tempDir, 'output.json');
    try {
      await writeFile(tempFile, JSON.stringify(result.data, null, 2));
      await rename(tempFile, filePath);
    } finally {
      await unlink(tempFile).catch(() => undefined);
      // Best-effort cleanup of the temp directory; ignore errors if already removed
      const { rmdir } = await import('node:fs/promises');
      await rmdir(tempDir).catch(() => undefined);
    }
  }

  return result;
}

// =============================================================================
// LLM Error Formatting
// =============================================================================

/**
 * Format Zod validation errors into LLM-friendly messages.
 *
 * Instead of cryptic Zod error codes, produces clear natural language
 * that tells the LLM exactly what to fix. This is the feedback loop
 * that makes schema validation work with any model.
 */
export function formatZodErrors(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';

    // Zod v4 uses different issue shapes than v3.
    // Use the human-readable `message` field which is always present.
    switch (issue.code) {
      case 'invalid_type': {
        const expected = (issue as { expected?: string }).expected;
        return `At "${path}": ${expected ? `expected ${expected}` : issue.message}`;
      }
      case 'invalid_value': {
        // Zod v4: enum validation → "invalid_value" with "values" array
        const values = (issue as { values?: unknown[] }).values;
        return values
          ? `At "${path}": must be one of [${values.join(', ')}]`
          : `At "${path}": ${issue.message}`;
      }
      case 'too_small': {
        const origin = (issue as { origin?: string }).origin;
        const minimum = (issue as { minimum?: number }).minimum;
        if (origin === 'array' && minimum !== undefined) {
          return `At "${path}": array must have at least ${minimum} item(s)`;
        }
        return `At "${path}": ${issue.message}`;
      }
      case 'custom':
        return `At "${path}": ${issue.message}`;
      default:
        return `At "${path}": ${issue.message}`;
    }
  });
}

/**
 * Build an LLM-friendly retry prompt from validation errors.
 *
 * This is what gets fed back to the model when its output doesn't match
 * the schema. The errors are specific enough for any model (including
 * local/smaller ones) to understand what needs fixing.
 */
export function buildValidationRetryPrompt(
  fileName: string,
  errors: string[],
  schemaHint?: string,
): string {
  const lines = [
    `## STRUCTURED OUTPUT VALIDATION ERRORS`,
    ``,
    `The \`${fileName}\` you wrote is INVALID. You MUST rewrite it.`,
    ``,
    `### Errors found:`,
    ...errors.map((e) => `- ${e}`),
    ``,
  ];

  if (schemaHint) {
    lines.push(`### Required schema:`, schemaHint, ``);
  }

  lines.push(
    `### How to fix:`,
    `1. Read the current \`${fileName}\` to see what you wrote`,
    `2. Fix each error listed above`,
    `3. Rewrite the file with the corrected JSON using the Write tool`,
    ``,
    `Common field name issues:`,
    `- Use "title" (REQUIRED) for short 3-10 word subtask summary`,
    `- Use "description" (REQUIRED) for detailed implementation instructions`,
    `- Use "id" (not "subtask_id" or "task_id") for subtask identifiers`,
    `- Use "status" with value "pending" for new subtasks`,
    `- Use "name" for phase names, "subtasks" for the subtask array`,
    `- Each subtask MUST be an object — do NOT use plain strings`,
  );

  return lines.join('\n');
}

// =============================================================================
// Lightweight LLM JSON Repair
// =============================================================================

/** Maximum repair attempts before giving up */
const MAX_REPAIR_ATTEMPTS = 2;

/**
 * Attempt to repair an invalid JSON file using a lightweight LLM call.
 *
 * Instead of re-running an entire agent session (which involves codebase
 * exploration, tool calls, and full planning), this makes a single focused
 * generateText() call with Output.object() to fix just the JSON structure.
 *
 * Cost comparison:
 * - Full re-plan: 50-100+ tool calls, reads entire codebase again
 * - This repair: single generateText() call, no tools, just JSON → JSON
 *
 * @param filePath - Path to the invalid JSON file
 * @param schema - Zod schema (coercion variant) for post-repair validation
 * @param outputSchema - Clean Zod schema for Output.object() constrained decoding
 * @param model - The language model to use for repair
 * @param errors - Human-readable validation errors from the first attempt
 * @param schemaHint - Optional schema example for the repair prompt
 * @returns Validation result — valid if repair succeeded, errors if not
 */
export async function repairJsonWithLLM<T>(
  filePath: string,
  schema: ZodSchema<T>,
  outputSchema: ZodSchema,
  model: LanguageModel,
  errors: string[],
  schemaHint?: string,
): Promise<StructuredOutputValidation<T>> {
  // Lazy import to avoid circular dependencies — ai package is heavy
  const { generateText, Output } = await import('ai');

  let rawContent: string;
  try {
    rawContent = await readFile(filePath, 'utf-8');
  } catch {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
    try {
      const repairPrompt = [
        'You are a JSON repair tool. Fix the following JSON so it matches the required schema.',
        '',
        '## Current (invalid) JSON:',
        '```json',
        rawContent,
        '```',
        '',
        '## Validation errors:',
        ...errors.map((e) => `- ${e}`),
        '',
        ...(schemaHint ? ['## Required schema:', schemaHint, ''] : []),
        'Return ONLY the corrected JSON object. Preserve all existing data — only fix the structure.',
      ].join('\n');

      const result = await generateText({
        model,
        prompt: repairPrompt,
        output: Output.object({ schema: outputSchema }),
      });

      if (result.output) {
        // Output.object() validated the response — now validate with the
        // coercion schema (which may normalize fields further) and write back
        const coerced = schema.safeParse(result.output);
        if (coerced.success) {
          // Use a secure temp file + atomic rename to avoid TOCTOU races
          const tempDir = await mkdtemp(join(tmpdir(), 'auto-claude-repair-'));
          const tempFile = join(tempDir, 'output.json');
          try {
            await writeFile(tempFile, JSON.stringify(coerced.data, null, 2));
            await rename(tempFile, filePath);
          } finally {
            await unlink(tempFile).catch(() => undefined);
            const { rmdir } = await import('node:fs/promises');
            await rmdir(tempDir).catch(() => undefined);
          }
          return { valid: true, data: coerced.data, errors: [] };
        }
        // Output.object() passed but coercion schema didn't — update errors for next attempt
        errors = formatZodErrors(coerced.error as ZodError);
        rawContent = JSON.stringify(result.output, null, 2);
      }
    } catch {
      // generateText failed (network, auth, etc.) — fall through to return failure
      break;
    }
  }

  // Repair failed — return the latest errors so the caller can decide next steps
  return { valid: false, errors };
}

/** Schema hint for the implementation plan (used in retry prompts) */
export const IMPLEMENTATION_PLAN_SCHEMA_HINT = `\`\`\`
{
  "feature": "string (feature name)",
  "workflow_type": "string (feature|refactor|bugfix|migration|simple|investigation)",
  "phases": [
    {
      "id": "string or number",
      "name": "string (phase name)",
      "subtasks": [
        {
          "id": "string (unique subtask identifier)",
          "title": "string (REQUIRED — short 3-10 word summary)",
          "description": "string (REQUIRED — detailed implementation instructions)",
          "status": "pending",
          "files_to_modify": ["string (optional)"],
          "files_to_create": ["string (optional)"],
          "verification": { "type": "command|manual", "run": "string (optional)" }
        }
      ]
    }
  ]
}
\`\`\`

IMPORTANT: Each subtask MUST be an object with at least "id", "title", and "status" fields.
Do NOT write subtasks as plain strings — they must be objects.`;
