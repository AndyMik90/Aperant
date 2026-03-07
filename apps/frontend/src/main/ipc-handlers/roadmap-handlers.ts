import { ipcMain, app } from "electron";
import type { BrowserWindow } from "electron";
import {
  IPC_CHANNELS,
  AUTO_BUILD_PATHS,
  getSpecsDir,
  DEFAULT_APP_SETTINGS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from "../../shared/constants";
import type {
  IPCResult,
  Roadmap,
  RoadmapFeatureStatus,
  RoadmapGenerationStatus,
  PersistedRoadmapProgress,
  Task,
  TaskMetadata,
  CompetitorAnalysis,
  AppSettings,
} from "../../shared/types";
import type { RoadmapConfig } from "../agent/types";
import path from "path";
import { existsSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { projectStore } from "../project-store";
import { AgentManager } from "../agent";
import { debugLog, debugError } from "../../shared/utils/debug-logger";
import { safeSendToRenderer } from "./utils";
import { writeFileWithRetry, readFileWithRetry } from "../utils/atomic-file";
import { withFileLock } from "../utils/file-lock";

/**
 * Read feature settings from the settings file
 */
function getFeatureSettings(): { model?: string; thinkingLevel?: string } {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");

  try {
    const content = readFileSync(settingsPath, "utf-8");
    const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };

    // Get roadmap-specific settings
    const featureModels = settings.featureModels || DEFAULT_FEATURE_MODELS;
    const featureThinking = settings.featureThinking || DEFAULT_FEATURE_THINKING;

    return {
      model: featureModels.roadmap,
      thinkingLevel: featureThinking.roadmap,
    };
  } catch (error) {
    // Return defaults if settings file doesn't exist (ENOENT) or fails to parse
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      debugError("[Roadmap Handler] Failed to read feature settings:", error);
    }
  }

  return {
    model: DEFAULT_FEATURE_MODELS.roadmap,
    thinkingLevel: DEFAULT_FEATURE_THINKING.roadmap,
  };
}

/**
 * Register all roadmap-related IPC handlers
 */
export function registerRoadmapHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Roadmap Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_GET,
    async (_, projectId: string): Promise<IPCResult<Roadmap | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.ROADMAP_FILE
      );

      if (!existsSync(roadmapPath)) {
        return { success: true, data: null };
      }

      try {
        const content = await readFileWithRetry(roadmapPath, { encoding: "utf-8" }) as string;
        const rawRoadmap = JSON.parse(content);

        // Load competitor analysis if available (competitor_analysis.json)
        const competitorAnalysisPath = path.join(
          project.path,
          AUTO_BUILD_PATHS.ROADMAP_DIR,
          AUTO_BUILD_PATHS.COMPETITOR_ANALYSIS
        );
        let competitorAnalysis: CompetitorAnalysis | undefined;
        if (existsSync(competitorAnalysisPath)) {
          try {
            const competitorContent = await readFileWithRetry(competitorAnalysisPath, { encoding: "utf-8" }) as string;
            const rawCompetitor = JSON.parse(competitorContent);
            // Transform snake_case to camelCase for frontend
            competitorAnalysis = {
              projectContext: {
                projectName: rawCompetitor.project_context?.project_name || "",
                projectType: rawCompetitor.project_context?.project_type || "",
                targetAudience: rawCompetitor.project_context?.target_audience || "",
              },
              competitors: (rawCompetitor.competitors || []).map((c: Record<string, unknown>) => ({
                id: c.id,
                name: c.name,
                url: c.url,
                description: c.description,
                relevance: c.relevance || "medium",
                painPoints: ((c.pain_points as Array<Record<string, unknown>>) || []).map((p) => ({
                  id: p.id,
                  description: p.description,
                  source: p.source,
                  severity: p.severity || "medium",
                  frequency: p.frequency || "",
                  opportunity: p.opportunity || "",
                })),
                strengths: (c.strengths as string[]) || [],
                marketPosition: (c.market_position as string) || "",
                source: c.source || undefined,
              })),
              marketGaps: (rawCompetitor.market_gaps || []).map((g: Record<string, unknown>) => ({
                id: g.id,
                description: g.description,
                affectedCompetitors: (g.affected_competitors as string[]) || [],
                opportunitySize: g.opportunity_size || "medium",
                suggestedFeature: (g.suggested_feature as string) || "",
              })),
              insightsSummary: {
                topPainPoints: rawCompetitor.insights_summary?.top_pain_points || [],
                differentiatorOpportunities:
                  rawCompetitor.insights_summary?.differentiator_opportunities || [],
                marketTrends: rawCompetitor.insights_summary?.market_trends || [],
              },
              researchMetadata: {
                searchQueriesUsed: rawCompetitor.research_metadata?.search_queries_used || [],
                sourcesConsulted: rawCompetitor.research_metadata?.sources_consulted || [],
                limitations: rawCompetitor.research_metadata?.limitations || [],
              },
              createdAt: rawCompetitor.metadata?.created_at
                ? new Date(rawCompetitor.metadata.created_at)
                : new Date(),
            };
          } catch {
            // Ignore competitor analysis parsing errors - it's optional
          }
        }

        // Transform snake_case to camelCase for frontend
        const roadmap: Roadmap = {
          id: rawRoadmap.id || `roadmap-${Date.now()}`,
          projectId,
          projectName: rawRoadmap.project_name || project.name,
          version: rawRoadmap.version || "1.0",
          vision: rawRoadmap.vision || "",
          targetAudience: {
            primary: rawRoadmap.target_audience?.primary || "",
            secondary: rawRoadmap.target_audience?.secondary || [],
          },
          phases: (rawRoadmap.phases || []).map((phase: Record<string, unknown>) => ({
            id: phase.id,
            name: phase.name,
            description: phase.description,
            order: phase.order,
            status: phase.status || "planned",
            features: phase.features || [],
            milestones: ((phase.milestones as Array<Record<string, unknown>>) || []).map((m) => ({
              id: m.id,
              title: m.title,
              description: m.description,
              features: m.features || [],
              status: m.status || "planned",
              targetDate: m.target_date ? new Date(m.target_date as string) : undefined,
            })),
          })),
          features: (rawRoadmap.features || []).map((feature: Record<string, unknown>) => ({
            id: feature.id,
            title: feature.title,
            description: feature.description,
            rationale: feature.rationale || "",
            priority: feature.priority || "should",
            complexity: feature.complexity || "medium",
            impact: feature.impact || "medium",
            phaseId: feature.phase_id,
            dependencies: feature.dependencies || [],
            status: feature.status || "under_review",
            acceptanceCriteria: feature.acceptance_criteria || [],
            userStories: feature.user_stories || [],
            linkedSpecId: feature.linked_spec_id,
            taskOutcome: feature.task_outcome,
            previousStatus: feature.previous_status,
            competitorInsightIds: (feature.competitor_insight_ids as string[]) || undefined,
          })),
          status: rawRoadmap.status || "draft",
          competitorAnalysis,
          createdAt: rawRoadmap.metadata?.created_at
            ? new Date(rawRoadmap.metadata.created_at)
            : new Date(),
          updatedAt: rawRoadmap.metadata?.updated_at
            ? new Date(rawRoadmap.metadata.updated_at)
            : new Date(),
        };

        return { success: true, data: roadmap };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to read roadmap",
        };
      }
    }
  );

  // Get roadmap generation status - allows frontend to query if generation is running
  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_GET_STATUS,
    async (_, projectId: string): Promise<IPCResult<{ isRunning: boolean }>> => {
      const isRunning = agentManager.isRoadmapRunning(projectId);
      debugLog("[Roadmap Handler] Get status:", { projectId, isRunning });
      return { success: true, data: { isRunning } };
    }
  );

  ipcMain.on(
    IPC_CHANNELS.ROADMAP_GENERATE,
    (
      _,
      projectId: string,
      enableCompetitorAnalysis?: boolean,
      refreshCompetitorAnalysis?: boolean
    ) => {
      // Get feature settings for roadmap
      const featureSettings = getFeatureSettings();
      const config: RoadmapConfig = {
        model: featureSettings.model,
        thinkingLevel: featureSettings.thinkingLevel,
      };

      debugLog("[Roadmap Handler] Generate request:", {
        projectId,
        enableCompetitorAnalysis,
        refreshCompetitorAnalysis,
        config,
      });

      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(projectId);
      if (!project) {
        debugError("[Roadmap Handler] Project not found:", projectId);
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.ROADMAP_ERROR,
          projectId,
          "Project not found"
        );
        return;
      }

      debugLog("[Roadmap Handler] Starting agent manager generation:", {
        projectId,
        projectPath: project.path,
        config,
      });

      // Start roadmap generation via agent manager
      agentManager.startRoadmapGeneration(
        projectId,
        project.path,
        false, // refresh (not a refresh operation)
        enableCompetitorAnalysis ?? false,
        refreshCompetitorAnalysis ?? false,
        config
      );

      // Send initial progress
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_PROGRESS, projectId, {
        phase: "analyzing",
        progress: 10,
        message: "Analyzing project structure...",
      } as RoadmapGenerationStatus);
    }
  );

  ipcMain.on(
    IPC_CHANNELS.ROADMAP_REFRESH,
    (
      _,
      projectId: string,
      enableCompetitorAnalysis?: boolean,
      refreshCompetitorAnalysis?: boolean
    ) => {
      // Get feature settings for roadmap
      const featureSettings = getFeatureSettings();
      const config: RoadmapConfig = {
        model: featureSettings.model,
        thinkingLevel: featureSettings.thinkingLevel,
      };

      debugLog("[Roadmap Handler] Refresh request:", {
        projectId,
        enableCompetitorAnalysis,
        refreshCompetitorAnalysis,
        config,
      });

      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.ROADMAP_ERROR,
          projectId,
          "Project not found"
        );
        return;
      }

      // Start roadmap regeneration with refresh flag
      agentManager.startRoadmapGeneration(
        projectId,
        project.path,
        true, // refresh (this is a refresh operation)
        enableCompetitorAnalysis ?? false,
        refreshCompetitorAnalysis ?? false,
        config
      );

      // Send initial progress
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_PROGRESS, projectId, {
        phase: "analyzing",
        progress: 10,
        message: "Refreshing roadmap...",
      } as RoadmapGenerationStatus);
    }
  );

  ipcMain.handle(IPC_CHANNELS.ROADMAP_STOP, async (_, projectId: string): Promise<IPCResult> => {
    debugLog("[Roadmap Handler] Stop generation request:", { projectId });

    // Stop roadmap generation for this project
    const wasStopped = agentManager.stopRoadmap(projectId);

    debugLog("[Roadmap Handler] Stop result:", { projectId, wasStopped });

    if (wasStopped) {
      debugLog("[Roadmap Handler] Sending stopped event to renderer");
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_STOPPED, projectId);
    }

    return { success: wasStopped };
  });

  // ============================================
  // Roadmap Save (full state persistence for drag-and-drop)
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_SAVE,
    async (_, projectId: string, roadmapData: Roadmap): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.ROADMAP_FILE
      );

      try {
        return await withFileLock(roadmapPath, async () => {
          let content: string;
          try {
            content = await readFileWithRetry(roadmapPath, { encoding: "utf-8" }) as string;
          } catch (readErr: unknown) {
            if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
              return { success: false, error: "Roadmap not found" };
            }
            throw readErr;
          }
          const existingRoadmap = JSON.parse(content);

          // Transform camelCase features back to snake_case for JSON file
          existingRoadmap.features = roadmapData.features.map((feature) => ({
            id: feature.id,
            title: feature.title,
            description: feature.description,
            rationale: feature.rationale || "",
            priority: feature.priority,
            complexity: feature.complexity,
            impact: feature.impact,
            phase_id: feature.phaseId,
            dependencies: feature.dependencies || [],
            status: feature.status,
            acceptance_criteria: feature.acceptanceCriteria || [],
            user_stories: feature.userStories || [],
            linked_spec_id: feature.linkedSpecId,
            task_outcome: feature.taskOutcome,
            previous_status: feature.previousStatus,
            competitor_insight_ids: feature.competitorInsightIds,
          }));

          // Update metadata timestamp
          existingRoadmap.metadata = existingRoadmap.metadata || {};
          existingRoadmap.metadata.updated_at = new Date().toISOString();

          await writeFileWithRetry(roadmapPath, JSON.stringify(existingRoadmap, null, 2), { encoding: 'utf-8' });

          return { success: true };
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save roadmap",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_UPDATE_FEATURE,
    async (
      _,
      projectId: string,
      featureId: string,
      status: RoadmapFeatureStatus
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.ROADMAP_FILE
      );

      try {
        return await withFileLock(roadmapPath, async () => {
          let content: string;
          try {
            content = await readFileWithRetry(roadmapPath, { encoding: "utf-8" }) as string;
          } catch (readErr: unknown) {
            if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
              return { success: false, error: "Roadmap not found" };
            }
            throw readErr;
          }
          const roadmap = JSON.parse(content);

          // Find and update the feature
          const feature = roadmap.features?.find((f: { id: string }) => f.id === featureId);
          if (!feature) {
            return { success: false, error: "Feature not found" };
          }

          feature.status = status;
          if (status !== 'done') {
            delete feature.task_outcome;
            delete feature.previous_status;
          }
          roadmap.metadata = roadmap.metadata || {};
          roadmap.metadata.updated_at = new Date().toISOString();

          await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });

          return { success: true };
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update feature",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_CONVERT_TO_SPEC,
    async (_, projectId: string, featureId: string): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.ROADMAP_FILE
      );

      try {
        return await withFileLock(roadmapPath, async () => {
        let content: string;
        try {
          content = await readFileWithRetry(roadmapPath, { encoding: "utf-8" }) as string;
        } catch (readErr: unknown) {
          if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
            return { success: false, error: "Roadmap not found" };
          }
          throw readErr;
        }
        const roadmap = JSON.parse(content);

        // Find the feature
        const feature = roadmap.features?.find((f: { id: string }) => f.id === featureId);
        if (!feature) {
          return { success: false, error: "Feature not found" };
        }

        // Build task description from feature
        const taskDescription = `# ${feature.title}

${feature.description}

## Rationale
${feature.rationale || "N/A"}

## User Stories
${(feature.user_stories || []).map((s: string) => `- ${s}`).join("\n") || "N/A"}

## Acceptance Criteria
${(feature.acceptance_criteria || []).map((c: string) => `- [ ] ${c}`).join("\n") || "N/A"}
`;

        // Generate proper spec directory (like task creation)
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);

        // Ensure specs directory exists
        if (!existsSync(specsDir)) {
          mkdirSync(specsDir, { recursive: true });
        }

        // Find next available spec number
        let specNumber = 1;
        const existingDirs = existsSync(specsDir)
          ? readdirSync(specsDir, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => d.name)
          : [];
        const existingNumbers = existingDirs
          .map((name) => {
            const match = name.match(/^(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((n) => n > 0);
        if (existingNumbers.length > 0) {
          specNumber = Math.max(...existingNumbers) + 1;
        }

        // Create spec ID with zero-padded number and slugified title
        const slugifiedTitle = feature.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 50);
        const specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;

        // Create spec directory
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });

        // Create initial implementation_plan.json
        const now = new Date().toISOString();
        const implementationPlan = {
          feature: feature.title,
          description: taskDescription,
          created_at: now,
          updated_at: now,
          status: "pending",
          phases: [],
        };
        await writeFileWithRetry(
          path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
          JSON.stringify(implementationPlan, null, 2),
          { encoding: 'utf-8' }
        );

        // Create requirements.json
        const requirements = {
          task_description: taskDescription,
          workflow_type: "feature",
        };
        await writeFileWithRetry(
          path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS),
          JSON.stringify(requirements, null, 2),
          { encoding: 'utf-8' }
        );

        // Create spec.md (required by backend spec creation process)
        await writeFileWithRetry(path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE), taskDescription, { encoding: 'utf-8' });

        // Build metadata
        const metadata: TaskMetadata = {
          sourceType: "roadmap",
          featureId: feature.id,
          category: "feature",
        };
        await writeFileWithRetry(path.join(specDir, "task_metadata.json"), JSON.stringify(metadata, null, 2), { encoding: 'utf-8' });

        // NOTE: We do NOT auto-start spec creation here - user should explicitly start the task
        // from the kanban board when they're ready

        // Update feature with linked spec
        feature.status = "planned";
        feature.linked_spec_id = specId;
        roadmap.metadata = roadmap.metadata || {};
        roadmap.metadata.updated_at = new Date().toISOString();
        await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });

        // Create task object
        const task: Task = {
          id: specId,
          specId: specId,
          projectId,
          title: feature.title,
          description: taskDescription,
          status: "backlog",
          subtasks: [],
          logs: [],
          metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return { success: true, data: task };
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to convert feature to spec",
        };
      }
    }
  );

  // ============================================
  // Roadmap Progress Persistence
  // Note: SAVE and CLEAR handlers are exposed for API completeness and future use.
  // Currently, progress is saved internally by agent-queue.ts and cleared when
  // generation completes. The LOAD handler is used by the renderer to restore
  // persisted progress state on app restart or project switch.
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_PROGRESS_SAVE,
    async (
      _,
      projectId: string,
      progressData: PersistedRoadmapProgress
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapDir = path.join(project.path, AUTO_BUILD_PATHS.ROADMAP_DIR);
      const progressPath = path.join(roadmapDir, AUTO_BUILD_PATHS.GENERATION_PROGRESS);

      try {
        // Ensure roadmap directory exists
        if (!existsSync(roadmapDir)) {
          mkdirSync(roadmapDir, { recursive: true });
        }

        // Derive isRunning from phase (active phases are running)
        const isRunning = progressData.phase !== 'idle' && progressData.phase !== 'complete' && progressData.phase !== 'error';

        // Transform camelCase to snake_case for JSON file
        const fileData = {
          phase: progressData.phase,
          progress: progressData.progress,
          message: progressData.message,
          started_at: progressData.startedAt || new Date().toISOString(),
          last_update_at: progressData.lastActivityAt || new Date().toISOString(),
          is_running: isRunning,
        };

        await writeFileWithRetry(progressPath, JSON.stringify(fileData, null, 2), { encoding: 'utf-8' });
        debugLog("[Roadmap Handler] Saved progress checkpoint:", { projectId, phase: progressData.phase });

        return { success: true };
      } catch (error) {
        debugError("[Roadmap Handler] Failed to save progress:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save progress",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_PROGRESS_LOAD,
    async (
      _,
      projectId: string
    ): Promise<IPCResult<PersistedRoadmapProgress | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const progressPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.GENERATION_PROGRESS
      );

      if (!existsSync(progressPath)) {
        return { success: true, data: null };
      }

      try {
        const content = await readFileWithRetry(progressPath, { encoding: "utf-8" }) as string;
        const rawData = JSON.parse(content);

        // Valid phase values that the frontend expects
        const validPhases = ['idle', 'analyzing', 'discovering', 'generating', 'complete', 'error'];

        // Validate required fields exist and phase is valid
        if (!rawData.phase || typeof rawData.progress !== 'number' || !validPhases.includes(rawData.phase)) {
          debugLog("[Roadmap Handler] Invalid progress file structure or phase, ignoring:", { projectId, phase: rawData.phase });
          return { success: true, data: null };
        }

        // Transform snake_case to camelCase for frontend
        const progressData: PersistedRoadmapProgress = {
          phase: rawData.phase,
          progress: rawData.progress,
          message: rawData.message || '',
          startedAt: rawData.started_at,
          lastActivityAt: rawData.last_update_at,
        };

        debugLog("[Roadmap Handler] Loaded progress checkpoint:", { projectId, phase: progressData.phase });

        return { success: true, data: progressData };
      } catch (error) {
        debugError("[Roadmap Handler] Failed to load progress:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to load progress",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ROADMAP_PROGRESS_CLEAR,
    async (_, projectId: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const progressPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.GENERATION_PROGRESS
      );

      try {
        if (existsSync(progressPath)) {
          unlinkSync(progressPath);
          debugLog("[Roadmap Handler] Cleared progress checkpoint:", { projectId });
        }
        return { success: true };
      } catch (error) {
        debugError("[Roadmap Handler] Failed to clear progress:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to clear progress",
        };
      }
    }
  );

  // ============================================
  // Competitor Analysis Save
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.COMPETITOR_ANALYSIS_SAVE,
    async (
      _,
      projectId: string,
      competitorAnalysis: CompetitorAnalysis
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapDir = path.join(project.path, AUTO_BUILD_PATHS.ROADMAP_DIR);
      const competitorAnalysisPath = path.join(
        roadmapDir,
        AUTO_BUILD_PATHS.COMPETITOR_ANALYSIS
      );

      try {
        // Ensure roadmap directory exists
        if (!existsSync(roadmapDir)) {
          mkdirSync(roadmapDir, { recursive: true });
        }

        await withFileLock(competitorAnalysisPath, async () => {
          // Transform camelCase to snake_case for JSON file
          const serialized = {
            project_context: {
              project_name: competitorAnalysis.projectContext.projectName,
              project_type: competitorAnalysis.projectContext.projectType,
              target_audience: competitorAnalysis.projectContext.targetAudience,
            },
            competitors: competitorAnalysis.competitors.map((c) => ({
              id: c.id,
              name: c.name,
              url: c.url,
              description: c.description,
              relevance: c.relevance,
              pain_points: c.painPoints.map((p) => ({
                id: p.id,
                description: p.description,
                source: p.source,
                severity: p.severity,
                frequency: p.frequency,
                opportunity: p.opportunity,
              })),
              strengths: c.strengths,
              market_position: c.marketPosition,
              source: c.source,
            })),
            market_gaps: competitorAnalysis.marketGaps.map((g) => ({
              id: g.id,
              description: g.description,
              affected_competitors: g.affectedCompetitors,
              opportunity_size: g.opportunitySize,
              suggested_feature: g.suggestedFeature,
            })),
            insights_summary: {
              top_pain_points: competitorAnalysis.insightsSummary.topPainPoints,
              differentiator_opportunities:
                competitorAnalysis.insightsSummary.differentiatorOpportunities,
              market_trends: competitorAnalysis.insightsSummary.marketTrends,
            },
            research_metadata: {
              search_queries_used:
                competitorAnalysis.researchMetadata.searchQueriesUsed,
              sources_consulted:
                competitorAnalysis.researchMetadata.sourcesConsulted,
              limitations: competitorAnalysis.researchMetadata.limitations,
            },
            metadata: {
              created_at: competitorAnalysis.createdAt
                ? new Date(competitorAnalysis.createdAt).toISOString()
                : new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };

          await writeFileWithRetry(
            competitorAnalysisPath,
            JSON.stringify(serialized, null, 2),
            { encoding: 'utf-8' }
          );
        });

        // Also persist manual competitors to a separate file that the backend
        // agent never overwrites, preventing data loss during concurrent analysis
        const manualCompetitors = competitorAnalysis.competitors.filter(
          (c) => c.source === "manual"
        );
        if (manualCompetitors.length > 0) {
          const manualCompetitorsPath = path.join(
            roadmapDir,
            AUTO_BUILD_PATHS.MANUAL_COMPETITORS
          );
          const manualSerialized = {
            competitors: manualCompetitors.map((c) => ({
              id: c.id,
              name: c.name,
              url: c.url,
              description: c.description,
              relevance: c.relevance,
              pain_points: c.painPoints.map((p) => ({
                id: p.id,
                description: p.description,
                source: p.source,
                severity: p.severity,
                frequency: p.frequency,
                opportunity: p.opportunity,
              })),
              strengths: c.strengths,
              market_position: c.marketPosition,
              source: c.source,
            })),
            updated_at: new Date().toISOString(),
          };
          await writeFileWithRetry(
            manualCompetitorsPath,
            JSON.stringify(manualSerialized, null, 2),
            { encoding: "utf-8" }
          );
        }

        debugLog("[Roadmap Handler] Saved competitor analysis:", { projectId });
        return { success: true };
      } catch (error) {
        debugError("[Roadmap Handler] Failed to save competitor analysis:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to save competitor analysis",
        };
      }
    }
  );

  // ============================================
  // Roadmap Agent Events → Renderer
  // ============================================

  agentManager.on("roadmap-progress", (projectId: string, status: RoadmapGenerationStatus) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_PROGRESS, projectId, status);
  });

  agentManager.on("roadmap-complete", (projectId: string, roadmap: Roadmap) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_COMPLETE, projectId, roadmap);
  });

  agentManager.on("roadmap-error", (projectId: string, error: string) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.ROADMAP_ERROR, projectId, error);
  });
}
