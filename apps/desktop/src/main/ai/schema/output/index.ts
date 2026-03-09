/**
 * Clean Output Schemas
 * ====================
 *
 * Provider-agnostic schemas for AI SDK Output.object() constrained decoding.
 * These schemas have all fields required and no preprocessing — suitable for
 * provider-level structured output enforcement (Anthropic, OpenAI strict mode).
 *
 * For file-based validation with LLM field coercion, use the schemas
 * exported from the parent schema/ module instead.
 */

export {
  ComplexityAssessmentOutputSchema,
  type ComplexityAssessmentOutput,
} from './complexity-assessment.output';

export {
  ImplementationPlanOutputSchema,
  type ImplementationPlanOutput,
  type PhaseOutput,
  type SubtaskOutput,
} from './implementation-plan.output';

export {
  QASignoffOutputSchema,
  type QASignoffOutput,
  type QAIssueOutput,
} from './qa-signoff.output';

export {
  ScanResultOutputSchema,
  type ScanResultOutput,
  ReviewFindingsOutputSchema,
  type ReviewFindingsOutput,
  StructuralIssuesOutputSchema,
  type StructuralIssuesOutput,
  AICommentTriagesOutputSchema,
  type AICommentTriagesOutput,
  SpecialistOutputOutputSchema,
  type SpecialistOutputOutput,
  SynthesisResultOutputSchema,
  type SynthesisResultOutput,
  FindingValidationsOutputSchema,
  type FindingValidationsOutput,
  type FindingValidationItemOutput,
  ResolutionVerificationOutputSchema,
  type ResolutionVerificationOutput,
  type VerificationItemOutput,
} from './pr-review.output';

export {
  TriageResultOutputSchema,
  type TriageResultOutput,
} from './triage.output';

export {
  ExtractedInsightsOutputSchema,
  type ExtractedInsightsOutput,
} from './insight-extractor.output';

import type { ZodSchema } from 'zod';
import { ComplexityAssessmentOutputSchema } from './complexity-assessment.output';

/**
 * Get the appropriate output schema for an agent type when using structured output.
 * Returns undefined for agent types that don't have a clean output schema
 * (these agents write files via tools instead of returning structured data).
 */
export function getOutputSchemaForAgent(agentType: string): ZodSchema | undefined {
  switch (agentType) {
    case 'complexity_assessor':
      return ComplexityAssessmentOutputSchema;
    // qa_signoff is read from file after QA session — not returned inline
    // implementation_plan is written via Write tool — not returned inline
    default:
      return undefined;
  }
}
