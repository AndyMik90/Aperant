import { create } from 'zustand';
import type { TaskStatusColumn } from '../../shared/constants/task';
import { TASK_STATUS_COLUMNS } from '../../shared/constants/task';
import type { KanbanColumnPreference } from '../../shared/types/kanban';

// ============================================
// Types
// ============================================

// Re-export shared type for backwards compatibility
export type ColumnPreferences = KanbanColumnPreference;

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
  /** Load preferences from main process (IPC), falling back to localStorage */
  loadPreferences: (projectId: string) => void;
  /** Save preferences to localStorage (sync cache) and main process (debounced IPC) */
  savePreferences: (projectId: string) => boolean;
  /** Reset preferences to defaults */
  resetPreferences: (projectId: string) => void;
  /** Get preferences for a single column */
  getColumnPreferences: (column: TaskStatusColumn) => ColumnPreferences;
}

// ============================================
// Constants
// ============================================

/** localStorage key prefix for kanban settings persistence (sync cache) */
const KANBAN_SETTINGS_KEY_PREFIX = 'kanban-column-prefs';

/** Base font size in pixels for rem conversion (matches CSS default) */
export const BASE_FONT_SIZE = 16;

/** Default column width in pixels */
export const DEFAULT_COLUMN_WIDTH = 320;

/** Minimum column width in pixels */
export const MIN_COLUMN_WIDTH = 180;

/** Maximum column width in pixels */
export const MAX_COLUMN_WIDTH = 600;

/** Collapsed column width in pixels */
export const COLLAPSED_COLUMN_WIDTH = 48;

// ============================================
// Rem Conversion Helpers
// ============================================

/**
 * Convert a pixel value to a rem string.
 * Used for CSS width values that should scale with the UI scale system.
 *
 * @param px - The pixel value to convert
 * @returns A rem string (e.g., "20rem" for 320px)
 */
export function pxToRem(px: number): string {
  return `${px / BASE_FONT_SIZE}rem`;
}

/** Default column width in rem (scales with UI) */
export const DEFAULT_COLUMN_WIDTH_REM = pxToRem(DEFAULT_COLUMN_WIDTH);

/** Minimum column width in rem (scales with UI) */
export const MIN_COLUMN_WIDTH_REM = pxToRem(MIN_COLUMN_WIDTH);

/** Maximum column width in rem (scales with UI) */
export const MAX_COLUMN_WIDTH_REM = pxToRem(MAX_COLUMN_WIDTH);

/** Collapsed column width in rem (scales with UI) */
export const COLLAPSED_COLUMN_WIDTH_REM = pxToRem(COLLAPSED_COLUMN_WIDTH);

// ============================================
// Debounce timer for saving kanban preferences to main process
// ============================================

let saveKanbanPrefsTimeout: ReturnType<typeof setTimeout> | null = null;

// Track the current project being loaded to detect stale IPC results
let currentLoadingProjectId: string | null = null;

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

/**
 * Save kanban preferences to main process via IPC (debounced)
 * Follows the saveTabStateToMain() pattern from project-store.ts
 *
 * NOTE: We capture columnPreferences at call time to avoid race conditions
 * when the user switches projects during the debounce window.
 */
function saveKanbanPreferencesToMain(projectId: string): void {
  // Capture preferences at call time to avoid saving wrong project's data
  const preferencesToSave = useKanbanSettingsStore.getState().columnPreferences;
  if (!preferencesToSave) return;

  // Clear any pending save
  if (saveKanbanPrefsTimeout) {
    clearTimeout(saveKanbanPrefsTimeout);
  }

  // Debounce saves to avoid excessive IPC calls
  saveKanbanPrefsTimeout = setTimeout(async () => {
    try {
      await window.electronAPI.saveKanbanPreferences(projectId, preferencesToSave);
    } catch (err) {
      // IPC save failed — localStorage sync cache is still available as fallback
      console.debug('[KanbanSettings] IPC save failed, using localStorage fallback:', err);
    }
  }, 100);
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
    // Clear any pending save from previous project to prevent cross-project contamination
    if (saveKanbanPrefsTimeout) {
      clearTimeout(saveKanbanPrefsTimeout);
      saveKanbanPrefsTimeout = null;
    }

    // Track current project to detect stale IPC results
    currentLoadingProjectId = projectId;

    // First, try loading from localStorage as immediate sync cache
    try {
      const key = getKanbanSettingsKey(projectId);
      const stored = localStorage.getItem(key);

      if (stored) {
        const parsed = JSON.parse(stored);
        if (validatePreferences(parsed)) {
          set({ columnPreferences: parsed });
        } else {
          set({ columnPreferences: createDefaultPreferences() });
        }
      } else {
        set({ columnPreferences: createDefaultPreferences() });
      }
    } catch {
      set({ columnPreferences: createDefaultPreferences() });
    }

    // Then, async load from main process via IPC (source of truth)
    (async () => {
      try {
        const result = await window.electronAPI.getKanbanPreferences(projectId);

        // Check if project changed while IPC was in flight - discard stale result
        if (currentLoadingProjectId !== projectId) {
          return;
        }

        if (result?.success && result.data) {
          if (validatePreferences(result.data)) {
            set({ columnPreferences: result.data });

            // Update localStorage sync cache with IPC data
            try {
              const key = getKanbanSettingsKey(projectId);
              localStorage.setItem(key, JSON.stringify(result.data));
            } catch {
              // localStorage write failed, non-critical
            }
            return;
          }
        }

        // IPC returned no data or invalid data — keep whatever was loaded from localStorage/defaults
      } catch {
        // IPC call failed — keep localStorage/default data already set above
      }
    })();
  },

  savePreferences: (projectId) => {
    try {
      const state = get();
      if (!state.columnPreferences) {
        return false;
      }

      // Save to localStorage as sync cache
      const key = getKanbanSettingsKey(projectId);
      localStorage.setItem(key, JSON.stringify(state.columnPreferences));

      // Save to main process via debounced IPC
      saveKanbanPreferencesToMain(projectId);

      return true;
    } catch {
      return false;
    }
  },

  resetPreferences: (projectId) => {
    try {
      const key = getKanbanSettingsKey(projectId);
      localStorage.removeItem(key);
      set({ columnPreferences: createDefaultPreferences() });

      // Also save reset state to main process
      saveKanbanPreferencesToMain(projectId);
    } catch {
      // Reset failed, non-critical
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
