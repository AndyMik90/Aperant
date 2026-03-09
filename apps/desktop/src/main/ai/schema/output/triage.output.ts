/**
 * Clean Triage Result Output Schema
 * ==================================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * Uses snake_case field names to match the triage prompt's JSON template.
 *
 * For post-hoc text parsing with field-name coercion, use
 * TriageResultSchema from '../triage' instead.
 */

import { z } from 'zod';

export const TriageResultOutputSchema = z.object({
  category: z.enum([
    'bug',
    'feature',
    'documentation',
    'question',
    'duplicate',
    'spam',
    'feature_creep',
  ]),
  confidence: z.number().min(0).max(1),
  priority: z.enum(['high', 'medium', 'low']),
  labels_to_add: z.array(z.string()),
  labels_to_remove: z.array(z.string()),
  is_duplicate: z.boolean(),
  duplicate_of: z.number().nullable(),
  is_spam: z.boolean(),
  is_feature_creep: z.boolean(),
  suggested_breakdown: z.array(z.string()),
  comment: z.string().nullable(),
});

export type TriageResultOutput = z.infer<typeof TriageResultOutputSchema>;
