/**
 * Ideation generation handlers (start/stop generation)
 */

import type { IpcMainEvent, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { app } from "electron";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  IPC_CHANNELS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from "../../../shared/constants";
import type {
  IPCResult,
  IdeationConfig,
  IdeationGenerationStatus,
  AppSettings,
} from "../../../shared/types";
import { projectStore } from "../../project-store";
import type { AgentManager } from "../../agent";
import { debugLog, debugError } from "../../../shared/utils/debug-logger";
import { safeSendToRenderer } from "../utils";

/**
 * Read ideation feature settings from the settings file
 */
function getIdeationFeatureSettings(): { model?: string; thinkingLevel?: string; language?: string } {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");

  try {
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, "utf-8");
      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };

      // Get ideation-specific settings
      const featureModels = settings.featureModels || DEFAULT_FEATURE_MODELS;
      const featureThinking = settings.featureThinking || DEFAULT_FEATURE_THINKING;

      return {
        model: featureModels.ideation,
        thinkingLevel: featureThinking.ideation,
        language: settings.language || "en",
      };
    }
  } catch (error) {
    debugError("[Ideation Handler] Failed to read feature settings:", error);
  }

  // Return defaults if settings file doesn't exist or fails to parse
  return {
    model: DEFAULT_FEATURE_MODELS.ideation,
    thinkingLevel: DEFAULT_FEATURE_THINKING.ideation,
    language: "en",
  };
}

/**
 * Start ideation generation for a project
 */
export function startIdeationGeneration(
  _event: IpcMainEvent,
  projectId: string,
  config: IdeationConfig,
  agentManager: AgentManager,
  mainWindow: BrowserWindow | null
): void {
  // Get feature settings and merge with config
  const featureSettings = getIdeationFeatureSettings();
  const configWithSettings: IdeationConfig = {
    ...config,
    model: config.model || featureSettings.model,
    thinkingLevel: config.thinkingLevel || featureSettings.thinkingLevel,
    language: config.language || featureSettings.language,
  };

  debugLog("[Ideation Handler] Start generation request:", {
    projectId,
    enabledTypes: configWithSettings.enabledTypes,
    maxIdeasPerType: configWithSettings.maxIdeasPerType,
    model: configWithSettings.model,
    thinkingLevel: configWithSettings.thinkingLevel,
  });

  const getMainWindow = () => mainWindow;

  const project = projectStore.getProject(projectId);
  if (!project) {
    debugLog("[Ideation Handler] Project not found:", projectId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.IDEATION_ERROR, projectId, "Project not found");
    return;
  }

  debugLog("[Ideation Handler] Starting agent manager generation:", {
    projectId,
    projectPath: project.path,
    model: configWithSettings.model,
    thinkingLevel: configWithSettings.thinkingLevel,
  });

  // Start ideation generation via agent manager
  agentManager.startIdeationGeneration(projectId, project.path, configWithSettings, false);

  // Send initial progress
  safeSendToRenderer(getMainWindow, IPC_CHANNELS.IDEATION_PROGRESS, projectId, {
    phase: "analyzing",
    progress: 10,
    message: "Analyzing project structure...",
  } as IdeationGenerationStatus);
}

/**
 * Refresh ideation session (regenerate with new ideas)
 */
export function refreshIdeationSession(
  _event: IpcMainEvent,
  projectId: string,
  config: IdeationConfig,
  agentManager: AgentManager,
  mainWindow: BrowserWindow | null
): void {
  // Get feature settings and merge with config
  const featureSettings = getIdeationFeatureSettings();
  const configWithSettings: IdeationConfig = {
    ...config,
    model: config.model || featureSettings.model,
    thinkingLevel: config.thinkingLevel || featureSettings.thinkingLevel,
    language: config.language || featureSettings.language,
  };

  debugLog("[Ideation Handler] Refresh session request:", {
    projectId,
    model: configWithSettings.model,
    thinkingLevel: configWithSettings.thinkingLevel,
  });

  const getMainWindow = () => mainWindow;

  const project = projectStore.getProject(projectId);
  if (!project) {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.IDEATION_ERROR, projectId, "Project not found");
    return;
  }

  // Start ideation regeneration with refresh flag
  agentManager.startIdeationGeneration(projectId, project.path, configWithSettings, true);

  // Send initial progress
  safeSendToRenderer(getMainWindow, IPC_CHANNELS.IDEATION_PROGRESS, projectId, {
    phase: "analyzing",
    progress: 10,
    message: "Refreshing ideation...",
  } as IdeationGenerationStatus);
}

/**
 * Stop ideation generation
 */
export async function stopIdeationGeneration(
  _event: IpcMainInvokeEvent,
  projectId: string,
  agentManager: AgentManager,
  mainWindow: BrowserWindow | null
): Promise<IPCResult> {
  debugLog("[Ideation Handler] Stop generation request:", { projectId });

  const wasStopped = agentManager.stopIdeation(projectId);

  debugLog("[Ideation Handler] Stop result:", { projectId, wasStopped });

  if (wasStopped) {
    debugLog("[Ideation Handler] Sending stopped event to renderer");
    const getMainWindow = () => mainWindow;
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.IDEATION_STOPPED, projectId);
  }

  return { success: wasStopped };
}
