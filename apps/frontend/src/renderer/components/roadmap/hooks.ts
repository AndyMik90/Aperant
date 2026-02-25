import { useEffect, useState } from 'react';
import { useRoadmapStore, loadRoadmap, generateRoadmap, refreshRoadmap, stopRoadmap } from '../../stores/roadmap-store';
import { useTaskStore } from '../../stores/task-store';
import type { RoadmapFeature } from '../../../shared/types';

/**
 * Hook to manage roadmap data and loading
 *
 * When the projectId changes, this hook:
 * 1. Loads the new project's roadmap data
 * 2. Queries the backend to check if generation is running for this project
 * 3. Restores the generation status UI state accordingly
 *
 * NOTE: Generation continues in the background when switching projects.
 * The loadRoadmap function queries the backend to restore the correct UI state.
 */
export function useRoadmapData(projectId: string) {
  const roadmap = useRoadmapStore((state) => state.roadmap);
  const competitorAnalysis = useRoadmapStore((state) => state.competitorAnalysis);
  const generationStatus = useRoadmapStore((state) => state.generationStatus);

  useEffect(() => {
    // Load roadmap data and query generation status for this project
    // The loadRoadmap function handles checking if generation is running
    // and restores the UI state accordingly
    loadRoadmap(projectId);
  }, [projectId]);

  return {
    roadmap,
    competitorAnalysis,
    generationStatus,
  };
}

/**
 * Hook to manage feature actions (convert, link, etc.)
 */
export function useFeatureActions() {
  const updateFeatureLinkedSpec = useRoadmapStore((state) => state.updateFeatureLinkedSpec);
  const addTask = useTaskStore((state) => state.addTask);

  const convertFeatureToSpec = async (
    projectId: string,
    feature: RoadmapFeature,
    selectedFeature: RoadmapFeature | null,
    setSelectedFeature: (feature: RoadmapFeature | null) => void
  ) => {
    const result = await window.electronAPI.convertFeatureToSpec(projectId, feature.id);
    if (result.success && result.data) {
      // Add the created task to the task store so it appears in the kanban immediately
      addTask(result.data);

      // Update the roadmap feature with the linked spec
      updateFeatureLinkedSpec(feature.id, result.data.specId);
      if (selectedFeature?.id === feature.id) {
        setSelectedFeature({
          ...feature,
          linkedSpecId: result.data.specId,
          status: 'in_progress',
        });
      }
    }
  };

  return {
    convertFeatureToSpec,
  };
}

/**
 * Hook to save roadmap changes to disk
 *
 * NOTE: Gets roadmap from store at call time (not render time) to ensure
 * we save the latest state after Zustand updates (e.g., after drag-drop status change)
 */
export function useRoadmapSave(projectId: string) {
  const saveRoadmap = async () => {
    // Get current state at call time to avoid stale closure issues
    const roadmap = useRoadmapStore.getState().roadmap;
    if (!roadmap) return;

    try {
      await window.electronAPI.saveRoadmap(projectId, roadmap);
    } catch (error) {
      console.error('Failed to save roadmap:', error);
    }
  };

  return { saveRoadmap };
}

/**
 * Hook to delete features from roadmap
 */
export function useFeatureDelete(projectId: string) {
  const deleteFeature = useRoadmapStore((state) => state.deleteFeature);

  const handleDeleteFeature = async (featureId: string) => {
    // Delete from store
    deleteFeature(featureId);

    // Persist to file
    const roadmap = useRoadmapStore.getState().roadmap;
    if (roadmap) {
      try {
        await window.electronAPI.saveRoadmap(projectId, roadmap);
      } catch (error) {
        console.error('Failed to save roadmap after delete:', error);
      }
    }
  };

  return { deleteFeature: handleDeleteFeature };
}


/**
 * Hook to manage roadmap generation actions
 *
 * Handles two scenarios:
 * 1. No existing competitor analysis: Show simple enable/skip dialog
 * 2. Existing competitor analysis: Show options to use existing, run new, or skip
 */
export function useRoadmapGeneration(projectId: string) {
  const competitorAnalysis = useRoadmapStore((state) => state.competitorAnalysis);
  const [pendingAction, setPendingAction] = useState<'generate' | 'refresh' | null>(null);
  const [showCompetitorDialog, setShowCompetitorDialog] = useState(false);
  const [showExistingAnalysisDialog, setShowExistingAnalysisDialog] = useState(false);

  // Check if we have existing competitor analysis
  const hasExistingAnalysis = !!competitorAnalysis;

  const handleGenerate = () => {
    setPendingAction('generate');
    if (hasExistingAnalysis) {
      setShowExistingAnalysisDialog(true);
    } else {
      setShowCompetitorDialog(true);
    }
  };

  const handleRefresh = () => {
    setPendingAction('refresh');
    if (hasExistingAnalysis) {
      setShowExistingAnalysisDialog(true);
    } else {
      setShowCompetitorDialog(true);
    }
  };

  // Handler for "Yes, Enable Analysis" (new competitor analysis)
  const handleCompetitorDialogAccept = () => {
    if (pendingAction === 'generate') {
      generateRoadmap(projectId, true); // Enable competitor analysis
    } else if (pendingAction === 'refresh') {
      refreshRoadmap(projectId, true); // Enable competitor analysis
    }
    setPendingAction(null);
  };

  // Handler for "No, Skip Analysis"
  const handleCompetitorDialogDecline = () => {
    if (pendingAction === 'generate') {
      generateRoadmap(projectId, false); // Disable competitor analysis
    } else if (pendingAction === 'refresh') {
      refreshRoadmap(projectId, false); // Disable competitor analysis
    }
    setPendingAction(null);
  };

  // Handler for "Use existing analysis" - reuses saved competitor data
  const handleUseExistingAnalysis = () => {
    // Enable competitor analysis but don't force refresh - backend will use existing if available
    if (pendingAction === 'generate') {
      generateRoadmap(projectId, true, false); // enableCompetitorAnalysis=true, refreshCompetitorAnalysis=false
    } else if (pendingAction === 'refresh') {
      refreshRoadmap(projectId, true, false); // enableCompetitorAnalysis=true, refreshCompetitorAnalysis=false
    }
    setPendingAction(null);
  };

  // Handler for "Run new analysis" - performs fresh web searches
  const handleRunNewAnalysis = () => {
    // Enable competitor analysis AND force refresh to run fresh web searches
    if (pendingAction === 'generate') {
      generateRoadmap(projectId, true, true); // enableCompetitorAnalysis=true, refreshCompetitorAnalysis=true
    } else if (pendingAction === 'refresh') {
      refreshRoadmap(projectId, true, true); // enableCompetitorAnalysis=true, refreshCompetitorAnalysis=true
    }
    setPendingAction(null);
  };

  // Handler for "Skip analysis"
  const handleSkipAnalysis = () => {
    if (pendingAction === 'generate') {
      generateRoadmap(projectId, false);
    } else if (pendingAction === 'refresh') {
      refreshRoadmap(projectId, false);
    }
    setPendingAction(null);
  };

  const handleStop = async () => {
    await stopRoadmap(projectId);
  };

  return {
    pendingAction,
    hasExistingAnalysis,
    competitorAnalysisDate: competitorAnalysis?.createdAt,
    // New dialog for existing analysis
    showExistingAnalysisDialog,
    setShowExistingAnalysisDialog,
    handleUseExistingAnalysis,
    handleRunNewAnalysis,
    handleSkipAnalysis,
    // Original dialog for no existing analysis
    showCompetitorDialog,
    setShowCompetitorDialog,
    handleGenerate,
    handleRefresh,
    handleCompetitorDialogAccept,
    handleCompetitorDialogDecline,
    handleStop,
  };
}
