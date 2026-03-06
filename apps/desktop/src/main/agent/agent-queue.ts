import path from 'path';
import { existsSync, mkdirSync, unlinkSync, promises as fsPromises } from 'fs';
import { EventEmitter } from 'events';
import { AgentState } from './agent-state';
import type { AgentEvents } from './agent-events';
import { AgentProcessManager } from './agent-process';
import { RoadmapConfig } from './types';
import type { IdeationConfig, Idea, RoadmapGenerationStatus } from '../../shared/types';
import { AUTO_BUILD_PATHS } from '../../shared/constants';
import { detectRateLimit, createSDKRateLimitInfo } from '../rate-limit-detector';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import { transformIdeaFromSnakeCase, transformSessionFromSnakeCase } from '../ipc-handlers/ideation/transformers';
import { transformRoadmapFromSnakeCase } from '../ipc-handlers/roadmap/transformers';
import type { RawIdea } from '../ipc-handlers/ideation/types';
import { debounce } from '../utils/debounce';
import { writeFileWithRetry } from '../utils/atomic-file';
import { runIdeation, IDEATION_TYPES } from '../ai/runners/ideation';
import type { IdeationType, IdeationStreamEvent } from '../ai/runners/ideation';
import { runRoadmapGeneration } from '../ai/runners/roadmap';
import type { RoadmapStreamEvent } from '../ai/runners/roadmap';
import type { ModelShorthand, ThinkingLevel } from '../ai/config/types';
import { resolvePromptsDir } from '../ai/prompts/prompt-loader';

type RoadmapPhase = RoadmapGenerationStatus['phase'];
const ROADMAP_HEARTBEAT_INTERVAL_MS = 3000;

const ROADMAP_PHASE_PROGRESS_CAPS: Record<RoadmapPhase, number> = {
  idle: 0,
  analyzing: 25,
  discovering: 55,
  generating: 90,
  complete: 100,
  error: 100,
};

function getRoadmapHeartbeatMessage(phase: RoadmapPhase): string {
  switch (phase) {
    case 'analyzing':
      return 'Analyzing project structure...';
    case 'discovering':
      return 'Discovering target audience and user needs...';
    case 'generating':
      return 'Generating roadmap features and phases...';
    case 'complete':
      return 'Roadmap generation complete';
    case 'error':
      return 'Roadmap generation failed';
    default:
      return 'Starting roadmap generation...';
  }
}

/**
 * Normalize runner-emitted roadmap phase names to the canonical UI/XState phases.
 * Supports legacy aliases emitted by the TS roadmap runner.
 */
function normalizeRoadmapPhase(rawPhase: string): RoadmapPhase {
  switch (rawPhase) {
    case 'idle':
    case 'analyzing':
    case 'discovering':
    case 'generating':
    case 'complete':
    case 'error':
      return rawPhase;
    case 'discovery':
      return 'discovering';
    case 'features':
      return 'generating';
    default:
      return 'analyzing';
  }
}

/**
 * Queue management for ideation and roadmap generation
 */
export class AgentQueueManager {
  private state: AgentState;
  private processManager: AgentProcessManager;
  private emitter: EventEmitter;
  private debouncedPersistRoadmapProgress: (
    projectPath: string,
    phase: string,
    progress: number,
    message: string,
    startedAt: string,
    isRunning: boolean
  ) => void;
  private cancelPersistRoadmapProgress: () => void;

  constructor(
    state: AgentState,
    _events: AgentEvents,
    processManager: AgentProcessManager,
    emitter: EventEmitter
  ) {
    this.state = state;
    this.processManager = processManager;
    this.emitter = emitter;

    // Create debounced version of persistRoadmapProgress (300ms, leading + trailing)
    // This limits file writes to ~3-4 per second while ensuring immediate first write
    // and final state persistence after burst of updates
    const { fn: debouncedFn, cancel } = debounce(
      this.persistRoadmapProgress.bind(this),
      300,
      { leading: true, trailing: true }
    );
    this.debouncedPersistRoadmapProgress = debouncedFn;
    this.cancelPersistRoadmapProgress = cancel;
  }

  /** Map of active AbortControllers for cancellation support */
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Persist roadmap generation progress to disk.
   * Creates generation_progress.json with current state including timestamps.
   *
   * @param projectPath - The project directory path
   * @param phase - Current generation phase
   * @param progress - Progress percentage (0-100)
   * @param message - Status message
   * @param startedAt - When generation started (ISO string)
   * @param isRunning - Whether generation is actively running
   */
  private async persistRoadmapProgress(
    projectPath: string,
    phase: RoadmapPhase,
    progress: number,
    message: string,
    startedAt: string,
    isRunning: boolean
  ): Promise<void> {
    try {
      const roadmapDir = path.join(projectPath, AUTO_BUILD_PATHS.ROADMAP_DIR);
      const progressPath = path.join(roadmapDir, AUTO_BUILD_PATHS.GENERATION_PROGRESS);

      // Ensure roadmap directory exists
      if (!existsSync(roadmapDir)) {
        mkdirSync(roadmapDir, { recursive: true });
      }

      const progressData = {
        phase,
        progress,
        message,
        started_at: startedAt,
        last_update_at: new Date().toISOString(),
        is_running: isRunning
      };

      await writeFileWithRetry(progressPath, JSON.stringify(progressData, null, 2), { encoding: 'utf-8' });
      debugLog('[Agent Queue] Persisted roadmap progress:', { phase, progress });
    } catch (err) {
      debugError('[Agent Queue] Failed to persist roadmap progress:', err);
    }
  }

  /**
   * Clear roadmap generation progress file from disk.
   * Called when generation completes, errors, or is stopped.
   *
   * @param projectPath - The project directory path
   */
  private clearRoadmapProgress(projectPath: string): void {
    // Cancel any pending debounced write to prevent re-creating the file after deletion
    this.cancelPersistRoadmapProgress();

    try {
      const progressPath = path.join(
        projectPath,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.GENERATION_PROGRESS
      );

      if (existsSync(progressPath)) {
        unlinkSync(progressPath);
        debugLog('[Agent Queue] Cleared roadmap progress file');
      }
    } catch (err) {
      debugError('[Agent Queue] Failed to clear roadmap progress:', err);
    }
  }

  /**
   * Start roadmap generation process
   *
   * @param refreshCompetitorAnalysis - Force refresh competitor analysis even if it exists.
   *   This allows refreshing competitor data independently of the general roadmap refresh.
   *   Use when user explicitly wants new competitor research.
   */
  async startRoadmapGeneration(
    projectId: string,
    projectPath: string,
    refresh: boolean = false,
    enableCompetitorAnalysis: boolean = false,
    _refreshCompetitorAnalysis: boolean = false,
    config?: RoadmapConfig
  ): Promise<void> {
    debugLog('[Agent Queue] Starting roadmap generation:', {
      projectId,
      projectPath,
      refresh,
      enableCompetitorAnalysis,
      config
    });

    // Use projectId as taskId for roadmap operations
    await this.runRoadmapRunner(projectId, projectPath, refresh, enableCompetitorAnalysis, config);
  }

  /**
   * Start ideation generation process
   */
  async startIdeationGeneration(
    projectId: string,
    projectPath: string,
    config: IdeationConfig,
    _refresh: boolean = false
  ): Promise<void> {
    debugLog('[Agent Queue] Starting ideation generation:', {
      projectId,
      projectPath,
      config
    });

    // Use projectId as taskId for ideation operations
    await this.runIdeationRunner(projectId, projectPath, config);
  }

  /**
   * Run ideation generation using the TypeScript ideation runner.
   * Replaces the previous Python subprocess spawning approach.
   */
  private async runIdeationRunner(
    projectId: string,
    projectPath: string,
    config: IdeationConfig
  ): Promise<void> {
    debugLog('[Agent Queue] Running ideation via TS runner:', { projectId, projectPath });

    // Cancel any existing ideation for this project
    const existingController = this.abortControllers.get(`ideation:${projectId}`);
    if (existingController) {
      existingController.abort();
      this.abortControllers.delete(`ideation:${projectId}`);
    }

    // Kill existing process for this project if any (legacy cleanup)
    this.processManager.killProcess(projectId);

    const abortController = new AbortController();
    this.abortControllers.set(`ideation:${projectId}`, abortController);

    // Mark as running in state
    const spawnId = this.state.generateSpawnId();
    this.state.addProcess(projectId, {
      taskId: projectId,
      process: null as unknown as import('child_process').ChildProcess,
      startedAt: new Date(),
      projectPath,
      spawnId,
      queueProcessType: 'ideation'
    });

    // Track progress
    const completedTypes = new Set<string>();
    const enabledTypes = config.enabledTypes.length > 0
      ? config.enabledTypes
      : [...IDEATION_TYPES];
    const totalTypes = enabledTypes.length;

    // Resolve prompts directory using the proper prompt-loader utility
    // which handles both dev (apps/desktop/prompts/) and production (resourcesPath/prompts/)
    const promptsDir = resolvePromptsDir();

    const outputDir = path.join(projectPath, '.auto-claude', 'ideation');

    // Emit initial progress
    this.emitter.emit('ideation-progress', projectId, {
      phase: 'analyzing',
      progress: 10,
      message: 'Starting ideation generation...',
      completedTypes: []
    });

    // Run each ideation type sequentially (matches Python runner behavior)
    for (const ideationType of enabledTypes) {
      if (abortController.signal.aborted) {
        debugLog('[Agent Queue] Ideation aborted before type:', ideationType);
        break;
      }

      const typeProgress = Math.round(10 + (completedTypes.size / totalTypes) * 80);
      this.emitter.emit('ideation-progress', projectId, {
        phase: 'generating',
        progress: typeProgress,
        message: `Generating ${ideationType} ideas...`,
        completedTypes: Array.from(completedTypes)
      });
      this.emitter.emit('ideation-log', projectId, `Starting ${ideationType}...`);

      try {
        const result = await runIdeation(
          {
            projectDir: projectPath,
            outputDir,
            promptsDir,
            ideationType: ideationType as IdeationType,
            modelShorthand: (config.model || 'sonnet') as ModelShorthand,
            thinkingLevel: (config.thinkingLevel || 'medium') as ThinkingLevel,
            maxIdeasPerType: config.maxIdeasPerType || 5,
            abortSignal: abortController.signal,
          },
          (event: IdeationStreamEvent) => {
            if (event.type === 'text-delta') {
              this.emitter.emit('ideation-log', projectId, event.text);
            }
          }
        );

        if (result.success) {
          completedTypes.add(ideationType);
          debugLog('[Agent Queue] Ideation type completed:', { projectId, ideationType });

          // Load and emit type-specific ideas
          const typeFilePath = path.join(outputDir, `${ideationType}_ideas.json`);
          try {
            const content = await fsPromises.readFile(typeFilePath, 'utf-8');
            const data: Record<string, RawIdea[]> = JSON.parse(content);
            const rawIdeas: RawIdea[] = data[ideationType] || [];
            const ideas: Idea[] = rawIdeas.map(transformIdeaFromSnakeCase);
            this.emitter.emit('ideation-type-complete', projectId, ideationType, ideas);
          } catch (err) {
            debugError('[Agent Queue] Failed to load ideas for type:', ideationType, err);
            this.emitter.emit('ideation-type-complete', projectId, ideationType, []);
          }
        } else {
          debugError('[Agent Queue] Ideation type failed:', { projectId, ideationType, error: result.error });
          this.emitter.emit('ideation-type-failed', projectId, ideationType);

          // Check for rate limit
          if (result.error) {
            const rateLimitDetection = detectRateLimit(result.error);
            if (rateLimitDetection.isRateLimited) {
              const rateLimitInfo = createSDKRateLimitInfo('ideation', rateLimitDetection, { projectId });
              this.emitter.emit('sdk-rate-limit', rateLimitInfo);
            }
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          debugLog('[Agent Queue] Ideation type aborted:', ideationType);
          break;
        }
        debugError('[Agent Queue] Ideation type error:', { ideationType, err });
        this.emitter.emit('ideation-type-failed', projectId, ideationType);
      }
    }

    // Clean up
    this.abortControllers.delete(`ideation:${projectId}`);
    this.state.deleteProcess(projectId);

    if (abortController.signal.aborted) {
      this.emitter.emit('ideation-stopped', projectId);
      return;
    }

    // Emit completion
    this.emitter.emit('ideation-progress', projectId, {
      phase: 'complete',
      progress: 100,
      message: 'Ideation generation complete',
      completedTypes: Array.from(completedTypes)
    });

    // Load and emit the complete ideation session
    try {
      const ideationFilePath = path.join(outputDir, 'ideation.json');
      if (existsSync(ideationFilePath)) {
        const content = await fsPromises.readFile(ideationFilePath, 'utf-8');
        const rawSession = JSON.parse(content);
        const session = transformSessionFromSnakeCase(rawSession, projectId);
        debugLog('[Agent Queue] Loaded ideation session:', { totalIdeas: session.ideas?.length || 0 });
        this.emitter.emit('ideation-complete', projectId, session);
      } else {
        debugLog('[Agent Queue] ideation.json not found, individual type files used');
        this.emitter.emit('ideation-complete', projectId, null);
      }
    } catch (err) {
      debugError('[Agent Queue] Failed to load ideation session:', err);
      this.emitter.emit('ideation-error', projectId,
        `Failed to load ideation session: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Run roadmap generation using the TypeScript roadmap runner.
   * Replaces the previous Python subprocess spawning approach.
   */
  private async runRoadmapRunner(
    projectId: string,
    projectPath: string,
    refresh: boolean,
    enableCompetitorAnalysis: boolean,
    config?: RoadmapConfig
  ): Promise<void> {
    debugLog('[Agent Queue] Running roadmap via TS runner:', { projectId, projectPath });

    // Cancel any existing roadmap for this project
    const existingController = this.abortControllers.get(`roadmap:${projectId}`);
    if (existingController) {
      existingController.abort();
      this.abortControllers.delete(`roadmap:${projectId}`);
    }

    // Kill existing process for this project if any (legacy cleanup)
    this.processManager.killProcess(projectId);

    const abortController = new AbortController();
    this.abortControllers.set(`roadmap:${projectId}`, abortController);

    // Mark as running in state
    const spawnId = this.state.generateSpawnId();
    this.state.addProcess(projectId, {
      taskId: projectId,
      process: null as unknown as import('child_process').ChildProcess,
      startedAt: new Date(),
      projectPath,
      spawnId,
      queueProcessType: 'roadmap'
    });

    // Track progress
    let progressPhase: RoadmapPhase = 'analyzing';
    let progressPercent = 10;
    const roadmapStartedAt = new Date().toISOString();
    let lastHeartbeatAt = 0;

    // Persist initial progress
    this.debouncedPersistRoadmapProgress(
      projectPath,
      progressPhase,
      progressPercent,
      'Starting roadmap generation...',
      roadmapStartedAt,
      true
    );

    // Emit initial progress
    this.emitter.emit('roadmap-progress', projectId, {
      phase: progressPhase,
      progress: progressPercent,
      message: 'Starting roadmap generation...'
    });

    const emitRoadmapHeartbeat = (message?: string, trickleProgress: boolean = false): void => {
      const now = Date.now();
      if (now - lastHeartbeatAt < ROADMAP_HEARTBEAT_INTERVAL_MS) return;
      lastHeartbeatAt = now;

      if (trickleProgress) {
        const cap = ROADMAP_PHASE_PROGRESS_CAPS[progressPhase];
        if (progressPercent < cap) {
          progressPercent = Math.min(progressPercent + 1, cap);
        }
      }

      const heartbeatMessage = message ?? getRoadmapHeartbeatMessage(progressPhase);
      this.emitter.emit('roadmap-progress', projectId, {
        phase: progressPhase,
        progress: progressPercent,
        message: heartbeatMessage
      });
      this.debouncedPersistRoadmapProgress(
        projectPath,
        progressPhase,
        progressPercent,
        heartbeatMessage,
        roadmapStartedAt,
        true
      );
    };

    try {
      const result = await runRoadmapGeneration(
        {
          projectDir: projectPath,
          modelShorthand: (config?.model || 'sonnet') as ModelShorthand,
          thinkingLevel: (config?.thinkingLevel || 'medium') as ThinkingLevel,
          refresh,
          enableCompetitorAnalysis,
          abortSignal: abortController.signal,
        },
        (event: RoadmapStreamEvent) => {
          switch (event.type) {
            case 'phase-start': {
              progressPhase = normalizeRoadmapPhase(event.phase);
              progressPercent = Math.min(progressPercent + 20, 90);
              const msg = `Running ${progressPhase} phase...`;
              this.emitter.emit('roadmap-log', projectId, msg);
              this.emitter.emit('roadmap-progress', projectId, {
                phase: progressPhase,
                progress: progressPercent,
                message: msg
              });
              this.debouncedPersistRoadmapProgress(
                projectPath, progressPhase, progressPercent, msg, roadmapStartedAt, true
              );
              break;
            }
            case 'phase-complete': {
              const msg = `Phase ${event.phase} ${event.success ? 'completed' : 'failed'}`;
              this.emitter.emit('roadmap-log', projectId, msg);
              break;
            }
            case 'text-delta': {
              this.emitter.emit('roadmap-log', projectId, event.text);
              emitRoadmapHeartbeat(undefined, true);
              break;
            }
            case 'tool-use': {
              const msg = `Using tool: ${event.name}`;
              this.emitter.emit('roadmap-log', projectId, msg);
              emitRoadmapHeartbeat(msg, true);
              break;
            }
            case 'error': {
              this.emitter.emit('roadmap-log', projectId, `Error: ${event.error}`);
              break;
            }
          }
        }
      );

      // Clean up
      this.abortControllers.delete(`roadmap:${projectId}`);
      this.state.deleteProcess(projectId);

      if (abortController.signal.aborted) {
        this.clearRoadmapProgress(projectPath);
        this.emitter.emit('roadmap-stopped', projectId);
        return;
      }

      if (result.success) {
        debugLog('[Agent Queue] Roadmap generation completed successfully');
        this.emitter.emit('roadmap-progress', projectId, {
          phase: 'complete',
          progress: 100,
          message: 'Roadmap generation complete'
        });
        this.clearRoadmapProgress(projectPath);

        // Load and emit the complete roadmap
        const roadmapFilePath = path.join(projectPath, '.auto-claude', 'roadmap', 'roadmap.json');
        if (existsSync(roadmapFilePath)) {
          try {
            const content = await fsPromises.readFile(roadmapFilePath, 'utf-8');
            const rawRoadmap = JSON.parse(content);
            const transformedRoadmap = transformRoadmapFromSnakeCase(rawRoadmap, projectId);
            debugLog('[Agent Queue] Loaded roadmap:', {
              featuresCount: transformedRoadmap.features?.length || 0,
              phasesCount: transformedRoadmap.phases?.length || 0
            });
            this.emitter.emit('roadmap-complete', projectId, transformedRoadmap);
          } catch (err) {
            debugError('[Roadmap] Failed to load roadmap:', err);
            this.emitter.emit('roadmap-error', projectId,
              `Failed to load roadmap: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else {
          debugError('[Roadmap] roadmap.json not found');
          this.emitter.emit('roadmap-error', projectId, 'Roadmap completed but file not found.');
        }
      } else {
        debugError('[Agent Queue] Roadmap generation failed:', { projectId, error: result.error });
        this.clearRoadmapProgress(projectPath);

        // Check for rate limit
        if (result.error) {
          const rateLimitDetection = detectRateLimit(result.error);
          if (rateLimitDetection.isRateLimited) {
            const rateLimitInfo = createSDKRateLimitInfo('roadmap', rateLimitDetection, { projectId });
            this.emitter.emit('sdk-rate-limit', rateLimitInfo);
          }
        }

        this.emitter.emit('roadmap-error', projectId,
          result.error || 'Roadmap generation failed');
      }
    } catch (err) {
      this.abortControllers.delete(`roadmap:${projectId}`);
      this.state.deleteProcess(projectId);
      this.clearRoadmapProgress(projectPath);

      if (abortController.signal.aborted) {
        this.emitter.emit('roadmap-stopped', projectId);
        return;
      }

      debugError('[Agent Queue] Roadmap runner error:', err);
      this.emitter.emit('roadmap-error', projectId,
        `Roadmap generation error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop ideation generation for a project
   */
  stopIdeation(projectId: string): boolean {
    debugLog('[Agent Queue] Stop ideation requested:', { projectId });

    // Try TS runner abort first
    const controller = this.abortControllers.get(`ideation:${projectId}`);
    if (controller) {
      debugLog('[Agent Queue] Aborting ideation TS runner:', projectId);
      controller.abort();
      this.abortControllers.delete(`ideation:${projectId}`);
      // Note: the runner's async loop will handle cleanup and emit ideation-stopped
      return true;
    }

    // Fallback: check for legacy process
    const processInfo = this.state.getProcess(projectId);
    const isIdeation = processInfo?.queueProcessType === 'ideation';
    if (isIdeation) {
      debugLog('[Agent Queue] Killing legacy ideation process:', projectId);
      this.processManager.killProcess(projectId);
      this.emitter.emit('ideation-stopped', projectId);
      return true;
    }

    debugLog('[Agent Queue] No running ideation process found for:', projectId);
    return false;
  }

  /**
   * Check if ideation is running for a project
   */
  isIdeationRunning(projectId: string): boolean {
    if (this.abortControllers.has(`ideation:${projectId}`)) return true;
    const processInfo = this.state.getProcess(projectId);
    return processInfo?.queueProcessType === 'ideation';
  }

  /**
   * Stop roadmap generation for a project
   */
  stopRoadmap(projectId: string): boolean {
    debugLog('[Agent Queue] Stop roadmap requested:', { projectId });

    // Try TS runner abort first
    const controller = this.abortControllers.get(`roadmap:${projectId}`);
    if (controller) {
      debugLog('[Agent Queue] Aborting roadmap TS runner:', projectId);
      controller.abort();
      this.abortControllers.delete(`roadmap:${projectId}`);
      // Note: the runner's async method will handle cleanup and emit roadmap-stopped
      return true;
    }

    // Fallback: check for legacy process
    const processInfo = this.state.getProcess(projectId);
    const isRoadmap = processInfo?.queueProcessType === 'roadmap';
    if (isRoadmap) {
      debugLog('[Agent Queue] Killing legacy roadmap process:', projectId);
      this.processManager.killProcess(projectId);
      this.emitter.emit('roadmap-stopped', projectId);
      return true;
    }

    debugLog('[Agent Queue] No running roadmap process found for:', projectId);
    return false;
  }

  /**
   * Check if roadmap is running for a project
   */
  isRoadmapRunning(projectId: string): boolean {
    if (this.abortControllers.has(`roadmap:${projectId}`)) return true;
    const processInfo = this.state.getProcess(projectId);
    return processInfo?.queueProcessType === 'roadmap';
  }
}
