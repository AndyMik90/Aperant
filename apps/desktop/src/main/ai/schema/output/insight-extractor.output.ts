/**
 * Clean Insight Extractor Output Schema
 * ======================================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * Uses snake_case field names to match the prompt's JSON template.
 *
 * For post-hoc text parsing with field-name coercion, use
 * ExtractedInsightsSchema from '../insight-extractor' instead.
 */

import { z } from 'zod';

const FileInsightOutputSchema = z.object({
  file: z.string(),
  insight: z.string(),
  category: z.string().optional(),
});

const ApproachOutcomeOutputSchema = z.object({
  success: z.boolean(),
  approach_used: z.string(),
  why_it_worked: z.string().nullable(),
  why_it_failed: z.string().nullable(),
  alternatives_tried: z.array(z.string()),
});

export const ExtractedInsightsOutputSchema = z.object({
  file_insights: z.array(FileInsightOutputSchema),
  patterns_discovered: z.array(z.string()),
  gotchas_discovered: z.array(z.string()),
  approach_outcome: ApproachOutcomeOutputSchema,
  recommendations: z.array(z.string()),
});

export type ExtractedInsightsOutput = z.infer<typeof ExtractedInsightsOutputSchema>;
