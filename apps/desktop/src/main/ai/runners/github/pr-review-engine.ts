/**
 * PR Review Engine
 * ================
 *
 * Core logic for multi-pass PR code review.
 * See apps/desktop/src/main/ai/runners/github/pr-review-engine.ts for the TypeScript implementation.
 *
 * Uses `createSimpleClient()` with `generateText()` for each review pass.
 * Supports multi-pass review: quick scan → parallel security/quality/structural/deep analysis.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';

import { createSimpleClient } from '../../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import { parseLLMJson } from '../../schema/structured-output';
import {
  ScanResultSchema,
  ReviewFindingsArraySchema,
  StructuralIssueSchema,
  AICommentTriageSchema,
} from '../../schema/pr-review';
import {
  ScanResultOutputSchema,
  ReviewFindingsOutputSchema,
  StructuralIssuesOutputSchema,
  AICommentTriagesOutputSchema,
} from '../../schema/output/pr-review.output';

// =============================================================================
// Enums & Types
// =============================================================================

/** Multi-pass review stages. */
export const ReviewPass = {
  QUICK_SCAN: 'quick_scan',
  SECURITY: 'security',
  QUALITY: 'quality',
  DEEP_ANALYSIS: 'deep_analysis',
  STRUCTURAL: 'structural',
  AI_COMMENT_TRIAGE: 'ai_comment_triage',
} as const;

export type ReviewPass = (typeof ReviewPass)[keyof typeof ReviewPass];

/** Severity levels for PR review findings. */
export const ReviewSeverity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type ReviewSeverity = (typeof ReviewSeverity)[keyof typeof ReviewSeverity];

/** Categories for PR review findings. */
export const ReviewCategory = {
  SECURITY: 'security',
  QUALITY: 'quality',
  STYLE: 'style',
  TEST: 'test',
  DOCS: 'docs',
  PATTERN: 'pattern',
  PERFORMANCE: 'performance',
  VERIFICATION_FAILED: 'verification_failed',
} as const;

export type ReviewCategory = (typeof ReviewCategory)[keyof typeof ReviewCategory];

/** Verdict on AI tool comments. */
export const AICommentVerdict = {
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  NICE_TO_HAVE: 'nice_to_have',
  TRIVIAL: 'trivial',
  FALSE_POSITIVE: 'false_positive',
  ADDRESSED: 'addressed',
} as const;

export type AICommentVerdict = (typeof AICommentVerdict)[keyof typeof AICommentVerdict];

/** A single finding from a PR review. */
export interface PRReviewFinding {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  suggestedFix?: string;
  fixable: boolean;
  evidence?: string;
  verificationNote?: string;
  /** Validation status from the finding-validator agent */
  validationStatus?: 'confirmed_valid' | 'dismissed_false_positive' | 'needs_human_review' | null;
  /** Explanation from the finding-validator */
  validationExplanation?: string;
  /** Which specialist agents flagged this finding */
  sourceAgents?: string[];
  /** Whether multiple specialists flagged the same location */
  crossValidated?: boolean;
}

/** Triage result for an AI tool comment. */
export interface AICommentTriage {
  commentId: number;
  toolName: string;
  originalComment: string;
  verdict: AICommentVerdict;
  reasoning: string;
  responseComment?: string;
}

/** Structural issue with the PR (feature creep, architecture, etc.). */
export interface StructuralIssue {
  id: string;
  issueType: string;
  severity: ReviewSeverity;
  title: string;
  description: string;
  impact: string;
  suggestion: string;
}

/** A changed file in a PR. */
export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
  patch?: string;
}

/** AI bot comment on a PR. */
export interface AIBotComment {
  commentId: number;
  author: string;
  toolName: string;
  body: string;
  file?: string;
  line?: number;
  createdAt: string;
}

/** Complete context for PR review. */
export interface PRContext {
  prNumber: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  state: string;
  changedFiles: ChangedFile[];
  diff: string;
  diffTruncated: boolean;
  repoStructure: string;
  relatedFiles: string[];
  commits: Array<Record<string, string>>;
  labels: string[];
  totalAdditions: number;
  totalDeletions: number;
  aiBotComments: AIBotComment[];
}

/** Quick scan result. */
export interface ScanResult {
  complexity: string;
  riskAreas: string[];
  verdict?: string;
  [key: string]: unknown;
}

/** Progress callback for review updates. */
export interface ProgressUpdate {
  phase: string;
  progress: number;
  message: string;
  prNumber?: number;
  extra?: Record<string, unknown>;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/** Configuration for PR review engine. */
export interface PRReviewEngineConfig {
  repo: string;
  model?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
  fastMode?: boolean;
  useParallelOrchestrator?: boolean;
}

/** Result of multi-pass review. */
export interface MultiPassReviewResult {
  findings: PRReviewFinding[];
  structuralIssues: StructuralIssue[];
  aiTriages: AICommentTriage[];
  scanResult: ScanResult;
}

// =============================================================================
// Review Pass Prompts
// =============================================================================

const REVIEW_PASS_PROMPTS: Record<ReviewPass, string> = {
  [ReviewPass.QUICK_SCAN]: `You are a senior code reviewer performing a quick scan of a pull request.

Analyze the PR and provide a JSON response with:
- "complexity": "low" | "medium" | "high"
- "risk_areas": string[] (list of risky areas)
- "verdict": "approve" | "request_changes" | "needs_review"
- "summary": brief summary of what this PR does

Respond with ONLY valid JSON, no markdown fencing.`,

  [ReviewPass.SECURITY]: `You are a security-focused code reviewer. Analyze the PR for:
- SQL injection, XSS, CSRF vulnerabilities
- Hardcoded secrets or credentials
- Unsafe deserialization
- Path traversal
- Insecure cryptographic practices
- Missing input validation

For each finding, output a JSON array of objects with:
{ "id": "SEC-N", "severity": "critical|high|medium|low", "category": "security", "title": "...", "description": "...", "file": "...", "line": N, "suggested_fix": "...", "fixable": boolean, "evidence": "actual code snippet" }

Respond with ONLY a JSON array, no markdown fencing.`,

  [ReviewPass.QUALITY]: `You are a code quality reviewer. Analyze the PR for:
- Code duplication
- Poor error handling
- Missing edge cases
- Unnecessary complexity
- Dead code
- Naming conventions

For each finding, output a JSON array of objects with:
{ "id": "QLT-N", "severity": "critical|high|medium|low", "category": "quality", "title": "...", "description": "...", "file": "...", "line": N, "suggested_fix": "...", "fixable": boolean, "evidence": "actual code snippet" }

Respond with ONLY a JSON array, no markdown fencing.`,

  [ReviewPass.DEEP_ANALYSIS]: `You are performing deep business logic analysis. Review for:
- Logic errors
- Race conditions
- State management issues
- Missing error recovery
- Data consistency problems

For each finding, output a JSON array of objects with:
{ "id": "DEEP-N", "severity": "critical|high|medium|low", "category": "quality", "title": "...", "description": "...", "file": "...", "line": N, "suggested_fix": "...", "fixable": boolean, "evidence": "actual code snippet" }

Respond with ONLY a JSON array, no markdown fencing.`,

  [ReviewPass.STRUCTURAL]: `You are reviewing the PR for structural issues:
- Feature creep (changes beyond stated scope)
- Scope creep
- Architecture violations
- Poor PR structure (should be split)

For each issue, output a JSON array of objects with:
{ "id": "STR-N", "issue_type": "feature_creep|scope_creep|architecture_violation|poor_structure", "severity": "critical|high|medium|low", "title": "...", "description": "...", "impact": "why this matters", "suggestion": "how to fix" }

Respond with ONLY a JSON array, no markdown fencing.`,

  [ReviewPass.AI_COMMENT_TRIAGE]: `You are triaging comments from other AI code review tools (CodeRabbit, Cursor, Greptile, etc.).

For each AI comment, determine if it is:
- "critical": Must be addressed before merge
- "important": Should be addressed
- "nice_to_have": Optional improvement
- "trivial": Can be ignored
- "false_positive": AI was wrong
- "addressed": Valid issue that was fixed in a subsequent commit

IMPORTANT: Check the commit timeline! If a later commit fixed what the AI flagged, verdict = "addressed".

Output a JSON array of objects with:
{ "comment_id": N, "tool_name": "...", "original_comment": "...", "verdict": "...", "reasoning": "...", "response_comment": "optional reply" }

Respond with ONLY a JSON array, no markdown fencing.`,
};

// =============================================================================
// Response Parsers
// =============================================================================

function parseScanResult(text: string): ScanResult {
  const result = parseLLMJson(text, ScanResultSchema);
  if (result) return result as ScanResult;
  return { complexity: 'low', riskAreas: [] };
}

function parseFindings(text: string): PRReviewFinding[] {
  const result = parseLLMJson(text, ReviewFindingsArraySchema);
  if (!result) return [];
  return result as PRReviewFinding[];
}

function parseStructuralIssues(text: string): StructuralIssue[] {
  const result = parseLLMJson(text, z.array(StructuralIssueSchema));
  if (!result) return [];
  return result as StructuralIssue[];
}

function parseAICommentTriages(text: string): AICommentTriage[] {
  const result = parseLLMJson(text, z.array(AICommentTriageSchema));
  if (!result) return [];
  return result as AICommentTriage[];
}

// =============================================================================
// Context Formatting
// =============================================================================

function formatChangedFiles(files: ChangedFile[], limit = 20): string {
  const lines: string[] = [];
  for (const file of files.slice(0, limit)) {
    lines.push(`- \`${file.path}\` (+${file.additions}/-${file.deletions})`);
  }
  if (files.length > limit) {
    lines.push(`- ... and ${files.length - limit} more files`);
  }
  return lines.join('\n');
}

function formatCommits(commits: Array<Record<string, string>>): string {
  if (commits.length === 0) return '';

  const lines: string[] = [];
  for (const commit of commits.slice(0, 5)) {
    const sha = (commit.oid ?? '').slice(0, 7);
    const message = commit.messageHeadline ?? '';
    lines.push(`- \`${sha}\` ${message}`);
  }
  if (commits.length > 5) {
    lines.push(`- ... and ${commits.length - 5} more commits`);
  }
  return `\n### Commits in this PR\n${lines.join('\n')}\n`;
}

function buildDiffContent(context: PRContext): { diff: string; warning: string } {
  let diffContent = context.diff;
  let warning = '';

  if (context.diffTruncated || !context.diff) {
    const patches: string[] = [];
    for (const file of context.changedFiles.slice(0, 50)) {
      if (file.patch) patches.push(file.patch);
    }
    diffContent = patches.join('\n');

    if (context.changedFiles.length > 50) {
      warning = `\n⚠️ **WARNING**: PR has ${context.changedFiles.length} changed files. Showing patches for first 50 files only. Review may be incomplete.\n`;
    } else {
      warning =
        '\n⚠️ **NOTE**: Full PR diff unavailable (PR > 20,000 lines). Using individual file patches instead.\n';
    }
  }

  if (diffContent.length > 50000) {
    const originalSize = diffContent.length;
    diffContent = diffContent.slice(0, 50000);
    warning = `\n⚠️ **WARNING**: Diff truncated from ${originalSize} to 50,000 characters. Review may be incomplete.\n`;
  }

  return { diff: diffContent, warning };
}

function buildReviewContext(context: PRContext): string {
  const filesStr = formatChangedFiles(context.changedFiles, 30);
  const { diff, warning } = buildDiffContent(context);

  return `
## Pull Request #${context.prNumber}

**Title:** ${context.title}
**Author:** ${context.author}
**Base:** ${context.baseBranch} ← **Head:** ${context.headBranch}
**State:** ${context.state}
**Changes:** ${context.totalAdditions} additions, ${context.totalDeletions} deletions across ${context.changedFiles.length} files

### Description
${context.description}

### Files Changed
${filesStr}

### Full Diff
\`\`\`diff
${diff.slice(0, 100000)}
\`\`\`${warning}
`;
}

function buildAICommentsContext(context: PRContext): string {
  const lines: string[] = [
    '## AI Tool Comments to Triage',
    '',
    `Found ${context.aiBotComments.length} comments from AI code review tools:`,
    '',
    '**IMPORTANT: Check the timeline! AI comments were made at specific times.',
    'If a later commit fixed the issue the AI flagged, use ADDRESSED (not FALSE_POSITIVE).**',
    '',
  ];

  for (let i = 0; i < context.aiBotComments.length; i++) {
    const comment = context.aiBotComments[i];
    lines.push(`### Comment ${i + 1}: ${comment.toolName}`);
    lines.push(`- **Comment ID**: ${comment.commentId}`);
    lines.push(`- **Author**: ${comment.author}`);
    lines.push(`- **Commented At**: ${comment.createdAt}`);
    lines.push(`- **File**: ${comment.file ?? 'General'}`);
    if (comment.line) lines.push(`- **Line**: ${comment.line}`);
    lines.push('');
    lines.push('**Comment:**');
    lines.push(comment.body);
    lines.push('');
  }

  if (context.commits.length > 0) {
    lines.push('## Commit Timeline (for reference)');
    lines.push('');
    lines.push('Use this to determine if issues were fixed AFTER AI comments:');
    lines.push('');
    for (const commit of context.commits) {
      const sha = (commit.oid ?? '').slice(0, 8);
      const message = commit.messageHeadline ?? '';
      const committedAt = commit.committedDate ?? '';
      lines.push(`- \`${sha}\` (${committedAt}): ${message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// PR Review Engine
// =============================================================================

/**
 * Determine if PR needs deep analysis pass.
 */
export function needsDeepAnalysis(scanResult: ScanResult, context: PRContext): boolean {
  const totalChanges = context.totalAdditions + context.totalDeletions;
  if (totalChanges > 200) return true;

  if (scanResult.complexity === 'high' || scanResult.complexity === 'medium') return true;

  if (scanResult.riskAreas.length > 0) return true;

  return false;
}

/**
 * Remove duplicate findings from multiple passes.
 */
export function deduplicateFindings(findings: PRReviewFinding[]): PRReviewFinding[] {
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
 * Run a single review pass and return parsed results.
 */
export async function runReviewPass(
  reviewPass: ReviewPass,
  context: PRContext,
  config: PRReviewEngineConfig,
): Promise<ScanResult | PRReviewFinding[]> {
  const passPrompt = REVIEW_PASS_PROMPTS[reviewPass];
  const filesStr = formatChangedFiles(context.changedFiles);
  const commitsStr = formatCommits(context.commits);
  const { diff, warning } = buildDiffContent(context);

  const prContext = `
## Pull Request #${context.prNumber}

**Title:** ${context.title}
**Author:** ${context.author}
**Base:** ${context.baseBranch} ← **Head:** ${context.headBranch}
**Changes:** ${context.totalAdditions} additions, ${context.totalDeletions} deletions across ${context.changedFiles.length} files

### Description
${context.description}

### Files Changed
${filesStr}
${commitsStr}
### Diff
\`\`\`diff
${diff}
\`\`\`${warning}
`;

  const fullPrompt = `${passPrompt}\n\n---\n\n${prContext}`;
  const modelShorthand = config.model ?? 'sonnet';
  const thinkingLevel = config.thinkingLevel ?? 'medium';

  const client = await createSimpleClient({
    systemPrompt: 'You are an expert code reviewer. Respond with structured JSON only.',
    modelShorthand,
    thinkingLevel,
  });

  if (reviewPass === ReviewPass.QUICK_SCAN) {
    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt: fullPrompt,
      output: Output.object({ schema: ScanResultOutputSchema }),
    });
    if (result.output) {
      return result.output as ScanResult;
    }
    return parseScanResult(result.text);
  }

  const result = await generateText({
    model: client.model,
    system: client.systemPrompt,
    prompt: fullPrompt,
    output: Output.object({ schema: ReviewFindingsOutputSchema }),
  });
  if (result.output) {
    return result.output.findings as PRReviewFinding[];
  }
  return parseFindings(result.text);
}

/**
 * Run the structural review pass.
 */
async function runStructuralPass(
  context: PRContext,
  config: PRReviewEngineConfig,
): Promise<StructuralIssue[]> {
  const passPrompt = REVIEW_PASS_PROMPTS[ReviewPass.STRUCTURAL];
  const prContext = buildReviewContext(context);
  const fullPrompt = `${passPrompt}\n\n---\n\n${prContext}`;

  const client = await createSimpleClient({
    systemPrompt: 'You are an expert code reviewer. Respond with structured JSON only.',
    modelShorthand: config.model ?? 'sonnet',
    thinkingLevel: config.thinkingLevel ?? 'medium',
  });

  try {
    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt: fullPrompt,
      output: Output.object({ schema: StructuralIssuesOutputSchema }),
    });
    if (result.output) {
      return result.output.issues as StructuralIssue[];
    }
    return parseStructuralIssues(result.text);
  } catch {
    return [];
  }
}

/**
 * Run the AI comment triage pass.
 */
async function runAITriagePass(
  context: PRContext,
  config: PRReviewEngineConfig,
): Promise<AICommentTriage[]> {
  if (context.aiBotComments.length === 0) return [];

  const passPrompt = REVIEW_PASS_PROMPTS[ReviewPass.AI_COMMENT_TRIAGE];
  const aiContext = buildAICommentsContext(context);
  const prContext = buildReviewContext(context);
  const fullPrompt = `${passPrompt}\n\n---\n\n${aiContext}\n\n---\n\n${prContext}`;

  const client = await createSimpleClient({
    systemPrompt: 'You are an expert code reviewer. Respond with structured JSON only.',
    modelShorthand: config.model ?? 'sonnet',
    thinkingLevel: config.thinkingLevel ?? 'medium',
  });

  try {
    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt: fullPrompt,
      output: Output.object({ schema: AICommentTriagesOutputSchema }),
    });
    if (result.output) {
      return result.output.triages as AICommentTriage[];
    }
    return parseAICommentTriages(result.text);
  } catch {
    return [];
  }
}

/**
 * Run multi-pass PR review for comprehensive analysis.
 *
 * Pass 1 (quick scan) runs first to determine complexity,
 * then remaining passes run in parallel.
 */
export async function runMultiPassReview(
  context: PRContext,
  config: PRReviewEngineConfig,
  progressCallback?: ProgressCallback,
): Promise<MultiPassReviewResult> {
  const reportProgress = (phase: string, progress: number, message: string) => {
    progressCallback?.({ phase, progress, message, prNumber: context.prNumber });
  };

  // Pass 1: Quick Scan
  reportProgress('quick_scan', 35, 'Pass 1/6: Quick Scan...');
  const scanResult = (await runReviewPass(ReviewPass.QUICK_SCAN, context, config)) as ScanResult;
  const quickVerdict = scanResult.verdict ?? 'no issues';
  reportProgress('quick_scan', 40, `Quick Scan complete — verdict: ${quickVerdict}`);

  const needsDeep = needsDeepAnalysis(scanResult, context);
  const hasAIComments = context.aiBotComments.length > 0;

  // Determine which parallel passes will run
  const passNames = ['Security', 'Quality', 'Structural'];
  if (hasAIComments) passNames.push('AI Triage');
  if (needsDeep) passNames.push('Deep Analysis');
  reportProgress('analyzing', 45, `Running ${passNames.join(', ')} in parallel...`);

  // Build parallel tasks — each reports its own start/completion
  const tasks: Array<Promise<{ type: string; data: unknown }>> = [
    (async () => {
      reportProgress('security', 50, 'Security analysis started...');
      const data = await runReviewPass(ReviewPass.SECURITY, context, config);
      const count = (data as PRReviewFinding[]).length;
      reportProgress('security', 60, `Security analysis complete — ${count} finding${count !== 1 ? 's' : ''}`);
      return { type: 'findings', data };
    })(),
    (async () => {
      reportProgress('quality', 50, 'Quality analysis started...');
      const data = await runReviewPass(ReviewPass.QUALITY, context, config);
      const count = (data as PRReviewFinding[]).length;
      reportProgress('quality', 60, `Quality analysis complete — ${count} finding${count !== 1 ? 's' : ''}`);
      return { type: 'findings', data };
    })(),
    (async () => {
      reportProgress('structural', 50, 'Structural analysis started...');
      const data = await runStructuralPass(context, config);
      const count = (data as StructuralIssue[]).length;
      reportProgress('structural', 60, `Structural analysis complete — ${count} issue${count !== 1 ? 's' : ''}`);
      return { type: 'structural', data };
    })(),
  ];

  if (hasAIComments) {
    tasks.push(
      (async () => {
        reportProgress('analyzing', 50, `AI Comment Triage started (${context.aiBotComments.length} comments)...`);
        const data = await runAITriagePass(context, config);
        const count = (data as AICommentTriage[]).length;
        reportProgress('analyzing', 60, `AI Comment Triage complete — ${count} triaged`);
        return { type: 'ai_triage', data };
      })(),
    );
  }

  if (needsDeep) {
    tasks.push(
      (async () => {
        reportProgress('deep_analysis', 50, 'Deep analysis started...');
        const data = await runReviewPass(ReviewPass.DEEP_ANALYSIS, context, config);
        const count = (data as PRReviewFinding[]).length;
        reportProgress('deep_analysis', 60, `Deep analysis complete — ${count} finding${count !== 1 ? 's' : ''}`);
        return { type: 'findings', data };
      })(),
    );
  }

  const results = await Promise.allSettled(tasks);

  const allFindings: PRReviewFinding[] = [];
  const structuralIssues: StructuralIssue[] = [];
  const aiTriages: AICommentTriage[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { type, data } = result.value;
    if (type === 'findings') {
      allFindings.push(...(data as PRReviewFinding[]));
    } else if (type === 'structural') {
      structuralIssues.push(...(data as StructuralIssue[]));
    } else if (type === 'ai_triage') {
      aiTriages.push(...(data as AICommentTriage[]));
    }
  }

  reportProgress('dedup', 85, `Deduplicating ${allFindings.length} findings...`);
  const uniqueFindings = deduplicateFindings(allFindings);
  const removed = allFindings.length - uniqueFindings.length;
  if (removed > 0) {
    reportProgress('dedup', 90, `Deduplication complete — removed ${removed} duplicate${removed !== 1 ? 's' : ''}, ${uniqueFindings.length} unique findings`);
  }

  return {
    findings: uniqueFindings,
    structuralIssues,
    aiTriages,
    scanResult,
  };
}
