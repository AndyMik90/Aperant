/**
 * Triage Engine
 * =============
 *
 * Issue triage logic for detecting duplicates, spam, and feature creep.
 * See apps/desktop/src/main/ai/runners/github/triage-engine.ts for the TypeScript implementation.
 *
 * Uses `createSimpleClient()` with `generateText()` for single-turn triage.
 */

import { generateText, Output } from 'ai';

import { createSimpleClient } from '../../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import { parseLLMJson } from '../../schema/structured-output';
import { TriageResultSchema } from '../../schema/triage';
import { TriageResultOutputSchema } from '../../schema/output';

// =============================================================================
// Enums & Types
// =============================================================================

/** Issue triage categories. */
export const TriageCategory = {
  BUG: 'bug',
  FEATURE: 'feature',
  DOCUMENTATION: 'documentation',
  QUESTION: 'question',
  DUPLICATE: 'duplicate',
  SPAM: 'spam',
  FEATURE_CREEP: 'feature_creep',
} as const;

export type TriageCategory = (typeof TriageCategory)[keyof typeof TriageCategory];

/** Result of triaging a single issue. */
export interface TriageResult {
  issueNumber: number;
  repo: string;
  category: TriageCategory;
  confidence: number;
  labelsToAdd: string[];
  labelsToRemove: string[];
  isDuplicate: boolean;
  duplicateOf: number | null;
  isSpam: boolean;
  isFeatureCreep: boolean;
  suggestedBreakdown: string[];
  priority: string;
  comment: string | null;
}

/** GitHub issue data for triage. */
export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  author: { login: string };
  createdAt: string;
  labels?: Array<{ name: string }>;
}

/** Configuration for triage engine. */
export interface TriageEngineConfig {
  repo: string;
  model?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
  fastMode?: boolean;
}

/** Progress callback for triage updates. */
export interface TriageProgressUpdate {
  phase: string;
  progress: number;
  message: string;
}

export type TriageProgressCallback = (update: TriageProgressUpdate) => void;

// =============================================================================
// Prompts
// =============================================================================

const TRIAGE_SYSTEM_PROMPT =
  'You are an expert issue triager for open source projects. Respond with structured JSON only.';

const TRIAGE_PROMPT = `Analyze the following GitHub issue and triage it.

Determine:
1. **Category**: bug, feature, documentation, question, duplicate, spam, or feature_creep
2. **Priority**: high, medium, or low
3. **Labels to add/remove** based on category
4. **Duplicate detection**: Check if similar issues exist
5. **Spam detection**: Is this a low-quality or spam issue?
6. **Feature creep**: Does this request go beyond reasonable scope?

Respond with a JSON object:
{
  "category": "bug|feature|documentation|question|duplicate|spam|feature_creep",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "labels_to_add": ["label1"],
  "labels_to_remove": ["label2"],
  "is_duplicate": false,
  "duplicate_of": null,
  "is_spam": false,
  "is_feature_creep": false,
  "suggested_breakdown": [],
  "comment": "optional comment to post on the issue"
}

Respond with ONLY valid JSON, no markdown fencing.`;

// =============================================================================
// Context Building
// =============================================================================

/**
 * Build context for triage including potential duplicates.
 */
export function buildTriageContext(issue: GitHubIssue, allIssues: GitHubIssue[]): string {
  // Find potential duplicates by title similarity
  const potentialDupes: GitHubIssue[] = [];
  const titleWords = new Set(issue.title.toLowerCase().split(/\s+/));

  for (const other of allIssues) {
    if (other.number === issue.number) continue;
    const otherWords = new Set(other.title.toLowerCase().split(/\s+/));
    let overlap = 0;
    titleWords.forEach((word) => {
      if (otherWords.has(word)) overlap++;
    });
    const ratio = overlap / Math.max(titleWords.size, 1);
    if (ratio > 0.3) {
      potentialDupes.push(other);
    }
  }

  const labels = issue.labels?.map((l) => l.name).join(', ') ?? '';

  const lines: string[] = [
    `## Issue #${issue.number}`,
    `**Title:** ${issue.title}`,
    `**Author:** ${issue.author.login}`,
    `**Created:** ${issue.createdAt}`,
    `**Labels:** ${labels}`,
    '',
    '### Body',
    issue.body ?? 'No description',
    '',
  ];

  if (potentialDupes.length > 0) {
    lines.push('### Potential Duplicates (similar titles)');
    for (const d of potentialDupes.slice(0, 5)) {
      lines.push(`- #${d.number}: ${d.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// Response Parsing
// =============================================================================

function parseTriageResult(
  issue: GitHubIssue,
  text: string,
  repo: string,
): TriageResult {
  const defaults: TriageResult = {
    issueNumber: issue.number,
    repo,
    category: TriageCategory.FEATURE,
    confidence: 0.0,
    labelsToAdd: [],
    labelsToRemove: [],
    isDuplicate: false,
    duplicateOf: null,
    isSpam: false,
    isFeatureCreep: false,
    suggestedBreakdown: [],
    priority: 'medium',
    comment: null,
  };

  const validated = parseLLMJson(text, TriageResultSchema);
  if (!validated) {
    return defaults;
  }

  return {
    issueNumber: issue.number,
    repo,
    category: validated.category as TriageCategory,
    confidence: validated.confidence,
    labelsToAdd: validated.labelsToAdd,
    labelsToRemove: validated.labelsToRemove,
    isDuplicate: validated.isDuplicate,
    duplicateOf: validated.duplicateOf,
    isSpam: validated.isSpam,
    isFeatureCreep: validated.isFeatureCreep,
    suggestedBreakdown: validated.suggestedBreakdown,
    priority: validated.priority,
    comment: validated.comment,
  };
}

// =============================================================================
// Triage Engine
// =============================================================================

/**
 * Triage a single issue using AI.
 */
export async function triageSingleIssue(
  issue: GitHubIssue,
  allIssues: GitHubIssue[],
  config: TriageEngineConfig,
): Promise<TriageResult> {
  const context = buildTriageContext(issue, allIssues);
  const fullPrompt = `${TRIAGE_PROMPT}\n\n---\n\n${context}`;

  const client = await createSimpleClient({
    systemPrompt: TRIAGE_SYSTEM_PROMPT,
    modelShorthand: config.model ?? 'sonnet',
    thinkingLevel: config.thinkingLevel ?? 'low',
  });

  try {
    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt: fullPrompt,
      output: Output.object({ schema: TriageResultOutputSchema }),
    });

    if (result.output) {
      const o = result.output;
      return {
        issueNumber: issue.number,
        repo: config.repo,
        category: o.category as TriageCategory,
        confidence: o.confidence,
        labelsToAdd: o.labels_to_add,
        labelsToRemove: o.labels_to_remove,
        isDuplicate: o.is_duplicate,
        duplicateOf: o.duplicate_of,
        isSpam: o.is_spam,
        isFeatureCreep: o.is_feature_creep,
        suggestedBreakdown: o.suggested_breakdown,
        priority: o.priority,
        comment: o.comment,
      };
    }

    // Fallback for providers without constrained decoding
    return parseTriageResult(issue, result.text, config.repo);
  } catch {
    return {
      issueNumber: issue.number,
      repo: config.repo,
      category: TriageCategory.FEATURE,
      confidence: 0.0,
      labelsToAdd: [],
      labelsToRemove: [],
      isDuplicate: false,
      duplicateOf: null,
      isSpam: false,
      isFeatureCreep: false,
      suggestedBreakdown: [],
      priority: 'medium',
      comment: null,
    };
  }
}

/**
 * Triage multiple issues in batch.
 */
export async function triageBatchIssues(
  issues: GitHubIssue[],
  config: TriageEngineConfig,
  progressCallback?: TriageProgressCallback,
): Promise<TriageResult[]> {
  const results: TriageResult[] = [];

  for (let i = 0; i < issues.length; i++) {
    progressCallback?.({
      phase: 'triaging',
      progress: Math.round(((i + 1) / issues.length) * 100),
      message: `Triaging issue #${issues[i].number} (${i + 1}/${issues.length})...`,
    });

    const result = await triageSingleIssue(issues[i], issues, config);
    results.push(result);
  }

  return results;
}
