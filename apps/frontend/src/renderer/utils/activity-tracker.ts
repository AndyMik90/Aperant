/**
 * Activity Tracker - Utility for tracking and storing task activities
 *
 * SUG-9: Activity Feed
 * Provides functions to add, load, and clear activities without
 * coupling to any specific component.
 */

import type { TaskStatus } from '../../shared/types';

// Activity types
export type ActivityType =
  | 'task_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'status_changed'
  | 'pr_created'
  | 'task_archived';

// Activity entry
export interface ActivityEntry {
  id: string;
  type: ActivityType;
  taskId: string;
  taskTitle: string;
  timestamp: string;
  duration?: number; // Duration in milliseconds
  phaseInfo?: string; // Which phase completed (e.g., "Planning", "Coding", "QA")
  details?: {
    fromStatus?: TaskStatus;
    toStatus?: TaskStatus;
    prUrl?: string;
  };
}

const ACTIVITY_KEY = 'activity-feed';
const MAX_ACTIVITIES = 200;

/**
 * Load activities from localStorage
 */
export function loadActivities(): ActivityEntry[] {
  try {
    const stored = localStorage.getItem(ACTIVITY_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save activities to localStorage
 */
function saveActivities(activities: ActivityEntry[]): void {
  try {
    // Keep only the most recent activities
    const trimmed = activities.slice(0, MAX_ACTIVITIES);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save activities:', error);
  }
}

/**
 * Add a new activity
 */
export function addActivity(
  type: ActivityType,
  task: { id: string; title: string },
  details?: ActivityEntry['details'],
  duration?: number,
  phaseInfo?: string
): void {
  const activities = loadActivities();
  const newActivity: ActivityEntry = {
    id: crypto.randomUUID(),
    type,
    taskId: task.id,
    taskTitle: task.title,
    timestamp: new Date().toISOString(),
    duration,
    phaseInfo,
    details,
  };
  saveActivities([newActivity, ...activities]);

  // Dispatch custom event so ActivityFeed components can update
  window.dispatchEvent(new CustomEvent('activity-added', { detail: newActivity }));
}

/**
 * Clear all activities
 */
export function clearActivities(): void {
  localStorage.removeItem(ACTIVITY_KEY);
  window.dispatchEvent(new CustomEvent('activities-cleared'));
}
