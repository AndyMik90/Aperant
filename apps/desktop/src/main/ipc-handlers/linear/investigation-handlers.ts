/**
 * Linear issue investigation IPC handlers
 */

import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { generateText } from "ai";
import { IPC_CHANNELS } from "../../../shared/constants";
import type {
  LinearInvestigationResult,
  LinearInvestigationStatus,
  LinearComment,
} from "../../../shared/types";
import { projectStore } from "../../project-store";
import { AgentManager } from "../../agent";
import { createSimpleClient } from "../../ai/client/factory";
import { getActiveProviderFeatureSettings } from "../feature-settings-helper";
import { getLinearApiKey, linearGraphQL } from "./utils";
import {
  createSpecForLinearIssue,
  buildLinearIssueContext,
  buildLinearInvestigationTask,
} from "./spec-utils";

const INVESTIGATION_SYSTEM_PROMPT = `You are an expert software engineer analyzing issue tickets. Given a Linear issue with its description, labels, and comments, provide a structured analysis.

Respond in EXACTLY this JSON format (no markdown fencing, no extra text):
{
  "summary": "A concise 1-2 sentence summary of what needs to be done",
  "proposedSolution": "A brief description of the recommended approach to solve this",
  "affectedFiles": ["list of file paths or patterns that would likely need changes"],
  "estimatedComplexity": "simple|standard|complex",
  "acceptanceCriteria": ["criterion 1", "criterion 2", "criterion 3"]
}

Complexity guidelines:
- "simple": Single file change, typo fix, config update, small UI tweak
- "standard": Multiple files, moderate logic changes, new component or endpoint
- "complex": Architectural changes, new system/service, cross-cutting concerns, data migrations`;

/**
 * Run AI analysis on a Linear issue and return structured results
 */
async function analyzeIssueWithAI(issueContext: string): Promise<{
  summary: string;
  proposedSolution: string;
  affectedFiles: string[];
  estimatedComplexity: "simple" | "standard" | "complex";
  acceptanceCriteria: string[];
}> {
  const featureSettings = getActiveProviderFeatureSettings("naming");

  const client = await createSimpleClient({
    systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
    modelShorthand:
      featureSettings.model === "haiku" ? "sonnet" : featureSettings.model,
    thinkingLevel: "low",
  });

  const result = await generateText({
    model: client.model,
    system: client.systemPrompt,
    prompt: `Analyze this issue and provide your structured JSON analysis:\n\n${issueContext}`,
  });

  const text = result.text.trim();

  // Try to parse the JSON response
  try {
    // Handle potential markdown fencing
    const jsonStr = text
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "");
    const parsed = JSON.parse(jsonStr);
    return {
      summary: parsed.summary || "Analysis completed",
      proposedSolution:
        parsed.proposedSolution || "See task description for details.",
      affectedFiles: Array.isArray(parsed.affectedFiles)
        ? parsed.affectedFiles
        : [],
      estimatedComplexity: ["simple", "standard", "complex"].includes(
        parsed.estimatedComplexity,
      )
        ? parsed.estimatedComplexity
        : "standard",
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria
        : [],
    };
  } catch {
    // If JSON parsing fails, return the raw text as summary
    return {
      summary: text.substring(0, 500),
      proposedSolution: "See task description for details.",
      affectedFiles: [],
      estimatedComplexity: "standard",
      acceptanceCriteria: [],
    };
  }
}

/**
 * Send investigation progress update to renderer
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  status: LinearInvestigationStatus,
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.LINEAR_INVESTIGATION_PROGRESS,
    projectId,
    status,
  );
}

/**
 * Send investigation error to renderer
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string,
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.LINEAR_INVESTIGATION_ERROR,
    projectId,
    error,
  );
}

/**
 * Send investigation completion to renderer
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  result: LinearInvestigationResult,
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.LINEAR_INVESTIGATION_COMPLETE,
    projectId,
    result,
  );
}

/**
 * Investigate a Linear issue and create a task
 */
function registerInvestigateIssue(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.on(
    IPC_CHANNELS.LINEAR_INVESTIGATE_ISSUE,
    async (
      _,
      projectId: string,
      issueId: string,
      selectedCommentIds?: string[],
    ) => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(mainWindow, projectId, "Project not found");
        return;
      }

      const apiKey = getLinearApiKey(project);
      if (!apiKey) {
        sendError(mainWindow, projectId, "No Linear API key configured");
        return;
      }

      try {
        // Phase 1: Fetching issue details
        sendProgress(mainWindow, projectId, {
          phase: "fetching",
          issueId,
          progress: 10,
          message: "Fetching issue details...",
        });

        // Fetch the issue with comments
        const query = `
          query($issueId: String!) {
            issue(id: $issueId) {
              id
              identifier
              title
              description
              url
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
              comments {
                nodes {
                  id
                  body
                  user {
                    id
                    name
                    email
                  }
                  createdAt
                  updatedAt
                }
              }
            }
          }
        `;

        const data = (await linearGraphQL(apiKey, query, { issueId })) as {
          issue: {
            id: string;
            identifier: string;
            title: string;
            description?: string;
            url: string;
            labels: {
              nodes: Array<{ id: string; name: string; color: string }>;
            };
            comments: {
              nodes: Array<{
                id: string;
                body: string;
                user: { id: string; name: string; email?: string };
                createdAt: string;
                updatedAt: string;
              }>;
            };
          };
        };

        const issue = data.issue;

        // Transform comments
        const allComments: LinearComment[] = issue.comments.nodes.map((c) => ({
          id: c.id,
          body: c.body,
          author: { id: c.user.id, name: c.user.name, email: c.user.email },
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));

        // Filter comments based on selection (if provided)
        // Use Array.isArray to handle empty array case (all comments deselected)
        const comments = Array.isArray(selectedCommentIds)
          ? allComments.filter((c) => selectedCommentIds.includes(c.id))
          : allComments;

        // Build context for the AI investigation
        const labels = issue.labels.nodes.map((l) => l.name);
        const issueContext = buildLinearIssueContext(
          issue.id,
          issue.identifier,
          issue.title,
          issue.description,
          labels,
          issue.url,
          comments,
        );

        // Phase 2: AI analysis of the issue
        sendProgress(mainWindow, projectId, {
          phase: "analyzing",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 30,
          message: "AI is analyzing the issue...",
        });

        // Run actual AI analysis on the issue
        const aiAnalysis = await analyzeIssueWithAI(issueContext);

        sendProgress(mainWindow, projectId, {
          phase: "analyzing",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 50,
          message: "Analysis complete, creating task...",
        });

        // Build task description enriched with AI analysis
        const taskDescription = buildLinearInvestigationTask(
          issue.id,
          issue.identifier,
          issue.title,
          issueContext,
        );

        // Enrich task description with AI analysis results
        const enrichedDescription = `${taskDescription}

## AI Analysis

**Summary:** ${aiAnalysis.summary}

**Proposed Solution:** ${aiAnalysis.proposedSolution}

**Estimated Complexity:** ${aiAnalysis.estimatedComplexity}

${aiAnalysis.affectedFiles.length > 0 ? `**Likely Affected Files:**\n${aiAnalysis.affectedFiles.map((f) => `- ${f}`).join("\n")}` : ""}

**Acceptance Criteria:**
${aiAnalysis.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;

        // Create spec directory and files (with coordinated numbering)
        const specData = await createSpecForLinearIssue(
          project,
          issue.id,
          issue.identifier,
          issue.title,
          enrichedDescription,
          issue.url,
          labels,
          project.settings?.mainBranch,
        );

        // Phase 3: Creating task
        sendProgress(mainWindow, projectId, {
          phase: "creating_task",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 70,
          message: "Creating task from investigation...",
        });

        // Build investigation result with real AI analysis
        const investigationResult: LinearInvestigationResult = {
          success: true,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          analysis: {
            summary: aiAnalysis.summary,
            proposedSolution: aiAnalysis.proposedSolution,
            affectedFiles: aiAnalysis.affectedFiles,
            estimatedComplexity: aiAnalysis.estimatedComplexity,
            acceptanceCriteria: aiAnalysis.acceptanceCriteria,
          },
          taskId: specData.specId,
        };

        // Phase 4: Complete
        sendProgress(mainWindow, projectId, {
          phase: "complete",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 100,
          message: "Investigation complete!",
        });

        sendComplete(mainWindow, projectId, investigationResult);
      } catch (error) {
        sendError(
          mainWindow,
          projectId,
          error instanceof Error
            ? error.message
            : "Failed to investigate issue",
        );
      }
    },
  );
}

/**
 * Register all investigation-related handlers
 */
export function registerLinearInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  registerInvestigateIssue(agentManager, getMainWindow);
}
