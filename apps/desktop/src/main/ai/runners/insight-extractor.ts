/**
 * Insight Extractor Runner
 * ========================
 *
 * Extracts structured insights from completed coding sessions using Vercel AI SDK.
 * See apps/desktop/src/main/ai/runners/insight-extractor.ts for the TypeScript implementation.
 *
 * Runs after each session to capture rich, actionable knowledge for the memory system.
 * Falls back to generic insights if extraction fails (never blocks the build).
 *
 * Uses `createSimpleClient()` with no tools (single-turn text generation).
 */

import { generateText, Output } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import { parseLLMJson } from '../schema/structured-output';
import { ExtractedInsightsSchema } from '../schema/insight-extractor';
import { ExtractedInsightsOutputSchema } from '../schema/output';

// =============================================================================
// Constants
// =============================================================================

/** Default model for insight extraction (fast and cheap) */
const DEFAULT_MODEL: ModelShorthand = 'haiku';

/** Maximum diff size to send to the LLM */
const MAX_DIFF_CHARS = 15000;

/** Maximum attempt history entries to include */
const MAX_ATTEMPTS_TO_INCLUDE = 3;

// =============================================================================
// Types
// =============================================================================

/** Configuration for insight extraction */
export interface InsightExtractionConfig {
  /** Subtask ID that was worked on */
  subtaskId: string;
  /** Description of the subtask */
  subtaskDescription: string;
  /** Session number */
  sessionNum: number;
  /** Whether the session succeeded */
  success: boolean;
  /** Git diff text */
  diff: string;
  /** List of changed file paths */
  changedFiles: string[];
  /** Commit messages from the session */
  commitMessages: string;
  /** Previous attempt history */
  attemptHistory: AttemptRecord[];
  /** Model shorthand (defaults to 'haiku') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (defaults to 'low') */
  thinkingLevel?: ThinkingLevel;
}

/** Record of a previous attempt */
export interface AttemptRecord {
  success: boolean;
  approach: string;
  error?: string;
}

/** Extracted insights from a session */
export interface ExtractedInsights {
  /** Insights about specific files */
  file_insights: FileInsight[];
  /** Patterns discovered during the session */
  patterns_discovered: string[];
  /** Gotchas/pitfalls discovered */
  gotchas_discovered: string[];
  /** Outcome of the approach used */
  approach_outcome: ApproachOutcome;
  /** Recommendations for future sessions */
  recommendations: string[];
  /** Metadata */
  subtask_id: string;
  session_num: number;
  success: boolean;
  changed_files: string[];
}

/** Insight about a specific file */
export interface FileInsight {
  file: string;
  insight: string;
  category?: string;
}

/** Outcome of the approach used in the session */
export interface ApproachOutcome {
  success: boolean;
  approach_used: string;
  why_it_worked: string | null;
  why_it_failed: string | null;
  alternatives_tried: string[];
}

// =============================================================================
// Prompt Building
// =============================================================================

const SYSTEM_PROMPT =
  'You are an expert code analyst. You extract structured insights from coding sessions. ' +
  'Always respond with valid JSON only, no markdown formatting or explanations.';

/**
 * Build the extraction prompt from session inputs.
 * Mirrors Python's `_build_extraction_prompt()`.
 */
function buildExtractionPrompt(config: InsightExtractionConfig): string {
  const attemptHistory = formatAttemptHistory(config.attemptHistory);
  const changedFiles =
    config.changedFiles.length > 0
      ? config.changedFiles.map((f) => `- ${f}`).join('\n')
      : '(No files changed)';

  // Truncate diff if too large
  let diff = config.diff;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (truncated, ${diff.length} chars total)`;
  }

  return `Extract structured insights from this coding session.
Output ONLY valid JSON with these keys: file_insights (array of {file, insight, category}), patterns_discovered (array of strings), gotchas_discovered (array of strings), approach_outcome ({success, approach_used, why_it_worked, why_it_failed, alternatives_tried}), recommendations (array of strings).

---

## SESSION DATA

### Subtask
- **ID**: ${config.subtaskId}
- **Description**: ${config.subtaskDescription}
- **Session Number**: ${config.sessionNum}
- **Outcome**: ${config.success ? 'SUCCESS' : 'FAILED'}

### Files Changed
${changedFiles}

### Commit Messages
${config.commitMessages}

### Git Diff
\`\`\`diff
${diff}
\`\`\`

### Previous Attempts
${attemptHistory}

---

Now analyze this session and output ONLY the JSON object.`;
}

/**
 * Format attempt history for the prompt.
 */
function formatAttemptHistory(attempts: AttemptRecord[]): string {
  if (attempts.length === 0) {
    return '(First attempt - no previous history)';
  }

  const recent = attempts.slice(-MAX_ATTEMPTS_TO_INCLUDE);
  return recent
    .map((attempt, i) => {
      const status = attempt.success ? 'SUCCESS' : 'FAILED';
      let line = `**Attempt ${i + 1}** (${status}): ${attempt.approach}`;
      if (attempt.error) {
        line += `\n  Error: ${attempt.error}`;
      }
      return line;
    })
    .join('\n');
}

// =============================================================================
// JSON Parsing
// =============================================================================

/**
 * Parse the LLM response into structured insights.
 * Uses Zod schema validation with field-name coercion.
 */
function parseInsights(responseText: string): Record<string, unknown> | null {
  return parseLLMJson(responseText, ExtractedInsightsSchema) as Record<string, unknown> | null;
}

// =============================================================================
// Generic Fallback
// =============================================================================

/**
 * Return generic insights when extraction fails or is disabled.
 * Mirrors Python's `_get_generic_insights()`.
 */
function getGenericInsights(subtaskId: string, success: boolean): ExtractedInsights {
  return {
    file_insights: [],
    patterns_discovered: [],
    gotchas_discovered: [],
    approach_outcome: {
      success,
      approach_used: `Implemented subtask: ${subtaskId}`,
      why_it_worked: null,
      why_it_failed: null,
      alternatives_tried: [],
    },
    recommendations: [],
    subtask_id: subtaskId,
    session_num: 0,
    success,
    changed_files: [],
  };
}

// =============================================================================
// Insight Extractor (Main Entry Point)
// =============================================================================

/**
 * Extract insights from a completed coding session using AI.
 *
 * Falls back to generic insights if extraction fails.
 * Never throws — always returns a valid InsightResult.
 *
 * @param config - Extraction configuration
 * @returns Extracted insights (rich if AI succeeds, generic if it fails)
 */
export async function extractSessionInsights(
  config: InsightExtractionConfig,
): Promise<ExtractedInsights> {
  const {
    subtaskId,
    sessionNum,
    success,
    changedFiles,
    modelShorthand = DEFAULT_MODEL,
    thinkingLevel = 'low',
  } = config;

  try {
    const prompt = buildExtractionPrompt(config);

    const client = await createSimpleClient({
      systemPrompt: SYSTEM_PROMPT,
      modelShorthand,
      thinkingLevel,
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt,
      output: Output.object({ schema: ExtractedInsightsOutputSchema }),
    });

    if (result.output) {
      const o = result.output;
      return {
        file_insights: o.file_insights,
        patterns_discovered: o.patterns_discovered,
        gotchas_discovered: o.gotchas_discovered,
        approach_outcome: o.approach_outcome,
        recommendations: o.recommendations,
        subtask_id: subtaskId,
        session_num: sessionNum,
        success,
        changed_files: changedFiles,
      };
    }

    // Fallback for providers without constrained decoding
    const parsed = parseInsights(result.text);

    if (parsed) {
      return {
        file_insights: (parsed.file_insights as FileInsight[]) ?? [],
        patterns_discovered: (parsed.patterns_discovered as string[]) ?? [],
        gotchas_discovered: (parsed.gotchas_discovered as string[]) ?? [],
        approach_outcome: (parsed.approach_outcome as ApproachOutcome) ?? {
          success,
          approach_used: `Implemented subtask: ${subtaskId}`,
          why_it_worked: null,
          why_it_failed: null,
          alternatives_tried: [],
        },
        recommendations: (parsed.recommendations as string[]) ?? [],
        subtask_id: subtaskId,
        session_num: sessionNum,
        success,
        changed_files: changedFiles,
      };
    }

    return getGenericInsights(subtaskId, success);
  } catch {
    return getGenericInsights(subtaskId, success);
  }
}
