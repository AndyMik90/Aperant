/// <reference types="vite/client" />
import { create } from 'zustand';
import { createActor } from 'xstate';
import type { Actor } from 'xstate';
import type {
  Competitor,
  CompetitorAnalysis,
  ManualCompetitorInput,
  Roadmap,
  RoadmapFeature,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  TaskOutcome,
  FeatureSource
} from '../../shared/types';
import {
  roadmapGenerationMachine,
  roadmapFeatureMachine,
  mapGenerationStateToPhase,
  mapFeatureStateToStatus,
  type RoadmapGenerationEvent,
  type RoadmapFeatureEvent
} from '@shared/state-machines';

// ---------------------------------------------------------------------------
// Module-level XState actor singletons
// ---------------------------------------------------------------------------

let generationActor: Actor<typeof roadmapGenerationMachine> | null = null;
const featureActors = new Map<string, Actor<typeof roadmapFeatureMachine>>();

/**
 * Reset all actors to clean state.
 * Use this in tests (afterEach) and HMR dispose handlers to avoid stale actors.
 */
export function resetActors(): void {
  if (generationActor) {
    generationActor.stop();
    generationActor = null;
  }
  featureActors.forEach((actor) => actor.stop());
  featureActors.clear();
}

/**
 * Get or create the singleton generation actor.
 * Optionally provide an initial state and context to restore from persisted data.
 */
function getOrCreateGenerationActor(
  initialState?: RoadmapGenerationStatus['phase'],
  initialContext?: Partial<{ progress: number; message: string; error: string; startedAt: number; completedAt: number; lastActivityAt: number }>
): Actor<typeof roadmapGenerationMachine> {
  // Invalidate cached actor if its state doesn't match the expected value
  if (generationActor && initialState) {
    const currentValue = String(generationActor.getSnapshot().value);
    if (currentValue !== initialState) {
      generationActor.stop();
      generationActor = null;
    }
  }
  if (!generationActor) {
    if (initialState) {
      const resolvedSnapshot = roadmapGenerationMachine.resolveState({
        value: initialState,
        context: {
          progress: initialContext?.progress ?? 0,
          message: initialContext?.message,
          error: initialContext?.error,
          startedAt: initialContext?.startedAt,
          completedAt: initialContext?.completedAt,
          lastActivityAt: initialContext?.lastActivityAt
        }
      });
      generationActor = createActor(roadmapGenerationMachine, { snapshot: resolvedSnapshot });
    } else {
      generationActor = createActor(roadmapGenerationMachine);
    }
    generationActor.start();
  }
  return generationActor;
}

/**
 * Get or create a feature actor for a given feature ID.
 * Optionally provide an initial state to restore from persisted data.
 */
function getOrCreateFeatureActor(
  featureId: string,
  initialState?: RoadmapFeatureStatus,
  initialContext?: Partial<{ linkedSpecId: string; taskOutcome: TaskOutcome; previousStatus: RoadmapFeatureStatus }>
): Actor<typeof roadmapFeatureMachine> {
  let actor = featureActors.get(featureId);
  // Invalidate cached actor if its state or context doesn't match the expected values
  if (actor && initialState) {
    const snapshot = actor.getSnapshot();
    const currentValue = String(snapshot.value);
    const ctx = snapshot.context;
    const contextMismatch = initialContext && (
      ctx.taskOutcome !== (initialContext.taskOutcome ?? undefined) ||
      ctx.previousStatus !== (initialContext.previousStatus ?? undefined) ||
      ctx.linkedSpecId !== (initialContext.linkedSpecId ?? undefined)
    );
    if (currentValue !== initialState || contextMismatch) {
      actor.stop();
      featureActors.delete(featureId);
      actor = undefined;
    }
  }
  if (!actor) {
    if (initialState) {
      const resolvedSnapshot = roadmapFeatureMachine.resolveState({
        value: initialState,
        context: {
          linkedSpecId: initialContext?.linkedSpecId ?? undefined,
          taskOutcome: initialContext?.taskOutcome ?? undefined,
          previousStatus: initialContext?.previousStatus ?? undefined
        }
      });
      actor = createActor(roadmapFeatureMachine, { snapshot: resolvedSnapshot });
    } else {
      actor = createActor(roadmapFeatureMachine);
    }
    actor.start();
    featureActors.set(featureId, actor);
  }
  return actor;
}

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
  markFeatureDoneBySpecId: (specId: string, taskOutcome?: TaskOutcome) => void;
  updateFeatureLinkedSpec: (featureId: string, specId: string) => void;
  deleteFeature: (featureId: string) => void;
  clearRoadmap: () => void;
  // Drag-and-drop actions
  reorderFeatures: (phaseId: string, featureIds: string[]) => void;
  updateFeaturePhase: (featureId: string, newPhaseId: string) => void;
  addFeature: (feature: Omit<RoadmapFeature, 'id'>) => string;
  addCompetitor: (input: ManualCompetitorInput) => string;
}

const initialGenerationStatus: RoadmapGenerationStatus = {
  phase: 'idle',
  progress: 0,
  message: ''
};

/**
 * Derive RoadmapGenerationStatus from the generation actor's current snapshot.
 */
function deriveGenerationStatus(actor: Actor<typeof roadmapGenerationMachine>): RoadmapGenerationStatus {
  const snapshot = actor.getSnapshot();
  const phase = mapGenerationStateToPhase(String(snapshot.value));
  const ctx = snapshot.context;
  return {
    phase,
    progress: ctx.progress,
    message: ctx.message ?? '',
    error: ctx.error,
    startedAt: ctx.startedAt ? new Date(ctx.startedAt) : undefined,
    lastActivityAt: ctx.lastActivityAt ? new Date(ctx.lastActivityAt) : undefined
  };
}

export const useRoadmapStore = create<RoadmapState>((set) => ({
  // Initial state
  roadmap: null,
  competitorAnalysis: null,
  generationStatus: initialGenerationStatus,
  currentProjectId: null,

  // Actions
  setRoadmap: (roadmap) => {
    // Prune stale actors: stop and remove actors for features not in the new roadmap
    if (roadmap) {
      const newFeatureIds = new Set(roadmap.features.map((f) => f.id));
      for (const [featureId, actor] of featureActors.entries()) {
        if (!newFeatureIds.has(featureId)) {
          actor.stop();
          featureActors.delete(featureId);
        }
      }
    } else {
      // No roadmap → cleanup all actors
      featureActors.forEach((actor) => actor.stop());
      featureActors.clear();
    }
    return set({ roadmap });
  },

  setCompetitorAnalysis: (analysis) => set({ competitorAnalysis: analysis }),

  setGenerationStatus: (status) => {
    const actor = getOrCreateGenerationActor(
      status.phase !== 'idle' ? status.phase : undefined,
      status.phase !== 'idle' ? {
        progress: status.progress,
        message: status.message,
        error: status.error,
        startedAt: status.startedAt?.getTime(),
        lastActivityAt: status.lastActivityAt?.getTime()
      } : undefined
    );

    // Map the incoming status phase to an XState event
    let event: RoadmapGenerationEvent | null = null;
    switch (status.phase) {
      case 'analyzing': {
        const currentState = String(actor.getSnapshot().value);
        if (currentState === 'idle') {
          event = { type: 'START_GENERATION' };
        } else if (currentState === 'complete' || currentState === 'error') {
          actor.send({ type: 'RESET' });
          event = { type: 'START_GENERATION' };
        }
        break;
      }
      case 'discovering': {
        // NOTE: Backward transitions (e.g., generating→discovering) are intentionally
        // unsupported. The generation pipeline is strictly forward-progressing, so XState
        // will silently drop the event if the actor is already past this phase.
        const cs = String(actor.getSnapshot().value);
        if (cs === 'idle') {
          actor.send({ type: 'START_GENERATION' });
        } else if (cs === 'complete' || cs === 'error') {
          actor.send({ type: 'RESET' });
          actor.send({ type: 'START_GENERATION' });
        }
        event = { type: 'DISCOVERY_STARTED' };
        break;
      }
      case 'generating': {
        const cs = String(actor.getSnapshot().value);
        if (cs === 'idle') {
          actor.send({ type: 'START_GENERATION' });
          actor.send({ type: 'DISCOVERY_STARTED' });
        } else if (cs === 'analyzing') {
          actor.send({ type: 'DISCOVERY_STARTED' });
        } else if (cs === 'complete' || cs === 'error') {
          actor.send({ type: 'RESET' });
          actor.send({ type: 'START_GENERATION' });
          actor.send({ type: 'DISCOVERY_STARTED' });
        }
        event = { type: 'GENERATION_STARTED' };
        break;
      }
      case 'complete': {
        const cs = String(actor.getSnapshot().value);
        // Catch-up logic: advance actor to 'generating' state before sending GENERATION_COMPLETE
        if (cs === 'idle') {
          actor.send({ type: 'START_GENERATION' });
          actor.send({ type: 'DISCOVERY_STARTED' });
          actor.send({ type: 'GENERATION_STARTED' });
        } else if (cs === 'analyzing') {
          actor.send({ type: 'DISCOVERY_STARTED' });
          actor.send({ type: 'GENERATION_STARTED' });
        } else if (cs === 'discovering') {
          actor.send({ type: 'GENERATION_STARTED' });
        } else if (cs === 'error') {
          actor.send({ type: 'RESET' });
          actor.send({ type: 'START_GENERATION' });
          actor.send({ type: 'DISCOVERY_STARTED' });
          actor.send({ type: 'GENERATION_STARTED' });
        }
        event = { type: 'GENERATION_COMPLETE' };
        break;
      }
      case 'error': {
        const cs = String(actor.getSnapshot().value);
        // Catch-up logic: GENERATION_ERROR is only handled in analyzing, discovering,
        // and generating states. Advance from idle/complete so the event isn't dropped.
        if (cs === 'idle') {
          actor.send({ type: 'START_GENERATION' });
        } else if (cs === 'complete' || cs === 'error') {
          actor.send({ type: 'RESET' });
          actor.send({ type: 'START_GENERATION' });
        }
        event = { type: 'GENERATION_ERROR', error: status.error ?? 'Unknown error' };
        break;
      }
      case 'idle': {
        // Stop or reset depending on current state
        const currentState = String(actor.getSnapshot().value);
        if (currentState === 'complete' || currentState === 'error') {
          event = { type: 'RESET' };
        } else if (currentState !== 'idle') {
          event = { type: 'STOP' };
        }
        break;
      }
    }

    if (event) {
      actor.send(event);
    }

    // Send progress updates for active states
    const currentState = String(actor.getSnapshot().value);
    if (currentState === 'analyzing' || currentState === 'discovering' || currentState === 'generating') {
      actor.send({ type: 'PROGRESS_UPDATE', progress: status.progress, message: status.message });
    }

    // Derive store state from the actor snapshot
    set({ generationStatus: deriveGenerationStatus(actor) });
  },

  setCurrentProjectId: (projectId) => set({ currentProjectId: projectId }),

  updateFeatureStatus: (featureId, status) => {
    // NOTE: getState() is called outside set() because XState actors are external
    // side effects that cannot run inside Zustand's synchronous updater. The feature
    // lookup and actor state restoration use this snapshot, with the actual state
    // write deferred to the set() call below. This is intentional architecture.
    const state = useRoadmapStore.getState();
    if (!state.roadmap) return;

    const feature = state.roadmap.features.find((f) => f.id === featureId);
    if (!feature) return;

    // Determine the XState event based on target status
    const eventMap: Record<RoadmapFeatureStatus, RoadmapFeatureEvent> = {
      planned: { type: 'PLAN' },
      in_progress: { type: 'START_PROGRESS' },
      done: { type: 'MARK_DONE' },
      under_review: { type: 'MOVE_TO_REVIEW' }
    };

    const actor = getOrCreateFeatureActor(featureId, feature.status, {
      linkedSpecId: feature.linkedSpecId,
      taskOutcome: feature.taskOutcome,
      previousStatus: feature.previousStatus
    });
    actor.send(eventMap[status]);

    const snapshot = actor.getSnapshot();
    const derivedStatus = mapFeatureStateToStatus(String(snapshot.value));
    const ctx = snapshot.context;

    // Skip store write if XState silently ignored the event (no-op transition)
    if (derivedStatus === feature.status && ctx.taskOutcome === feature.taskOutcome && ctx.previousStatus === feature.previousStatus) return;

    set((s) => {
      if (!s.roadmap) return s;
      const updatedFeatures = s.roadmap.features.map((f) =>
        f.id === featureId
          ? {
              ...f,
              status: derivedStatus,
              taskOutcome: ctx.taskOutcome,
              previousStatus: ctx.previousStatus
            }
          : f
      );
      return {
        roadmap: { ...s.roadmap, features: updatedFeatures, updatedAt: new Date() }
      };
    });
  },

  // Mark feature as done when its linked task completes
  markFeatureDoneBySpecId: (specId: string, taskOutcome: TaskOutcome = 'completed') => {
    const state = useRoadmapStore.getState();
    if (!state.roadmap) return;

    // Determine the XState event based on task outcome
    const outcomeEventMap: Record<TaskOutcome, RoadmapFeatureEvent> = {
      completed: { type: 'TASK_COMPLETED' },
      deleted: { type: 'TASK_DELETED' },
      archived: { type: 'TASK_ARCHIVED' }
    };

    const event = outcomeEventMap[taskOutcome];

    // Process actors outside set() — collect derived state per feature
    const featureUpdates = new Map<string, { status: RoadmapFeatureStatus; taskOutcome?: TaskOutcome; previousStatus?: RoadmapFeatureStatus }>();
    for (const feature of state.roadmap.features) {
      if (feature.linkedSpecId !== specId) continue;

      const actor = getOrCreateFeatureActor(feature.id, feature.status, {
        linkedSpecId: feature.linkedSpecId,
        taskOutcome: feature.taskOutcome,
        previousStatus: feature.previousStatus
      });
      actor.send(event);

      const snapshot = actor.getSnapshot();
      const ctx = snapshot.context;
      featureUpdates.set(feature.id, {
        status: mapFeatureStateToStatus(String(snapshot.value)),
        taskOutcome: ctx.taskOutcome,
        previousStatus: ctx.previousStatus
      });
    }

    if (featureUpdates.size === 0) return;

    set((s) => {
      if (!s.roadmap) return s;
      const updatedFeatures = s.roadmap.features.map((f) => {
        const update = featureUpdates.get(f.id);
        return update ? { ...f, ...update } : f;
      });
      return {
        roadmap: { ...s.roadmap, features: updatedFeatures, updatedAt: new Date() }
      };
    });
  },

  updateFeatureLinkedSpec: (featureId, specId) => {
    const state = useRoadmapStore.getState();
    if (!state.roadmap) return;

    const feature = state.roadmap.features.find((f) => f.id === featureId);
    if (!feature) return;

    const actor = getOrCreateFeatureActor(featureId, feature.status, {
      linkedSpecId: feature.linkedSpecId,
      taskOutcome: feature.taskOutcome,
      previousStatus: feature.previousStatus
    });
    actor.send({ type: 'LINK_SPEC', specId } satisfies RoadmapFeatureEvent);

    const snapshot = actor.getSnapshot();
    const derivedStatus = mapFeatureStateToStatus(String(snapshot.value));
    const ctx = snapshot.context;

    // Skip store write if nothing changed (same linkedSpecId and status)
    if (ctx.linkedSpecId === feature.linkedSpecId && derivedStatus === feature.status) return;

    set((s) => {
      if (!s.roadmap) return s;
      const updatedFeatures = s.roadmap.features.map((f) =>
        f.id === featureId
          ? { ...f, linkedSpecId: ctx.linkedSpecId, status: derivedStatus }
          : f
      );
      return {
        roadmap: { ...s.roadmap, features: updatedFeatures, updatedAt: new Date() }
      };
    });
  },

  deleteFeature: (featureId) => {
    // Stop and remove the feature's actor outside set()
    const actor = featureActors.get(featureId);
    if (actor) {
      actor.stop();
      featureActors.delete(featureId);
    }

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
    });
  },

  clearRoadmap: () => {
    // Stop all actors and clear Maps
    if (generationActor) {
      generationActor.stop();
      generationActor = null;
    }
    featureActors.forEach((actor) => {
      actor.stop();
    });
    featureActors.clear();

    return set({
      roadmap: null,
      competitorAnalysis: null,
      generationStatus: initialGenerationStatus,
      currentProjectId: null
    });
  },

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
    const newId = `feature-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
  },

  // Add a manual competitor to the competitor analysis
  addCompetitor: (input) => {
    const newId = `competitor-manual-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const newCompetitor: Competitor = {
      id: newId,
      name: input.name,
      url: input.url,
      description: input.description,
      relevance: input.relevance,
      painPoints: [],
      strengths: [],
      marketPosition: '',
      source: 'manual'
    };

    set((state) => {
      const existing = state.competitorAnalysis;
      if (existing) {
        return {
          competitorAnalysis: {
            ...existing,
            competitors: [...existing.competitors, newCompetitor]
          }
        };
      }

      // Create a new CompetitorAnalysis with sensible defaults
      return {
        competitorAnalysis: {
          projectContext: {
            projectName: '',
            projectType: '',
            targetAudience: ''
          },
          competitors: [newCompetitor],
          marketGaps: [],
          insightsSummary: {
            topPainPoints: [],
            differentiatorOpportunities: [],
            marketTrends: []
          },
          researchMetadata: {
            searchQueriesUsed: [],
            sourcesConsulted: [],
            limitations: []
          },
          createdAt: new Date()
        }
      };
    });

    return newId;
  },

}));

/**
 * Reconcile roadmap features with their linked tasks.
 * Catches cases where tasks were completed/deleted before this fix was deployed,
 * or if the app crashed mid-operation.
 */
async function reconcileLinkedFeatures(projectId: string, roadmap: Roadmap): Promise<void> {
  const store = useRoadmapStore.getState();

  // Find features that have a linkedSpecId but aren't done yet (or are done without taskOutcome)
  const featuresNeedingReconciliation = roadmap.features.filter(
    (f) => f.linkedSpecId && (f.status !== 'done' || !f.taskOutcome)
  );

  if (featuresNeedingReconciliation.length === 0) return;

  // Fetch current tasks for the project
  const tasksResult = await window.electronAPI.getTasks(projectId);
  if (!tasksResult.success || !tasksResult.data) return;

  // Guard against empty task list (e.g., specs directory temporarily inaccessible)
  // to avoid falsely marking all linked features as 'deleted'
  if (tasksResult.data.length === 0 && featuresNeedingReconciliation.length > 0) return;

  const taskMap = new Map(tasksResult.data.map((t) => [t.specId || t.id, t]));
  let hasChanges = false;

  for (const feature of featuresNeedingReconciliation) {
    // Safe: linkedSpecId is guaranteed to exist by the filter above
    const linkedSpecId = feature.linkedSpecId;
    if (!linkedSpecId) continue;

    const task = taskMap.get(linkedSpecId);

    if (!task) {
      // Task no longer exists → mark as done with deleted outcome
      if (feature.status !== 'done' || feature.taskOutcome !== 'deleted') {
        store.markFeatureDoneBySpecId(linkedSpecId, 'deleted');
        hasChanges = true;
      }
    } else if (task.status === 'done' || task.status === 'pr_created') {
      // Task is completed → mark feature as done
      if (feature.status !== 'done' || !feature.taskOutcome) {
        store.markFeatureDoneBySpecId(linkedSpecId, 'completed');
        hasChanges = true;
      }
    } else if (task.metadata?.archivedAt) {
      // Task is archived → mark feature as done with archived outcome
      if (feature.status !== 'done' || feature.taskOutcome !== 'archived') {
        store.markFeatureDoneBySpecId(linkedSpecId, 'archived');
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    const updatedRoadmap = useRoadmapStore.getState().roadmap;
    if (updatedRoadmap) {
      console.log('[Roadmap] Reconciled linked features with task states');
      window.electronAPI.saveRoadmap(projectId, updatedRoadmap).catch((err) => {
        console.error('[Roadmap] Failed to save reconciled roadmap:', err);
      });
    }
  }
}

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

    // Reconcile features with linked tasks that may have been completed/deleted
    await reconcileLinkedFeatures(projectId, migratedRoadmap);

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

// HMR cleanup: reset actors on hot module replacement
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetActors();
  });
}
