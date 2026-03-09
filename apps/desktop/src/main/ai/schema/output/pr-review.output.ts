/**
 * Clean PR Review Output Schemas
 * ================================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * All fields are plain Zod types with no z.preprocess(), z.passthrough(),
 * or .optional() on required fields — providers enforce these schemas at the
 * token level so the model physically cannot produce non-compliant JSON.
 *
 * For post-hoc text parsing with LLM field coercion, use the schemas
 * exported from '../pr-review' instead.
 *
 * Note: Output.object() requires an object (not an array) at the top level.
 * Array results are wrapped in { items: [...] } and unwrapped by the caller.
 */

import { z } from 'zod';

// =============================================================================
// ScanResultOutputSchema — Quick scan pass
// =============================================================================

export const ScanResultOutputSchema = z.object({
  complexity: z.enum(['low', 'medium', 'high']),
  riskAreas: z.array(z.string()),
  verdict: z.string(),
  summary: z.string(),
});

export type ScanResultOutput = z.infer<typeof ScanResultOutputSchema>;

// =============================================================================
// ReviewFindingOutputSchema — Individual finding (security / quality / deep)
// =============================================================================

const ReviewFindingOutputSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum(['security', 'quality', 'style', 'test', 'docs', 'pattern', 'performance', 'verification_failed']),
  title: z.string(),
  description: z.string(),
  file: z.string(),
  line: z.number(),
  suggestedFix: z.string(),
  fixable: z.boolean(),
  evidence: z.string(),
});

/** Wraps finding array at top level for Output.object() compatibility. */
export const ReviewFindingsOutputSchema = z.object({
  findings: z.array(ReviewFindingOutputSchema),
});

export type ReviewFindingsOutput = z.infer<typeof ReviewFindingsOutputSchema>;

// =============================================================================
// StructuralIssueOutputSchema — Structural review pass
// =============================================================================

const StructuralIssueOutputSchema = z.object({
  id: z.string(),
  issueType: z.enum(['feature_creep', 'scope_creep', 'architecture_violation', 'poor_structure']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string(),
  description: z.string(),
  impact: z.string(),
  suggestion: z.string(),
});

/** Wraps structural issue array at top level for Output.object() compatibility. */
export const StructuralIssuesOutputSchema = z.object({
  issues: z.array(StructuralIssueOutputSchema),
});

export type StructuralIssuesOutput = z.infer<typeof StructuralIssuesOutputSchema>;

// =============================================================================
// AICommentTriageOutputSchema — AI comment triage pass
// =============================================================================

const AICommentTriageOutputSchema = z.object({
  commentId: z.number(),
  toolName: z.string(),
  originalComment: z.string(),
  verdict: z.enum(['critical', 'important', 'nice_to_have', 'trivial', 'false_positive', 'addressed']),
  reasoning: z.string(),
  responseComment: z.string(),
});

/** Wraps triage array at top level for Output.object() compatibility. */
export const AICommentTriagesOutputSchema = z.object({
  triages: z.array(AICommentTriageOutputSchema),
});

export type AICommentTriagesOutput = z.infer<typeof AICommentTriagesOutputSchema>;

// =============================================================================
// SpecialistOutputOutputSchema — Parallel orchestrator specialist findings
// =============================================================================

/** Clean version of SpecialistOutputSchema for Output.object() (no z.preprocess). */
export const SpecialistOutputOutputSchema = z.object({
  findings: z.array(ReviewFindingOutputSchema),
  summary: z.string(),
});

export type SpecialistOutputOutput = z.infer<typeof SpecialistOutputOutputSchema>;

// =============================================================================
// SynthesisResultOutputSchema — Parallel orchestrator synthesis verdict
// =============================================================================

/** Clean version of SynthesisResultSchema for Output.object() (no z.preprocess). */
export const SynthesisResultOutputSchema = z.object({
  verdict: z.enum(['ready_to_merge', 'merge_with_changes', 'needs_revision', 'blocked']),
  verdictReasoning: z.string(),
  keptFindingIds: z.array(z.string()),
  removedFindingIds: z.array(z.string()),
  removalReasons: z.record(z.string(), z.string()),
});

export type SynthesisResultOutput = z.infer<typeof SynthesisResultOutputSchema>;

// =============================================================================
// FindingValidationOutputSchema — Finding validator results
// =============================================================================

const FindingValidationItemOutputSchema = z.object({
  findingId: z.string(),
  validationStatus: z.enum(['confirmed_valid', 'dismissed_false_positive', 'needs_human_review']),
  codeEvidence: z.string(),
  explanation: z.string(),
});

/** Wraps validation array at top level for Output.object() compatibility. */
export const FindingValidationsOutputSchema = z.object({
  validations: z.array(FindingValidationItemOutputSchema),
});

export type FindingValidationsOutput = z.infer<typeof FindingValidationsOutputSchema>;
export type FindingValidationItemOutput = z.infer<typeof FindingValidationItemOutputSchema>;

// =============================================================================
// ResolutionVerificationOutputSchema — Followup resolution verifier
// =============================================================================

const VerificationItemOutputSchema = z.object({
  findingId: z.string(),
  status: z.enum(['resolved', 'unresolved', 'partially_resolved', 'cant_verify']),
  evidence: z.string(),
});

/** Clean version of ResolutionVerificationSchema for Output.object() (no z.preprocess). */
export const ResolutionVerificationOutputSchema = z.object({
  verifications: z.array(VerificationItemOutputSchema),
});

export type ResolutionVerificationOutput = z.infer<typeof ResolutionVerificationOutputSchema>;
export type VerificationItemOutput = z.infer<typeof VerificationItemOutputSchema>;
