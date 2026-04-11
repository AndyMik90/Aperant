import { create } from 'zustand';
import type { DesktopStateSnapshot } from '../../shared/types';

const EMPTY_DESKTOP_STATE: DesktopStateSnapshot = {
  supported: typeof window !== 'undefined' ? Boolean(window.platform?.isWindows) : false,
  available: false,
  pinEnabled: false,
  associationHotkey: null,
  currentDesktop: null,
  projectAssociations: [],
};

interface DesktopStoreState {
  snapshot: DesktopStateSnapshot;
  isLoading: boolean;
  error: string | null;
  setSnapshot: (snapshot: DesktopStateSnapshot) => void;
  loadDesktopState: () => Promise<DesktopStateSnapshot>;
  setDesktopPinEnabled: (enabled: boolean) => Promise<DesktopStateSnapshot | null>;
  associateProjectToCurrentDesktop: (projectId: string) => Promise<DesktopStateSnapshot | null>;
  clearProjectDesktopAssociation: (projectId: string) => Promise<DesktopStateSnapshot | null>;
  toggleProjectDesktopAssociation: (projectId: string) => Promise<DesktopStateSnapshot | null>;
}

export const useDesktopStore = create<DesktopStoreState>((set, get) => ({
  snapshot: EMPTY_DESKTOP_STATE,
  isLoading: false,
  error: null,

  setSnapshot: (snapshot) => set({ snapshot, error: snapshot.error ?? null }),

  loadDesktopState: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.electronAPI.getDesktopState();
      if (result.success && result.data) {
        set({ snapshot: result.data, isLoading: false, error: result.data.error ?? null });
        return result.data;
      }

      set({ isLoading: false, error: result.error ?? 'Failed to load desktop state.' });
      return get().snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load desktop state.';
      set({ isLoading: false, error: message });
      return get().snapshot;
    }
  },

  setDesktopPinEnabled: async (enabled) => {
    try {
      const result = await window.electronAPI.setDesktopPinEnabled(enabled);
      if (result.success && result.data) {
        set({ snapshot: result.data, error: result.data.error ?? null });
        return result.data;
      }

      set({ error: result.error ?? 'Failed to update desktop pin state.' });
      return null;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update desktop pin state.' });
      return null;
    }
  },

  associateProjectToCurrentDesktop: async (projectId) => {
    try {
      const result = await window.electronAPI.associateProjectToCurrentDesktop(projectId);
      if (result.success && result.data) {
        set({ snapshot: result.data, error: result.data.error ?? null });
        return result.data;
      }

      set({ error: result.error ?? 'Failed to associate the project with this desktop.' });
      return null;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to associate the project with this desktop.' });
      return null;
    }
  },

  clearProjectDesktopAssociation: async (projectId) => {
    try {
      const result = await window.electronAPI.clearProjectDesktopAssociation(projectId);
      if (result.success && result.data) {
        set({ snapshot: result.data, error: result.data.error ?? null });
        return result.data;
      }

      set({ error: result.error ?? 'Failed to clear the desktop association.' });
      return null;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to clear the desktop association.' });
      return null;
    }
  },

  toggleProjectDesktopAssociation: async (projectId) => {
    const { snapshot } = get();
    const currentDesktopId = snapshot.currentDesktop?.id;
    const currentAssociation = snapshot.projectAssociations.find(
      (association) => association.projectId === projectId
    );

    if (currentAssociation?.desktopId === currentDesktopId) {
      return get().clearProjectDesktopAssociation(projectId);
    }

    return get().associateProjectToCurrentDesktop(projectId);
  },
}));

export async function loadDesktopState(): Promise<DesktopStateSnapshot> {
  return useDesktopStore.getState().loadDesktopState();
}
