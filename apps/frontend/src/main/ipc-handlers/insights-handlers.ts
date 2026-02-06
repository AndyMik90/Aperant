import { ipcMain, app } from "electron";
import type { BrowserWindow } from "electron";
import path from "path";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { debugError } from "../../shared/utils/debug-logger";
import {
  IPC_CHANNELS,
  getSpecsDir,
  AUTO_BUILD_PATHS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from "../../shared/constants";
import type {
  IPCResult,
  InsightsSession,
  InsightsSessionSummary,
  InsightsModelConfig,
  Task,
  TaskMetadata,
  AppSettings,
} from "../../shared/types";
import { projectStore } from "../project-store";
import { insightsService } from "../insights-service";
import { safeSendToRenderer } from "./utils";

/**
 * Read insights feature settings from the settings file
 */
function getInsightsFeatureSettings(): InsightsModelConfig {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");

  try {
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, "utf-8");
      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };

      // Get insights-specific settings from Agent Settings
      // Use nullish coalescing at property level to handle partial settings objects
      const featureModels = settings.featureModels ?? DEFAULT_FEATURE_MODELS;
      const featureThinking = settings.featureThinking ?? DEFAULT_FEATURE_THINKING;

      return {
        profileId: "balanced", // Default profile for settings-based config
        model: featureModels.insights ?? DEFAULT_FEATURE_MODELS.insights,
        thinkingLevel: featureThinking.insights ?? DEFAULT_FEATURE_THINKING.insights,
      };
    }
  } catch (error) {
    debugError("[Insights Handler] Failed to read feature settings:", error);
  }

  // Return defaults if settings file doesn't exist or fails to parse
  return {
    profileId: "balanced", // Default profile for settings-based config
    model: DEFAULT_FEATURE_MODELS.insights,
    thinkingLevel: DEFAULT_FEATURE_THINKING.insights,
  };
}

/**
 * Register all insights-related IPC handlers
 */
export function registerInsightsHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ============================================
  // Insights Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_GET_SESSION,
    async (_, projectId: string): Promise<IPCResult<InsightsSession | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.loadSession(projectId, project.path);
      return { success: true, data: session };
    }
  );

  ipcMain.on(
    IPC_CHANNELS.INSIGHTS_SEND_MESSAGE,
    async (
      _,
      projectId: string,
      message: string,
      modelConfig?: InsightsModelConfig,
      attachments?: Array<{ id: string; name: string; path: string; type: 'image' | 'text'; size: number }>
    ) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.INSIGHTS_ERROR,
          projectId,
          "Project not found"
        );
        return;
      }

      // Get feature settings from Agent Settings and merge with provided config
      const featureSettings = getInsightsFeatureSettings();
      const configWithSettings: InsightsModelConfig = {
        // Start with feature settings as defaults
        ...featureSettings,
        // Override with any explicitly provided config
        ...modelConfig,
      };

      console.log("[Insights Handler] Using model config:", {
        model: configWithSettings.model,
        thinkingLevel: configWithSettings.thinkingLevel,
      });

      // Log attachments if provided (for future implementation)
      if (attachments && attachments.length > 0) {
        console.log("[Insights Handler] Attachments received:", attachments.length, "files");
        // TODO: Process attachments when Python backend supports them
        // Images should be converted to base64 and included in the API message
        // Text files should be read and included as content
      }

      // Await the async sendMessage to ensure proper error handling and
      // that all async operations (like getProcessEnv) complete before
      // the handler returns. This fixes race conditions on Windows where
      // environment setup wouldn't complete before process spawn.
      try {
        await insightsService.sendMessage(projectId, project.path, message, configWithSettings);
      } catch (error) {
        // Errors during sendMessage (executor errors) are already emitted via
        // the 'error' event, but we catch here to prevent unhandled rejection
        // and ensure all error types are reported to the UI
        console.error("[Insights IPC] Error in sendMessage:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.INSIGHTS_ERROR,
          projectId,
          `Failed to send message: ${errorMessage}`
        );
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CLEAR_SESSION,
    async (_, projectId: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      insightsService.clearSession(projectId, project.path);
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CREATE_TASK,
    async (
      _,
      projectId: string,
      title: string,
      description: string,
      metadata?: TaskMetadata
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: "Auto Claude not initialized for this project" };
      }

      // Input validation
      if (!title || typeof title !== "string" || !title.trim()) {
        return { success: false, error: "Title is required" };
      }
      if (title.length > 200) {
        return { success: false, error: "Title must be 200 characters or fewer" };
      }
      // Sanitize title for filesystem safety (remove characters unsafe for directory names)
      title = title.replace(/[/\\:*?"<>|]/g, "-").replace(/-{2,}/g, "-").trim();
      if (!title) {
        return { success: false, error: "Title contains only invalid characters" };
      }
      if (description && description.length > 10000) {
        return { success: false, error: "Description must be 10,000 characters or fewer" };
      }

      try {
        // Generate a unique spec ID based on existing specs
        // Get specs directory path
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);

        // Find next available spec number
        let specNumber = 1;
        if (existsSync(specsDir)) {
          const existingDirs = readdirSync(specsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          const existingNumbers = existingDirs
            .map((name) => {
              const match = name.match(/^(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter((n) => n > 0);

          if (existingNumbers.length > 0) {
            specNumber = Math.max(...existingNumbers) + 1;
          }
        }

        // Create spec ID with zero-padded number and slugified title
        const slugifiedTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 50);

        // Atomic directory creation with retry to prevent duplicate spec IDs under concurrency
        let specId = "";
        let specDir = "";
        const MAX_RETRIES = 10;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;
          specDir = path.join(specsDir, specId);
          try {
            // Ensure parent exists, then try non-recursive mkdir (atomic)
            mkdirSync(specsDir, { recursive: true });
            mkdirSync(specDir, { recursive: false });
            break; // Success — directory created
          } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EEXIST") {
              specNumber++;
              if (attempt === MAX_RETRIES - 1) {
                return { success: false, error: "Failed to create unique spec directory after multiple retries" };
              }
              continue;
            }
            throw err; // Rethrow unexpected errors
          }
        }

        // Build metadata with source type
        const taskMetadata: TaskMetadata = {
          sourceType: "insights",
          ...metadata,
        };

        // Create initial implementation_plan.json
        const now = new Date().toISOString();
        const implementationPlan = {
          feature: title,
          description: description,
          created_at: now,
          updated_at: now,
          status: "pending",
          phases: [],
        };

        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2));

        // Save task metadata
        const metadataPath = path.join(specDir, "task_metadata.json");
        writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2));

        // Create the task object
        const task: Task = {
          id: specId,
          specId: specId,
          projectId,
          title,
          description,
          status: "planning",
          subtasks: [],
          logs: [],
          metadata: taskMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return { success: true, data: task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create task",
        };
      }
    }
  );

  // List all sessions for a project
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_LIST_SESSIONS,
    async (_, projectId: string): Promise<IPCResult<InsightsSessionSummary[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const sessions = insightsService.listSessions(project.path);
      return { success: true, data: sessions };
    }
  );

  // Create a new session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_NEW_SESSION,
    async (_, projectId: string): Promise<IPCResult<InsightsSession>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.createNewSession(projectId, project.path);
      return { success: true, data: session };
    }
  );

  // Switch to a different session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_SWITCH_SESSION,
    async (_, projectId: string, sessionId: string): Promise<IPCResult<InsightsSession | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.switchSession(projectId, project.path, sessionId);
      return { success: true, data: session };
    }
  );

  // Delete a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_DELETE_SESSION,
    async (_, projectId: string, sessionId: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const success = insightsService.deleteSession(projectId, project.path, sessionId);
        if (success) {
          return { success: true };
        }
        return { success: false, error: "Failed to delete session" };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to delete session: ${errorMessage}` };
      }
    }
  );

  // Rename a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_RENAME_SESSION,
    async (_, projectId: string, sessionId: string, newTitle: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const success = insightsService.renameSession(project.path, sessionId, newTitle);
        if (success) {
          return { success: true };
        }
        return { success: false, error: "Failed to rename session" };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to rename session: ${errorMessage}` };
      }
    }
  );

  // Update model configuration for a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_UPDATE_MODEL_CONFIG,
    async (
      _,
      projectId: string,
      sessionId: string,
      modelConfig: InsightsModelConfig
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const success = insightsService.updateSessionModelConfig(
          project.path,
          sessionId,
          modelConfig
        );
        if (success) {
          return { success: true };
        }
        return { success: false, error: "Failed to update model configuration" };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to update model configuration: ${errorMessage}` };
      }
    }
  );

  // Mark a message's task as created (persists across navigation/app restart)
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_MARK_TASK_CREATED,
    async (
      _,
      projectId: string,
      sessionId: string,
      messageId: string,
      taskId: string
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const success = insightsService.markTaskCreated(
          project.path,
          sessionId,
          messageId,
          taskId
        );
        if (success) {
          return { success: true };
        }
        return { success: false, error: "Failed to mark task as created" };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to mark task as created: ${errorMessage}` };
      }
    }
  );

  // ============================================
  // Insights Event Forwarding (Service -> Renderer)
  // ============================================

  // Forward streaming chunks to renderer
  insightsService.on("stream-chunk", (projectId: string, chunk: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_STREAM_CHUNK, projectId, chunk);
  });

  // Forward status updates to renderer
  insightsService.on("status", (projectId: string, status: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_STATUS, projectId, status);
  });

  // Forward errors to renderer
  insightsService.on("error", (projectId: string, error: string) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_ERROR, projectId, error);
  });

  // Forward SDK rate limit events to renderer
  insightsService.on("sdk-rate-limit", (rateLimitInfo: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Cancel/abort insights generation
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CANCEL,
    async (_, projectId: string): Promise<IPCResult<void>> => {
      try {
        const wasCanceled = insightsService.cancelSession(projectId);
        if (!wasCanceled) {
          // No active generation to cancel — not an error, just a no-op
          return { success: true };
        }
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }
  );
}
