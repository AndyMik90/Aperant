/**
 * Linear issue investigation IPC handlers
 */

import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
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

const INVESTIGATION_SYSTEM_PROMPT = `You are an expert software engineer analyzing issue tickets. Given a Linear issue with its description, labels, comments, and optionally codebase impact data from GitNexus, provide a structured analysis.

Respond in EXACTLY this JSON format (no markdown fencing, no extra text):
{
  "summary": "A concise 1-2 sentence summary of what needs to be done",
  "proposedSolution": "A brief description of the recommended approach to solve this",
  "affectedFiles": ["list of file paths or patterns that would likely need changes"],
  "estimatedComplexity": "simple|standard|complex",
  "acceptanceCriteria": ["criterion 1", "criterion 2", "criterion 3"],
  "impactScore": 0-100,
  "impactDetails": {
    "affectedSymbols": 0,
    "affectedProcesses": 0,
    "blastRadius": 0,
    "riskLevel": "low|medium|high|critical"
  }
}

Complexity guidelines:
- "simple": Single file change, typo fix, config update, small UI tweak
- "standard": Multiple files, moderate logic changes, new component or endpoint
- "complex": Architectural changes, new system/service, cross-cutting concerns, data migrations

Impact score guidelines (0-100):
- 0-20: Isolated change, few symbols affected, no cross-cutting concerns
- 21-40: Moderate scope, affects a single module or feature area
- 41-60: Significant scope, spans multiple modules, several execution flows affected
- 61-80: Large scope, core systems affected, many dependants in the blast radius
- 81-100: Critical infrastructure change, affects foundational abstractions or data models

Risk level:
- "low": impactScore 0-25, isolated changes
- "medium": impactScore 26-50, moderate blast radius
- "high": impactScore 51-75, broad impact across modules
- "critical": impactScore 76-100, core infrastructure affected

If no GitNexus data is provided, estimate impact based on the issue description and your understanding of typical codebases. Set impactScore to your best estimate.`;

// =========================================================================
// GitNexus Integration
// =========================================================================

interface GitNexusResult {
  available: boolean;
  queryContext?: string;
  impactContext?: string;
}

/**
 * Check if GitNexus index exists for a project
 */
function hasGitNexusIndex(projectPath: string): boolean {
  return existsSync(path.join(projectPath, ".gitnexus"));
}

/**
 * Run a GitNexus CLI command and return its output
 */
function runGitNexus(projectPath: string, args: string[]): string | null {
  try {
    const result = spawnSync("gitnexus", args, {
      cwd: projectPath,
      timeout: 15_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // GitNexus outputs to stderr due to KuzuDB native module limitation
    const output = (result.stderr || result.stdout || "").trim();
    if (result.status !== 0 && !output) return null;
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Gather GitNexus codebase context for an issue
 * Uses `gitnexus query` for related execution flows and `gitnexus impact` for blast radius
 */
function gatherGitNexusContext(
  projectPath: string,
  issueTitle: string,
  issueLabels: string[],
): GitNexusResult {
  if (!hasGitNexusIndex(projectPath)) {
    return { available: false };
  }

  // Extract key terms from issue title for querying
  const searchTerms = issueTitle
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 3)
    .join(" ");

  if (!searchTerms) {
    return { available: true };
  }

  // Query for related execution flows
  const queryContext = runGitNexus(projectPath, ["query", searchTerms]);

  // Try impact analysis on the most specific term
  const primaryTerm = searchTerms.split(" ")[0];
  const impactContext = primaryTerm
    ? runGitNexus(projectPath, ["impact", primaryTerm])
    : null;

  // Also try label-based queries for more context
  const labelTerms = issueLabels
    .filter(
      (l) =>
        !["bug", "feature", "enhancement", "chore"].includes(l.toLowerCase()),
    )
    .slice(0, 2);

  let labelContext: string | null = null;
  for (const label of labelTerms) {
    const result = runGitNexus(projectPath, ["query", label]);
    if (result) {
      labelContext = labelContext ? `${labelContext}\n\n${result}` : result;
    }
  }

  const fullQueryContext = [queryContext, labelContext]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return {
    available: true,
    queryContext: fullQueryContext || undefined,
    impactContext: impactContext || undefined,
  };
}

// =========================================================================
// AI Analysis
// =========================================================================

interface AnalysisResult {
  summary: string;
  proposedSolution: string;
  affectedFiles: string[];
  estimatedComplexity: "simple" | "standard" | "complex";
  acceptanceCriteria: string[];
  impactScore?: number;
  impactDetails?: {
    affectedSymbols: number;
    affectedProcesses: number;
    blastRadius: number;
    riskLevel: "low" | "medium" | "high" | "critical";
  };
}

/**
 * Run AI analysis on a Linear issue with optional GitNexus context
 */
async function analyzeIssueWithAI(
  issueContext: string,
  gitNexusContext?: GitNexusResult,
): Promise<AnalysisResult> {
  const featureSettings = getActiveProviderFeatureSettings("naming");

  const client = await createSimpleClient({
    systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
    modelShorthand:
      featureSettings.model === "haiku" ? "sonnet" : featureSettings.model,
    thinkingLevel: "low",
  });

  // Build prompt with optional GitNexus context
  let prompt = `Analyze this issue and provide your structured JSON analysis:\n\n${issueContext}`;

  if (gitNexusContext?.available) {
    if (gitNexusContext.queryContext) {
      prompt += `\n\n## Codebase Context (from GitNexus knowledge graph)\n\nRelated execution flows and symbols found in the codebase:\n\n${gitNexusContext.queryContext}`;
    }
    if (gitNexusContext.impactContext) {
      prompt += `\n\n## Blast Radius Analysis (from GitNexus)\n\n${gitNexusContext.impactContext}`;
    }
    if (!gitNexusContext.queryContext && !gitNexusContext.impactContext) {
      prompt += `\n\nNote: GitNexus codebase index is available but no matching symbols were found for this issue. Estimate impact based on the issue description.`;
    }
  }

  const result = await generateText({
    model: client.model,
    system: client.systemPrompt,
    prompt,
  });

  const text = result.text.trim();

  try {
    const jsonStr = text
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "");
    const parsed = JSON.parse(jsonStr);

    const impactScore =
      typeof parsed.impactScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.impactScore)))
        : undefined;

    const validRiskLevels = ["low", "medium", "high", "critical"] as const;
    const impactDetails = parsed.impactDetails
      ? {
          affectedSymbols: Number(parsed.impactDetails.affectedSymbols) || 0,
          affectedProcesses:
            Number(parsed.impactDetails.affectedProcesses) || 0,
          blastRadius: Number(parsed.impactDetails.blastRadius) || 0,
          riskLevel: validRiskLevels.includes(parsed.impactDetails.riskLevel)
            ? (parsed.impactDetails.riskLevel as
                | "low"
                | "medium"
                | "high"
                | "critical")
            : "medium",
        }
      : undefined;

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
      impactScore,
      impactDetails,
    };
  } catch {
    return {
      summary: text.substring(0, 500),
      proposedSolution: "See task description for details.",
      affectedFiles: [],
      estimatedComplexity: "standard",
      acceptanceCriteria: [],
    };
  }
}

// =========================================================================
// Linear Comment Posting
// =========================================================================

/**
 * Format the AI analysis into a markdown comment for Linear
 */
function formatAnalysisComment(
  analysis: AnalysisResult,
  taskId?: string,
): string {
  const lines: string[] = [];

  lines.push("## 🤖 Aperant Investigation");
  lines.push("");
  lines.push(`**Summary:** ${analysis.summary}`);
  lines.push("");
  lines.push(`**Proposed Solution:** ${analysis.proposedSolution}`);
  lines.push("");
  lines.push(`**Estimated Complexity:** ${analysis.estimatedComplexity}`);

  if (analysis.impactScore != null) {
    const riskLevel = analysis.impactDetails?.riskLevel || "unknown";
    lines.push("");
    lines.push(
      `**Impact Score:** ${analysis.impactScore}/100 (${riskLevel} risk)`,
    );
    if (analysis.impactDetails) {
      lines.push(
        `- Affected symbols: ${analysis.impactDetails.affectedSymbols}`,
      );
      lines.push(
        `- Affected processes: ${analysis.impactDetails.affectedProcesses}`,
      );
      lines.push(`- Blast radius: ${analysis.impactDetails.blastRadius}`);
    }
  }

  if (analysis.affectedFiles.length > 0) {
    lines.push("");
    lines.push("**Likely Affected Files:**");
    for (const file of analysis.affectedFiles) {
      lines.push(`- \`${file}\``);
    }
  }

  if (analysis.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("**Acceptance Criteria:**");
    for (const criterion of analysis.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  if (taskId) {
    lines.push("");
    lines.push(`---`);
    lines.push(`*Task created: ${taskId}*`);
  }

  return lines.join("\n");
}

/**
 * Post investigation results as a comment on the Linear issue
 */
async function postAnalysisToLinear(
  apiKey: string,
  issueId: string,
  analysis: AnalysisResult,
  taskId?: string,
): Promise<void> {
  const body = formatAnalysisComment(analysis, taskId);

  const mutation = `
    mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
        }
      }
    }
  `;

  await linearGraphQL(apiKey, mutation, { issueId, body });
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

        // Phase 2: Gather codebase context via GitNexus (if available)
        sendProgress(mainWindow, projectId, {
          phase: "analyzing",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 25,
          message: "Scanning codebase with GitNexus...",
        });

        const gitNexusContext = gatherGitNexusContext(
          project.path,
          issue.title,
          labels,
        );

        // Phase 3: AI analysis with GitNexus context
        sendProgress(mainWindow, projectId, {
          phase: "analyzing",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 35,
          message: gitNexusContext.available
            ? "AI is analyzing issue with codebase context..."
            : "AI is analyzing the issue...",
        });

        const aiAnalysis = await analyzeIssueWithAI(
          issueContext,
          gitNexusContext,
        );

        sendProgress(mainWindow, projectId, {
          phase: "analyzing",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 55,
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
        const impactSection =
          aiAnalysis.impactScore != null
            ? `\n**Impact Score:** ${aiAnalysis.impactScore}/100 (${aiAnalysis.impactDetails?.riskLevel || "unknown"} risk)${
                aiAnalysis.impactDetails
                  ? `\n- Affected symbols: ${aiAnalysis.impactDetails.affectedSymbols}\n- Affected processes: ${aiAnalysis.impactDetails.affectedProcesses}\n- Blast radius: ${aiAnalysis.impactDetails.blastRadius}`
                  : ""
              }`
            : "";

        const enrichedDescription = `${taskDescription}

## AI Analysis

**Summary:** ${aiAnalysis.summary}

**Proposed Solution:** ${aiAnalysis.proposedSolution}

**Estimated Complexity:** ${aiAnalysis.estimatedComplexity}
${impactSection}

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

        // Build investigation result with real AI analysis + impact data
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
            impactScore: aiAnalysis.impactScore,
            impactDetails: aiAnalysis.impactDetails,
          },
          taskId: specData.specId,
        };

        // Phase 4: Post analysis as comment to Linear issue
        sendProgress(mainWindow, projectId, {
          phase: "creating_task",
          issueId,
          issueIdentifier: issue.identifier,
          progress: 85,
          message: "Posting analysis to Linear...",
        });

        try {
          await postAnalysisToLinear(
            apiKey,
            issue.id,
            aiAnalysis,
            specData.specId,
          );
        } catch (commentError) {
          // Non-fatal — log but don't fail the investigation
          console.warn(
            "[Linear] Failed to post analysis comment:",
            commentError,
          );
        }

        // Phase 5: Complete
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
