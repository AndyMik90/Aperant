/**
 * Spec Validator
 * ==============
 *
 * Validates spec outputs at each checkpoint.
 * See apps/desktop/src/main/ai/spec/spec-validator.ts for the TypeScript implementation.
 *
 * Includes:
 *   - validateImplementationPlan() — DAG validation, field checks
 *   - JSON auto-fix runner (repair trailing commas, missing fields)
 *   - Validation fixer agent runner (up to 3 retries via AI)
 */

import { generateText } from 'ai';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';
import { safeParseJson } from '../../utils/json-repair';

// ---------------------------------------------------------------------------
// Schemas (ported from schemas.py)
// ---------------------------------------------------------------------------

const IMPLEMENTATION_PLAN_REQUIRED_FIELDS = ['feature', 'workflow_type', 'phases'];

const IMPLEMENTATION_PLAN_WORKFLOW_TYPES = [
  'feature',
  'refactor',
  'investigation',
  'migration',
  'simple',
  'bugfix',
  'bug_fix',
];

const PHASE_REQUIRED_FIELDS = ['name', 'subtasks'];
const PHASE_REQUIRED_FIELDS_EITHER = [['phase', 'id']];
const PHASE_TYPES = ['setup', 'implementation', 'investigation', 'integration', 'cleanup'];

const SUBTASK_REQUIRED_FIELDS = ['id', 'description', 'status'];
const SUBTASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'blocked', 'failed'];

const VERIFICATION_TYPES = ['command', 'api', 'browser', 'component', 'e2e', 'manual', 'none'];

const CONTEXT_REQUIRED_FIELDS = ['task_description'];
const CONTEXT_RECOMMENDED_FIELDS = ['files_to_modify', 'files_to_reference', 'scoped_services'];

const SPEC_REQUIRED_SECTIONS = ['Overview', 'Workflow Type', 'Task Scope', 'Success Criteria'];
const SPEC_RECOMMENDED_SECTIONS = [
  'Files to Modify',
  'Files to Reference',
  'Requirements',
  'QA Acceptance Criteria',
];

// ---------------------------------------------------------------------------
// Types (ported from models.py)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  checkpoint: string;
  errors: string[];
  warnings: string[];
  fixes: string[];
}

export interface ValidationSummary {
  allPassed: boolean;
  results: ValidationResult[];
  errorCount: number;
  warningCount: number;
}

// ---------------------------------------------------------------------------
// Auto-fix helpers (ported from auto_fix.py)
// ---------------------------------------------------------------------------

/**
 * Attempt to repair common JSON syntax errors.
 * Ported from: `_repair_json_syntax()` in auto_fix.py
 */
function repairJsonSyntax(content: string): string | null {
  if (!content?.trim()) return null;

  const maxSize = 1024 * 1024; // 1 MB
  if (content.length > maxSize) return null;

  let repaired = content;

  // Remove trailing commas before closing brackets/braces
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Strip string contents for bracket counting (to avoid counting brackets in strings)
  const stripped = repaired.replace(/"(?:[^"\\]|\\.)*"/g, '""');

  // Track open brackets using stack
  const stack: string[] = [];
  for (const char of stripped) {
    if (char === '{') stack.push('{');
    else if (char === '[') stack.push('[');
    else if (char === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (char === ']' && stack[stack.length - 1] === '[') stack.pop();
  }

  if (stack.length > 0) {
    // Strip incomplete key-value pair at end
    repaired = repaired.replace(/,\s*"(?:[^"\\]|\\.)*$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    repaired = repaired.replace(/:\s*"(?:[^"\\]|\\.)*$/, ': ""');
    repaired = repaired.replace(/:\s*[0-9.]+$/, ': 0');
    repaired = repaired.trimEnd();

    // Close remaining brackets in reverse order
    for (const bracket of [...stack].reverse()) {
      repaired += bracket === '{' ? '}' : ']';
    }
  }

  // Fix unquoted status values (common LLM error)
  repaired = repaired.replace(
    /("[^"]+"\s*):\s*(pending|in_progress|completed|failed|done|backlog)\s*([,}\]])/g,
    '$1: "$2"$3',
  );

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

/**
 * Normalize common status variants to schema-compliant values.
 * Ported from: `_normalize_status()` in auto_fix.py
 */
function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string') return 'pending';

  const normalized = value.trim().toLowerCase();
  if (SUBTASK_STATUS_VALUES.includes(normalized)) return normalized;

  if (['not_started', 'not started', 'todo', 'to_do', 'backlog'].includes(normalized))
    return 'pending';
  if (['in-progress', 'inprogress', 'working'].includes(normalized)) return 'in_progress';
  if (['done', 'complete', 'completed_successfully'].includes(normalized)) return 'completed';

  return 'pending';
}

/**
 * Attempt to auto-fix common implementation_plan.json issues.
 * Ported from: `auto_fix_plan()` in auto_fix.py
 *
 * @returns true if any fixes were applied
 */
export function autoFixPlan(specDir: string): boolean {
  const planFile = join(specDir, 'implementation_plan.json');

  let plan: Record<string, unknown> | null = null;
  let jsonRepaired = false;

  let content: string;
  try {
    content = readFileSync(planFile, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  plan = safeParseJson<Record<string, unknown>>(content);
  if (!plan) {
    // Try local repairJsonSyntax as a secondary pass
    const repaired = repairJsonSyntax(content);
    if (repaired) {
      plan = safeParseJson<Record<string, unknown>>(repaired);
      if (plan) jsonRepaired = true;
    }
  }
  if (!plan) return false;

  let fixed = false;

  // Convert top-level subtasks/chunks to phases format
  if (
    !('phases' in plan) &&
    (Array.isArray(plan.subtasks) || Array.isArray(plan.chunks))
  ) {
    const subtasks = (plan.subtasks ?? plan.chunks) as unknown[];
    plan.phases = [{ id: '1', phase: 1, name: 'Phase 1', subtasks }];
    delete plan.subtasks;
    delete plan.chunks;
    fixed = true;
  }

  // Fix missing top-level fields
  if (!('feature' in plan)) {
    plan.feature = (plan.title ?? plan.spec_id ?? 'Unnamed Feature') as string;
    fixed = true;
  }

  if (!('workflow_type' in plan)) {
    plan.workflow_type = 'feature';
    fixed = true;
  }

  if (!('phases' in plan)) {
    plan.phases = [];
    fixed = true;
  }

  const phases = plan.phases as Record<string, unknown>[];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];

    // Normalize field aliases
    if (!('name' in phase) && 'title' in phase) {
      phase.name = phase.title;
      fixed = true;
    }

    if (!('phase' in phase)) {
      phase.phase = i + 1;
      fixed = true;
    }

    if (!('name' in phase)) {
      phase.name = `Phase ${i + 1}`;
      fixed = true;
    }

    if (!('subtasks' in phase)) {
      phase.subtasks = (phase.chunks ?? []) as unknown[];
      fixed = true;
    } else if ('chunks' in phase && !(phase.subtasks as unknown[]).length) {
      phase.subtasks = (phase.chunks ?? []) as unknown[];
      fixed = true;
    }

    // Normalize depends_on to string[]
    const raw = phase.depends_on;
    let normalized: string[];
    if (Array.isArray(raw)) {
      normalized = raw.filter((d) => d !== null).map((d) => String(d).trim());
    } else if (raw === null || raw === undefined) {
      normalized = [];
    } else {
      normalized = [String(raw).trim()];
    }
    if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
      phase.depends_on = normalized;
      fixed = true;
    }

    // Fix subtasks
    const subtasks = phase.subtasks as Record<string, unknown>[];
    for (let j = 0; j < subtasks.length; j++) {
      const subtask = subtasks[j];

      if (!('id' in subtask)) {
        subtask.id = `subtask-${i + 1}-${j + 1}`;
        fixed = true;
      }

      if (!('title' in subtask)) {
        // Derive title from description or name if available
        subtask.title = subtask.description || subtask.name || 'Untitled subtask';
        fixed = true;
      }

      if (!('status' in subtask)) {
        subtask.status = 'pending';
        fixed = true;
      } else {
        const ns = normalizeStatus(subtask.status);
        if (subtask.status !== ns) {
          subtask.status = ns;
          fixed = true;
        }
      }
    }
  }

  if (fixed || jsonRepaired) {
    try {
      writeFileSync(planFile, JSON.stringify(plan, null, 2), 'utf-8');
    } catch {
      return false;
    }
  }

  return fixed || jsonRepaired;
}

// ---------------------------------------------------------------------------
// Individual validators (ported from validators/)
// ---------------------------------------------------------------------------

/**
 * Validate prerequisites exist.
 * Ported from: PrereqsValidator in prereqs_validator.py
 */
export function validatePrereqs(specDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  if (!existsSync(specDir)) {
    errors.push(`Spec directory does not exist: ${specDir}`);
    fixes.push(`Create directory: mkdir -p ${specDir}`);
    return { valid: false, checkpoint: 'prereqs', errors, warnings, fixes };
  }

  const projectIndex = join(specDir, 'project_index.json');
  if (!existsSync(projectIndex)) {
    errors.push('project_index.json not found');
    fixes.push('Run project analysis to generate project_index.json');
  }

  return { valid: errors.length === 0, checkpoint: 'prereqs', errors, warnings, fixes };
}

/**
 * Validate context.json exists and has required structure.
 * Ported from: ContextValidator in context_validator.py
 */
export function validateContext(specDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  const contextFile = join(specDir, 'context.json');

  let raw: string;
  try {
    raw = readFileSync(contextFile, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      errors.push('context.json not found');
      fixes.push('Regenerate context.json');
      return { valid: false, checkpoint: 'context', errors, warnings, fixes };
    }
    throw err;
  }
  const context = safeParseJson<Record<string, unknown>>(raw);
  if (!context) {
    errors.push('context.json is invalid JSON');
    fixes.push('Regenerate context.json or fix JSON syntax');
    return { valid: false, checkpoint: 'context', errors, warnings, fixes };
  }

  for (const field of CONTEXT_REQUIRED_FIELDS) {
    if (!(field in context)) {
      errors.push(`Missing required field: ${field}`);
      fixes.push(`Add '${field}' to context.json`);
    }
  }

  for (const field of CONTEXT_RECOMMENDED_FIELDS) {
    if (!(field in context) || !context[field]) {
      warnings.push(`Missing recommended field: ${field}`);
    }
  }

  return { valid: errors.length === 0, checkpoint: 'context', errors, warnings, fixes };
}

/**
 * Validate spec.md exists and has required sections.
 * Ported from: SpecDocumentValidator in spec_document_validator.py
 */
export function validateSpecDocument(specDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  const specFile = join(specDir, 'spec.md');

  let content: string;
  try {
    content = readFileSync(specFile, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      errors.push('spec.md not found');
      fixes.push('Create spec.md with required sections');
      return { valid: false, checkpoint: 'spec', errors, warnings, fixes };
    }
    throw err;
  }

  for (const section of SPEC_REQUIRED_SECTIONS) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^##?\\s+${escaped}`, 'mi');
    if (!pattern.test(content)) {
      errors.push(`Missing required section: '${section}'`);
      fixes.push(`Add '## ${section}' section to spec.md`);
    }
  }

  for (const section of SPEC_RECOMMENDED_SECTIONS) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^##?\\s+${escaped}`, 'mi');
    if (!pattern.test(content)) {
      warnings.push(`Missing recommended section: '${section}'`);
    }
  }

  if (content.length < 500) {
    warnings.push('spec.md seems too short (< 500 chars)');
  }

  return { valid: errors.length === 0, checkpoint: 'spec', errors, warnings, fixes };
}

/**
 * Validate implementation_plan.json exists and has valid schema.
 * Ported from: ImplementationPlanValidator in implementation_plan_validator.py
 *
 * Includes DAG validation (cycle detection) and field existence checks.
 */
export function validateImplementationPlan(specDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  const planFile = join(specDir, 'implementation_plan.json');

  let raw: string;
  try {
    raw = readFileSync(planFile, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      errors.push('implementation_plan.json not found');
      fixes.push('Run the planning phase to generate implementation_plan.json');
      return { valid: false, checkpoint: 'plan', errors, warnings, fixes };
    }
    throw err;
  }
  const plan = safeParseJson<Record<string, unknown>>(raw);
  if (!plan) {
    errors.push('implementation_plan.json is invalid JSON');
    fixes.push('Regenerate implementation_plan.json or fix JSON syntax');
    return { valid: false, checkpoint: 'plan', errors, warnings, fixes };
  }

  // Validate top-level required fields
  for (const field of IMPLEMENTATION_PLAN_REQUIRED_FIELDS) {
    if (!(field in plan)) {
      errors.push(`Missing required field: ${field}`);
      fixes.push(`Add '${field}' to implementation_plan.json`);
    }
  }

  // Validate workflow_type
  if ('workflow_type' in plan) {
    const wt = plan.workflow_type as string;
    if (!IMPLEMENTATION_PLAN_WORKFLOW_TYPES.includes(wt)) {
      errors.push(`Invalid workflow_type: ${wt}`);
      fixes.push(`Use one of: ${IMPLEMENTATION_PLAN_WORKFLOW_TYPES.join(', ')}`);
    }
  }

  // Validate phases
  const phases = (plan.phases as Record<string, unknown>[] | undefined) ?? [];
  if (!phases.length) {
    errors.push('No phases defined');
    fixes.push('Add at least one phase with subtasks');
  } else {
    for (let i = 0; i < phases.length; i++) {
      errors.push(...validatePhase(phases[i], i));
    }
  }

  // Check for at least one subtask
  const totalSubtasks = phases.reduce(
    (sum, p) => sum + ((p.subtasks as unknown[] | undefined)?.length ?? 0),
    0,
  );
  if (totalSubtasks === 0) {
    errors.push('No subtasks defined in any phase');
    fixes.push('Add subtasks to phases');
  }

  // Validate DAG (no cycles)
  errors.push(...validateDependencies(phases));

  return { valid: errors.length === 0, checkpoint: 'plan', errors, warnings, fixes };
}

function validatePhase(phase: Record<string, unknown>, index: number): string[] {
  const errors: string[] = [];

  // Must have at least one of phase/id
  const hasPhaseOrId = PHASE_REQUIRED_FIELDS_EITHER[0].some((f) => f in phase);
  if (!hasPhaseOrId) {
    errors.push(
      `Phase ${index + 1}: missing required field (need one of: ${PHASE_REQUIRED_FIELDS_EITHER[0].join(', ')})`,
    );
  }

  for (const field of PHASE_REQUIRED_FIELDS) {
    if (!(field in phase)) {
      errors.push(`Phase ${index + 1}: missing required field '${field}'`);
    }
  }

  if ('type' in phase && !PHASE_TYPES.includes(phase.type as string)) {
    errors.push(`Phase ${index + 1}: invalid type '${phase.type as string}'`);
  }

  const subtasks = (phase.subtasks as Record<string, unknown>[] | undefined) ?? [];
  for (let j = 0; j < subtasks.length; j++) {
    errors.push(...validateSubtask(subtasks[j], index, j));
  }

  return errors;
}

function validateSubtask(
  subtask: Record<string, unknown>,
  phaseIdx: number,
  subtaskIdx: number,
): string[] {
  const errors: string[] = [];

  for (const field of SUBTASK_REQUIRED_FIELDS) {
    if (!(field in subtask)) {
      errors.push(
        `Phase ${phaseIdx + 1}, Subtask ${subtaskIdx + 1}: missing required field '${field}'`,
      );
    }
  }

  if ('status' in subtask && !SUBTASK_STATUS_VALUES.includes(subtask.status as string)) {
    errors.push(
      `Phase ${phaseIdx + 1}, Subtask ${subtaskIdx + 1}: invalid status '${subtask.status as string}'`,
    );
  }

  if ('verification' in subtask) {
    const ver = subtask.verification as Record<string, unknown>;
    if (!('type' in ver)) {
      errors.push(
        `Phase ${phaseIdx + 1}, Subtask ${subtaskIdx + 1}: verification missing 'type'`,
      );
    } else if (!VERIFICATION_TYPES.includes(ver.type as string)) {
      errors.push(
        `Phase ${phaseIdx + 1}, Subtask ${subtaskIdx + 1}: invalid verification type '${ver.type as string}'`,
      );
    }
  }

  return errors;
}

/**
 * Validate no circular dependencies in phases (DAG check).
 * Ported from: `_validate_dependencies()` in implementation_plan_validator.py
 */
function validateDependencies(phases: Record<string, unknown>[]): string[] {
  const errors: string[] = [];

  // Build phase ID → position map (supports both "id" string and "phase" number)
  const phaseIds = new Set<string | number>();
  const phaseOrder = new Map<string | number, number>();

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const phaseId = (p.id ?? p.phase ?? i + 1) as string | number;
    phaseIds.add(phaseId);
    phaseOrder.set(phaseId, i);
  }

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseId = (phase.id ?? phase.phase ?? i + 1) as string | number;
    const dependsOn = (phase.depends_on as (string | number)[] | undefined) ?? [];

    for (const dep of dependsOn) {
      if (!phaseIds.has(dep)) {
        errors.push(`Phase ${phaseId}: depends on non-existent phase ${dep}`);
      } else if ((phaseOrder.get(dep) ?? -1) >= i) {
        errors.push(`Phase ${phaseId}: cannot depend on phase ${dep} (would create cycle)`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// SpecValidator orchestrator (ported from spec_validator.py)
// ---------------------------------------------------------------------------

/**
 * Validates spec outputs at each checkpoint.
 * Ported from: SpecValidator class in spec_validator.py
 */
export class SpecValidator {
  constructor(private specDir: string) {}

  validateAll(): ValidationResult[] {
    return [
      this.validatePrereqs(),
      this.validateContext(),
      this.validateSpecDocument(),
      this.validateImplementationPlan(),
    ];
  }

  validatePrereqs(): ValidationResult {
    return validatePrereqs(this.specDir);
  }

  validateContext(): ValidationResult {
    return validateContext(this.specDir);
  }

  validateSpecDocument(): ValidationResult {
    return validateSpecDocument(this.specDir);
  }

  validateImplementationPlan(): ValidationResult {
    return validateImplementationPlan(this.specDir);
  }

  /**
   * Run full validation and return a summary.
   */
  summarize(): ValidationSummary {
    const results = this.validateAll();
    const allPassed = results.every((r) => r.valid);
    const errorCount = results.reduce((s, r) => s + r.errors.length, 0);
    const warningCount = results.reduce((s, r) => s + r.warnings.length, 0);
    return { allPassed, results, errorCount, warningCount };
  }
}

// ---------------------------------------------------------------------------
// Validation Fixer Agent (auto-fix using AI, up to 3 retries)
// ---------------------------------------------------------------------------

/** Maximum auto-fix retries */
const MAX_AUTO_FIX_RETRIES = 3;

const VALIDATION_FIXER_SYSTEM_PROMPT = `You are the Validation Fixer Agent in the Auto-Build spec creation pipeline. Your ONLY job is to fix validation errors in spec files so the pipeline can continue.

Key Principle: Read the error, understand the schema, fix the file. Be surgical.

Schemas:
- context.json requires: task_description (string)
- implementation_plan.json requires: feature (string), workflow_type (string: feature|refactor|investigation|migration|simple|bugfix), phases (array of {phase|id, name, subtasks})
- Each subtask requires: id (string), description (string), status (string: pending|in_progress|completed|blocked|failed)
- spec.md requires sections: ## Overview, ## Workflow Type, ## Task Scope, ## Success Criteria

Rules:
1. READ BEFORE FIXING - Always read the file first
2. MINIMAL CHANGES - Only fix what's broken, don't restructure
3. PRESERVE DATA - Don't lose existing valid data
4. VALID OUTPUT - Ensure fixed file is valid JSON/Markdown
5. ONE FIX AT A TIME - Fix one error, verify, then next`;

/**
 * Attempt to fix validation errors using an AI agent.
 *
 * Runs up to MAX_AUTO_FIX_RETRIES times, checking validation after each attempt.
 *
 * @param specDir - Path to the spec directory
 * @param errors - Validation errors to fix
 * @param checkpoint - Which checkpoint failed (context, spec, plan, etc.)
 * @returns Updated ValidationResult after fixing attempts
 */
export async function runValidationFixer(
  specDir: string,
  errors: string[],
  checkpoint: string,
): Promise<ValidationResult> {
  if (errors.length === 0) {
    return { valid: true, checkpoint, errors: [], warnings: [], fixes: [] };
  }

  let lastResult: ValidationResult = {
    valid: false,
    checkpoint,
    errors,
    warnings: [],
    fixes: [],
  };

  for (let attempt = 0; attempt < MAX_AUTO_FIX_RETRIES; attempt++) {
    // First, try structural auto-fix (no AI call needed)
    if (checkpoint === 'plan') {
      const fixed = autoFixPlan(specDir);
      if (fixed) {
        // Re-validate after auto-fix
        const result = validateImplementationPlan(specDir);
        if (result.valid) return result;
        lastResult = result;
        if (lastResult.errors.length === 0) break;
      }
    }

    // Build AI fixer prompt
    const errorList = lastResult.errors.map((e) => `  - ${e}`).join('\n');
    const prompt = buildFixerPrompt(specDir, checkpoint, lastResult.errors);

    try {
      const client = await createSimpleClient({
        systemPrompt: VALIDATION_FIXER_SYSTEM_PROMPT,
        modelShorthand: 'sonnet',
        thinkingLevel: 'low',
        maxSteps: 10,
      });

      await generateText({
        model: client.model,
        system: client.systemPrompt,
        prompt,
      });
    } catch {
      // Continue regardless — the fixer may have written files before failing
    }

    // Re-validate
    const recheck = recheckValidation(specDir, checkpoint);
    if (recheck.valid) return recheck;

    lastResult = recheck;

    if (attempt < MAX_AUTO_FIX_RETRIES - 1) {
      // Next iteration will pass updated errors
    }
  }

  return lastResult;
}

function buildFixerPrompt(specDir: string, checkpoint: string, errors: string[]): string {
  const errorList = errors.map((e) => `  - ${e}`).join('\n');

  // Read current file contents for context
  const fileContents: string[] = [];

  if (checkpoint === 'context') {
    const cf = join(specDir, 'context.json');
    try {
      fileContents.push(`## context.json (current):\n\`\`\`json\n${readFileSync(cf, 'utf-8')}\n\`\`\``);
    } catch { /* ignore */ }
  } else if (checkpoint === 'spec') {
    const sf = join(specDir, 'spec.md');
    try {
      fileContents.push(`## spec.md (current):\n\`\`\`markdown\n${readFileSync(sf, 'utf-8').slice(0, 5000)}\n\`\`\``);
    } catch { /* ignore */ }
  } else if (checkpoint === 'plan') {
    const pf = join(specDir, 'implementation_plan.json');
    try {
      fileContents.push(`## implementation_plan.json (current):\n\`\`\`json\n${readFileSync(pf, 'utf-8').slice(0, 8000)}\n\`\`\``);
    } catch { /* ignore */ }
  }

  return `Fix the following validation errors in the spec directory: ${specDir}

## Validation Errors (checkpoint: ${checkpoint}):
${errorList}

${fileContents.join('\n\n')}

Please fix each error by reading the file and making minimal corrections. Verify your fixes are valid after applying them.`;
}

function recheckValidation(specDir: string, checkpoint: string): ValidationResult {
  switch (checkpoint) {
    case 'prereqs':
      return validatePrereqs(specDir);
    case 'context':
      return validateContext(specDir);
    case 'spec':
      return validateSpecDocument(specDir);
    case 'plan':
      return validateImplementationPlan(specDir);
    default:
      return { valid: true, checkpoint, errors: [], warnings: [], fixes: [] };
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format a validation result as a human-readable string.
 * Mirrors Python's ValidationResult.__str__()
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines = [
    `Checkpoint: ${result.checkpoint}`,
    `Status: ${result.valid ? 'PASS' : 'FAIL'}`,
  ];

  if (result.errors.length > 0) {
    lines.push('\nErrors:');
    for (const err of result.errors) {
      lines.push(`  [X] ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    for (const warn of result.warnings) {
      lines.push(`  [!] ${warn}`);
    }
  }

  if (result.fixes.length > 0 && !result.valid) {
    lines.push('\nSuggested Fixes:');
    for (const fix of result.fixes) {
      lines.push(`  -> ${fix}`);
    }
  }

  return lines.join('\n');
}
