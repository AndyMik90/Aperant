import { create } from 'zustand';
import type { LinearSyncStatus, LinearSyncEvent } from '../../../shared/types';

interface LinearSyncStatusState {
  // Sync status
  syncStatus: LinearSyncStatus | null;
  connectionError: string | null;
  syncEvents: LinearSyncEvent[];

  // Actions
  setSyncStatus: (status: LinearSyncStatus | null) => void;
  setConnectionError: (error: string | null) => void;
  addSyncEvent: (event: LinearSyncEvent) => void;
  clearSyncEvents: () => void;
  clearSyncStatus: () => void;

  // Selectors
  isConnected: () => boolean;
  getTeamName: () => string | null;
}

export const useLinearSyncStatusStore = create<LinearSyncStatusState>((set, get) => ({
  // Initial state
  syncStatus: null,
  connectionError: null,
  syncEvents: [],

  // Actions
  setSyncStatus: (syncStatus) => set({ syncStatus, connectionError: null }),

  setConnectionError: (connectionError) => set({ connectionError }),

  addSyncEvent: (event) => set((state) => ({
    syncEvents: [event, ...state.syncEvents].slice(0, 50) // Keep last 50 events
  })),

  clearSyncEvents: () => set({ syncEvents: [] }),

  clearSyncStatus: () => set({
    syncStatus: null,
    connectionError: null
  }),

  // Selectors
  isConnected: () => {
    const { syncStatus } = get();
    return syncStatus?.connected ?? false;
  },

  getTeamName: () => {
    const { syncStatus } = get();
    return syncStatus?.teamName ?? null;
  }
}));

/**
 * Check Linear connection status
 */
export async function checkLinearConnection(projectId: string): Promise<LinearSyncStatus | null> {
  const store = useLinearSyncStatusStore.getState();

  try {
    const result = await window.electronAPI.checkLinearConnection(projectId);
    if (result.success && result.data) {
      store.setSyncStatus(result.data);
      return result.data;
    } else {
      store.setConnectionError(result.error || 'Failed to check Linear connection');
      return null;
    }
  } catch (error) {
    store.setConnectionError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}
