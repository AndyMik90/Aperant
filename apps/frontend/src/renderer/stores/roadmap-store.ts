import { create } from 'zustand';
import type {
  CompetitorAnalysis,
  Roadmap,
  RoadmapFeature,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  FeatureSource
} from '../../shared/types';

/**
 * Migrate roadmap data to latest schema
 * - Converts 'idea' status to 'under_review' (Canny-compatible)
 * - Adds default source for features without one
 */
function migrateRoadmapIfNeeded(roadmap: Roadmap): Roadmap {
  let needsMigration = false;

  const migratedFeatures = roadmap.features.map((feature) => {
    const migratedFeature = { ...feature };

    // Migrate 'idea' status to 'under_review'
    if ((feature.status as string) === 'idea') {
      migratedFeature.status = 'under_review';
      needsMigration = true;
    }

    // Add default source if missing
    if (!feature.source) {
      migratedFeature.source = { provider: 'internal' } as FeatureSource;
      needsMigration = true;
    }

    return migratedFeature;
  });

  if (needsMigration) {
    console.log('[Roadmap] Migrated roadmap data to latest schema');
    return {
      ...roadmap,
      features: migratedFeatures,
      updatedAt: new Date()
    };
  }

  return roadmap;
}

interface RoadmapState {
  // Data
  roadmap: Roadmap | null;
  competitorAnalysis: CompetitorAnalysis | null;
  generationStatus: RoadmapGenerationStatus;
  currentProjectId: string | null;  // Track which project we're viewing/generating for

  // Actions
  setRoadmap: (roadmap: Roadmap | null) => void;
  setCompetitorAnalysis: (analysis: CompetitorAnalysis | null) => void;
  setGenerationStatus: (status: RoadmapGenerationStatus) => void;
  setCurrentProjectId: (projectId: string | null) => void;
  updateFeatureStatus: (featureId: string, status: RoadmapFeatureStatus) => void;
  markFeatureDoneBySpecId: (specId: string) => void;
  updateFeatureLinkedSpec: (featureId: string, specId: string) => void;
  deleteFeature: (featureId: string) => void;
  clearRoadmap: () => void;
  // Drag-and-drop actions
  reorderFeatures: (phaseId: string, featureIds: string[]) => void;
  updateFeaturePhase: (featureId: string, newPhaseId: string) => void;
  addFeature: (feature: Omit<RoadmapFeature, 'id'>) => string;
}

const initialGenerationStatus: RoadmapGenerationStatus = {
  phase: 'idle',
  progress: 0,
  message: ''
};

export const useRoadmapStore = create<RoadmapState>((set) => ({
  // Initial state
  roadmap: null,
  competitorAnalysis: null,
  generationStatus: initialGenerationStatus,
  currentProjectId: null,

  // Actions
  setRoadmap: (roadmap) => set({ roadmap }),

  setCompetitorAnalysis: (analysis) => set({ competitorAnalysis: analysis }),

  setGenerationStatus: (status) =>
    set((state) => {
      const now = new Date();
      const isStartingGeneration =
        state.generationStatus.phase === 'idle' && status.phase !== 'idle';
      const isStoppingGeneration = status.phase === 'idle' || status.phase === 'complete' || status.phase === 'error';

      return {
        generationStatus: {
          ...status,
          // Set startedAt when transitioning from idle to active, but preserve passed timestamp if provided (for restoring persisted state)
          startedAt: isStartingGeneration
            ? (status.startedAt ?? now)
            : isStoppingGeneration
              ? undefined
              : status.startedAt ?? state.generationStatus.startedAt,
          // Update lastActivityAt on any status change, but preserve passed timestamp if provided (for restoring persisted state)
          lastActivityAt: isStoppingGeneration ? undefined : (status.lastActivityAt ?? now)
        }
      };
    }),

  setCurrentProjectId: (projectId) => set({ currentProjectId: projectId }),

  updateFeatureStatus: (featureId, status) =>
    set((state) => {
      if (!state.roadmap) return state;

      const updatedFeatures = state.roadmap.features.map((feature) =>
        feature.id === featureId ? { ...feature, status } : feature
      );

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  // Mark feature as done when its linked task completes
  markFeatureDoneBySpecId: (specId: string) =>
    set((state) => {
      if (!state.roadmap) return state;

      const updatedFeatures = state.roadmap.features.map((feature) =>
        feature.linkedSpecId === specId
          ? { ...feature, status: 'done' as RoadmapFeatureStatus }
          : feature
      );

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  updateFeatureLinkedSpec: (featureId, specId) =>
    set((state) => {
      if (!state.roadmap) return state;

      const updatedFeatures = state.roadmap.features.map((feature) =>
        feature.id === featureId
          ? { ...feature, linkedSpecId: specId, status: 'in_progress' as RoadmapFeatureStatus }
          : feature
      );

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  deleteFeature: (featureId) =>
    set((state) => {
      if (!state.roadmap) return state;

      const updatedFeatures = state.roadmap.features.filter(
        (feature) => feature.id !== featureId
      );

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  clearRoadmap: () =>
    set({
      roadmap: null,
      competitorAnalysis: null,
      generationStatus: initialGenerationStatus,
      currentProjectId: null
    }),

  // Reorder features within a phase
  reorderFeatures: (phaseId, featureIds) =>
    set((state) => {
      if (!state.roadmap) return state;

      // Get features for this phase in the new order
      const phaseFeatures = featureIds
        .map((id) => state.roadmap?.features.find((f) => f.id === id))
        .filter((f): f is RoadmapFeature => f !== undefined);

      // Get features from other phases (unchanged)
      const otherFeatures = state.roadmap.features.filter(
        (f) => f.phaseId !== phaseId
      );

      // Combine: other phases first, then reordered phase features
      const updatedFeatures = [...otherFeatures, ...phaseFeatures];

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  // Move a feature to a different phase
  updateFeaturePhase: (featureId, newPhaseId) =>
    set((state) => {
      if (!state.roadmap) return state;

      const updatedFeatures = state.roadmap.features.map((feature) =>
        feature.id === featureId ? { ...feature, phaseId: newPhaseId } : feature
      );

      return {
        roadmap: {
          ...state.roadmap,
          features: updatedFeatures,
          updatedAt: new Date()
        }
      };
    }),

  // Add a new feature to the roadmap
  addFeature: (featureData) => {
    const newId = `feature-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newFeature: RoadmapFeature = {
      ...featureData,
      id: newId
    };

    set((state) => {
      if (!state.roadmap) return state;

      return {
        roadmap: {
          ...state.roadmap,
          features: [...state.roadmap.features, newFeature],
          updatedAt: new Date()
        }
      };
    });

    return newId;
  }
}));

// Helper functions for loading roadmap
export async function loadRoadmap(projectId: string): Promise<void> {
  const store = useRoadmapStore.getState();

  // Always set current project ID first - this ensures event handlers
  // only process events for the currently viewed project
  store.setCurrentProjectId(projectId);

  // Query if roadmap generation is currently running for this project
  // This restores the generation status when switching back to a project
  const statusResult = await window.electronAPI.getRoadmapStatus(projectId);
  if (statusResult.success && statusResult.data?.isRunning) {
    // Generation is running - try to load persisted progress for more accurate state
    const progressResult = await window.electronAPI.loadRoadmapProgress(projectId);
    if (progressResult.success && progressResult.data) {
      // Restore full progress state including timestamps
      const persistedProgress = progressResult.data;

      // Helper to safely parse date strings (returns undefined for invalid dates)
      const parseDate = (dateStr: string | undefined): Date | undefined => {
        if (!dateStr) return undefined;
        const date = new Date(dateStr);
        return Number.isNaN(date.getTime()) ? undefined : date;
      };

      store.setGenerationStatus({
        phase: persistedProgress.phase !== 'idle' ? persistedProgress.phase : 'analyzing',
        progress: persistedProgress.progress,
        message: persistedProgress.message || 'Roadmap generation in progress...',
        startedAt: parseDate(persistedProgress.startedAt) ?? new Date(),
        lastActivityAt: parseDate(persistedProgress.lastActivityAt) ?? new Date()
      });
    } else {
      // Fallback: generation is running but no persisted progress found
      store.setGenerationStatus({
        phase: 'analyzing',
        progress: 0,
        message: 'Roadmap generation in progress...',
        startedAt: new Date(),
        lastActivityAt: new Date()
      });
    }
  } else {
    // Generation is not running - reset to idle
    store.setGenerationStatus({
      phase: 'idle',
      progress: 0,
      message: ''
    });
  }

  const result = await window.electronAPI.getRoadmap(projectId);
  if (result.success && result.data) {
    // Migrate roadmap to latest schema if needed
    const migratedRoadmap = migrateRoadmapIfNeeded(result.data);
    store.setRoadmap(migratedRoadmap);

    // Save migrated roadmap if changes were made
    if (migratedRoadmap !== result.data) {
      window.electronAPI.saveRoadmap(projectId, migratedRoadmap).catch((err) => {
        console.error('[Roadmap] Failed to save migrated roadmap:', err);
      });
    }

    // Extract and set competitor analysis separately if present
    if (migratedRoadmap.competitorAnalysis) {
      store.setCompetitorAnalysis(migratedRoadmap.competitorAnalysis);
    } else {
      store.setCompetitorAnalysis(null);
    }
  } else {
    store.setRoadmap(null);
    store.setCompetitorAnalysis(null);
  }
}

export function generateRoadmap(
  projectId: string,
  enableCompetitorAnalysis?: boolean,
  refreshCompetitorAnalysis?: boolean
): void {
  // Debug logging
  if (window.DEBUG) {
    console.log('[Roadmap] Starting generation:', { projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis });
  }

  useRoadmapStore.getState().setGenerationStatus({
    phase: 'analyzing',
    progress: 0,
    message: 'Starting roadmap generation...'
  });
  window.electronAPI.generateRoadmap(projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis);
}

export function refreshRoadmap(
  projectId: string,
  enableCompetitorAnalysis?: boolean,
  refreshCompetitorAnalysis?: boolean
): void {
  // Debug logging
  if (window.DEBUG) {
    console.log('[Roadmap] Starting refresh:', { projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis });
  }

  useRoadmapStore.getState().setGenerationStatus({
    phase: 'analyzing',
    progress: 0,
    message: 'Refreshing roadmap...'
  });
  window.electronAPI.refreshRoadmap(projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis);
}

export async function stopRoadmap(projectId: string): Promise<boolean> {
  const store = useRoadmapStore.getState();

  // Debug logging
  if (window.DEBUG) {
    console.log('[Roadmap] Stop requested:', { projectId });
  }

  // Always update UI state to 'idle' when user requests stop, regardless of backend response
  // This prevents the UI from getting stuck in "generating" state if the process already ended
  store.setGenerationStatus({
    phase: 'idle',
    progress: 0,
    message: 'Generation stopped'
  });

  const result = await window.electronAPI.stopRoadmap(projectId);

  // Debug logging
  if (window.DEBUG) {
    console.log('[Roadmap] Stop result:', { projectId, success: result.success });
  }

  if (!result.success) {
    // Backend couldn't find/stop the process (likely already finished/crashed)
    console.log('[Roadmap] Process already stopped');
  }

  return result.success;
}

// Selectors
export function getFeaturesByPhase(
  roadmap: Roadmap | null,
  phaseId: string
): RoadmapFeature[] {
  if (!roadmap) return [];
  return roadmap.features.filter((f) => f.phaseId === phaseId);
}

export function getFeaturesByPriority(
  roadmap: Roadmap | null,
  priority: string
): RoadmapFeature[] {
  if (!roadmap) return [];
  return roadmap.features.filter((f) => f.priority === priority);
}

export function getFeatureStats(roadmap: Roadmap | null): {
  total: number;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
  byComplexity: Record<string, number>;
} {
  if (!roadmap) {
    return {
      total: 0,
      byPriority: {},
      byStatus: {},
      byComplexity: {}
    };
  }

  const byPriority: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byComplexity: Record<string, number> = {};

  roadmap.features.forEach((feature) => {
    byPriority[feature.priority] = (byPriority[feature.priority] || 0) + 1;
    byStatus[feature.status] = (byStatus[feature.status] || 0) + 1;
    byComplexity[feature.complexity] = (byComplexity[feature.complexity] || 0) + 1;
  });

  return {
    total: roadmap.features.length,
    byPriority,
    byStatus,
    byComplexity
  };
}
