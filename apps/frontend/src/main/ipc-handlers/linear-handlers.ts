import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "fs";
import path from "path";
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
import { projectStore } from "../project-store";
import { parseEnvFile } from "./utils";

/**
 * Register all linear-related IPC handlers
 */
export function registerLinearHandlers(
	agentManager: AgentManager,
	_getMainWindow: () => BrowserWindow | null,
): void {
	// ============================================
	// Linear Integration Operations
	// ============================================

	/**
	 * Helper to get Linear API key from project env
	 */
	const getLinearApiKey = (project: Project): string | null => {
		if (!project.autoBuildPath) return null;
		const envPath = path.join(project.path, project.autoBuildPath, ".env");
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
					// Note: These queries are kept as documentation for future API reference
					const _countQuery = `
            query($teamId: String!) {
              team(id: $teamId) {
                issues {
                  totalCount: nodes { id }
                }
              }
            }
          `;
					// Get approximate count
					const _issuesQuery = `
            query($teamId: ID!) {
              issues(filter: { team: { id: { eq: $teamId } } }, first: 0) {
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
					void _countQuery;
					void _issuesQuery;

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
				const specsDir = path.join(project.path, specsBaseDir);
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
						const specDir = path.join(specsDir, specId);
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
							path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
							JSON.stringify(implementationPlan, null, 2),
						);

						// Create requirements.json
						const requirements = {
							task_description: description,
							workflow_type: "feature",
						};
						writeFileSync(
							path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS),
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
							path.join(specDir, "task_metadata.json"),
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
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			try {
				// Run the validation agent
				const result = await agentManager.validateLinearTicket(
					`linear-validation-${ticketId}`,
					project.path,
					ticketId,
					skipCache,
				);

				if (!result || !result.success) {
					return { success: false, error: result?.error || "Validation failed" };
				}

				return { success: true, data: result.data };
			} catch (error) {
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
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			// Enforce max 5 tickets per batch
			if (ticketIds.length > 5) {
				return { success: false, error: "Maximum 5 tickets allowed per batch" };
			}

			try {
				const results = await agentManager.validateLinearTicketBatch(
					`linear-batch-${ticketIds.join("-")}`,
					project.path,
					ticketIds,
					skipCache,
				);

				if (!results || !results.success) {
					return {
						success: false,
						error: results?.error || "Batch validation failed",
					};
				}

				return { success: true, data: results.data };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Batch validation failed",
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
			const project = projectStore.getProject(projectId);
			if (!project) {
				return { success: false, error: "Project not found" };
			}

			const apiKey = getLinearApiKey(project);
			if (!apiKey) {
				return { success: false, error: "No Linear API key configured" };
			}

			try {
				// Build labels from validation
				const labels =
					validation.suggestedLabels?.map((l: { name: string }) => l.name) ||
					[];

				// Add validation label
				labels.push("AI-Validated");

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

				await linearGraphQL(apiKey, mutation, {
					issueId: ticketId,
					labels: labelIds,
				});

				return { success: true, data: { updated: true } };
			} catch (error) {
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
	 */
	ipcMain.handle(
		IPC_CHANNELS.LINEAR_CLEAR_CACHE,
		async (_): Promise<IPCResult<void>> => {
			try {
				const cacheDir = path.join(
					process.env.HOME || ".",
					".auto-claude",
					"specs",
					".cache",
					"linear_validator",
				);

				const fs = await import("fs/promises");
				try {
					await fs.rm(cacheDir, { recursive: true, force: true });
				} catch {
					// Cache dir might not exist, that's ok
				}

				return { success: true, data: undefined };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Failed to clear cache",
				};
			}
		},
	);
}
