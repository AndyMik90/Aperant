import { create } from 'zustand';
import type { TaskStatusColumn } from '../../shared/constants/task';
import { TASK_STATUS_COLUMNS } from '../../shared/constants/task';

// ============================================
// Types
// ============================================

/**
 * Column preferences for a single kanban column
 */
export interface ColumnPreferences {
  /** Column width in pixels (180-600px range) */
  width: number;
  /** Whether the column is collapsed (narrow vertical strip) */
  isCollapsed: boolean;
  /** Whether the column width is locked (prevents resize) */
  isLocked: boolean;
}

/**
 * All column preferences keyed by status column
 */
export type KanbanColumnPreferences = Record<TaskStatusColumn, ColumnPreferences>;

/**
 * Kanban settings store state
 */
interface KanbanSettingsState {
  /** Column preferences for each status column */
  columnPreferences: KanbanColumnPreferences | null;

  // Actions
  /** Initialize column preferences (call on mount) */
  initializePreferences: () => void;
  /** Set column width */
  setColumnWidth: (column: TaskStatusColumn, width: number) => void;
  /** Toggle column collapsed state */
  toggleColumnCollapsed: (column: TaskStatusColumn) => void;
  /** Set column collapsed state explicitly */
  setColumnCollapsed: (column: TaskStatusColumn, isCollapsed: boolean) => void;
  /** Toggle column locked state */
  toggleColumnLocked: (column: TaskStatusColumn) => void;
  /** Set column locked state explicitly */
  setColumnLocked: (column: TaskStatusColumn, isLocked: boolean) => void;
  /** Load preferences from localStorage */
  loadPreferences: (projectId: string) => void;
  /** Save preferences to localStorage */
  savePreferences: (projectId: string) => boolean;
  /** Reset preferences to defaults */
  resetPreferences: (projectId: string) => void;
  /** Get preferences for a single column */
  getColumnPreferences: (column: TaskStatusColumn) => ColumnPreferences;
}

// ============================================
// Constants
// ============================================

/** localStorage key prefix for kanban settings persistence */
const KANBAN_SETTINGS_KEY_PREFIX = 'kanban-column-prefs';

/** Default column width in pixels */
export const DEFAULT_COLUMN_WIDTH = 320;

/** Minimum column width in pixels */
export const MIN_COLUMN_WIDTH = 180;

/** Maximum column width in pixels */
export const MAX_COLUMN_WIDTH = 600;

/** Collapsed column width in pixels */
export const COLLAPSED_COLUMN_WIDTH = 48;

// ============================================
// Helper Functions
// ============================================

/**
 * Get the localStorage key for a project's kanban settings
 */
function getKanbanSettingsKey(projectId: string): string {
  return `${KANBAN_SETTINGS_KEY_PREFIX}-${projectId}`;
}

/**
 * Create default column preferences for all columns
 */
function createDefaultPreferences(): KanbanColumnPreferences {
  const preferences: Partial<KanbanColumnPreferences> = {};

  for (const column of TASK_STATUS_COLUMNS) {
    preferences[column] = {
      width: DEFAULT_COLUMN_WIDTH,
      isCollapsed: false,
      isLocked: false
    };
  }

  return preferences as KanbanColumnPreferences;
}

/**
 * Validate column preferences structure
 * Returns true if valid, false if invalid/incomplete
 */
function validatePreferences(data: unknown): data is KanbanColumnPreferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  const prefs = data as Record<string, unknown>;

  // Validate each required column exists with correct structure
  for (const column of TASK_STATUS_COLUMNS) {
    const columnPrefs = prefs[column];

    if (!columnPrefs || typeof columnPrefs !== 'object') {
      return false;
    }

    const cp = columnPrefs as Record<string, unknown>;

    // Validate width is a number within bounds
    if (typeof cp.width !== 'number' || cp.width < MIN_COLUMN_WIDTH || cp.width > MAX_COLUMN_WIDTH) {
      return false;
    }

    // Validate boolean fields
    if (typeof cp.isCollapsed !== 'boolean' || typeof cp.isLocked !== 'boolean') {
      return false;
    }
  }

  return true;
}

/**
 * Clamp a width value to valid bounds
 */
function clampWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
}

// ============================================
// Store
// ============================================

export const useKanbanSettingsStore = create<KanbanSettingsState>((set, get) => ({
  columnPreferences: null,

  initializePreferences: () => {
    const state = get();
    if (!state.columnPreferences) {
      set({ columnPreferences: createDefaultPreferences() });
    }
  },

  setColumnWidth: (column, width) => {
    set((state) => {
      if (!state.columnPreferences) return state;

      // Don't allow width changes on locked columns
      if (state.columnPreferences[column].isLocked) {
        return state;
      }

      const clampedWidth = clampWidth(width);

      return {
        columnPreferences: {
          ...state.columnPreferences,
          [column]: {
            ...state.columnPreferences[column],
            width: clampedWidth
          }
        }
      };
    });
  },

  toggleColumnCollapsed: (column) => {
    set((state) => {
      if (!state.columnPreferences) return state;

      return {
        columnPreferences: {
          ...state.columnPreferences,
          [column]: {
            ...state.columnPreferences[column],
            isCollapsed: !state.columnPreferences[column].isCollapsed
          }
        }
      };
    });
  },

  setColumnCollapsed: (column, isCollapsed) => {
    set((state) => {
      if (!state.columnPreferences) return state;

      return {
        columnPreferences: {
          ...state.columnPreferences,
          [column]: {
            ...state.columnPreferences[column],
            isCollapsed
          }
        }
      };
    });
  },

  toggleColumnLocked: (column) => {
    set((state) => {
      if (!state.columnPreferences) return state;

      return {
        columnPreferences: {
          ...state.columnPreferences,
          [column]: {
            ...state.columnPreferences[column],
            isLocked: !state.columnPreferences[column].isLocked
          }
        }
      };
    });
  },

  setColumnLocked: (column, isLocked) => {
    set((state) => {
      if (!state.columnPreferences) return state;

      return {
        columnPreferences: {
          ...state.columnPreferences,
          [column]: {
            ...state.columnPreferences[column],
            isLocked
          }
        }
      };
    });
  },

  loadPreferences: (projectId) => {
    try {
      const key = getKanbanSettingsKey(projectId);
      const stored = localStorage.getItem(key);

      if (stored) {
        const parsed = JSON.parse(stored);

        // Validate structure before using
        if (validatePreferences(parsed)) {
          set({ columnPreferences: parsed });
          return;
        }

        // Invalid data structure, use defaults
        console.warn('[KanbanSettingsStore] Invalid preferences in localStorage, using defaults');
      }

      // No stored preferences or invalid, use defaults
      set({ columnPreferences: createDefaultPreferences() });
    } catch (error) {
      console.error('[KanbanSettingsStore] Failed to load preferences:', error);
      set({ columnPreferences: createDefaultPreferences() });
    }
  },

  savePreferences: (projectId) => {
    try {
      const state = get();
      if (!state.columnPreferences) {
        return false;
      }

      const key = getKanbanSettingsKey(projectId);
      localStorage.setItem(key, JSON.stringify(state.columnPreferences));
      return true;
    } catch (error) {
      console.error('[KanbanSettingsStore] Failed to save preferences:', error);
      return false;
    }
  },

  resetPreferences: (projectId) => {
    try {
      const key = getKanbanSettingsKey(projectId);
      localStorage.removeItem(key);
      set({ columnPreferences: createDefaultPreferences() });
    } catch (error) {
      console.error('[KanbanSettingsStore] Failed to reset preferences:', error);
    }
  },

  getColumnPreferences: (column) => {
    const state = get();

    if (!state.columnPreferences) {
      return {
        width: DEFAULT_COLUMN_WIDTH,
        isCollapsed: false,
        isLocked: false
      };
    }

    return state.columnPreferences[column];
  }
}));

