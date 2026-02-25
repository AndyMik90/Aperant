import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  Roadmap,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  PersistedRoadmapProgress,
  CompetitorAnalysis,
  Task,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Roadmap API operations
 */
export interface RoadmapAPI {
  // Operations
  getRoadmap: (projectId: string) => Promise<IPCResult<Roadmap | null>>;
  getRoadmapStatus: (projectId: string) => Promise<IPCResult<{ isRunning: boolean }>>;
  saveRoadmap: (projectId: string, roadmap: Roadmap) => Promise<IPCResult>;
  generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => void;
  refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => void;
  stopRoadmap: (projectId: string) => Promise<IPCResult>;
  updateFeatureStatus: (
    projectId: string,
    featureId: string,
    status: RoadmapFeatureStatus
  ) => Promise<IPCResult>;
  convertFeatureToSpec: (
    projectId: string,
    featureId: string
  ) => Promise<IPCResult<Task>>;

  // Competitor analysis
  saveCompetitorAnalysis: (projectId: string, competitorAnalysis: CompetitorAnalysis) => Promise<IPCResult>;

  // Progress persistence
  saveRoadmapProgress: (projectId: string, progress: PersistedRoadmapProgress) => Promise<IPCResult>;
  loadRoadmapProgress: (projectId: string) => Promise<IPCResult<PersistedRoadmapProgress | null>>;
  clearRoadmapProgress: (projectId: string) => Promise<IPCResult>;

  // Event Listeners
  onRoadmapProgress: (
    callback: (projectId: string, status: RoadmapGenerationStatus) => void
  ) => IpcListenerCleanup;
  onRoadmapComplete: (
    callback: (projectId: string, roadmap: Roadmap) => void
  ) => IpcListenerCleanup;
  onRoadmapError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
  onRoadmapStopped: (
    callback: (projectId: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Roadmap API implementation
 */
export const createRoadmapAPI = (): RoadmapAPI => ({
  // Operations
  getRoadmap: (projectId: string): Promise<IPCResult<Roadmap | null>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_GET, projectId),

  getRoadmapStatus: (projectId: string): Promise<IPCResult<{ isRunning: boolean }>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_GET_STATUS, projectId),

  saveRoadmap: (projectId: string, roadmap: Roadmap): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_SAVE, projectId, roadmap),

  generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_GENERATE, projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis),

  refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean): void =>
    sendIpc(IPC_CHANNELS.ROADMAP_REFRESH, projectId, enableCompetitorAnalysis, refreshCompetitorAnalysis),

  stopRoadmap: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_STOP, projectId),

  updateFeatureStatus: (
    projectId: string,
    featureId: string,
    status: RoadmapFeatureStatus
  ): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_UPDATE_FEATURE, projectId, featureId, status),

  convertFeatureToSpec: (
    projectId: string,
    featureId: string
  ): Promise<IPCResult<Task>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_CONVERT_TO_SPEC, projectId, featureId),

  // Competitor analysis
  saveCompetitorAnalysis: (projectId: string, competitorAnalysis: CompetitorAnalysis): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.COMPETITOR_ANALYSIS_SAVE, projectId, competitorAnalysis),

  // Progress persistence
  saveRoadmapProgress: (projectId: string, progress: PersistedRoadmapProgress): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_SAVE, projectId, progress),

  loadRoadmapProgress: (projectId: string): Promise<IPCResult<PersistedRoadmapProgress | null>> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_LOAD, projectId),

  clearRoadmapProgress: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.ROADMAP_PROGRESS_CLEAR, projectId),

  // Event Listeners
  onRoadmapProgress: (
    callback: (projectId: string, status: RoadmapGenerationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_PROGRESS, callback),

  onRoadmapComplete: (
    callback: (projectId: string, roadmap: Roadmap) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_COMPLETE, callback),

  onRoadmapError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_ERROR, callback),

  onRoadmapStopped: (
    callback: (projectId: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.ROADMAP_STOPPED, callback)
});
