/**
 * Kanban board column preference types
 * Shared across IPC boundary (main process, preload, renderer)
 */

/**
 * Column preferences for a single kanban column
 */
export interface KanbanColumnPreference {
  /** Column width in pixels (180-600px range) */
  width: number;
  /** Whether the column is collapsed (narrow vertical strip) */
  isCollapsed: boolean;
  /** Whether the column width is locked (prevents resize) */
  isLocked: boolean;
}

/**
 * All column preferences keyed by column status (e.g., 'backlog', 'in_progress', 'done')
 */
export type KanbanPreferences = Record<string, KanbanColumnPreference>;
