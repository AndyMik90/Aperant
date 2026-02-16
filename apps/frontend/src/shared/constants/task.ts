/**
 * Task-related constants
 * Includes status, categories, complexity, priority, and execution phases
 */

import type { TaskStatus } from '@shared/types/task';

// ============================================
// Task Status (Kanban columns)
// ============================================

// Task status columns in Kanban board order
export const TASK_STATUS_COLUMNS = [
  'backlog',
  'queue',
  'in_progress',
  'ai_review',
  'human_review',
  'done'
] as const;

export type TaskStatusColumn = typeof TASK_STATUS_COLUMNS[number];

// Status label translation keys (use with t() from react-i18next)
// Note: pr_created maps to 'done' column in Kanban view (see KanbanBoard.tsx)
// Note: error maps to 'human_review' column in Kanban view (errors need human attention)
export const TASK_STATUS_LABELS: Record<TaskStatusColumn | 'pr_created' | 'error', string> = {
  backlog: 'columns.backlog',
  queue: 'columns.queue',
  in_progress: 'columns.in_progress',
  ai_review: 'columns.ai_review',
  human_review: 'columns.human_review',
  done: 'columns.done',
  pr_created: 'columns.pr_created',
  error: 'columns.error'
};

// Status colors for UI
// Note: pr_created maps to 'done' column in Kanban view (see KanbanBoard.tsx)
// Note: error maps to 'human_review' column in Kanban view (errors need human attention)
export const TASK_STATUS_COLORS: Record<TaskStatusColumn | 'pr_created' | 'error', string> = {
  backlog: 'bg-muted text-muted-foreground',
  queue: 'bg-cyan-500/10 text-cyan-400',
  in_progress: 'bg-info/10 text-info',
  ai_review: 'bg-warning/10 text-warning',
  human_review: 'bg-purple-500/10 text-purple-400',
  done: 'bg-success/10 text-success',
  pr_created: 'bg-info/10 text-info',
  error: 'bg-destructive/10 text-destructive'
};

// Status priority for deduplication: higher = more complete
// Used in project-store.ts to resolve duplicate tasks (main vs worktree)
// IMPORTANT: Must follow workflow order: backlog < queue < in_progress < review < done
export const TASK_STATUS_PRIORITY: Record<TaskStatus, number> = {
  'done': 100,           // Highest priority - task is complete
  'pr_created': 90,
  'human_review': 80,
  'ai_review': 70,
  'in_progress': 50,
  'queue': 30,
  'backlog': 20,
  'error': 10           // Lowest priority
} as const;

// ============================================
// Subtask Status
// ============================================

export const SUBTASK_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted',
  in_progress: 'bg-info',
  completed: 'bg-success',
  failed: 'bg-destructive'
};

// ============================================
// Execution Phases
// ============================================

// Execution phase labels
export const EXECUTION_PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  planning: 'Planning',
  coding: 'Coding',
  rate_limit_paused: 'Rate Limited',
  auth_failure_paused: 'Auth Required',
  qa_review: 'AI Review',
  qa_fixing: 'Fixing Issues',
  complete: 'Complete',
  failed: 'Failed'
};

// Execution phase colors (for progress bars and indicators)
export const EXECUTION_PHASE_COLORS: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  planning: 'bg-amber-500 text-amber-50',
  coding: 'bg-info text-info-foreground',
  rate_limit_paused: 'bg-orange-500 text-orange-50',
  auth_failure_paused: 'bg-red-500 text-red-50',
  qa_review: 'bg-purple-500 text-purple-50',
  qa_fixing: 'bg-warning text-warning-foreground',
  complete: 'bg-success text-success-foreground',
  failed: 'bg-destructive text-destructive-foreground'
};

// Execution phase badge colors (outline style)
export const EXECUTION_PHASE_BADGE_COLORS: Record<string, string> = {
  idle: 'bg-muted/50 text-muted-foreground border-muted',
  planning: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  coding: 'bg-info/10 text-info border-info/30',
  rate_limit_paused: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  auth_failure_paused: 'bg-red-500/10 text-red-400 border-red-500/30',
  qa_review: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  qa_fixing: 'bg-warning/10 text-warning border-warning/30',
  complete: 'bg-success/10 text-success border-success/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30'
};

// Execution phase progress weights (for overall progress calculation)
export const EXECUTION_PHASE_WEIGHTS: Record<string, { start: number; end: number }> = {
  idle: { start: 0, end: 0 },
  planning: { start: 0, end: 20 },
  coding: { start: 20, end: 80 },
  rate_limit_paused: { start: 20, end: 80 },  // Same as coding (pause during coding)
  auth_failure_paused: { start: 20, end: 80 },  // Same as coding (pause during coding)
  qa_review: { start: 80, end: 95 },
  qa_fixing: { start: 80, end: 95 },  // Same range as qa_review, cycles back
  complete: { start: 100, end: 100 },
  failed: { start: 0, end: 0 }
};

// ============================================
// Task Categories
// ============================================

export const TASK_CATEGORY_LABELS: Record<string, string> = {
  feature: 'Feature',
  bug_fix: 'Bug Fix',
  refactoring: 'Refactoring',
  documentation: 'Docs',
  security: 'Security',
  performance: 'Performance',
  ui_ux: 'UI/UX',
  infrastructure: 'Infrastructure',
  testing: 'Testing'
};

export const TASK_CATEGORY_COLORS: Record<string, string> = {
  feature: 'bg-primary/10 text-primary border-primary/30',
  bug_fix: 'bg-destructive/10 text-destructive border-destructive/30',
  refactoring: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  documentation: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  security: 'bg-red-500/10 text-red-400 border-red-500/30',
  performance: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  ui_ux: 'bg-info/10 text-info border-info/30',
  infrastructure: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  testing: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
};

// ============================================
// Task Complexity
// ============================================

export const TASK_COMPLEXITY_LABELS: Record<string, string> = {
  trivial: 'Trivial',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  complex: 'Complex'
};

export const TASK_COMPLEXITY_COLORS: Record<string, string> = {
  trivial: 'bg-success/10 text-success',
  small: 'bg-info/10 text-info',
  medium: 'bg-warning/10 text-warning',
  large: 'bg-orange-500/10 text-orange-400',
  complex: 'bg-destructive/10 text-destructive'
};

// ============================================
// Task Impact
// ============================================

export const TASK_IMPACT_LABELS: Record<string, string> = {
  low: 'Low Impact',
  medium: 'Medium Impact',
  high: 'High Impact',
  critical: 'Critical Impact'
};

export const TASK_IMPACT_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-info/10 text-info',
  high: 'bg-warning/10 text-warning',
  critical: 'bg-destructive/10 text-destructive'
};

// ============================================
// Task Priority
// ============================================

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
};

export const TASK_PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-info/10 text-info',
  high: 'bg-warning/10 text-warning',
  urgent: 'bg-destructive/10 text-destructive'
};

// ============================================
// Image/Attachment Constants
// ============================================

// Maximum image file size (10 MB)
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// Maximum number of images per task
export const MAX_IMAGES_PER_TASK = 10;

// Maximum number of referenced files per task
export const MAX_REFERENCED_FILES = 20;

// Allowed image MIME types
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
] as const;

// Allowed image file extensions (for display)
export const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const;

// Human-readable allowed types for error messages
export const ALLOWED_IMAGE_TYPES_DISPLAY = 'PNG, JPEG, GIF, WebP, SVG';

// Attachments directory name within spec folder
export const ATTACHMENTS_DIR = 'attachments';

// ============================================
// JSON Error Markers
// ============================================

/**
 * Marker prefix for task descriptions that failed JSON parsing.
 * Format: __JSON_ERROR__:<error message>
 * Used in project-store.ts when loading tasks with malformed implementation_plan.json
 */
export const JSON_ERROR_PREFIX = '__JSON_ERROR__:';

/**
 * Marker suffix for task titles that have JSON parsing errors.
 * Appended to spec directory name, replaced with i18n suffix at render time.
 * Used in project-store.ts when loading tasks with malformed implementation_plan.json
 */
export const JSON_ERROR_TITLE_SUFFIX = '__JSON_ERROR_SUFFIX__';
