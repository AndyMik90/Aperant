/**
 * Clean Implementation Plan Output Schema
 * ========================================
 *
 * For use with AI SDK Output.object() constrained decoding.
 * Simplified structure suitable for provider-level schema enforcement.
 *
 * For file-based validation with LLM field coercion, use
 * ImplementationPlanSchema from '../implementation-plan' instead.
 */

import { z } from 'zod';

const SubtaskOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'failed']),
  files_to_create: z.array(z.string()),
  files_to_modify: z.array(z.string()),
});

const PhaseOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtasks: z.array(SubtaskOutputSchema),
});

export const ImplementationPlanOutputSchema = z.object({
  feature: z.string(),
  workflow_type: z.string(),
  phases: z.array(PhaseOutputSchema).min(1),
});

export type ImplementationPlanOutput = z.infer<typeof ImplementationPlanOutputSchema>;
export type PhaseOutput = z.infer<typeof PhaseOutputSchema>;
export type SubtaskOutput = z.infer<typeof SubtaskOutputSchema>;
