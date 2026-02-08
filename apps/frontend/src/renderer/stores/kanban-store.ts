/**
 * Kanban UI state store with localStorage persistence
 * FIX-23: Persist column collapse state across sessions
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KanbanState {
  // Collapsed column IDs
  collapsedColumns: string[];
  // Columns collapsed automatically (not by user) — NOT persisted
  autoCollapsedColumns: string[];

  // Actions
  toggleColumnCollapse: (columnId: string) => void;
  setCollapsedColumns: (columns: string[]) => void;
  isColumnCollapsed: (columnId: string) => boolean;
  setAutoCollapsed: (columnId: string, isAuto: boolean) => void;
}

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set, get) => ({
      collapsedColumns: [],
      autoCollapsedColumns: [],

      toggleColumnCollapse: (columnId: string) => {
        set((state) => {
          const isCollapsed = state.collapsedColumns.includes(columnId);
          if (isCollapsed) {
            return {
              collapsedColumns: state.collapsedColumns.filter(id => id !== columnId),
              // If expanding, also clear auto-collapsed flag
              autoCollapsedColumns: state.autoCollapsedColumns.filter(id => id !== columnId)
            };
          } else {
            return {
              collapsedColumns: [...state.collapsedColumns, columnId]
            };
          }
        });
      },

      setCollapsedColumns: (columns: string[]) => {
        set({ collapsedColumns: columns });
      },

      isColumnCollapsed: (columnId: string) => {
        return get().collapsedColumns.includes(columnId);
      },

      setAutoCollapsed: (columnId: string, isAuto: boolean) => {
        set((state) => {
          if (isAuto) {
            if (state.autoCollapsedColumns.includes(columnId)) return state;
            return {
              autoCollapsedColumns: [...state.autoCollapsedColumns, columnId]
            };
          } else {
            return {
              autoCollapsedColumns: state.autoCollapsedColumns.filter(id => id !== columnId)
            };
          }
        });
      }
    }),
    {
      name: 'kanban-ui-state',
      // Only persist manual collapse state, not auto-collapsed
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns
      })
    }
  )
);
