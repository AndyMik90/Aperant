/**
 * Schema Module
 * =============
 *
 * Zod schemas for validating LLM-generated structured output.
 *
 * Provides two validation approaches:
 * 1. Post-session file validation (for tool-using agents that write files)
 * 2. Inline Output.object() schemas (for single-shot structured generation)
 *
 * All schemas include coercion transforms that handle common LLM field name
 * variations (e.g., title→description), making validation provider-agnostic.
 */

export {
  ImplementationPlanSchema,
  PlanPhaseSchema,
  PlanSubtaskSchema,
  type ValidatedImplementationPlan,
  type ValidatedPlanPhase,
  type ValidatedPlanSubtask,
} from './implementation-plan';

export {
  ComplexityAssessmentSchema,
  type ValidatedComplexityAssessment,
} from './complexity-assessment';

export {
  QASignoffSchema,
  QAIssueSchema,
  type ValidatedQASignoff,
  type ValidatedQAIssue,
} from './qa-signoff';

export {
  validateStructuredOutput,
  validateJsonFile,
  validateAndNormalizeJsonFile,
  repairJsonWithLLM,
  parseLLMJson,
  formatZodErrors,
  buildValidationRetryPrompt,
  IMPLEMENTATION_PLAN_SCHEMA_HINT,
  type StructuredOutputValidation,
} from './structured-output';

export {
  ScanResultSchema,
  ReviewFindingSchema,
  ReviewFindingsArraySchema,
  StructuralIssueSchema,
  AICommentTriageSchema,
  MRReviewResultSchema,
  SynthesisResultSchema,
  VerificationItemSchema,
  ResolutionVerificationSchema,
  SpecialistOutputSchema,
  type ValidatedScanResult,
  type ValidatedReviewFinding,
  type ValidatedReviewFindingsArray,
  type ValidatedStructuralIssue,
  type ValidatedAICommentTriage,
  type ValidatedMRReviewResult,
  type ValidatedSynthesisResult,
  type ValidatedVerificationItem,
  type ValidatedResolutionVerification,
  type ValidatedSpecialistOutput,
} from './pr-review';

export {
  TriageResultSchema,
  type ValidatedTriageResult,
} from './triage';

export {
  ExtractedInsightsSchema,
  TaskSuggestionSchema,
  type ValidatedExtractedInsights,
  type ValidatedTaskSuggestion,
} from './insight-extractor';

// Clean output schemas for AI SDK Output.object() constrained decoding
export {
  ComplexityAssessmentOutputSchema,
  type ComplexityAssessmentOutput,
  ImplementationPlanOutputSchema,
  type ImplementationPlanOutput,
  QASignoffOutputSchema,
  type QASignoffOutput,
  TriageResultOutputSchema,
  type TriageResultOutput,
  ExtractedInsightsOutputSchema,
  type ExtractedInsightsOutput,
} from './output';
