/**
 * Task Duration Tracking Utilities
 *
 * Provides functions to record timestamps at phase transitions and calculate
 * AI work durations. Only tracks AI phases (planning, coding, ai_review).
 * Human review time is NOT tracked as it doesn't help estimate AI work time.
 *
 * @see docs/architecture/TASK_DURATION_TRACKING.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Timestamps for task phases (AI work only)
 */
export interface TaskTimestamps {
  created?: string;
  planning_started?: string;
  planning_completed?: string;
  coding_started?: string;
  coding_completed?: string;
  ai_review_started?: string;
  ai_review_completed?: string;
}

/**
 * Durations calculated from timestamps (in milliseconds)
 */
export interface TaskDurations {
  planning_ms?: number;
  coding_ms?: number;
  ai_review_ms?: number;
  total_ai_ms?: number;
}

/**
 * Valid timestamp events that can be recorded
 */
export type TimestampEvent = keyof TaskTimestamps;

/**
 * Record a timestamp for a task phase transition.
 * Reads the current plan, updates the timestamp, and saves it back.
 *
 * @param planPath - Path to the implementation_plan.json file
 * @param event - The timestamp event to record (e.g., 'planning_started')
 */
export function recordTaskTimestamp(
  planPath: string,
  event: TimestampEvent
): void {
  try {
    if (!existsSync(planPath)) {
      console.warn(`[recordTaskTimestamp] Plan file not found: ${planPath}`);
      return;
    }

    const planContent = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    // Initialize timestamps object if it doesn't exist
    if (!plan.timestamps) {
      plan.timestamps = {};
    }

    // Record the timestamp
    plan.timestamps[event] = new Date().toISOString();

    // Calculate durations if we have completed timestamps
    plan.durations = calculateDurations(plan.timestamps);

    // Update the updated_at field
    plan.updated_at = new Date().toISOString();

    // Write back to file
    writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');

    console.log(`[recordTaskTimestamp] Recorded ${event} at ${plan.timestamps[event]}`);
  } catch (error) {
    console.error(`[recordTaskTimestamp] Failed to record timestamp:`, error);
  }
}

/**
 * Calculate durations from timestamps.
 * Only calculates durations for completed phases.
 *
 * @param timestamps - The timestamps object from the plan
 * @returns Calculated durations in milliseconds
 */
export function calculateDurations(timestamps: TaskTimestamps): TaskDurations {
  const durations: TaskDurations = {};

  // Planning duration
  if (timestamps.planning_started && timestamps.planning_completed) {
    durations.planning_ms = new Date(timestamps.planning_completed).getTime() -
      new Date(timestamps.planning_started).getTime();
  }

  // Coding duration
  if (timestamps.coding_started && timestamps.coding_completed) {
    durations.coding_ms = new Date(timestamps.coding_completed).getTime() -
      new Date(timestamps.coding_started).getTime();
  }

  // AI Review duration
  if (timestamps.ai_review_started && timestamps.ai_review_completed) {
    durations.ai_review_ms = new Date(timestamps.ai_review_completed).getTime() -
      new Date(timestamps.ai_review_started).getTime();
  }

  // Calculate total AI time (sum of all completed phases)
  const totalParts: number[] = [];
  if (durations.planning_ms) totalParts.push(durations.planning_ms);
  if (durations.coding_ms) totalParts.push(durations.coding_ms);
  if (durations.ai_review_ms) totalParts.push(durations.ai_review_ms);

  if (totalParts.length > 0) {
    durations.total_ai_ms = totalParts.reduce((a, b) => a + b, 0);
  }

  return durations;
}

/**
 * Get the current elapsed time for an active phase.
 *
 * @param timestamps - The timestamps object from the plan
 * @param currentPhase - The currently active phase ('planning', 'coding', 'ai_review')
 * @returns Elapsed time in milliseconds, or undefined if phase not started
 */
export function getElapsedTime(
  timestamps: TaskTimestamps,
  currentPhase: 'planning' | 'coding' | 'ai_review'
): number | undefined {
  const startKey = `${currentPhase}_started` as keyof TaskTimestamps;
  const startTime = timestamps[startKey];

  if (!startTime) {
    return undefined;
  }

  return Date.now() - new Date(startTime).getTime();
}

/**
 * Get total AI time including current active phase.
 *
 * @param timestamps - The timestamps object from the plan
 * @param durations - The durations object from the plan
 * @param currentPhase - The currently active phase (if any)
 * @returns Total AI time in milliseconds
 */
export function getTotalAITime(
  timestamps: TaskTimestamps,
  durations: TaskDurations,
  currentPhase?: 'planning' | 'coding' | 'ai_review'
): number {
  let total = 0;

  // Add completed phase durations
  if (durations.planning_ms) total += durations.planning_ms;
  if (durations.coding_ms) total += durations.coding_ms;
  if (durations.ai_review_ms) total += durations.ai_review_ms;

  // Add elapsed time from current active phase
  if (currentPhase) {
    const elapsed = getElapsedTime(timestamps, currentPhase);
    if (elapsed) {
      total += elapsed;
    }
  }

  return total;
}

/**
 * Format duration for display.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "5s", "2m 15s", "1h 30m", "2h 15m 30s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingSeconds = seconds % 60;
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    if (remainingSeconds > 0) {
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    }
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Format duration in short form for task card.
 *
 * @param ms - Duration in milliseconds
 * @returns Short formatted string like "5s", "2m", "1h 30m"
 */
export function formatDurationShort(ms: number): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Get duration breakdown as percentages for display.
 *
 * @param durations - The durations object from the plan
 * @returns Object with phase percentages and total time
 */
export function getDurationBreakdown(durations: TaskDurations): {
  planning: { ms: number; percent: number } | null;
  coding: { ms: number; percent: number } | null;
  ai_review: { ms: number; percent: number } | null;
  total_ms: number;
} {
  const total = durations.total_ai_ms || 0;

  return {
    planning: durations.planning_ms
      ? { ms: durations.planning_ms, percent: Math.round((durations.planning_ms / total) * 100) }
      : null,
    coding: durations.coding_ms
      ? { ms: durations.coding_ms, percent: Math.round((durations.coding_ms / total) * 100) }
      : null,
    ai_review: durations.ai_review_ms
      ? { ms: durations.ai_review_ms, percent: Math.round((durations.ai_review_ms / total) * 100) }
      : null,
    total_ms: total,
  };
}
