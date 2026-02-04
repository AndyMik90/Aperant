/**
 * Kanban UI state store with localStorage persistence
 * FIX-23: Persist column collapse state across sessions
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KanbanState {
  // Collapsed column IDs
  collapsedColumns: string[];

  // Actions
  toggleColumnCollapse: (columnId: string) => void;
  setCollapsedColumns: (columns: string[]) => void;
  isColumnCollapsed: (columnId: string) => boolean;
}

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set, get) => ({
      collapsedColumns: [],

      toggleColumnCollapse: (columnId: string) => {
        set((state) => {
          const isCollapsed = state.collapsedColumns.includes(columnId);
          if (isCollapsed) {
            return {
              collapsedColumns: state.collapsedColumns.filter(id => id !== columnId)
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
      }
    }),
    {
      name: 'kanban-ui-state',
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns
      })
    }
  )
);
