/**
 * Spec Orchestrator
 * =================
 *
 * Drives the spec creation pipeline through complexity-first phase selection:
 *   complexity_assessment → [phases based on tier]
 *
 * Complexity assessment runs FIRST to gate the workflow:
 *   - SIMPLE: quick_spec → validation (2 phases — no discovery/requirements)
 *   - STANDARD: discovery → requirements → spec_writing → planning → validation
 *   - COMPLEX: Full pipeline including research and self-critique
 *
 * Context accumulation: after each phase, output files are captured and injected
 * into the next phase's kickoff message, eliminating redundant file re-reads.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'events';

import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import {
  validateJsonFile,
  validateAndNormalizeJsonFile,
  ComplexityAssessmentSchema,
  ImplementationPlanSchema,
  ComplexityAssessmentOutputSchema,
  ImplementationPlanOutputSchema,
  buildValidationRetryPrompt,
  IMPLEMENTATION_PLAN_SCHEMA_HINT,
} from '../schema';
import type { ZodSchema } from 'zod';
import type { SessionResult } from '../session/types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retries for a single phase */
const MAX_PHASE_RETRIES = 2;

/** Maximum characters of a single phase output to carry forward */
const MAX_PHASE_OUTPUT_SIZE = 12_000;

// =============================================================================
// Types
// =============================================================================

/** Complexity tiers */
export type ComplexityTier = 'simple' | 'standard' | 'complex';

/** Spec creation phases (ordered) */
export type SpecPhase =
  | 'discovery'
  | 'requirements'
  | 'complexity_assessment'
  | 'historical_context'
  | 'research'
  | 'context'
  | 'spec_writing'
  | 'self_critique'
  | 'planning'
  | 'validation'
  | 'quick_spec';

/** Maps spec phases to their agent types */
const PHASE_AGENT_MAP: Record<SpecPhase, AgentType> = {
  discovery: 'spec_discovery',
  requirements: 'spec_gatherer',
  complexity_assessment: 'spec_gatherer',
  historical_context: 'spec_context',
  research: 'spec_researcher',
  context: 'spec_context',
  spec_writing: 'spec_writer',
  self_critique: 'spec_critic',
  planning: 'planner',
  validation: 'spec_validation',
  quick_spec: 'spec_writer',
} as const;

/**
 * Phases to run for each complexity tier.
 * Complexity assessment runs BEFORE these phases as the gating step.
 *
 * - SIMPLE: skip discovery & requirements entirely — quick_spec handles everything.
 * - STANDARD: discovery builds context.json, requirements gathers formal reqs,
 *   then spec_writing + planning. 'context' phase removed (redundant with discovery).
 * - COMPLEX: full pipeline including research and self-critique.
 */
const COMPLEXITY_PHASES: Record<ComplexityTier, SpecPhase[]> = {
  simple: ['quick_spec', 'validation'],
  standard: ['discovery', 'requirements', 'spec_writing', 'planning', 'validation'],
  complex: [
    'discovery',
    'requirements',
    'research',
    'context',
    'spec_writing',
    'self_critique',
    'planning',
    'validation',
  ],
} as const;

/** Maps each phase to the output files it typically produces */
const PHASE_OUTPUTS: Partial<Record<SpecPhase, string[]>> = {
  discovery: ['context.json'],
  requirements: ['requirements.json'],
  complexity_assessment: ['complexity_assessment.json'],
  research: ['research.json'],
  context: ['context.json'],
  spec_writing: ['spec.md'],
  self_critique: ['spec.md'],
  planning: ['implementation_plan.json'],
  quick_spec: ['spec.md', 'implementation_plan.json'],
};

/** Configuration for the spec orchestrator */
export interface SpecOrchestratorConfig {
  /** Spec directory path */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Task description (what to build) */
  taskDescription?: string;
  /** Complexity override (skip AI assessment) */
  complexityOverride?: ComplexityTier;
  /** Whether to use AI for complexity assessment (default: true) */
  useAiAssessment?: boolean;
  /** Pre-generated project index JSON content (injected into all phases) */
  projectIndex?: string;
  /** CLI model override */
  cliModel?: string;
  /** CLI thinking level override */
  cliThinking?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback to generate the system prompt for a given agent type and phase */
  generatePrompt: (agentType: AgentType, phase: SpecPhase, context: SpecPromptContext) => Promise<string>;
  /** Callback to run an agent session */
  runSession: (config: SpecSessionRunConfig) => Promise<SessionResult>;
}

/** Context passed to prompt generation */
export interface SpecPromptContext {
  /** Current phase number (1-indexed) */
  phaseNumber: number;
  /** Total phases to run */
  totalPhases: number;
  /** Current phase name */
  phaseName: SpecPhase;
  /** Task description */
  taskDescription?: string;
  /** Complexity tier (after assessment) */
  complexity?: ComplexityTier;
  /** Pre-generated project index (JSON string) */
  projectIndex?: string;
  /** Accumulated outputs from prior phases (filename → content) */
  priorPhaseOutputs?: Record<string, string>;
  /** Retry attempt number (0 = first try) */
  attemptCount: number;
  /** Schema validation error feedback for retry (built by buildValidationRetryPrompt) */
  schemaRetryContext?: string;
}

/** Configuration passed to runSession callback */
export interface SpecSessionRunConfig {
  agentType: AgentType;
  phase: Phase;
  /** Spec pipeline phase name (e.g., 'complexity_assessment', 'discovery', 'requirements') */
  specPhase: SpecPhase;
  systemPrompt: string;
  specDir: string;
  projectDir: string;
  sessionNumber: number;
  abortSignal?: AbortSignal;
  cliModel?: string;
  cliThinking?: string;
  /** Accumulated outputs from prior phases (filename → content) for kickoff enrichment */
  priorPhaseOutputs?: Record<string, string>;
  /** Pre-generated project index (JSON string) */
  projectIndex?: string;
  /** Optional Zod schema for structured output (uses AI SDK Output.object()) */
  outputSchema?: ZodSchema;
}

/** Result of a single phase execution */
export interface SpecPhaseResult {
  phase: SpecPhase;
  success: boolean;
  errors: string[];
  retries: number;
}

/** Events emitted by the spec orchestrator */
export interface SpecOrchestratorEvents {
  /** Phase started */
  'phase-start': (phase: SpecPhase, phaseNumber: number, totalPhases: number) => void;
  /** Phase completed */
  'phase-complete': (phase: SpecPhase, result: SpecPhaseResult) => void;
  /** Session completed within a phase */
  'session-complete': (result: SessionResult, phase: SpecPhase) => void;
  /** Spec creation finished */
  'spec-complete': (outcome: SpecOutcome) => void;
  /** Log message */
  'log': (message: string) => void;
  /** Error occurred */
  'error': (error: Error, phase: SpecPhase) => void;
}

/** Final spec creation outcome */
export interface SpecOutcome {
  success: boolean;
  complexity?: ComplexityTier;
  phasesExecuted: SpecPhase[];
  durationMs: number;
  error?: string;
}

/** Complexity assessment result (matches Python spec/complexity.py) */
interface ComplexityAssessment {
  complexity: ComplexityTier;
  confidence: number;
  reasoning: string;
  needs_research?: boolean;
  needs_self_critique?: boolean;
}

// =============================================================================
// SpecOrchestrator
// =============================================================================

/**
 * Orchestrates the spec creation pipeline with dynamic complexity adaptation.
 *
 * Replaces the Python `SpecOrchestrator` class from `spec/pipeline/orchestrator.py`.
 * Manages spec creation through a series of AI-driven phases that adapt based on
 * task complexity assessment.
 */
export class SpecOrchestrator extends EventEmitter {
  private config: SpecOrchestratorConfig;
  private sessionNumber = 0;
  private aborted = false;
  private assessment: ComplexityAssessment | null = null;
  private phaseSummaries: Record<string, string> = {};

  constructor(config: SpecOrchestratorConfig) {
    super();
    this.config = config;

    config.abortSignal?.addEventListener('abort', () => {
      this.aborted = true;
    });
  }

  /**
   * Run the full spec creation pipeline.
   *
   * Phase progression:
   * 1. Complexity assessment — gate the workflow (uses task description + project index)
   * 2. Phases based on complexity tier (SIMPLE skips discovery/requirements entirely)
   *
   * After each phase, output files are captured and injected into subsequent phases
   * to eliminate redundant file re-reads between agents.
   */
  async run(): Promise<SpecOutcome> {
    const startTime = Date.now();
    const phasesExecuted: SpecPhase[] = [];

    try {
      // ===================================================================
      // Step 1: Determine complexity (runs FIRST to gate the workflow)
      // ===================================================================
      let complexity: ComplexityTier;

      // Fast-path heuristic: catch obviously simple tasks before expensive AI assessment
      const heuristicResult = this.assessComplexityHeuristic(this.config.taskDescription ?? '');
      if (heuristicResult) {
        complexity = heuristicResult;
        this.assessment = {
          complexity: heuristicResult,
          confidence: 0.9,
          reasoning: `Heuristic: task description matches ${heuristicResult} pattern`,
        };
        this.emitTyped('log', `Complexity heuristic: ${heuristicResult} (skipping AI assessment)`);
        phasesExecuted.push('complexity_assessment');
      } else if (this.config.complexityOverride) {
        complexity = this.config.complexityOverride;
        this.emitTyped('log', `Complexity override: ${complexity}`);
      } else if (this.config.useAiAssessment !== false) {
        // Run AI complexity assessment as the first phase
        if (this.aborted) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, 'Cancelled');
        }

        const assessResult = await this.runComplexityAssessment(1);
        phasesExecuted.push('complexity_assessment');
        await this.capturePhaseOutput('complexity_assessment');

        if (!assessResult.success) {
          // Fall back to standard on assessment failure
          this.assessment = {
            complexity: 'standard',
            confidence: 0.5,
            reasoning: 'Fallback: AI assessment failed',
          };
        }

        complexity = this.assessment?.complexity ?? 'standard';
      } else {
        // Heuristic fallback
        complexity = 'standard';
        this.assessment = {
          complexity: 'standard',
          confidence: 0.5,
          reasoning: 'Heuristic assessment (AI disabled)',
        };
        phasesExecuted.push('complexity_assessment');
      }

      // ===================================================================
      // Step 2: Determine and run phases based on assessed complexity
      // ===================================================================
      const phasesToRun = [...COMPLEXITY_PHASES[complexity]];

      // Inject research/self-critique if flagged but not already in the tier
      if (this.assessment?.needs_research && !phasesToRun.includes('research')) {
        // Insert research before context (or before spec_writing if no context phase)
        const insertBefore = phasesToRun.indexOf('context') !== -1
          ? phasesToRun.indexOf('context')
          : phasesToRun.indexOf('spec_writing');
        if (insertBefore !== -1) {
          phasesToRun.splice(insertBefore, 0, 'research');
        }
      }

      if (this.assessment?.needs_self_critique && !phasesToRun.includes('self_critique')) {
        const planningIdx = phasesToRun.indexOf('planning');
        if (planningIdx !== -1) {
          phasesToRun.splice(planningIdx, 0, 'self_critique');
        }
      }

      this.emitTyped('log', `Running ${complexity} workflow: ${phasesToRun.join(' → ')}`);

      for (const phase of phasesToRun) {
        if (this.aborted) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, 'Cancelled');
        }

        const result = await this.runPhase(phase, phasesExecuted.length + 1, phasesToRun.length + (phasesExecuted.includes('complexity_assessment') ? 1 : 0));
        phasesExecuted.push(phase);

        if (!result.success) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, result.errors.join('; '));
        }

        // Capture phase outputs for injection into subsequent phases
        await this.capturePhaseOutput(phase);
      }

      return this.outcome(true, phasesExecuted, Date.now() - startTime);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.outcome(false, phasesExecuted, Date.now() - startTime, message);
    }
  }

  // ===========================================================================
  // Complexity Heuristic
  // ===========================================================================

  /**
   * Fast-path heuristic for obviously simple tasks.
   * Returns 'simple' if the description matches simple patterns, null otherwise.
   * This avoids an expensive AI assessment call for trivial tasks.
   */
  private assessComplexityHeuristic(taskDescription: string): ComplexityTier | null {
    const desc = taskDescription.toLowerCase().trim();
    const wordCount = desc.split(/\s+/).length;

    // Very short descriptions (under 30 words) with simple signal words → SIMPLE
    if (wordCount <= 30) {
      const simplePatterns = [
        /\b(change|rename|update|replace|swap|switch)\b.*\b(color|colour|name|text|label|title|string|value|icon|logo)\b/,
        /\b(fix|correct)\b.*\b(typo|spelling|grammar)\b/,
        /\b(bump|update)\b.*\b(version|dependency)\b/,
        /\b(remove|delete)\b.*\b(unused|dead|deprecated)\b/,
      ];
      if (simplePatterns.some(p => p.test(desc))) {
        return 'simple';
      }
    }

    // Long descriptions or complex signal words → let AI decide
    return null;
  }

  // ===========================================================================
  // Phase Execution
  // ===========================================================================

  /**
   * Run a single spec phase with retries.
   */
  private async runPhase(
    phase: SpecPhase,
    phaseNumber: number,
    totalPhases: number,
  ): Promise<SpecPhaseResult> {
    const agentType = PHASE_AGENT_MAP[phase];
    const errors: string[] = [];
    let schemaRetryContext: string | undefined;
    /** Set when a retry is needed because the model didn't call any tools */
    let toolUseRetryContext: string | undefined;

    this.emitTyped('phase-start', phase, phaseNumber, totalPhases);

    for (let attempt = 0; attempt <= MAX_PHASE_RETRIES; attempt++) {
      if (this.aborted) {
        return { phase, success: false, errors: ['Cancelled'], retries: attempt };
      }

      this.sessionNumber++;

      const phaseOutputs = Object.keys(this.phaseSummaries).length > 0 ? { ...this.phaseSummaries } : undefined;

      const prompt = await this.config.generatePrompt(agentType, phase, {
        phaseNumber,
        totalPhases,
        phaseName: phase,
        taskDescription: this.config.taskDescription,
        complexity: this.assessment?.complexity,
        projectIndex: this.config.projectIndex,
        priorPhaseOutputs: phaseOutputs,
        attemptCount: attempt,
        // Carry both schema and tool-use retry context (at most one is set at a time)
        schemaRetryContext: schemaRetryContext ?? toolUseRetryContext,
      });
      // Clear single-use retry context
      toolUseRetryContext = undefined;

      // For planning and quick_spec phases, pass the output schema so providers
      // with native structured output (OpenAI, Anthropic) use constrained decoding
      // to guarantee the implementation plan matches the schema. The structured
      // output is generated as a final step after all tool calls complete.
      const isPlanningPhase = phase === 'planning' || phase === 'quick_spec';
      const outputSchema = isPlanningPhase ? ImplementationPlanOutputSchema : undefined;

      const result = await this.config.runSession({
        agentType,
        phase: 'spec',
        specPhase: phase,
        systemPrompt: prompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.sessionNumber,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
        priorPhaseOutputs: phaseOutputs,
        projectIndex: this.config.projectIndex,
        ...(outputSchema ? { outputSchema } : {}),
      });

      this.emitTyped('session-complete', result, phase);

      if (result.outcome === 'cancelled') {
        return { phase, success: false, errors: ['Cancelled'], retries: attempt };
      }

      if (result.outcome === 'completed' || result.outcome === 'max_steps' || result.outcome === 'context_window') {
        // If the provider returned structured output (via constrained decoding),
        // write it to implementation_plan.json — this is guaranteed to match the
        // schema, overriding whatever the agent wrote via the Write tool.
        if (isPlanningPhase && result.structuredOutput) {
          const planPath = join(this.config.specDir, 'implementation_plan.json');
          try {
            await writeFile(planPath, JSON.stringify(result.structuredOutput, null, 2));
            this.emitTyped('log', `Wrote implementation plan from structured output (schema-guaranteed)`);
          } catch (writeErr) {
            this.emitTyped('log', `Failed to write structured output plan: ${writeErr}`);
          }
        }
        // Validate that expected output files were actually created.
        // Some models (e.g., GLM-5, Codex) may complete a session without calling
        // any tools, producing no output files despite a successful stream.
        const missingFiles = await this.validatePhaseOutputs(phase);
        if (missingFiles.length > 0) {
          const noToolCalls = result.toolCallCount === 0;
          const detail = noToolCalls
            ? `Model completed session without making any tool calls — expected files not created: ${missingFiles.join(', ')}`
            : `Phase completed but expected output files missing: ${missingFiles.join(', ')}`;
          errors.push(detail);
          this.emitTyped('log', `Phase ${phase} output validation failed (attempt ${attempt + 1}): ${detail}`);

          if (attempt < MAX_PHASE_RETRIES) {
            // Build a directive retry prompt when the model hallucinated tool usage.
            // This is common with Codex models that generate text claiming to have
            // written files without actually invoking the Write tool.
            if (noToolCalls) {
              const fileList = missingFiles.map(f => `${this.config.specDir}/${f}`).join(', ');
              toolUseRetryContext = [
                'CRITICAL — TOOL USE REQUIRED',
                '',
                'Your previous attempt failed because you did NOT call any tools.',
                'You MUST use the Write tool to create the required output file(s).',
                'Do NOT describe file contents in your text response — you must invoke the Write tool.',
                '',
                `Missing file(s) that MUST be created using the Write tool: ${fileList}`,
                '',
                'Steps:',
                `1. Use the Write tool to create each missing file listed above`,
                '2. Include the full file content in the Write tool call',
                '3. Do NOT skip tool calls or assume files were already created',
              ].join('\n');
            }
            continue; // Retry the phase
          }
          // All retries exhausted — fall through to failure
          break;
        }

        // Schema validation for phases with structured output requirements
        // (e.g., planning phase must produce valid implementation_plan.json)
        const schemaValidation = await this.validatePhaseSchema(phase);
        if (schemaValidation && !schemaValidation.valid) {
          errors.push(`Schema validation failed: ${schemaValidation.errors.join(', ')}`);
          this.emitTyped('log', `Phase ${phase} schema validation failed (attempt ${attempt + 1}): ${schemaValidation.errors.join(', ')}`);
          if (attempt < MAX_PHASE_RETRIES) {
            // Build LLM-friendly error feedback so the agent knows what to fix
            const schemaHint = (phase === 'planning' || phase === 'quick_spec')
              ? IMPLEMENTATION_PLAN_SCHEMA_HINT
              : undefined;
            schemaRetryContext = buildValidationRetryPrompt(
              phase === 'quick_spec' ? 'implementation_plan.json' : PHASE_OUTPUTS[phase]?.[0] ?? 'output file',
              schemaValidation.errors,
              schemaHint,
            );
            continue; // Retry with error feedback
          }
          break;
        }

        const phaseResult: SpecPhaseResult = { phase, success: true, errors: [], retries: attempt };
        this.emitTyped('phase-complete', phase, phaseResult);
        return phaseResult;
      }

      // Error — collect and maybe retry
      const errorMsg = result.error?.message ?? `Phase ${phase} failed with outcome: ${result.outcome}`;
      errors.push(errorMsg);

      // Non-retryable errors
      if (result.outcome === 'auth_failure') {
        return { phase, success: false, errors, retries: attempt };
      }

      if (attempt < MAX_PHASE_RETRIES) {
        this.emitTyped('log', `Phase ${phase} failed (attempt ${attempt + 1}), retrying...`);
      }
    }

    const failResult: SpecPhaseResult = { phase, success: false, errors, retries: MAX_PHASE_RETRIES };
    this.emitTyped('phase-complete', phase, failResult);
    return failResult;
  }

  /**
   * Run AI complexity assessment by invoking the complexity assessor agent.
   */
  private async runComplexityAssessment(
    phaseNumber: number,
  ): Promise<SpecPhaseResult> {
    // totalPhases=1 for the assessment itself; actual phase count is determined after assessment
    this.emitTyped('phase-start', 'complexity_assessment', phaseNumber, 1);
    this.sessionNumber++;

    const prompt = await this.config.generatePrompt('spec_gatherer', 'complexity_assessment', {
      phaseNumber,
      totalPhases: 1,
      phaseName: 'complexity_assessment',
      taskDescription: this.config.taskDescription,
      projectIndex: this.config.projectIndex,
      attemptCount: 0,
    });

    // Pass clean output schema for constrained decoding (all fields required,
    // no preprocess/passthrough). Providers with native structured output
    // (Anthropic, OpenAI) enforce this at the token level.
    const sessionResult = await this.config.runSession({
      agentType: 'spec_gatherer',
      phase: 'spec',
      specPhase: 'complexity_assessment',
      systemPrompt: prompt,
      specDir: this.config.specDir,
      projectDir: this.config.projectDir,
      sessionNumber: this.sessionNumber,
      abortSignal: this.config.abortSignal,
      cliModel: this.config.cliModel,
      cliThinking: this.config.cliThinking,
      projectIndex: this.config.projectIndex,
      outputSchema: ComplexityAssessmentOutputSchema,
    });

    this.emitTyped('session-complete', sessionResult, 'complexity_assessment');

    if (sessionResult.outcome === 'cancelled') {
      return { phase: 'complexity_assessment', success: false, errors: ['Cancelled'], retries: 0 };
    }

    // Prefer structured output from constrained decoding (no file I/O needed)
    if (sessionResult.structuredOutput) {
      this.assessment = sessionResult.structuredOutput as unknown as ComplexityAssessment;
      this.emitTyped('log', `Complexity assessed (structured output): ${this.assessment.complexity} (confidence: ${(this.assessment.confidence * 100).toFixed(0)}%)`);
      return { phase: 'complexity_assessment', success: true, errors: [], retries: 0 };
    }

    // Fallback: read assessment from file (agent wrote it via tool)
    try {
      const assessmentPath = join(this.config.specDir, 'complexity_assessment.json');
      const fileResult = await validateJsonFile(assessmentPath, ComplexityAssessmentSchema);

      if (fileResult.valid && fileResult.data) {
        this.assessment = fileResult.data as ComplexityAssessment;
        this.emitTyped('log', `Complexity assessed: ${fileResult.data.complexity} (confidence: ${(fileResult.data.confidence * 100).toFixed(0)}%)`);
        return { phase: 'complexity_assessment', success: true, errors: [], retries: 0 };
      }
    } catch {
      // Assessment file not found or invalid — fall through
    }

    // If assessment file wasn't written, treat as failure (caller will fallback)
    return {
      phase: 'complexity_assessment',
      success: false,
      errors: ['Complexity assessment file not created or invalid'],
      retries: 0,
    };
  }

  // ===========================================================================
  // Context Accumulation
  // ===========================================================================

  /**
   * Capture output files from a completed phase and store them in phaseSummaries.
   * These are injected into subsequent phases to eliminate redundant file re-reads.
   */

  /**
   * Validate that a phase produced its expected output files.
   * Returns the list of missing file names (empty if all exist).
   */
  private async validatePhaseOutputs(phase: SpecPhase): Promise<string[]> {
    const expectedFiles = PHASE_OUTPUTS[phase];
    if (!expectedFiles?.length) return []; // Phase has no expected outputs

    const missing: string[] = [];
    for (const fileName of expectedFiles) {
      try {
        await access(join(this.config.specDir, fileName));
      } catch {
        missing.push(fileName);
      }
    }
    return missing;
  }

  /**
   * Validate phase output files against their Zod schemas.
   * Returns null for phases without schema requirements.
   * For phases with schemas (planning, quick_spec), validates and normalizes
   * the output file, writing back coerced data on success.
   */
  private async validatePhaseSchema(
    phase: SpecPhase,
  ): Promise<{ valid: boolean; errors: string[] } | null> {
    if (phase === 'planning' || phase === 'quick_spec') {
      const planPath = join(this.config.specDir, 'implementation_plan.json');
      try {
        const result = await validateAndNormalizeJsonFile(planPath, ImplementationPlanSchema);
        return { valid: result.valid, errors: result.errors };
      } catch {
        return null; // File doesn't exist yet — handled by validatePhaseOutputs
      }
    }
    return null; // No schema for this phase
  }

  private async capturePhaseOutput(phase: SpecPhase): Promise<void> {
    const outputFiles = PHASE_OUTPUTS[phase];
    if (!outputFiles?.length) return;

    for (const fileName of outputFiles) {
      try {
        const filePath = join(this.config.specDir, fileName);
        const content = await readFile(filePath, 'utf-8');
        if (content.trim()) {
          this.phaseSummaries[fileName] = content.length > MAX_PHASE_OUTPUT_SIZE
            ? content.slice(0, MAX_PHASE_OUTPUT_SIZE) + '\n... (truncated)'
            : content;
        }
      } catch {
        // File may not exist if phase didn't produce it — that's fine
      }
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private outcome(
    success: boolean,
    phasesExecuted: SpecPhase[],
    durationMs: number,
    error?: string,
  ): SpecOutcome {
    const outcome: SpecOutcome = {
      success,
      complexity: this.assessment?.complexity,
      phasesExecuted,
      durationMs,
      error,
    };

    this.emitTyped('spec-complete', outcome);
    return outcome;
  }

  /**
   * Typed event emitter helper.
   */
  private emitTyped<K extends keyof SpecOrchestratorEvents>(
    event: K,
    ...args: Parameters<SpecOrchestratorEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
}
