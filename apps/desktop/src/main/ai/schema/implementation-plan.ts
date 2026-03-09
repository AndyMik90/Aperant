/**
 * Implementation Plan Schema
 * ==========================
 *
 * Zod schema for validating and coercing implementation_plan.json.
 *
 * LLMs produce field name variations (title vs description, subtask_id vs id, etc.).
 * This schema handles coercion of known aliases via `z.preprocess()` so validation
 * succeeds even when models deviate from the exact spec — while still ensuring
 * all required data is present.
 */

import { z } from 'zod';

// =============================================================================
// Subtask Status Enum
// =============================================================================

const SUBTASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'blocked', 'failed'] as const;

/**
 * Coerces common status variations to canonical values.
 * LLMs frequently output "done", "complete", "not_started", "todo", etc.
 */
function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string') return 'pending';
  const lower = value.toLowerCase().trim();

  // Map common LLM variations to canonical values
  const statusMap: Record<string, string> = {
    done: 'completed',
    complete: 'completed',
    finished: 'completed',
    success: 'completed',
    not_started: 'pending',
    todo: 'pending',
    queued: 'pending',
    backlog: 'pending',
    running: 'in_progress',
    active: 'in_progress',
    wip: 'in_progress',
    working: 'in_progress',
    stuck: 'blocked',
    waiting: 'blocked',
    error: 'failed',
    errored: 'failed',
  };

  return statusMap[lower] ?? (SUBTASK_STATUS_VALUES.includes(lower as typeof SUBTASK_STATUS_VALUES[number]) ? lower : 'pending');
}

// =============================================================================
// Subtask Schema (with coercion)
// =============================================================================

/**
 * Preprocessor that normalizes LLM field name variations before Zod validation.
 * Handles: subtask_id→id, name→title (fallback), file_paths→files_to_modify.
 * Title is the primary field (short summary); description is optional detail.
 */
function coerceSubtask(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  return {
    ...raw,
    // Coerce id: accept subtask_id, task_id, step as aliases
    // Some models use "step": 1 as the identifier instead of "id"
    id: raw.id ?? raw.subtask_id ?? raw.task_id ?? (raw.step !== undefined ? String(raw.step) : undefined),
    // Title is the primary field — short summary (3-10 words).
    // Falls back to name/summary/description for models that don't produce "title".
    title: raw.title ?? raw.name ?? raw.summary ?? raw.description ?? undefined,
    // Description is detailed implementation notes for the coder agent.
    // Falls back to details/title/name for models that don't produce a separate description.
    description: raw.description ?? (typeof raw.details === 'string' ? raw.details : undefined) ?? raw.title ?? raw.name ?? raw.summary ?? undefined,
    // Normalize status
    status: normalizeStatus(raw.status),
    // Coerce files_to_modify: accept file_paths, files_modified as aliases
    files_to_modify: raw.files_to_modify ?? raw.file_paths ?? raw.files_modified ?? undefined,
    // Coerce files_to_create: accept new_files as alias
    files_to_create: raw.files_to_create ?? raw.new_files ?? undefined,
    // Coerce verification object: accept method as alias for type.
    // Non-object verification values (strings, etc.) are NOT coerced — let Zod
    // reject them so the validation retry loop can tell the LLM what's wrong.
    verification: raw.verification && typeof raw.verification === 'object'
      ? {
          ...(raw.verification as Record<string, unknown>),
          type: (raw.verification as Record<string, unknown>).type
            ?? (raw.verification as Record<string, unknown>).method
            ?? undefined,
        }
      : raw.verification,
  };
}

export const PlanSubtaskSchema = z.preprocess(coerceSubtask, z.object({
  id: z.string({ message: 'Subtask must have an "id" field' }),
  title: z.string({ message: 'Subtask must have a "title" field (short 3-10 word summary)' }),
  description: z.string({ message: 'Subtask must have a "description" field (detailed implementation notes)' }),
  status: z.enum(SUBTASK_STATUS_VALUES).default('pending'),
  files_to_create: z.array(z.string()).optional(),
  files_to_modify: z.array(z.string()).optional(),
  verification: z.object({
    type: z.string(),
    run: z.string().optional(),
    scenario: z.string().optional(),
  }).optional(),
  // Passthrough unknown fields so we don't lose data the LLM added
}).passthrough());

// =============================================================================
// Phase Schema (with coercion)
// =============================================================================

function coercePhase(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  const phaseId = raw.id ?? raw.phase_id ?? (raw.phase !== undefined ? String(raw.phase) : undefined);

  // Resolve subtasks from known aliases
  let subtasks = raw.subtasks ?? raw.chunks ?? raw.tasks ?? undefined;

  // Coerce string/number subtask items to objects.
  // Many LLMs write tasks as simple string arrays instead of subtask objects:
  //   "tasks": ["Add package.json", "Set up Vite", "Add linting"]
  // This is a common pattern across providers (OpenAI, Gemini, Mistral, local
  // models, etc.) — convert to subtask objects so downstream validation succeeds.
  if (Array.isArray(subtasks)) {
    subtasks = subtasks.map((item: unknown, idx: number) => {
      if (typeof item === 'string') {
        return {
          id: `${phaseId ?? idx + 1}-${idx + 1}`,
          title: item,
          status: 'pending',
          files_to_modify: [],
          files_to_create: [],
        };
      }
      // Some models write subtasks as bare numbers (step indices)
      if (typeof item === 'number') {
        return {
          id: `${phaseId ?? idx + 1}-${idx + 1}`,
          title: `Step ${item}`,
          status: 'pending',
        };
      }
      return item;
    });
  }

  return {
    ...raw,
    // Coerce id: accept phase_id as alias, or convert phase number to string id
    id: phaseId,
    // Coerce name: accept title as alias
    name: raw.name ?? raw.title ?? (raw.id ? String(raw.id) : undefined) ?? 'Phase',
    subtasks,
  };
}

export const PlanPhaseSchema = z.preprocess(coercePhase, z.object({
  id: z.union([z.string(), z.number().transform(String)]).optional(),
  phase: z.number().optional(),
  name: z.string({ message: 'Phase must have a "name" (or "title") field' }),
  subtasks: z.array(PlanSubtaskSchema, { message: 'Phase must have a "subtasks" array' }).min(1, 'Phase must have at least one subtask'),
  depends_on: z.array(z.union([z.string(), z.number()])).optional(),
}).passthrough())
  // Ensure at least one of id or phase is present
  .refine(
    (phase) => phase.id !== undefined || phase.phase !== undefined,
    { message: 'Phase must have either "id" or "phase" field' }
  );

// =============================================================================
// Implementation Plan Schema (top-level)
// =============================================================================

function coercePlan(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = input as Record<string, unknown>;

  // If model wrote flat steps/tasks/implementation_steps instead of phases[], wrap in a single phase.
  // Many models produce a flat array of steps rather than the nested
  // phases[].subtasks[] structure our schema requires.
  // The quick_spec agent commonly writes "implementation_steps" as well.
  let phases = raw.phases;
  if (!phases && (raw.steps || raw.tasks || raw.implementation_steps)) {
    const items = (raw.steps ?? raw.tasks ?? raw.implementation_steps) as unknown[];
    phases = [{
      id: '1',
      name: raw.feature ?? raw.title ?? raw.name ?? 'Implementation',
      subtasks: items,
    }];
  }

  // Handle flat files_to_modify / implementation_order format.
  // Some models (especially for simple tasks) write a flat structure:
  //   { "files_to_modify": [{ "path": "...", "changes": [...] }], "implementation_order": ["..."] }
  // instead of the nested phases[].subtasks[] structure. Convert to canonical form.
  if (!phases && Array.isArray(raw.files_to_modify)) {
    const subtasks: unknown[] = [];

    if (Array.isArray(raw.implementation_order) && raw.implementation_order.length > 0) {
      // Use implementation_order entries as subtasks (each is a string description)
      for (let i = 0; i < (raw.implementation_order as unknown[]).length; i++) {
        const orderEntry = (raw.implementation_order as unknown[])[i];
        const desc = typeof orderEntry === 'string' ? orderEntry : String(orderEntry);
        // Extract file path from the description (format: "file.js: Do something")
        const colonIdx = desc.indexOf(':');
        const filePath = colonIdx > 0 ? desc.slice(0, colonIdx).trim() : undefined;
        subtasks.push({
          id: `1-${i + 1}`,
          title: desc,
          status: 'pending',
          files_to_modify: filePath ? [filePath] : [],
        });
      }
    } else {
      // Fall back to creating subtasks from files_to_modify[].changes[]
      let subtaskIndex = 0;
      for (const fileEntry of raw.files_to_modify as unknown[]) {
        if (fileEntry && typeof fileEntry === 'object') {
          const entry = fileEntry as Record<string, unknown>;
          const filePath = typeof entry.path === 'string' ? entry.path : undefined;
          const changes = Array.isArray(entry.changes) ? entry.changes : [];
          for (const change of changes) {
            subtaskIndex++;
            const changeDesc = change && typeof change === 'object'
              ? (change as Record<string, unknown>).description ?? JSON.stringify(change)
              : String(change);
            subtasks.push({
              id: `1-${subtaskIndex}`,
              title: changeDesc as string,
              status: 'pending',
              files_to_modify: filePath ? [filePath] : [],
            });
          }
        }
      }
    }

    if (subtasks.length > 0) {
      phases = [{
        id: '1',
        name: raw.feature ?? raw.title ?? raw.name ?? 'Implementation',
        subtasks,
      }];
    }
  }

  return {
    ...raw,
    // Coerce feature: accept title, name as aliases
    feature: raw.feature ?? raw.title ?? raw.name ?? undefined,
    // Coerce workflow_type: accept type as alias
    workflow_type: raw.workflow_type ?? raw.type ?? undefined,
    phases,
  };
}

export const ImplementationPlanSchema = z.preprocess(coercePlan, z.object({
  feature: z.string().optional(),
  workflow_type: z.string().optional(),
  phases: z.array(PlanPhaseSchema, { message: 'Plan must have a "phases" array' }).min(1, 'Plan must have at least one phase'),
}).passthrough());

// =============================================================================
// Inferred Types
// =============================================================================

export type ValidatedPlanSubtask = z.infer<typeof PlanSubtaskSchema>;
export type ValidatedPlanPhase = z.infer<typeof PlanPhaseSchema>;
export type ValidatedImplementationPlan = z.infer<typeof ImplementationPlanSchema>;
