/**
 * Build Orchestrator
 * ==================
 *
 * See apps/desktop/src/main/ai/orchestration/build-orchestrator.ts for the TypeScript implementation.
 * Drives the full build lifecycle through phase progression:
 *   planning → coding → qa_review → qa_fixing → complete/failed
 *
 * Each phase invokes `runAgentSession()` with the appropriate agent type,
 * system prompt, and configuration. Phase transitions follow the ordering
 * defined in phase-protocol.ts.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'events';

import type { ExecutionPhase } from '../../../shared/constants/phase-protocol';
import {
  isTerminalPhase,
  isValidPhaseTransition,
  type CompletablePhase,
} from '../../../shared/constants/phase-protocol';
import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import {
  ImplementationPlanSchema,
  ImplementationPlanOutputSchema,
  validateAndNormalizeJsonFile,
  repairJsonWithLLM,
  buildValidationRetryPrompt,
  IMPLEMENTATION_PLAN_SCHEMA_HINT,
} from '../schema';
import { safeParseJson } from '../../utils/json-repair';
import type { SessionResult } from '../session/types';
import { iterateSubtasks } from './subtask-iterator';
import type { SubtaskIteratorConfig, SubtaskResult } from './subtask-iterator';

// =============================================================================
// Constants
// =============================================================================

/** Delay between iterations when auto-continuing (ms) */
const AUTO_CONTINUE_DELAY_MS = 3_000;

/** Maximum planning validation retries before failing */
const MAX_PLANNING_VALIDATION_RETRIES = 3;

/** Maximum retries for a single subtask before marking stuck */
const MAX_SUBTASK_RETRIES = 3;

/** Delay before retrying after an error (ms) */
const ERROR_RETRY_DELAY_MS = 5_000;

// =============================================================================
// Types
// =============================================================================

/** Build phase mapped to agent type */
type BuildPhase = 'planning' | 'coding' | 'qa_review' | 'qa_fixing';

/** Maps build phases to their agent types */
const PHASE_AGENT_MAP: Record<BuildPhase, AgentType> = {
  planning: 'planner',
  coding: 'coder',
  qa_review: 'qa_reviewer',
  qa_fixing: 'qa_fixer',
} as const;

/** Maps build phases to config phase keys */
const PHASE_CONFIG_MAP: Record<BuildPhase, Phase> = {
  planning: 'planning',
  coding: 'coding',
  qa_review: 'qa',
  qa_fixing: 'qa',
} as const;

/** Configuration for the build orchestrator */
export interface BuildOrchestratorConfig {
  /** Spec directory path (e.g., .auto-claude/specs/001-feature/) */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Source spec directory in main project (for worktree syncing) */
  sourceSpecDir?: string;
  /** CLI model override */
  cliModel?: string;
  /** CLI thinking level override */
  cliThinking?: string;
  /** Maximum iterations (0 = unlimited) */
  maxIterations?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback to generate the system prompt for a given agent type and phase */
  generatePrompt: (agentType: AgentType, phase: BuildPhase, context: PromptContext) => Promise<string>;
  /** Callback to run an agent session */
  runSession: (config: SessionRunConfig) => Promise<SessionResult>;
  /** Optional callback for syncing spec to source (worktree mode) */
  syncSpecToSource?: (specDir: string, sourceSpecDir: string) => Promise<boolean>;
  /** Optional callback to get a resolved LanguageModel for lightweight repair calls */
  getModel?: (agentType: AgentType) => Promise<import('ai').LanguageModel | undefined>;
}

/** Context passed to prompt generation */
export interface PromptContext {
  /** Current iteration number */
  iteration: number;
  /** Current subtask (if in coding phase) */
  subtask?: SubtaskInfo;
  /** Planning retry context (if replanning after validation failure) */
  planningRetryContext?: string;
  /** Recovery hints for subtask retries */
  recoveryHints?: string;
  /** Number of previous attempts on current subtask */
  attemptCount: number;
}

/** Minimal subtask info for prompt generation */
export interface SubtaskInfo {
  id: string;
  description: string;
  phaseName?: string;
  filesToCreate?: string[];
  filesToModify?: string[];
  status: string;
}

/** Configuration passed to runSession callback */
export interface SessionRunConfig {
  agentType: AgentType;
  phase: Phase;
  systemPrompt: string;
  specDir: string;
  projectDir: string;
  subtaskId?: string;
  sessionNumber: number;
  abortSignal?: AbortSignal;
  cliModel?: string;
  cliThinking?: string;
  /** Optional Zod schema for structured output (uses AI SDK Output.object()) */
  outputSchema?: import('zod').ZodSchema;
}

/** Events emitted by the build orchestrator */
export interface BuildOrchestratorEvents {
  /** Phase transition */
  'phase-change': (phase: ExecutionPhase, message: string) => void;
  /** Iteration started */
  'iteration-start': (iteration: number, phase: BuildPhase) => void;
  /** Session completed */
  'session-complete': (result: SessionResult, phase: BuildPhase) => void;
  /** Build finished (success or failure) */
  'build-complete': (outcome: BuildOutcome) => void;
  /** Log message */
  'log': (message: string) => void;
  /** Error occurred */
  'error': (error: Error, phase: BuildPhase) => void;
}

/** Final build outcome */
export interface BuildOutcome {
  /** Whether the build succeeded */
  success: boolean;
  /** Final phase reached */
  finalPhase: ExecutionPhase;
  /** Total iterations executed */
  totalIterations: number;
  /** Total duration in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Whether the coding phase completed before failure (indicates QA-phase failure) */
  codingCompleted: boolean;
}

// =============================================================================
// Implementation Plan Types
// =============================================================================

/** Structure of implementation_plan.json */
interface ImplementationPlan {
  feature?: string;
  workflow_type?: string;
  phases: PlanPhase[];
}

interface PlanPhase {
  id?: string;
  phase?: number;
  name: string;
  subtasks: PlanSubtask[];
}

interface PlanSubtask {
  id: string;
  description: string;
  status: string;
  files_to_create?: string[];
  files_to_modify?: string[];
}

// =============================================================================
// BuildOrchestrator
// =============================================================================

/**
 * Orchestrates the full build lifecycle through phase progression.
 *
 * Replaces the Python `run_autonomous_agent()` main loop in `agents/coder.py`.
 * Manages transitions between planning, coding, QA review, and QA fixing phases.
 */
export class BuildOrchestrator extends EventEmitter {
  private config: BuildOrchestratorConfig;
  private currentPhase: ExecutionPhase = 'idle';
  private completedPhases: CompletablePhase[] = [];
  private iteration = 0;
  private aborted = false;

  constructor(config: BuildOrchestratorConfig) {
    super();
    this.config = config;

    // Listen for abort
    config.abortSignal?.addEventListener('abort', () => {
      this.aborted = true;
    });
  }

  /**
   * Run the full build lifecycle.
   *
   * Phase progression:
   * 1. Check if implementation_plan.json exists
   *    - No: Run planning phase to create it
   *    - Yes: Skip to coding
   * 2. Run coding phase (iterate subtasks)
   * 3. Run QA review
   * 4. If QA fails: run QA fixing, then re-review
   * 5. Complete or fail
   */
  async run(): Promise<BuildOutcome> {
    const startTime = Date.now();

    try {
      // Determine starting phase
      const isFirstRun = await this.isFirstRun();

      if (isFirstRun) {
        // Planning phase
        const planResult = await this.runPlanningPhase();
        if (!planResult.success) {
          return this.buildOutcome(false, Date.now() - startTime, planResult.error);
        }

        // Reset subtask statuses to "pending" after first-run planning — the spec
        // pipeline or planner may have created the plan with pre-set "completed"
        // statuses, which would cause isBuildComplete() to skip coding entirely.
        // Only on first run: resumed builds must preserve genuine progress.
        await this.resetSubtaskStatuses();
      }

      // Validate and normalize the plan before coding.
      // This is critical when the spec_orchestrator creates the plan (before the
      // build orchestrator runs) — it may omit `status` fields or use alternate
      // field names, causing the subtask iterator to find 0 pending subtasks.
      const preCodingPlanPath = join(this.config.specDir, 'implementation_plan.json');
      const preCodingValidation = await validateAndNormalizeJsonFile(preCodingPlanPath, ImplementationPlanSchema);
      if (!preCodingValidation.valid) {
        const errorDetail = preCodingValidation.errors.join('; ');
        this.emitTyped('log', `Pre-coding plan validation failed: ${errorDetail}`);
        return this.buildOutcome(false, Date.now() - startTime,
          `Implementation plan is invalid and cannot be executed: ${errorDetail}`);
      }

      // Check if build is already complete
      if (await this.isBuildComplete()) {
        this.transitionPhase('complete', 'Build already complete');
        return this.buildOutcome(true, Date.now() - startTime);
      }

      // Coding phase
      const codingResult = await this.runCodingPhase();
      if (!codingResult.success) {
        return this.buildOutcome(false, Date.now() - startTime, codingResult.error);
      }

      // QA review phase
      const qaResult = await this.runQAPhase();
      return this.buildOutcome(qaResult.success, Date.now() - startTime, qaResult.error);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.transitionPhase('failed', `Build failed: ${message}`);
      return this.buildOutcome(false, Date.now() - startTime, message);
    }
  }

  // ===========================================================================
  // Phase Runners
  // ===========================================================================

  /**
   * Run the planning phase: invoke planner agent to create implementation_plan.json.
   */
  private async runPlanningPhase(): Promise<{ success: boolean; error?: string }> {
    this.transitionPhase('planning', 'Creating implementation plan');
    let planningRetryContext: string | undefined;
    let validationFailures = 0;

    for (let attempt = 0; attempt < MAX_PLANNING_VALIDATION_RETRIES + 1; attempt++) {
      if (this.aborted) {
        return { success: false, error: 'Build cancelled' };
      }

      this.iteration++;
      this.emitTyped('iteration-start', this.iteration, 'planning');

      const prompt = await this.config.generatePrompt('planner', 'planning', {
        iteration: this.iteration,
        planningRetryContext,
        attemptCount: attempt,
      });

      const result = await this.config.runSession({
        agentType: 'planner',
        phase: 'planning',
        systemPrompt: prompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.iteration,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
        outputSchema: ImplementationPlanOutputSchema,
      });

      this.emitTyped('session-complete', result, 'planning');

      if (result.outcome === 'cancelled') {
        return { success: false, error: 'Build cancelled' };
      }

      if (result.outcome === 'error' || result.outcome === 'auth_failure' || result.outcome === 'rate_limited') {
        return { success: false, error: result.error?.message ?? 'Planning session failed' };
      }

      // If the provider returned structured output via constrained decoding,
      // write it to the plan file — this is guaranteed to match the schema.
      if (result.structuredOutput) {
        const structuredPlanPath = join(this.config.specDir, 'implementation_plan.json');
        try {
          await writeFile(structuredPlanPath, JSON.stringify(result.structuredOutput, null, 2));
          this.emitTyped('log', 'Wrote implementation plan from structured output (schema-guaranteed)');
        } catch {
          // Non-fatal — fall through to file-based validation
        }
      }

      // Validate + normalize the implementation plan using Zod schema.
      // Zod coercion handles LLM field name variations (title→description,
      // subtask_id→id, status normalization, etc.) and writes back canonical data.
      const planPath = join(this.config.specDir, 'implementation_plan.json');
      const validation = await validateAndNormalizeJsonFile(planPath, ImplementationPlanSchema);
      if (validation.valid) {
        // Sync to source if in worktree mode
        if (this.config.sourceSpecDir && this.config.syncSpecToSource) {
          await this.config.syncSpecToSource(this.config.specDir, this.config.sourceSpecDir);
        }
        this.markPhaseCompleted('planning');
        return { success: true };
      }

      // Plan is invalid — try lightweight LLM repair first (single generateText call,
      // no tools, no codebase re-exploration). This is ~100x cheaper than a full re-plan.
      validationFailures++;
      this.emitTyped('log', `Plan validation failed (attempt ${validationFailures}), attempting lightweight repair...`);

      if (this.config.getModel) {
        const model = await this.config.getModel('planner');
        if (model) {
          const repairResult = await repairJsonWithLLM(
            planPath,
            ImplementationPlanSchema,
            ImplementationPlanOutputSchema,
            model,
            validation.errors,
            IMPLEMENTATION_PLAN_SCHEMA_HINT,
          );
          if (repairResult.valid) {
            this.emitTyped('log', 'Lightweight repair succeeded');
            if (this.config.sourceSpecDir && this.config.syncSpecToSource) {
              await this.config.syncSpecToSource(this.config.specDir, this.config.sourceSpecDir);
            }
            this.markPhaseCompleted('planning');
            return { success: true };
          }
          this.emitTyped('log', `Lightweight repair failed: ${repairResult.errors.join(', ')}`);
        }
      }

      // Lightweight repair failed or unavailable — fall back to full re-plan
      if (validationFailures >= MAX_PLANNING_VALIDATION_RETRIES) {
        return {
          success: false,
          error: `Implementation plan validation failed after ${validationFailures} attempts: ${validation.errors.join(', ')}`,
        };
      }

      // Build retry context for the full re-plan (last resort)
      planningRetryContext = buildValidationRetryPrompt(
        'implementation_plan.json',
        validation.errors,
        IMPLEMENTATION_PLAN_SCHEMA_HINT,
      );

      this.emitTyped('log', `Falling back to full re-plan (attempt ${validationFailures + 1})...`);
    }

    return { success: false, error: 'Planning exhausted all retries' };
  }

  /**
   * Run the coding phase: iterate through subtasks and invoke coder agent.
   */
  private async runCodingPhase(): Promise<{ success: boolean; error?: string }> {
    this.transitionPhase('coding', 'Starting implementation');

    const iteratorConfig: SubtaskIteratorConfig = {
      specDir: this.config.specDir,
      projectDir: this.config.projectDir,
      sourceSpecDir: this.config.sourceSpecDir,
      maxRetries: MAX_SUBTASK_RETRIES,
      autoContinueDelayMs: AUTO_CONTINUE_DELAY_MS,
      abortSignal: this.config.abortSignal,
      onSubtaskStart: (subtask, attempt) => {
        this.iteration++;
        this.emitTyped('iteration-start', this.iteration, 'coding');
        this.emitTyped('log', `Working on ${subtask.id}: ${subtask.description} (attempt ${attempt})`);
      },
      runSubtaskSession: async (subtask, attempt) => {
        const prompt = await this.config.generatePrompt('coder', 'coding', {
          iteration: this.iteration,
          subtask,
          attemptCount: attempt,
        });

        return this.config.runSession({
          agentType: 'coder',
          phase: 'coding',
          systemPrompt: prompt,
          specDir: this.config.specDir,
          projectDir: this.config.projectDir,
          subtaskId: subtask.id,
          sessionNumber: this.iteration,
          abortSignal: this.config.abortSignal,
          cliModel: this.config.cliModel,
          cliThinking: this.config.cliThinking,
        });
      },
      onSubtaskComplete: (subtask, result) => {
        this.emitTyped('session-complete', result, 'coding');
      },
      onSubtaskStuck: (subtask, reason) => {
        this.emitTyped('log', `Subtask ${subtask.id} stuck: ${reason}`);
      },
    };

    const iteratorResult = await iterateSubtasks(iteratorConfig);

    if (iteratorResult.cancelled) {
      return { success: false, error: 'Build cancelled' };
    }

    if (iteratorResult.stuckSubtasks.length > 0 && iteratorResult.completedSubtasks === 0) {
      return {
        success: false,
        error: `All subtasks stuck: ${iteratorResult.stuckSubtasks.join(', ')}`,
      };
    }

    // Sync after coding
    if (this.config.sourceSpecDir && this.config.syncSpecToSource) {
      await this.config.syncSpecToSource(this.config.specDir, this.config.sourceSpecDir);
    }

    this.markPhaseCompleted('coding');
    return { success: true };
  }

  /**
   * Run QA review and optional QA fixing loop.
   */
  private async runQAPhase(): Promise<{ success: boolean; error?: string }> {
    // QA review
    this.transitionPhase('qa_review', 'Running QA review');

    const maxQACycles = 3;
    for (let cycle = 0; cycle < maxQACycles; cycle++) {
      if (this.aborted) {
        return { success: false, error: 'Build cancelled' };
      }

      this.iteration++;
      this.emitTyped('iteration-start', this.iteration, 'qa_review');

      const reviewPrompt = await this.config.generatePrompt('qa_reviewer', 'qa_review', {
        iteration: this.iteration,
        attemptCount: cycle,
      });

      const reviewResult = await this.config.runSession({
        agentType: 'qa_reviewer',
        phase: 'qa',
        systemPrompt: reviewPrompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.iteration,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
      });

      this.emitTyped('session-complete', reviewResult, 'qa_review');

      if (reviewResult.outcome === 'cancelled') {
        return { success: false, error: 'Build cancelled' };
      }

      // Check QA result
      const qaStatus = await this.readQAStatus();

      if (qaStatus === 'passed') {
        this.markPhaseCompleted('qa_review');
        this.transitionPhase('complete', 'Build complete - QA passed');
        return { success: true };
      }

      if ((qaStatus === 'failed' || qaStatus === 'unknown') && cycle < maxQACycles - 1) {
        // Run QA fixer — mark qa_review completed BEFORE transitioning to qa_fixing
        // (the phase protocol requires qa_review in completedPhases for the transition)
        this.markPhaseCompleted('qa_review');
        this.transitionPhase('qa_fixing', 'Fixing QA issues');

        this.iteration++;
        this.emitTyped('iteration-start', this.iteration, 'qa_fixing');

        const fixPrompt = await this.config.generatePrompt('qa_fixer', 'qa_fixing', {
          iteration: this.iteration,
          attemptCount: cycle,
        });

        const fixResult = await this.config.runSession({
          agentType: 'qa_fixer',
          phase: 'qa',
          systemPrompt: fixPrompt,
          specDir: this.config.specDir,
          projectDir: this.config.projectDir,
          sessionNumber: this.iteration,
          abortSignal: this.config.abortSignal,
          cliModel: this.config.cliModel,
          cliThinking: this.config.cliThinking,
        });

        this.emitTyped('session-complete', fixResult, 'qa_fixing');
        this.markPhaseCompleted('qa_fixing');

        // Delete qa_report.md before re-review so the reviewer writes a clean verdict.
        // The fixer often edits qa_report.md (changing status to "FIXES_APPLIED" etc.)
        // which corrupts the verdict detection. Deleting ensures a fresh report each cycle.
        await this.resetQAReport();

        // Loop back to QA review
        this.transitionPhase('qa_review', 'Re-running QA review after fixes');
        continue;
      }

      // QA failed and no more cycles
      this.transitionPhase('failed', 'QA review failed after maximum fix cycles');
      return { success: false, error: 'QA review failed after maximum fix cycles' };
    }

    return { success: false, error: 'QA exhausted all cycles' };
  }

  // ===========================================================================
  // Phase Transition
  // ===========================================================================

  /**
   * Transition to a new execution phase with validation.
   */
  private transitionPhase(phase: ExecutionPhase, message: string): void {
    if (isTerminalPhase(this.currentPhase) && !isTerminalPhase(phase)) {
      return; // Cannot leave terminal phase
    }

    if (!isValidPhaseTransition(this.currentPhase, phase, this.completedPhases)) {
      this.emitTyped('log', `Blocked phase transition: ${this.currentPhase} -> ${phase}`);
      return;
    }

    this.currentPhase = phase;
    this.emitTyped('phase-change', phase, message);
  }

  /**
   * Mark a build phase as completed.
   */
  private markPhaseCompleted(phase: CompletablePhase): void {
    if (!this.completedPhases.includes(phase)) {
      this.completedPhases.push(phase);
    }
  }

  // ===========================================================================
  // Plan Validation
  // ===========================================================================

  // normalizeSubtaskIds() REMOVED — replaced by Zod schema coercion in
  // validateAndNormalizeJsonFile(). The ImplementationPlanSchema handles:
  // - subtask_id → id, task_id → id
  // - title → description, name → description
  // - phase_id → id
  // - file_paths → files_to_modify
  // - Status normalization (done→completed, todo→pending, etc.)
  // - Missing status defaults to "pending"

  /**
   * Reset all subtask statuses to "pending" after initial planning.
   *
   * Some LLMs (particularly non-Anthropic models) create implementation plans
   * with subtasks pre-set to "completed". Since no coding has happened yet,
   * all statuses must be "pending" for the coding phase to execute.
   */
  private async resetSubtaskStatuses(): Promise<void> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      const raw = await readFile(planPath, 'utf-8');
      const plan = safeParseJson<ImplementationPlan>(raw);
      if (!plan) return;
      let updated = false;

      for (const phase of plan.phases) {
        if (!Array.isArray(phase.subtasks)) continue;
        for (const subtask of phase.subtasks) {
          if (subtask.status !== 'pending') {
            subtask.status = 'pending';
            updated = true;
          }
        }
      }

      if (updated) {
        await writeFile(planPath, JSON.stringify(plan, null, 2));
        this.emitTyped('log', 'Reset all subtask statuses to "pending" after planning');
      }
    } catch {
      // Non-fatal: validation will catch any plan issues
    }
  }

  // validateImplementationPlan() REMOVED — replaced by Zod schema validation
  // via validateAndNormalizeJsonFile(planPath, ImplementationPlanSchema).
  // The Zod schema provides:
  // - Structural validation (required fields, types, array shapes)
  // - Coercion of LLM field name variations (title→description, etc.)
  // - Status enum validation with normalization (done→completed, etc.)
  // - Human-readable error messages for LLM retry feedback

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /**
   * Check if this is a first run (no implementation plan exists).
   */
  private async isFirstRun(): Promise<boolean> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      await readFile(planPath, 'utf-8');
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Check if all subtasks in the implementation plan are completed.
   */
  private async isBuildComplete(): Promise<boolean> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      const raw = await readFile(planPath, 'utf-8');
      const plan = safeParseJson<ImplementationPlan>(raw);
      if (!plan) return false;

      for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status !== 'completed') {
            return false;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read QA status from the spec directory.
   * Returns 'passed', 'failed', or 'unknown'.
   */
  private async readQAStatus(): Promise<'passed' | 'failed' | 'unknown'> {
    const qaReportPath = join(this.config.specDir, 'qa_report.md');
    try {
      const content = await readFile(qaReportPath, 'utf-8');
      const lower = content.toLowerCase();
      if (lower.includes('status: passed') || lower.includes('status: approved')) {
        return 'passed';
      }
      // Explicitly detect failure patterns so intermediate states don't short-circuit.
      // The QA fixer may write "FIXES_APPLIED" — that's an intermediate state that
      // should NOT count as a verdict. Only the reviewer writes the final verdict.
      if (
        lower.includes('status: failed') ||
        lower.includes('status: rejected') ||
        lower.includes('status: needs changes')
      ) {
        return 'failed';
      }
      // If the report has content but no recognizable verdict, treat as unknown
      // so the orchestrator can retry rather than permanently failing.
      if (content.trim().length > 0) {
        return 'unknown';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Delete qa_report.md so the next QA review cycle writes a fresh verdict.
   * The QA fixer often edits qa_report.md (adding "FIXES_APPLIED" etc.),
   * which corrupts verdict detection. Resetting ensures clean state.
   */
  private async resetQAReport(): Promise<void> {
    const qaReportPath = join(this.config.specDir, 'qa_report.md');
    try {
      await unlink(qaReportPath);
    } catch {
      // File may not exist — that's fine
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private buildOutcome(success: boolean, durationMs: number, error?: string): BuildOutcome {
    const outcome: BuildOutcome = {
      success,
      finalPhase: this.currentPhase,
      totalIterations: this.iteration,
      durationMs,
      error,
      codingCompleted: this.completedPhases.includes('coding'),
    };

    if (!success && !isTerminalPhase(this.currentPhase)) {
      this.transitionPhase('failed', error ?? 'Build failed');
    }

    this.emitTyped('build-complete', outcome);
    return outcome;
  }

  /**
   * Typed event emitter helper.
   */
  private emitTyped<K extends keyof BuildOrchestratorEvents>(
    event: K,
    ...args: Parameters<BuildOrchestratorEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
}
