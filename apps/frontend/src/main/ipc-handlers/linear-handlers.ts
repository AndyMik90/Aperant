import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "fs";
import {
	AUTO_BUILD_PATHS,
	getSpecsDir,
	IPC_CHANNELS,
} from "../../shared/constants";
import type {
	IPCResult,
	LinearImportResult,
	LinearIssue,
	LinearProject,
	LinearSyncStatus,
	LinearTeam,
	Project,
	TaskMetadata,
} from "../../shared/types";
import type { AgentManager } from "../agent";
import { joinPaths } from "../platform";
import { projectStore } from "../project-store";
import { parseEnvFile } from "./utils";

/**
 * Debug logging for Linear validation (enabled via DEBUG_LINEAR_VALIDATION env var)
 */
const DEBUG_LINEAR = process.env.DEBUG_LINEAR_VALIDATION === "true";
const debugLog = (...args: unknown[]) => {
	if (DEBUG_LINEAR) {
		console.log("[LinearValidation]", ...args);
	}
};

/**
 * Validation progress tracking for active validations
 */
const activeValidations = new Map<string, {
	startTime: number;
	lastProgress: number;
}>();

/**
 * Register all linear-related IPC handlers
 */
export function registerLinearHandlers(
	agentManager: AgentManager,
	_getMainWindow: () => BrowserWindow | null,
): void {
	console.warn('[Linear] Registering Linear integration handlers');

	// Listen for validation progress events from agent manager
	agentManager.on("linear-validate-progress", (ticketId: string, progressEvent: {
		phase: string;
		step: number;
		total: number;
		message: string;
	}) => {
		debugLog("Validation progress event received:", { ticketId, progressEvent });

		// Track progress to detect stuck validations
		const tracking = activeValidations.get(ticketId);
		if (tracking) {
			tracking.lastProgress = Date.now();
		}

		// Forward progress to renderer
		const mainWindow = _getMainWindow();
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send(IPC_CHANNELS.LINEAR_VALIDATE_PROGRESS, {
				ticketId,
				...progressEvent
			});
		}
	});
	// ============================================
	// Linear Integration Operations
	// ============================================

	/**
	 * Helper to get Linear API key from project env
	 */
	const getLinearApiKey = (project: Project): string | null => {
		if (!project.autoBuildPath) return null;
		const envPath = joinPaths(project.path, project.autoBuildPath, ".env");
		if (!existsSync(envPath)) return null;

		try {
			const content = readFileSync(envPath, "utf-8");
			const vars = parseEnvFile(content);
			return vars["LINEAR_API_KEY"] || null;
		} catch {
			return null;
		}
	};

	/**
	 * Make a request to the Linear API
	 */
	const linearGraphQL = async (
		apiKey: string,
		query: string,
		variables?: Record<string, unknown>,
	): Promise<unknown> => {
		// Linear API keys (starting with lin_api_) should NOT use Bearer prefix
		// OAuth tokens should use Bearer prefix
		const isPersonalApiKey = apiKey.startsWith("lin_api_");
		const authorization = isPersonalApiKey ? apiKey : `Bearer ${apiKey}`;

		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: authorization,
			},
			body: JSON.stringify({ query, variables }),
		});

		// Check response.ok first, then try to parse JSON
		// This handles cases where the API returns non-JSON errors (e.g., 503 from proxy)
		if (!response.ok) {
			let errorMessage = response.statusText;
			try {
				const errorResult = await response.json();
				errorMessage =
					errorResult?.errors?.[0]?.message ||
					errorResult?.error ||
					errorResult?.message ||
					response.statusText;
			} catch {
				// JSON parsing failed - use status text as fallback
			}
			throw new Error(`Linear API error: ${response.status} - ${errorMessage}`);
		}

		const result = await response.json();
		if (result.errors) {
			throw new Error(result.errors[0]?.message || "Linear API error");
		}

		return result.data;
	};

	ipcMain.handle(
		IPC_CHANNELS.LINEAR_CHECK_CONNECTION,
		async (_, projectId: string): Promise<IPCResult<LinearSyncStatus>> => {
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return {
					success: true,
					data: {
						connected: false,
						error: "No Linear API key configured",
					},
				};
			}

			try {
				const query = `
          query {
            viewer {
              id
              name
            }
            teams {
              nodes {
                id
                name
                key
              }
            }
          }
        `;

				const data = (await linearGraphQL(apiKey, query)) as {
					viewer: { id: string; name: string };
					teams: { nodes: Array<{ id: string; name: string; key: string }> };
				};

				// Get issue count for the first team
				let issueCount = 0;
				let teamName: string | undefined;

				if (data.teams.nodes.length > 0) {
					teamName = data.teams.nodes[0].name;

					// Simple count estimation - get first 250 issues
					const countData = (await linearGraphQL(
						apiKey,
						`
            query($teamId: ID!) {
              issues(filter: { team: { id: { eq: $teamId } } }, first: 250) {
                nodes { id }
              }
            }
          `,
						{ teamId: data.teams.nodes[0].id },
					)) as {
						issues: { nodes: Array<{ id: string }> };
					};
					issueCount = countData.issues.nodes.length;
				}

				return {
					success: true,
					data: {
						connected: true,
						teamName,
						issueCount,
						lastSyncedAt: new Date().toISOString(),
					},
				};
			} catch (error) {
				return {
					success: true,
					data: {
						connected: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to connect to Linear",
					},
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.LINEAR_GET_TEAMS,
		async (_, projectId: string): Promise<IPCResult<LinearTeam[]>> => {
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				const query = `
          query {
            teams {
              nodes {
                id
                name
                key
              }
            }
          }
        `;

				const data = (await linearGraphQL(apiKey, query)) as {
					teams: { nodes: LinearTeam[] };
				};

				return { success: true, data: data.teams.nodes };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to fetch teams",
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.LINEAR_GET_PROJECTS,
		async (
			_,
			projectId: string,
			teamId: string,
		): Promise<IPCResult<LinearProject[]>> => {
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				const query = `
          query($teamId: ID!) {
            team(id: $teamId) {
              projects {
                nodes {
                  id
                  name
                  state
                }
              }
            }
          }
        `;

				const data = (await linearGraphQL(apiKey, query, { teamId })) as {
					team: { projects: { nodes: LinearProject[] } };
				};

				return { success: true, data: data.team.projects.nodes };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to fetch projects",
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.LINEAR_GET_ISSUES,
		async (
			_,
			projectId: string,
			teamId?: string,
			linearProjectId?: string,
		): Promise<IPCResult<LinearIssue[]>> => {
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				// Build filter using GraphQL variables for safety
				const variables: Record<string, string> = {};
				const filterParts: string[] = [];
				const variableDeclarations: string[] = [];

				if (teamId) {
					variables.teamId = teamId;
					variableDeclarations.push("$teamId: ID!");
					filterParts.push("team: { id: { eq: $teamId } }");
				}
				if (linearProjectId) {
					variables.linearProjectId = linearProjectId;
					variableDeclarations.push("$linearProjectId: ID!");
					filterParts.push("project: { id: { eq: $linearProjectId } }");
				}

				const variablesDef =
					variableDeclarations.length > 0
						? `(${variableDeclarations.join(", ")})`
						: "";
				const filterClause =
					filterParts.length > 0
						? `filter: { ${filterParts.join(", ")} }, `
						: "";

				const query = `
          query${variablesDef} {
            issues(${filterClause}first: 250, orderBy: updatedAt) {
              nodes {
                id
                identifier
                title
                description
                state {
                  id
                  name
                  type
                }
                priority
                priorityLabel
                labels {
                  nodes {
                    id
                    name
                    color
                  }
                }
                assignee {
                  id
                  name
                  email
                }
                project {
                  id
                  name
                }
                createdAt
                updatedAt
                url
              }
            }
          }
        `;

				const data = (await linearGraphQL(apiKey, query, variables)) as {
					issues: {
						nodes: Array<{
							id: string;
							identifier: string;
							title: string;
							description?: string;
							state: { id: string; name: string; type: string };
							priority: number;
							priorityLabel: string;
							labels: {
								nodes: Array<{ id: string; name: string; color: string }>;
							};
							assignee?: { id: string; name: string; email: string };
							project?: { id: string; name: string };
							createdAt: string;
							updatedAt: string;
							url: string;
						}>;
					};
				};

				// Transform to our LinearIssue format
				const issues: LinearIssue[] = data.issues.nodes.map((issue) => ({
					...issue,
					labels: issue.labels.nodes,
				}));

				return { success: true, data: issues };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to fetch issues",
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.LINEAR_IMPORT_ISSUES,
		async (
			_,
			projectId: string,
			issueIds: string[],
		): Promise<IPCResult<LinearImportResult>> => {
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				// First, fetch the full details of selected issues
				const query = `
          query($ids: [ID!]!) {
            issues(filter: { id: { in: $ids } }) {
              nodes {
                id
                identifier
                title
                description
                state {
                  id
                  name
                  type
                }
                priority
                priorityLabel
                labels {
                  nodes {
                    id
                    name
                    color
                  }
                }
                url
              }
            }
          }
        `;

				const data = (await linearGraphQL(apiKey, query, {
					ids: issueIds,
				})) as {
					issues: {
						nodes: Array<{
							id: string;
							identifier: string;
							title: string;
							description?: string;
							state: { id: string; name: string; type: string };
							priority: number;
							priorityLabel: string;
							labels: {
								nodes: Array<{ id: string; name: string; color: string }>;
							};
							url: string;
						}>;
					};
				};

				let imported = 0;
				let failed = 0;
				const errors: string[] = [];

				// Set up specs directory
				const specsBaseDir = getSpecsDir(project.autoBuildPath);
				const specsDir = joinPaths(project.path, specsBaseDir);
				if (!existsSync(specsDir)) {
					mkdirSync(specsDir, { recursive: true });
				}

				// Create tasks for each imported issue
				for (const issue of data.issues.nodes) {
					try {
						// Build description from Linear issue
						const labels = issue.labels.nodes.map((l) => l.name).join(", ");
						const description = `# ${issue.title}

**Linear Issue:** [${issue.identifier}](${issue.url})
**Priority:** ${issue.priorityLabel}
**Status:** ${issue.state.name}
${labels ? `**Labels:** ${labels}` : ""}

## Description

${issue.description || "No description provided."}
`;

						// Find next available spec number
						let specNumber = 1;
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

						// Create spec ID with zero-padded number and slugified title
						const slugifiedTitle = issue.title
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-|-$/g, "")
							.substring(0, 50);
						const specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;

						// Create spec directory
						const specDir = joinPaths(specsDir, specId);
						mkdirSync(specDir, { recursive: true });

						// Create initial implementation_plan.json
						const now = new Date().toISOString();
						const implementationPlan = {
							feature: issue.title,
							description: description,
							created_at: now,
							updated_at: now,
							status: "pending",
							phases: [],
						};
						writeFileSync(
							joinPaths(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
							JSON.stringify(implementationPlan, null, 2),
						);

						// Create requirements.json
						const requirements = {
							task_description: description,
							workflow_type: "feature",
						};
						writeFileSync(
							joinPaths(specDir, AUTO_BUILD_PATHS.REQUIREMENTS),
							JSON.stringify(requirements, null, 2),
						);

						// Build metadata
						const metadata: TaskMetadata = {
							sourceType: "linear",
							linearIssueId: issue.id,
							linearIdentifier: issue.identifier,
							linearUrl: issue.url,
							category: "feature",
						};
						writeFileSync(
							joinPaths(specDir, "task_metadata.json"),
							JSON.stringify(metadata, null, 2),
						);

						// Start spec creation with the existing spec directory
						agentManager.startSpecCreation(
							specId,
							project.path,
							description,
							specDir,
							metadata,
						);

						imported++;
					} catch (err) {
						failed++;
						errors.push(
							`Failed to import ${issue.identifier}: ${err instanceof Error ? err.message : "Unknown error"}`,
						);
					}
				}

				return {
					success: true,
					data: {
						success: failed === 0,
						imported,
						failed,
						errors: errors.length > 0 ? errors : undefined,
					},
				};
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to import issues",
				};
			}
		},
	);

	// ============================================
	// Validation Operations (AI-powered ticket validation)
	// ============================================

	/**
	 * Validate a single Linear ticket using AI
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_VALIDATE_TICKET,
		async (
			_,
			projectId: string,
			ticketId: string,
			skipCache: boolean,
		): Promise<IPCResult<any>> => {
			debugLog("Validation request started", { ticketId, skipCache, projectId });

			const project = projectStore.getProject(projectId);
			if (!project) {
				debugLog("Validation failed: Project not found", { projectId });
				return { success: false, error: "Project not found" };
			}

			// Track this validation
			activeValidations.set(ticketId, {
				startTime: Date.now(),
				lastProgress: Date.now()
			});

			try {
				debugLog("Calling agentManager.validateLinearTicket", { ticketId, skipCache });

				// Run the validation agent
				const result = await agentManager.validateLinearTicket(
					`linear-validation-${ticketId}`,
					project.path,
					ticketId,
					skipCache,
				);

				// Clean up tracking
				activeValidations.delete(ticketId);

				if (!result || !result.success) {
					debugLog("Validation failed", { ticketId, error: result?.error });
					return { success: false, error: result?.error || "Validation failed" };
				}

				const hasCached = result.data?.cached ?? false;
				const status = result.data?.status ?? "unknown";
				debugLog("Validation response received", { ticketId, status, hasCached, skipCache });

				return { success: true, data: result.data };
			} catch (error) {
				// Clean up tracking on error
				activeValidations.delete(ticketId);

				debugLog("Validation error", { ticketId, error });
				return {
					success: false,
					error: error instanceof Error ? error.message : "Validation failed",
				};
			}
		},
	);

	/**
	 * Validate multiple Linear tickets in batch (max 5)
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_VALIDATE_BATCH,
		async (
			_,
			projectId: string,
			ticketIds: string[],
			skipCache: boolean,
		): Promise<IPCResult<any>> => {
			debugLog("Batch validation request started", { ticketIds, skipCache, projectId });

			const project = projectStore.getProject(projectId);
			if (!project) {
				debugLog("Batch validation failed: Project not found", { projectId });
				return { success: false, error: "Project not found" };
			}

			// Enforce max 5 tickets per batch
			if (ticketIds.length > 5) {
				debugLog("Batch validation failed: Too many tickets", { count: ticketIds.length });
				return { success: false, error: "Maximum 5 tickets allowed per batch" };
			}

			try {
				debugLog("Calling agentManager.validateLinearTicketBatch", { ticketIds, skipCache });

				const results = await agentManager.validateLinearTicketBatch(
					`linear-batch-${ticketIds.join("-")}`,
					project.path,
					ticketIds,
					skipCache,
				);

				if (!results || !results.success) {
					debugLog("Batch validation failed", { ticketIds, error: results?.error });
					return {
						success: false,
						error: results?.error || "Batch validation failed",
					};
				}

				const resultCount = results.data?.results?.length ?? 0;
				debugLog("Batch validation response received", {
					ticketIds,
					resultCount,
					skipCache,
				});

				return { success: true, data: results.data };
			} catch (error) {
				debugLog("Batch validation error", { ticketIds, error });
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Batch validation failed",
				};
			}
		},
	);

	/**
	 * Cancel an ongoing validation
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_CANCEL_VALIDATION,
		async (_, ticketId: string): Promise<IPCResult<void>> => {
			debugLog("Cancel validation requested", { ticketId });

			try {
				// Find and kill the running validation task
				// The task ID format is "linear-validation-{ticketId}"
				const taskId = `linear-validation-${ticketId}`;

				if (agentManager.isRunning(taskId)) {
					const killed = agentManager.killTask(taskId);
					if (killed) {
						debugLog("Validation cancelled successfully", { ticketId });
						// Clean up tracking
						activeValidations.delete(ticketId);
						return { success: true };
					} else {
						debugLog("Failed to cancel validation", { ticketId });
						return { success: false, error: "Failed to cancel validation" };
					}
				} else {
					debugLog("No active validation to cancel", { ticketId });
					return { success: false, error: "No active validation found" };
				}
			} catch (error) {
				debugLog("Cancel validation error", { ticketId, error });
				return {
					success: false,
					error: error instanceof Error ? error.message : "Failed to cancel validation",
				};
			}
		},
	);

	/**
	 * Update a Linear ticket with validation results
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_UPDATE_TICKET_WITH_VALIDATION,
		async (
			_,
			projectId: string,
			ticketId: string,
			validation: any,
		): Promise<IPCResult<any>> => {
			debugLog("Update ticket with validation started", { ticketId, projectId });

			const project = projectStore.getProject(projectId);
			if (!project) {
				debugLog("Update failed: Project not found", { projectId });
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				debugLog("Update failed: No Linear API key", { projectId });
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				// Build labels from validation
				const labels =
					validation.suggestedLabels?.map((l: { name: string }) => l.name) ||
					[];

				// Add validation label
				labels.push("AI-Validated");

				debugLog("Updating ticket labels", { ticketId, labels });

				const mutation = `
          mutation($issueId: ID!, $labels: [String!]!) {
            issueUpdate(id: $issueId, input: { labelIds: $labels }) {
              success
              issue {
                id
                labels {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        `;

				// First, get existing labels
				const query = `
          query($issueId: ID!) {
            issue(id: $issueId) {
              labels {
                nodes {
                  id
                  name
                }
              }
            }
          }
        `;

				const queryData = (await linearGraphQL(apiKey, query, {
					issueId: ticketId,
				})) as {
					issue: { labels: { nodes: Array<{ id: string; name: string }> } };
				};

				// Get all team labels to find IDs
				const labelsQuery = `
          query {
            teams {
              nodes {
                labels {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        `;

				interface LinearLabel {
					id: string;
					name: string;
				}

				interface LinearTeamLabels {
					labels: { nodes: LinearLabel[] };
				}

				interface LinearLabelsResponse {
					teams: { nodes: LinearTeamLabels[] };
				}

				const labelsData = (await linearGraphQL(
					apiKey,
					labelsQuery,
				)) as LinearLabelsResponse;

				// Build label ID map
				const labelIdMap = new Map<string, string>();
				for (const team of labelsData.teams.nodes) {
					for (const label of team.labels.nodes) {
						labelIdMap.set(label.name, label.id);
					}
				}

				// Combine existing labels with new labels
				const existingLabels = queryData.issue.labels.nodes.map((l) => l.name);
				const allLabels = new Set([...existingLabels, ...labels]);

				const labelIds = Array.from(allLabels)
					.map((name) => labelIdMap.get(name))
					.filter((id): id is string => id !== undefined);

				debugLog("Applying label IDs to ticket", { ticketId, labelIds });

				await linearGraphQL(apiKey, mutation, {
					issueId: ticketId,
					labels: labelIds,
				});

				debugLog("Ticket update complete", { ticketId });
				return { success: true, data: { updated: true } };
			} catch (error) {
				debugLog("Ticket update error", { ticketId, error });
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to update ticket",
				};
			}
		},
	);

	/**
	 * Clear validation cache
	 * Note: The in-memory validation results are cleared by the frontend
	 * via clearValidationResults(). The backend disk cache is stored
	 * per-project at <spec_dir>/.cache/linear_validator and has
	 * timestamp-based invalidation, so explicit clearing is not required.
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_CLEAR_CACHE,
		async (_): Promise<IPCResult<void>> => {
			debugLog("Clear cache requested");
			// No-op - frontend clears in-memory cache via clearValidationResults()
			// Backend disk cache is per-project with timestamp-based invalidation
			return { success: true, data: undefined };
		},
	);

	console.warn('[Linear] Linear integration handlers registered');
}
