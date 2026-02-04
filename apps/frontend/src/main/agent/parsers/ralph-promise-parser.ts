/**
 * Ralph Promise Parser
 *
 * Detects Ralph-Wiggum promise markers in agent output:
 * - <promise>STEP_N_COMPLETE</promise> - Step completion (progress tracking)
 * - <promise>TASK_{SPEC_ID}_COMPLETE</promise> - Task completion (transition to AI review)
 *
 * These markers are emitted by the coding agent during autonomous execution
 * as defined in the spec.md Ralph-compatible format.
 */

import type {
  StepCompleteBlock,
  TaskCompleteBlock,
} from '../../../shared/types/structured-output';

// Regex patterns for Ralph promises
// Step completion: <promise>STEP_1_COMPLETE</promise>, <promise>STEP_2_COMPLETE</promise>, etc.
const STEP_COMPLETE_PATTERN = /<promise>STEP_(\d+)_COMPLETE<\/promise>/;

// Task completion: <promise>TASK_001_COMPLETE</promise>, <promise>TASK_feature-auth_COMPLETE</promise>, etc.
const TASK_COMPLETE_PATTERN = /<promise>TASK_([A-Za-z0-9_-]+)_COMPLETE<\/promise>/;

// Generic promise pattern for detecting any promise
const ANY_PROMISE_PATTERN = /<promise>([A-Z0-9_]+)<\/promise>/g;

export interface RalphPromiseResult {
  type: 'step_complete' | 'task_complete' | 'unknown';
  block: StepCompleteBlock | TaskCompleteBlock | null;
  rawPromise: string;
}

/**
 * Parse a line for Ralph promise markers
 * @param line - The raw output line to parse
 * @returns RalphPromiseResult if a promise is found, null otherwise
 */
export function parseRalphPromise(line: string): RalphPromiseResult | null {
  // Check for step completion promise
  const stepMatch = line.match(STEP_COMPLETE_PATTERN);
  if (stepMatch) {
    const stepNumber = parseInt(stepMatch[1], 10);
    const promiseText = stepMatch[0];
    return {
      type: 'step_complete',
      block: {
        type: 'step_complete',
        stepNumber,
        promiseText,
        timestamp: new Date().toISOString(),
      } satisfies StepCompleteBlock,
      rawPromise: promiseText,
    };
  }

  // Check for task completion promise
  const taskMatch = line.match(TASK_COMPLETE_PATTERN);
  if (taskMatch) {
    const specId = taskMatch[1];
    const promiseText = taskMatch[0];
    return {
      type: 'task_complete',
      block: {
        type: 'task_complete',
        specId,
        promiseText,
        timestamp: new Date().toISOString(),
      } satisfies TaskCompleteBlock,
      rawPromise: promiseText,
    };
  }

  // Check for any other promise (for logging/debugging)
  const anyMatch = line.match(ANY_PROMISE_PATTERN);
  if (anyMatch) {
    return {
      type: 'unknown',
      block: null,
      rawPromise: anyMatch[0],
    };
  }

  return null;
}

/**
 * Extract all promises from a multi-line string
 * Useful for parsing entire output buffers
 */
export function extractAllPromises(content: string): RalphPromiseResult[] {
  const results: RalphPromiseResult[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const result = parseRalphPromise(line);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Check if content contains the final task completion promise
 */
export function hasTaskCompletionPromise(content: string, specId?: string): boolean {
  if (specId) {
    // Check for specific spec ID completion
    const pattern = new RegExp(`<promise>TASK_${specId}_COMPLETE</promise>`);
    return pattern.test(content);
  }
  // Check for any task completion
  return TASK_COMPLETE_PATTERN.test(content);
}

/**
 * Get the highest completed step number from content
 */
export function getHighestCompletedStep(content: string): number {
  const matches = content.matchAll(/<promise>STEP_(\d+)_COMPLETE<\/promise>/g);
  let highest = 0;

  for (const match of matches) {
    const stepNum = parseInt(match[1], 10);
    if (stepNum > highest) {
      highest = stepNum;
    }
  }

  return highest;
}
