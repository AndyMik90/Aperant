/**
 * Parallel Orchestrator PR Reviewer
 * ==================================
 *
 * PR reviewer using parallel specialist analysis via Promise.allSettled().
 * See apps/desktop/src/main/ai/runners/github/parallel-orchestrator.ts for the TypeScript implementation.
 *
 * The orchestrator analyzes the PR and runs specialized agents (security,
 * quality, logic, codebase-fit) in parallel. Results are synthesized into
 * a final verdict.
 *
 * Key Design:
 * - Replaces SDK `agents={}` with Promise.allSettled() pattern
 * - Each specialist loads a rich .md system prompt from apps/desktop/prompts/github/
 * - Specialists get Read/Grep/Glob tool access via the agent config registry
 * - Cross-validation: findings flagged by multiple specialists get boosted severity
 * - Finding-validator pass: re-reads actual code to confirm/dismiss each finding
 * - Uses createSimpleClient() for lightweight parallel sessions
 */

import { streamText, stepCountIs, Output } from 'ai';
import type { Tool as AITool } from 'ai';
import * as crypto from 'node:crypto';

import { createSimpleClient } from '../../client/factory';
import type { SimpleClientResult } from '../../client/types';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import { buildThinkingProviderOptions } from '../../config/types';
import { parseLLMJson } from '../../schema/structured-output';
import { SpecialistOutputSchema, SynthesisResultSchema, FindingValidationArraySchema } from '../../schema/pr-review';
import {
  SpecialistOutputOutputSchema,
  SynthesisResultOutputSchema,
  FindingValidationsOutputSchema,
} from '../../schema/output/pr-review.output';
import type {
  PRContext,
  PRReviewFinding,
  ProgressCallback,
  ProgressUpdate,
} from './pr-review-engine';
import { ReviewCategory, ReviewSeverity } from './pr-review-engine';
import { loadPrompt } from '../../prompts/prompt-loader';
import { buildToolRegistry } from '../../tools/build-registry';
import { getSecurityProfile } from '../../security/security-profile';
import { getAgentConfig, type AgentType } from '../../config/agent-configs';
import type { ToolContext } from '../../tools/types';
import type { ToolRegistry } from '../../tools/registry';
import type { SecurityProfile } from '../../security/bash-validator';

// =============================================================================
// Types
// =============================================================================

/** Merge verdict for PR review. */
export const MergeVerdict = {
  READY_TO_MERGE: 'ready_to_merge',
  MERGE_WITH_CHANGES: 'merge_with_changes',
  NEEDS_REVISION: 'needs_revision',
  BLOCKED: 'blocked',
} as const;

export type MergeVerdict = (typeof MergeVerdict)[keyof typeof MergeVerdict];

/** Configuration for a specialist agent. */
interface SpecialistConfig {
  name: string;
  promptName: string;
  agentType: AgentType;
  description: string;
}

/** Result from parallel orchestrator review. */
export interface ParallelOrchestratorResult {
  findings: PRReviewFinding[];
  verdict: MergeVerdict;
  verdictReasoning: string;
  summary: string;
  blockers: string[];
  agentsInvoked: string[];
  reviewedCommitSha?: string;
}

/** Configuration for the parallel orchestrator. */
export interface ParallelOrchestratorConfig {
  repo: string;
  projectDir: string;
  model?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
  fastMode?: boolean;
}

// =============================================================================
// Specialist Configurations
// =============================================================================

const SPECIALIST_CONFIGS: SpecialistConfig[] = [
  {
    name: 'security',
    promptName: 'github/pr_security_agent',
    agentType: 'pr_security_specialist',
    description: 'Security vulnerabilities, OWASP Top 10, auth issues, injection, XSS',
  },
  {
    name: 'quality',
    promptName: 'github/pr_quality_agent',
    agentType: 'pr_quality_specialist',
    description: 'Code quality, complexity, duplication, error handling, patterns',
  },
  {
    name: 'logic',
    promptName: 'github/pr_logic_agent',
    agentType: 'pr_logic_specialist',
    description: 'Logic correctness, edge cases, algorithms, race conditions',
  },
  {
    name: 'codebase-fit',
    promptName: 'github/pr_codebase_fit_agent',
    agentType: 'pr_codebase_fit_specialist',
    description: 'Naming conventions, ecosystem fit, architectural alignment',
  },
];

// =============================================================================
// Severity / Category mapping
// =============================================================================

const SEVERITY_MAP: Record<string, PRReviewFinding['severity']> = {
  critical: ReviewSeverity.CRITICAL,
  high: ReviewSeverity.HIGH,
  medium: ReviewSeverity.MEDIUM,
  low: ReviewSeverity.LOW,
};

const CATEGORY_MAP: Record<string, PRReviewFinding['category']> = {
  security: ReviewCategory.SECURITY,
  quality: ReviewCategory.QUALITY,
  style: ReviewCategory.STYLE,
  test: ReviewCategory.TEST,
  docs: ReviewCategory.DOCS,
  pattern: ReviewCategory.PATTERN,
  performance: ReviewCategory.PERFORMANCE,
};

function mapSeverity(s: string): PRReviewFinding['severity'] {
  return SEVERITY_MAP[s.toLowerCase()] ?? ReviewSeverity.MEDIUM;
}

function mapCategory(c: string): PRReviewFinding['category'] {
  return CATEGORY_MAP[c.toLowerCase()] ?? ReviewCategory.QUALITY;
}

function generateFindingId(file: string, line: number, title: string): string {
  const hash = crypto
    .createHash('md5')
    .update(`${file}:${line}:${title}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `PR-${hash}`;
}

// =============================================================================
// PR context message builder (user message content for specialists)
// =============================================================================

function buildPRContextMessage(context: PRContext): string {
  const filesList = context.changedFiles
    .map((f) => `- \`${f.path}\` (+${f.additions}/-${f.deletions}) - ${f.status}`)
    .join('\n');

  const patches = context.changedFiles
    .filter((f) => f.patch)
    .map((f) => `\n### File: ${f.path}\n${f.patch}`)
    .join('\n');

  const MAX_DIFF = 150_000;
  const diffContent =
    patches.length > MAX_DIFF
      ? `${patches.slice(0, MAX_DIFF)}\n\n... (diff truncated)`
      : patches;

  return `## PR Context

**PR #${context.prNumber}**: ${context.title}
**Author:** ${context.author}
**Base:** ${context.baseBranch} ← **Head:** ${context.headBranch}
**Changes:** +${context.totalAdditions}/-${context.totalDeletions} across ${context.changedFiles.length} files

**Description:**
${context.description || '(No description provided)'}

### Changed Files (${context.changedFiles.length} files)
${filesList}

### Diff
${diffContent}

---

## MANDATORY: Tool-Based Verification

**You have Read, Grep, and Glob tools available. You MUST use them.**

Before producing your final JSON output, you MUST complete these steps:

1. **Read each changed file** — Use the Read tool to examine the full context of every changed file listed above (not just the diff). Read at least 50 lines around each changed section to understand the broader context.

2. **Grep for patterns** — Use Grep to search for related patterns across the codebase:
   - Search for callers/consumers of changed functions
   - Search for similar patterns that might be affected
   - Verify claims about "missing" protections by searching for them

3. **Verify before concluding** — If you find zero issues, you must still demonstrate that you examined the code thoroughly. Your summary should reference specific files and lines you examined.

**If your response contains zero tool calls, your review will be considered invalid.** A thorough review requires reading actual source code, not just reviewing diffs.`;
}

// =============================================================================
// Parse specialist JSON
// =============================================================================

function parseSpecialistOutput(
  _name: string,
  input: string | { findings: Array<Record<string, unknown>>; summary: string },
): PRReviewFinding[] {
  // Accept either a structured object (from Output.object()) or raw text (fallback)
  let parsed: { findings: Array<Record<string, unknown>>; summary?: string } | null;
  if (typeof input === 'string') {
    parsed = parseLLMJson(input, SpecialistOutputSchema);
  } else {
    parsed = input as unknown as { findings: Array<Record<string, unknown>>; summary?: string };
  }
  if (!parsed) return [];

  const findings: PRReviewFinding[] = [];
  for (const f of parsed.findings) {
    const title = f.title as string | undefined;
    const file = f.file as string | undefined;
    if (!title || !file) continue;
    const line = (f.line as number) ?? 0;
    const id = generateFindingId(file, line, title);
    findings.push({
      id,
      severity: mapSeverity((f.severity as string) ?? 'medium'),
      category: mapCategory((f.category as string) ?? 'quality'),
      title,
      description: (f.description as string) ?? '',
      file,
      line,
      endLine: f.endLine as number | undefined,
      suggestedFix: f.suggestedFix as string | undefined,
      fixable: (f.fixable as boolean) ?? false,
      evidence: f.evidence as string | undefined,
    });
  }
  return findings;
}

// =============================================================================
// Orchestrator prompt (synthesis)
// =============================================================================

function buildSynthesisPrompt(
  context: PRContext,
  specialistResults: Array<{ name: string; findings: PRReviewFinding[] }>,
): string {
  const findingsSummary = specialistResults
    .map(({ name, findings }) => {
      if (findings.length === 0) return `**${name}**: No issues found.`;
      const list = findings
        .map(
          (f) =>
            `  - [${f.severity.toUpperCase()}] ${f.title} (${f.file}:${f.line})`,
        )
        .join('\n');
      return `**${name}** (${findings.length} findings):\n${list}`;
    })
    .join('\n\n');

  return `You are a senior code review orchestrator synthesizing findings from specialist reviewers.

## PR Summary
**PR #${context.prNumber}**: ${context.title}
${context.description || '(No description)'}
Changes: +${context.totalAdditions}/-${context.totalDeletions} across ${context.changedFiles.length} files

## Specialist Findings
${findingsSummary}

## Your Task

Synthesize all specialist findings into a final verdict. Remove duplicates and false positives.

Return ONLY valid JSON (no markdown fencing):

{
  "verdict": "ready_to_merge|merge_with_changes|needs_revision|blocked",
  "verdict_reasoning": "Why this verdict",
  "summary": "Overall assessment",
  "kept_finding_ids": ["PR-ABC123"],
  "removed_finding_ids": ["PR-XYZ789"],
  "removal_reasons": { "PR-XYZ789": "False positive because..." }
}`;
}

// =============================================================================
// Provider-agnostic generateText options
// =============================================================================

/**
 * Build provider-agnostic options for generateText().
 *
 * Codex models require system prompt via providerOptions.openai.instructions
 * instead of the `system` parameter, plus `store: false`.
 * Other providers use the standard `system` parameter.
 */
function buildGenerateTextOptions(
  client: SimpleClientResult,
): { system: string | undefined; providerOptions?: Record<string, Record<string, string | number | boolean | null>> } {
  const isCodex = client.resolvedModelId?.includes('codex') ?? false;

  // Build thinking/reasoning provider options
  const thinkingOptions = client.thinkingLevel
    ? buildThinkingProviderOptions(client.resolvedModelId, client.thinkingLevel)
    : undefined;

  if (isCodex) {
    return {
      system: undefined,
      providerOptions: {
        ...(thinkingOptions ?? {}),
        openai: {
          ...(thinkingOptions?.openai as Record<string, string | number | boolean | null> ?? {}),
          ...(client.systemPrompt ? { instructions: client.systemPrompt } : {}),
          store: false,
        },
      },
    };
  }

  return {
    system: client.systemPrompt,
    ...(thinkingOptions ? { providerOptions: thinkingOptions as Record<string, Record<string, string | number | boolean | null>> } : {}),
  };
}

// =============================================================================
// Main Reviewer Class
// =============================================================================

export class ParallelOrchestratorReviewer {
  private readonly config: ParallelOrchestratorConfig;
  private readonly progressCallback?: ProgressCallback;
  private readonly registry: ToolRegistry;
  private readonly securityProfile: SecurityProfile;

  constructor(config: ParallelOrchestratorConfig, progressCallback?: ProgressCallback) {
    this.config = config;
    this.progressCallback = progressCallback;
    this.registry = buildToolRegistry();
    this.securityProfile = getSecurityProfile(config.projectDir);
  }

  private reportProgress(update: ProgressUpdate): void {
    this.progressCallback?.(update);
  }

  /**
   * Run the parallel orchestrator review.
   *
   * 1. Run all specialist agents in parallel via Promise.allSettled()
   * 2. Cross-validate findings across specialists
   * 3. Synthesize findings into a final verdict
   * 4. Run finding-validator to confirm/dismiss each finding
   * 5. Deduplicate and generate blockers
   */
  async review(
    context: PRContext,
    abortSignal?: AbortSignal,
  ): Promise<ParallelOrchestratorResult> {
    this.reportProgress({
      phase: 'orchestrating',
      progress: 30,
      message: `[ParallelOrchestrator] Starting parallel specialist analysis...`,
      prNumber: context.prNumber,
    });

    const modelShorthand = this.config.model ?? 'sonnet';
    const thinkingLevel = this.config.thinkingLevel ?? 'medium';

    // 1. Run all specialists in parallel
    const specialistPromises = SPECIALIST_CONFIGS.map((spec) =>
      this.runSpecialist(spec, context, modelShorthand, thinkingLevel, abortSignal),
    );

    const settledResults = await Promise.allSettled(specialistPromises);
    const agentsInvoked: string[] = [];
    const specialistResults: Array<{ name: string; findings: PRReviewFinding[] }> = [];

    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      const specName = SPECIALIST_CONFIGS[i].name;
      agentsInvoked.push(specName);

      if (result.status === 'fulfilled') {
        specialistResults.push(result.value);
      } else {
        specialistResults.push({ name: specName, findings: [] });
      }
    }

    // 2. Cross-validate findings across specialists
    this.reportProgress({
      phase: 'orchestrating',
      progress: 55,
      message: `[ParallelOrchestrator] Cross-validating findings across ${agentsInvoked.length} specialists...`,
      prNumber: context.prNumber,
    });
    const crossValidated = this.crossValidateFindings(specialistResults);
    const crossCount = crossValidated.filter((f) => f.crossValidated).length;
    if (crossCount > 0) {
      this.reportProgress({
        phase: 'orchestrating',
        progress: 57,
        message: `[ParallelOrchestrator] Cross-validation: ${crossCount} finding${crossCount !== 1 ? 's' : ''} confirmed by multiple specialists`,
        prNumber: context.prNumber,
      });
    }

    // 3. Synthesize verdict
    this.reportProgress({
      phase: 'synthesizing',
      progress: 60,
      message: '[ParallelOrchestrator] Synthesizing specialist findings...',
      prNumber: context.prNumber,
    });

    const synthesisResult = await this.synthesizeFindings(
      context,
      specialistResults,
      crossValidated,
      modelShorthand,
      thinkingLevel,
      abortSignal,
    );

    // 4. Run finding validator on kept findings
    const validatedFindings = await this.runFindingValidator(
      synthesisResult.keptFindings,
      context,
      modelShorthand,
      thinkingLevel,
      abortSignal,
    );

    // 5. Deduplicate
    const uniqueFindings = this.deduplicateFindings(validatedFindings);

    // 6. Generate blockers
    const blockers: string[] = [];
    for (const finding of uniqueFindings) {
      if (
        finding.severity === ReviewSeverity.CRITICAL ||
        finding.severity === ReviewSeverity.HIGH ||
        finding.severity === ReviewSeverity.MEDIUM
      ) {
        blockers.push(`${finding.category}: ${finding.title}`);
      }
    }

    // 7. Generate summary
    const summary = this.generateSummary(
      synthesisResult.verdict,
      synthesisResult.verdictReasoning,
      blockers,
      uniqueFindings.length,
      agentsInvoked,
    );

    this.reportProgress({
      phase: 'complete',
      progress: 100,
      message: `[ParallelOrchestrator] Review complete — ${uniqueFindings.length} findings, verdict: ${synthesisResult.verdict}`,
      prNumber: context.prNumber,
    });

    return {
      findings: uniqueFindings,
      verdict: synthesisResult.verdict,
      verdictReasoning: synthesisResult.verdictReasoning,
      summary,
      blockers,
      agentsInvoked,
    };
  }

  /**
   * Run a single specialist agent with .md prompt and tool access.
   */
  private async runSpecialist(
    config: SpecialistConfig,
    context: PRContext,
    modelShorthand: ModelShorthand,
    thinkingLevel: ThinkingLevel,
    abortSignal?: AbortSignal,
  ): Promise<{ name: string; findings: PRReviewFinding[] }> {
    this.reportProgress({
      phase: config.name,
      progress: 35,
      message: `[Specialist:${config.name}] Starting ${config.name} analysis...`,
      prNumber: context.prNumber,
    });

    // Load rich .md prompt as system prompt
    const systemPrompt = loadPrompt(config.promptName);

    // Build tool set from agent config (Read, Grep, Glob)
    const toolContext: ToolContext = {
      cwd: this.config.projectDir,
      projectDir: this.config.projectDir,
      specDir: '',
      securityProfile: this.securityProfile,
      abortSignal,
    };

    const tools: Record<string, AITool> = {};
    const agentConfig = getAgentConfig(config.agentType);
    for (const toolName of agentConfig.tools) {
      const definedTool = this.registry.getTool(toolName);
      if (definedTool) {
        tools[toolName] = definedTool.bind(toolContext);
      }
    }

    const boundToolNames = Object.keys(tools);
    this.reportProgress({
      phase: config.name,
      progress: 36,
      message: `[Specialist:${config.name}] Tools: ${boundToolNames.length > 0 ? boundToolNames.join(', ') : 'NONE (!) — check agent config'}`,
      prNumber: context.prNumber,
    });

    // Build PR context as user message
    const userMessage = buildPRContextMessage(context);

    const client = await createSimpleClient({
      systemPrompt,
      modelShorthand,
      thinkingLevel,
    });

    const genOptions = buildGenerateTextOptions(client);

    try {
      // Track tool usage across steps
      let stepCount = 0;
      let toolCallCount = 0;
      const toolsUsed = new Set<string>();

      // Use streamText instead of generateText — Codex endpoint only supports streaming.
      // Output.object() generates structured output as a final step after all tool calls.
      const stream = streamText({
        model: client.model,
        system: genOptions.system,
        messages: [{ role: 'user' as const, content: userMessage }],
        tools,
        stopWhen: stepCountIs(100),
        output: Output.object({ schema: SpecialistOutputOutputSchema }),
        abortSignal,
        ...(genOptions.providerOptions ? { providerOptions: genOptions.providerOptions } : {}),
        onStepFinish: ({ toolCalls }) => {
          stepCount++;
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              toolCallCount++;
              toolsUsed.add(tc.toolName);
            }
            this.reportProgress({
              phase: config.name,
              progress: 40,
              message: `[Specialist:${config.name}] Step ${stepCount}: ${toolCalls.length} tool call(s) — ${toolCalls.map((tc) => tc.toolName).join(', ')}`,
              prNumber: context.prNumber,
            });
          }
        },
      });

      // Consume the stream (required before accessing output/text)
      for await (const _part of stream.fullStream) { /* consume */ }

      // Use structured output if available, fall back to text parsing
      const structuredOutput = await stream.output;
      const findings = structuredOutput
        ? parseSpecialistOutput(config.name, structuredOutput)
        : parseSpecialistOutput(config.name, await stream.text);

      const toolSummary = toolCallCount > 0
        ? ` (${toolCallCount} tool calls: ${Array.from(toolsUsed).join(', ')})`
        : ' (no tool calls — review may be shallow)';

      this.reportProgress({
        phase: config.name,
        progress: 50,
        message: `[Specialist:${config.name}] Complete — ${findings.length} finding${findings.length !== 1 ? 's' : ''}, ${stepCount} steps${toolSummary}`,
        prNumber: context.prNumber,
      });

      return { name: config.name, findings };
    } catch (error) {
      if (abortSignal?.aborted) {
        return { name: config.name, findings: [] };
      }
      // Extract detailed error info for debugging
      const err = error as Record<string, unknown>;
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = err.statusCode ?? err.status ?? '';
      const responseBody = err.responseBody ?? err.data ?? '';
      const detail = statusCode ? ` [${statusCode}]` : '';
      const bodySnippet = responseBody ? ` Body: ${String(responseBody).slice(0, 200)}` : '';
      this.reportProgress({
        phase: config.name,
        progress: 50,
        message: `[Specialist:${config.name}] Failed${detail}: ${message.slice(0, 150)}${bodySnippet}`,
        prNumber: context.prNumber,
      });
      return { name: config.name, findings: [] };
    }
  }

  /**
   * Cross-validate findings across specialists.
   *
   * When multiple specialists flag the same file/line/category location,
   * the finding is marked as cross-validated and its severity is boosted
   * (low → medium). A single de-duplicated finding is kept.
   */
  private crossValidateFindings(
    specialistResults: Array<{ name: string; findings: PRReviewFinding[] }>,
  ): PRReviewFinding[] {
    const locationIndex = new Map<string, Array<{ specialist: string; finding: PRReviewFinding }>>();

    for (const { name, findings } of specialistResults) {
      for (const finding of findings) {
        const lineGroup = Math.floor(finding.line / 5) * 5;
        const key = `${finding.file}:${lineGroup}:${finding.category}`;
        if (!locationIndex.has(key)) {
          locationIndex.set(key, []);
        }
        locationIndex.get(key)!.push({ specialist: name, finding });
      }
    }

    const allFindings: PRReviewFinding[] = [];
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    for (const entries of locationIndex.values()) {
      const specialists = new Set(entries.map((e) => e.specialist));

      if (specialists.size >= 2) {
        // Multiple specialists flagged same location — cross-validated
        const sorted = [...entries].sort(
          (a, b) => (severityOrder[a.finding.severity] ?? 4) - (severityOrder[b.finding.severity] ?? 4),
        );
        const primary = { ...sorted[0].finding };
        primary.crossValidated = true;
        primary.sourceAgents = Array.from(specialists);
        // Boost low → medium when cross-validated
        if (primary.severity === ReviewSeverity.LOW) {
          primary.severity = ReviewSeverity.MEDIUM;
        }
        allFindings.push(primary);
      } else {
        for (const entry of entries) {
          allFindings.push({ ...entry.finding, sourceAgents: [entry.specialist] });
        }
      }
    }

    return allFindings;
  }

  /**
   * Run the finding-validator agent.
   *
   * The validator re-reads actual source code at each finding's location
   * and either confirms the finding as valid or dismisses it as a false positive.
   * Cross-validated findings cannot be dismissed.
   */
  private async runFindingValidator(
    findings: PRReviewFinding[],
    context: PRContext,
    modelShorthand: ModelShorthand,
    thinkingLevel: ThinkingLevel,
    abortSignal?: AbortSignal,
  ): Promise<PRReviewFinding[]> {
    if (findings.length === 0) return [];

    this.reportProgress({
      phase: 'validation',
      progress: 70,
      message: `[FindingValidator] Validating ${findings.length} finding${findings.length !== 1 ? 's' : ''}...`,
      prNumber: context.prNumber,
    });

    const systemPrompt = loadPrompt('github/pr_finding_validator');

    // Build tools from pr_finding_validator config (ALL_BUILTIN_TOOLS excl SpawnSubagent)
    const toolContext: ToolContext = {
      cwd: this.config.projectDir,
      projectDir: this.config.projectDir,
      specDir: '',
      securityProfile: this.securityProfile,
      abortSignal,
    };

    const tools: Record<string, AITool> = {};
    const agentConfig = getAgentConfig('pr_finding_validator');
    for (const toolName of agentConfig.tools) {
      if (toolName === 'SpawnSubagent') continue;
      const definedTool = this.registry.getTool(toolName);
      if (definedTool) {
        tools[toolName] = definedTool.bind(toolContext);
      }
    }

    // Build validation request listing all findings
    const findingsList = findings
      .map(
        (f, i) =>
          `${i + 1}. **${f.id}**: [${f.severity.toUpperCase()}] ${f.title}\n   File: ${f.file}:${f.line}\n   Description: ${f.description}\n   Evidence: ${f.evidence ?? 'none'}`,
      )
      .join('\n\n');

    const changedFiles = context.changedFiles.map((f) => f.path).join(', ');

    const userMessage = `## PR Context
PR #${context.prNumber}: ${context.title}
Changed files: ${changedFiles}

## Findings to Validate

${findingsList}

Validate each finding by reading the actual code at the specified file and line. Return a JSON array of validation results, one per finding.`;

    const client = await createSimpleClient({
      systemPrompt,
      modelShorthand,
      thinkingLevel,
    });

    const genOptions = buildGenerateTextOptions(client);

    try {
      let validatorToolCalls = 0;

      // Use streamText — Codex endpoint only supports streaming.
      // Output.object() generates the validation array (wrapped in { validations: [...] }) as a final step.
      const stream = streamText({
        model: client.model,
        system: genOptions.system,
        messages: [{ role: 'user' as const, content: userMessage }],
        tools,
        stopWhen: stepCountIs(150),
        output: Output.object({ schema: FindingValidationsOutputSchema }),
        abortSignal,
        ...(genOptions.providerOptions ? { providerOptions: genOptions.providerOptions } : {}),
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls && toolCalls.length > 0) {
            validatorToolCalls += toolCalls.length;
            this.reportProgress({
              phase: 'validation',
              progress: 75,
              message: `[FindingValidator] Examining code: ${toolCalls.map((tc) => tc.toolName).join(', ')}`,
              prNumber: context.prNumber,
            });
          }
        },
      });

      // Consume stream before reading output
      for await (const _part of stream.fullStream) { /* consume */ }

      // Use structured output if available, fall back to text parsing
      const structuredOutput = await stream.output;
      let rawValidations: Array<{ findingId: string; validationStatus: string; explanation: string }>;
      if (structuredOutput) {
        rawValidations = structuredOutput.validations;
      } else {
        const text = await stream.text;
        const parsed = parseLLMJson(text, FindingValidationArraySchema);
        if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
          return findings; // Fail-safe: keep all findings
        }
        rawValidations = parsed;
      }

      if (rawValidations.length === 0) {
        return findings; // Fail-safe: keep all findings
      }

      const validationMap = new Map<string, { validationStatus: string; explanation: string }>();
      for (const v of rawValidations) {
        if (v.findingId) {
          validationMap.set(v.findingId, v);
        }
      }

      const validatedFindings: PRReviewFinding[] = [];
      let confirmed = 0;
      let dismissed = 0;
      let needsReview = 0;

      for (const finding of findings) {
        const validation = validationMap.get(finding.id);

        if (!validation) {
          validatedFindings.push({ ...finding, validationStatus: 'needs_human_review' });
          needsReview++;
          continue;
        }

        if (validation.validationStatus === 'dismissed_false_positive') {
          if (finding.crossValidated) {
            // Cross-validated findings cannot be dismissed
            validatedFindings.push({
              ...finding,
              validationStatus: 'confirmed_valid',
              validationExplanation: `[Cross-validated by ${finding.sourceAgents?.join(', ')}] Validator attempted dismissal: ${validation.explanation}`,
            });
            confirmed++;
          } else {
            dismissed++;
            // Dismissed — omit from final results
          }
        } else if (validation.validationStatus === 'confirmed_valid') {
          validatedFindings.push({
            ...finding,
            validationStatus: 'confirmed_valid',
            validationExplanation: validation.explanation,
          });
          confirmed++;
        } else {
          validatedFindings.push({
            ...finding,
            validationStatus: 'needs_human_review',
            validationExplanation: validation.explanation,
          });
          needsReview++;
        }
      }

      this.reportProgress({
        phase: 'validation',
        progress: 80,
        message: `[FindingValidator] Complete — ${confirmed} confirmed, ${dismissed} dismissed, ${needsReview} needs review`,
        prNumber: context.prNumber,
      });

      return validatedFindings;
    } catch {
      // Fail-safe: keep all findings if validator fails
      this.reportProgress({
        phase: 'validation',
        progress: 80,
        message: `[FindingValidator] Validation failed — keeping all ${findings.length} findings`,
        prNumber: context.prNumber,
      });
      return findings;
    }
  }

  /**
   * Synthesize findings from all specialists into a final verdict.
   */
  private async synthesizeFindings(
    context: PRContext,
    specialistResults: Array<{ name: string; findings: PRReviewFinding[] }>,
    allFindings: PRReviewFinding[],
    modelShorthand: ModelShorthand,
    thinkingLevel: ThinkingLevel,
    abortSignal?: AbortSignal,
  ): Promise<{
    verdict: MergeVerdict;
    verdictReasoning: string;
    keptFindings: PRReviewFinding[];
  }> {
    // If no findings from any specialist, approve
    if (allFindings.length === 0) {
      return {
        verdict: MergeVerdict.READY_TO_MERGE,
        verdictReasoning: 'No issues found by any specialist reviewer.',
        keptFindings: [],
      };
    }

    const prompt = buildSynthesisPrompt(context, specialistResults);

    const client = await createSimpleClient({
      systemPrompt: 'You are a senior code review orchestrator.',
      modelShorthand,
      thinkingLevel,
    });

    const genOptions = buildGenerateTextOptions(client);

    const verdictMap: Record<string, MergeVerdict> = {
      ready_to_merge: MergeVerdict.READY_TO_MERGE,
      merge_with_changes: MergeVerdict.MERGE_WITH_CHANGES,
      needs_revision: MergeVerdict.NEEDS_REVISION,
      blocked: MergeVerdict.BLOCKED,
    };

    try {
      // Use streamText — Codex endpoint only supports streaming.
      // Output.object() generates the structured verdict as a final step.
      const stream = streamText({
        model: client.model,
        system: genOptions.system,
        prompt,
        output: Output.object({ schema: SynthesisResultOutputSchema }),
        abortSignal,
        ...(genOptions.providerOptions ? { providerOptions: genOptions.providerOptions } : {}),
      });

      // Consume stream before reading output
      for await (const _part of stream.fullStream) { /* consume */ }

      // Use structured output if available, fall back to text parsing
      const structuredOutput = await stream.output;
      let data: { verdict: string; verdictReasoning: string; removedFindingIds: string[] } | null;
      if (structuredOutput) {
        data = structuredOutput;
      } else {
        const text = await stream.text;
        data = parseLLMJson(text, SynthesisResultSchema);
      }

      if (!data) {
        throw new Error('Failed to parse synthesis result');
      }

      const verdict = verdictMap[data.verdict] ?? MergeVerdict.NEEDS_REVISION;
      const removedIds = new Set(data.removedFindingIds);
      const keptFindings = allFindings.filter((f) => !removedIds.has(f.id));

      return {
        verdict,
        verdictReasoning: data.verdictReasoning,
        keptFindings,
      };
    } catch {
      // Fallback: keep all findings, determine verdict from severity
      const hasCritical = allFindings.some(
        (f) => f.severity === ReviewSeverity.CRITICAL,
      );
      const hasHigh = allFindings.some(
        (f) => f.severity === ReviewSeverity.HIGH,
      );

      return {
        verdict: hasCritical
          ? MergeVerdict.BLOCKED
          : hasHigh
            ? MergeVerdict.NEEDS_REVISION
            : MergeVerdict.MERGE_WITH_CHANGES,
        verdictReasoning: 'Verdict determined from finding severity levels.',
        keptFindings: allFindings,
      };
    }
  }

  /**
   * Deduplicate findings by file + line + title.
   */
  private deduplicateFindings(findings: PRReviewFinding[]): PRReviewFinding[] {
    const seen = new Set<string>();
    const unique: PRReviewFinding[] = [];
    for (const f of findings) {
      const key = `${f.file}:${f.line}:${f.title.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    }
    return unique;
  }

  /**
   * Generate a human-readable summary.
   */
  private generateSummary(
    verdict: MergeVerdict,
    verdictReasoning: string,
    blockers: string[],
    findingCount: number,
    agentsInvoked: string[],
  ): string {
    const statusEmoji: Record<MergeVerdict, string> = {
      [MergeVerdict.READY_TO_MERGE]: '✅',
      [MergeVerdict.MERGE_WITH_CHANGES]: '🟡',
      [MergeVerdict.NEEDS_REVISION]: '🟠',
      [MergeVerdict.BLOCKED]: '🔴',
    };

    const emoji = statusEmoji[verdict] ?? '📝';
    const agentsStr = agentsInvoked.length > 0 ? agentsInvoked.join(', ') : 'none';

    const blockersSection =
      blockers.length > 0
        ? `\n### 🚨 Blocking Issues\n${blockers.map((b) => `- ${b}`).join('\n')}\n`
        : '';

    return `## ${emoji} Review: ${verdict.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}

### Verdict
${verdictReasoning}
${blockersSection}
### Summary
- **Findings**: ${findingCount} issue(s) found
- **Agents invoked**: ${agentsStr}

---
*AI-generated review using parallel specialist analysis.*
`;
  }
}
