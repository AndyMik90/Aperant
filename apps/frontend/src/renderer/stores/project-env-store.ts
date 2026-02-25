import { create } from 'zustand';
import type { ProjectEnvConfig } from '../../shared/types';

interface ProjectEnvState {
  // State
  envConfig: ProjectEnvConfig | null;
  projectId: string | null;
  isLoading: boolean;
  error: string | null;
  // Track the current pending request to handle race conditions
  // Stored in state so it's properly reset on HMR and managed alongside other state
  currentRequestId: number;

  // Actions
  setEnvConfig: (projectId: string | null, config: ProjectEnvConfig | null) => void;
  setEnvConfigOnly: (projectId: string | null, config: ProjectEnvConfig | null) => void;
  clearEnvConfig: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  incrementRequestId: () => number;
}

export const useProjectEnvStore = create<ProjectEnvState>((set, get) => ({
  // Initial state
  envConfig: null,
  projectId: null,
  isLoading: false,
  error: null,
  currentRequestId: 0,

  // Actions
  // setEnvConfig clears error - used for successful config loads
  setEnvConfig: (projectId, envConfig) => set({
    projectId,
    envConfig,
    error: null
  }),

  // setEnvConfigOnly updates config without touching error state - used in error cases
  setEnvConfigOnly: (projectId, envConfig) => set({
    projectId,
    envConfig
  }),

  clearEnvConfig: () => set({
    envConfig: null,
    projectId: null,
    error: null
  }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  incrementRequestId: () => {
    const newId = get().currentRequestId + 1;
    set({ currentRequestId: newId });
    return newId;
  }
}));

/**
 * Load project environment config from main process.
 * Updates the store with the loaded config.
 * Handles race conditions when called rapidly for different projects.
 */
export async function loadProjectEnvConfig(projectId: string): Promise<ProjectEnvConfig | null> {
  // Get fresh store state for initial operations
  const initialStore = useProjectEnvStore.getState();

  // Increment request ID to track this specific request
  const requestId = initialStore.incrementRequestId();

  initialStore.setLoading(true);
  initialStore.setError(null);

  try {
    const result = await window.electronAPI.getProjectEnv(projectId);

    // Get fresh store state after async operation for consistency
    const currentStore = useProjectEnvStore.getState();

    // Check if this request is still the current one (handle race conditions)
    if (requestId !== currentStore.currentRequestId) {
      // A newer request was made, ignore this result
      return null;
    }

    if (result.success && result.data) {
      currentStore.setEnvConfig(projectId, result.data);
      return result.data;
    } else {
      // Use setEnvConfigOnly to update config without clearing the error we're about to set
      currentStore.setEnvConfigOnly(projectId, null);
      currentStore.setError(result.error || 'Failed to load environment config');
      return null;
    }
  } catch (error) {
    // Get fresh store state after async operation
    const currentStore = useProjectEnvStore.getState();

    // Check if this request is still the current one
    if (requestId !== currentStore.currentRequestId) {
      return null;
    }

    // Use setEnvConfigOnly to update config without clearing the error we're about to set
    currentStore.setEnvConfigOnly(projectId, null);
    currentStore.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  } finally {
    // Get fresh store state for final loading state update
    const finalStore = useProjectEnvStore.getState();
    // Only update loading state if this is still the current request
    if (requestId === finalStore.currentRequestId) {
      finalStore.setLoading(false);
    }
  }
}

/**
 * Set project env config directly (for use by useProjectSettings hook).
 * This is a standalone function for use outside React components.
 */
export function setProjectEnvConfig(projectId: string, config: ProjectEnvConfig | null): void {
  const store = useProjectEnvStore.getState();
  store.setEnvConfig(projectId, config);
}

/**
 * Clear the project env config (for use when switching projects or closing dialogs).
 * This is a standalone function for use outside React components.
 */
export function clearProjectEnvConfig(): void {
  const store = useProjectEnvStore.getState();
  store.clearEnvConfig();
}
