/**
 * Azure DevOps Integration IPC Handlers
 *
 * Handles communication between renderer and main process for Azure DevOps operations.
 * Uses Azure DevOps REST API to fetch real data.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { projectStore } from '../project-store';
import type {
  AzureDevOpsIteration,
  AzureDevOpsWorkItem,
  AzureDevOpsSyncStatus,
  AzureDevOpsConfig,
  IPCResult
} from '../../shared/types';

/**
 * Helper to make authenticated Azure DevOps API requests
 */
async function azureDevOpsRequest<T>(
  url: string,
  pat: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown
): Promise<T> {
  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  
  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure DevOps API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Get Azure DevOps configuration from project env
 */
async function getAzureDevOpsConfig(projectId: string): Promise<AzureDevOpsConfig | null> {
  try {
    const project = projectStore.getProject(projectId);
    if (!project?.autoBuildPath) {
      return null;
    }

    // Read project env file for Azure DevOps settings
    const fs = await import('fs/promises');
    const path = await import('path');
    const envPath = path.join(project.path, project.autoBuildPath, '.env');

    try {
      const envContent = await fs.readFile(envPath, 'utf-8');
      const envLines = envContent.split('\n');

      let enabled = false;
      let organizationUrl: string | undefined;
      let projectName: string | undefined;
      let team: string | undefined;
      let pat: string | undefined;

      for (const line of envLines) {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim();

        switch (key.trim()) {
          case 'AZURE_DEVOPS_ENABLED':
            enabled = value.toLowerCase() === 'true';
            break;
          case 'AZURE_DEVOPS_ORGANIZATION_URL':
            organizationUrl = value;
            break;
          case 'AZURE_DEVOPS_PROJECT':
            projectName = value;
            break;
          case 'AZURE_DEVOPS_TEAM':
            team = value;
            break;
          case 'AZURE_DEVOPS_PAT':
            pat = value;
            break;
        }
      }

      return {
        enabled,
        organizationUrl,
        project: projectName,
        team,
        personalAccessToken: pat
      };
    } catch {
      // No env file or can't read it
      return { enabled: false };
    }
  } catch (error) {
    console.error('[AzureDevOps] Error getting config:', error);
    return null;
  }
}

/**
 * Get iterations (sprints) for the project/team from Azure DevOps API
 */
async function getIterations(projectId: string): Promise<{
  success: boolean;
  iterations?: AzureDevOpsIteration[];
  project?: string;
  team?: string;
  organizationUrl?: string;
  error?: string;
}> {
  const config = await getAzureDevOpsConfig(projectId);

  if (!config || !config.enabled) {
    return {
      success: false,
      error: 'Azure DevOps integration is not enabled'
    };
  }

  if (!config.organizationUrl || !config.project || !config.personalAccessToken) {
    return {
      success: false,
      error: 'Azure DevOps configuration is incomplete'
    };
  }

  try {
    // Build API URL - if team is specified, use team iterations, otherwise use project iterations
    let url: string;
    if (config.team) {
      url = `${config.organizationUrl}/${encodeURIComponent(config.project)}/${encodeURIComponent(config.team)}/_apis/work/teamsettings/iterations?api-version=7.0`;
    } else {
      // Get project iterations (classification nodes)
      url = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/wit/classificationnodes/iterations?$depth=10&api-version=7.0`;
    }

    const response = await azureDevOpsRequest<{
      value?: Array<{
        id: string;
        name: string;
        path: string;
        attributes?: {
          startDate?: string;
          finishDate?: string;
          timeFrame?: 'past' | 'current' | 'future';
        };
      }>;
      // For classification nodes response
      children?: Array<{
        id: number;
        identifier: string;
        name: string;
        path: string;
        attributes?: {
          startDate?: string;
          finishDate?: string;
        };
      }>;
    }>(url, config.personalAccessToken);

    let iterations: AzureDevOpsIteration[] = [];

    if (response.value) {
      // Team iterations response
      iterations = response.value.map(iter => {
        const timeFrame = iter.attributes?.timeFrame;
        return {
          id: iter.id,
          name: iter.name,
          path: iter.path,
          startDate: iter.attributes?.startDate,
          finishDate: iter.attributes?.finishDate,
          state: timeFrame,
          isCurrent: timeFrame === 'current',
          attributes: iter.attributes
        };
      });
    } else if (response.children) {
      // Classification nodes response (project-level)
      const now = new Date();
      iterations = response.children.map(node => {
        const startDate = node.attributes?.startDate ? new Date(node.attributes.startDate) : undefined;
        const finishDate = node.attributes?.finishDate ? new Date(node.attributes.finishDate) : undefined;
        
        let state: 'past' | 'current' | 'future' | undefined;
        let isCurrent = false;
        
        if (startDate && finishDate) {
          if (now >= startDate && now <= finishDate) {
            state = 'current';
            isCurrent = true;
          } else if (now > finishDate) {
            state = 'past';
          } else {
            state = 'future';
          }
        }

        return {
          id: node.identifier || String(node.id),
          name: node.name,
          path: node.path,
          startDate: node.attributes?.startDate,
          finishDate: node.attributes?.finishDate,
          state,
          isCurrent,
          attributes: node.attributes ? {
            startDate: node.attributes.startDate,
            finishDate: node.attributes.finishDate,
            timeFrame: state
          } : undefined
        };
      });
    }

    // Sort by start date, most recent first
    iterations.sort((a, b) => {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    });

    return {
      success: true,
      iterations,
      project: config.project,
      team: config.team,
      organizationUrl: config.organizationUrl
    };
  } catch (error) {
    console.error('[AzureDevOps] Error fetching iterations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch iterations'
    };
  }
}

/**
 * Get work items for a specific iteration and area using WIQL query
 */
async function getWorkItemsForIteration(
  projectId: string,
  iterationPath: string,
  areaPath?: string
): Promise<{
  success: boolean;
  workItems?: AzureDevOpsWorkItem[];
  error?: string;
}> {
  const config = await getAzureDevOpsConfig(projectId);

  if (!config || !config.enabled) {
    return {
      success: false,
      error: 'Azure DevOps integration is not enabled'
    };
  }

  if (!config.organizationUrl || !config.project || !config.personalAccessToken) {
    return {
      success: false,
      error: 'Azure DevOps configuration is incomplete'
    };
  }

  try {
    // Use WIQL to query work items for the iteration
    const wiqlUrl = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/wit/wiql?api-version=7.0`;
    
    // Clean iteration path for WIQL query:
    // - Remove leading backslash
    // - Remove \Iteration segment (API returns paths like \Project\Iteration\Sprint but WIQL needs Project\Sprint)
    let cleanIterationPath = iterationPath;
    // Remove leading backslash
    while (cleanIterationPath.startsWith('\\')) {
      cleanIterationPath = cleanIterationPath.substring(1);
    }
    // Remove \Iteration\ segment from path
    cleanIterationPath = cleanIterationPath.replace(/\\Iteration\\/g, '\\');
    
    // Clean area path similarly:
    // - Remove leading backslash
    // - Remove \Area segment (API returns paths like \Project\Area\Team but WIQL needs Project\Team)
    let cleanAreaPath = areaPath || '';
    // Remove leading backslash
    while (cleanAreaPath.startsWith('\\')) {
      cleanAreaPath = cleanAreaPath.substring(1);
    }
    // Remove \Area\ segment from path
    cleanAreaPath = cleanAreaPath.replace(/\\Area\\/g, '\\');
    // Handle case where path ends with \Area (root area)
    cleanAreaPath = cleanAreaPath.replace(/\\Area$/, '');

    console.log('[AzureDevOps] WIQL paths - iteration:', cleanIterationPath, ', area:', cleanAreaPath);

    // Build WHERE clause - always filter by iteration, optionally by area
    let whereClause = `[System.IterationPath] UNDER '${cleanIterationPath}'`;
    if (cleanAreaPath) {
      whereClause += ` AND [System.AreaPath] UNDER '${cleanAreaPath}'`;
    }

    const wiqlQuery = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.CreatedDate], [System.ChangedDate], [Microsoft.VSTS.Common.Priority], [System.Tags], [System.IterationPath], [System.AreaPath], [Microsoft.VSTS.Scheduling.StoryPoints], [Microsoft.VSTS.Scheduling.Effort], [System.Description], [Microsoft.VSTS.Common.AcceptanceCriteria]
              FROM WorkItems 
              WHERE ${whereClause}
              ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.CreatedDate] DESC`
    };

    const wiqlResponse = await azureDevOpsRequest<{
      workItems?: Array<{ id: number; url: string }>;
    }>(wiqlUrl, config.personalAccessToken, 'POST', wiqlQuery);

    if (!wiqlResponse.workItems || wiqlResponse.workItems.length === 0) {
      return {
        success: true,
        workItems: []
      };
    }

    // Fetch full work item details (batch of up to 200 at a time)
    const workItemIds = wiqlResponse.workItems.map(wi => wi.id).slice(0, 200);
    const detailsUrl = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/wit/workitems?ids=${workItemIds.join(',')}&$expand=all&api-version=7.0`;
    
    const detailsResponse = await azureDevOpsRequest<{
      value: Array<{
        id: number;
        rev: number;
        url: string;
        fields: {
          'System.Id': number;
          'System.Title': string;
          'System.Description'?: string;
          'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
          'Custom.Design'?: string;
          'System.State': string;
          'System.WorkItemType': string;
          'System.AssignedTo'?: {
            displayName: string;
            uniqueName: string;
            imageUrl?: string;
          };
          'System.CreatedDate': string;
          'System.ChangedDate': string;
          'Microsoft.VSTS.Common.Priority'?: number;
          'System.Tags'?: string;
          'System.IterationPath': string;
          'System.AreaPath': string;
          'Microsoft.VSTS.Scheduling.StoryPoints'?: number;
          'Microsoft.VSTS.Scheduling.Effort'?: number;
          'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
          'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number;
          'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
          [key: string]: any;
        };
        _links?: {
          html?: { href: string };
        };
      }>;
    }>(detailsUrl, config.personalAccessToken);

    const workItems: AzureDevOpsWorkItem[] = detailsResponse.value.map(wi => ({
      id: wi.id,
      rev: wi.rev,
      title: wi.fields['System.Title'],
      description: wi.fields['System.Description'],
      acceptanceCriteria: wi.fields['Microsoft.VSTS.Common.AcceptanceCriteria'],
      design: wi.fields['Custom.Design'],
      state: wi.fields['System.State'],
      workItemType: wi.fields['System.WorkItemType'],
      assignedTo: wi.fields['System.AssignedTo'] ? {
        displayName: wi.fields['System.AssignedTo'].displayName,
        uniqueName: wi.fields['System.AssignedTo'].uniqueName,
        imageUrl: wi.fields['System.AssignedTo'].imageUrl
      } : undefined,
      createdDate: wi.fields['System.CreatedDate'],
      changedDate: wi.fields['System.ChangedDate'],
      priority: wi.fields['Microsoft.VSTS.Common.Priority'],
      tags: wi.fields['System.Tags'],
      iterationPath: wi.fields['System.IterationPath'],
      areaPath: wi.fields['System.AreaPath'],
      url: wi.url,
      htmlUrl: wi._links?.html?.href,
      storyPoints: wi.fields['Microsoft.VSTS.Scheduling.StoryPoints'],
      effort: wi.fields['Microsoft.VSTS.Scheduling.Effort'],
      remainingWork: wi.fields['Microsoft.VSTS.Scheduling.RemainingWork'],
      originalEstimate: wi.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],
      completedWork: wi.fields['Microsoft.VSTS.Scheduling.CompletedWork'],
      fields: wi.fields
    }));

    return {
      success: true,
      workItems
    };
  } catch (error) {
    console.error('[AzureDevOps] Error fetching work items:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch work items'
    };
  }
}

/**
 * Get areas for the project from Azure DevOps API
 */
async function getAreas(projectId: string): Promise<{
  success: boolean;
  areas?: Array<{ id: string; name: string; path: string }>;
  error?: string;
}> {
  const config = await getAzureDevOpsConfig(projectId);

  if (!config || !config.enabled) {
    return {
      success: false,
      error: 'Azure DevOps integration is not enabled'
    };
  }

  if (!config.organizationUrl || !config.project || !config.personalAccessToken) {
    return {
      success: false,
      error: 'Azure DevOps configuration is incomplete'
    };
  }

  try {
    const url = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.0`;
    
    const response = await azureDevOpsRequest<{
      id: number;
      identifier: string;
      name: string;
      path: string;
      children?: Array<{
        id: number;
        identifier: string;
        name: string;
        path: string;
        children?: Array<unknown>;
      }>;
    }>(url, config.personalAccessToken);

    // Flatten the area tree
    const areas: Array<{ id: string; name: string; path: string }> = [];
    
    function flattenAreas(node: { id?: number; identifier?: string; name: string; path: string; children?: Array<unknown> }, depth = 0) {
      areas.push({
        id: node.identifier || String(node.id),
        name: node.name,
        path: node.path
      });
      
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          flattenAreas(child as { id?: number; identifier?: string; name: string; path: string; children?: Array<unknown> }, depth + 1);
        }
      }
    }
    
    flattenAreas(response);

    return {
      success: true,
      areas
    };
  } catch (error) {
    console.error('[AzureDevOps] Error fetching areas:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch areas'
    };
  }
}

/**
 * Register Azure DevOps IPC handlers
 */
export function registerAzureDevOpsHandlers(getMainWindow: () => BrowserWindow | null): void {
  // Get Azure DevOps configuration
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_GET_CONFIG, async (_event, projectId: string) => {
    try {
      const config = await getAzureDevOpsConfig(projectId);
      return { success: true, data: config };
    } catch (error) {
      console.error('[AzureDevOps] Error getting config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Check Azure DevOps connection
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION, async (_event, projectId: string) => {
    try {
      // Get current env config from the project store
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const envConfig = project.envConfig;
      if (!envConfig) {
        return { success: false, error: 'Project environment config not found' };
      }

      // Check if Azure DevOps is enabled and configured
      if (!envConfig.azureDevOpsEnabled) {
        return {
          success: true,
          data: {
            connected: false,
            error: 'Azure DevOps integration is not enabled'
          }
        };
      }

      if (!envConfig.azureDevOpsOrganizationUrl || !envConfig.azureDevOpsProject || !envConfig.azureDevOpsPersonalAccessToken) {
        return {
          success: true,
          data: {
            connected: false,
            error: 'Azure DevOps configuration is incomplete. Please configure organization URL, project, and PAT.'
          }
        };
      }

      // Test connection by fetching project info
      try {
        const url = `${envConfig.azureDevOpsOrganizationUrl}/_apis/projects/${encodeURIComponent(envConfig.azureDevOpsProject)}?api-version=7.0`;
        await azureDevOpsRequest(url, envConfig.azureDevOpsPersonalAccessToken);
        
        return {
          success: true,
          data: {
            connected: true,
            organizationUrl: envConfig.azureDevOpsOrganizationUrl,
            project: envConfig.azureDevOpsProject,
            team: envConfig.azureDevOpsTeam
          }
        };
      } catch (error) {
        return {
          success: true,
          data: {
            connected: false,
            error: error instanceof Error ? error.message : 'Failed to connect to Azure DevOps'
          }
        };
      }
    } catch (error) {
      console.error('[AzureDevOps] Error checking connection:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get iterations
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_GET_ITERATIONS, async (_event, projectId: string) => {
    try {
      console.log('[AzureDevOps] GET_ITERATIONS called with projectId:', projectId);
      const result = await getIterations(projectId);
      if (result.success && result.iterations) {
        result.iterations.forEach((iter, idx) => {
          console.log(`  [${idx}] id: ${iter.id}, name: ${iter.name}, path: ${iter.path}, isCurrent: ${iter.isCurrent}`);
        });
      }
      return result;
    } catch (error) {
      console.error('[AzureDevOps] Error getting iterations:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get current iteration
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_GET_CURRENT_ITERATION, async (_event, projectId: string) => {
    try {
      const result = await getIterations(projectId);
      if (result.success && result.iterations) {
        const currentIteration = result.iterations.find(i => i.isCurrent || i.state === 'current');
        return { success: true, data: currentIteration || null };
      }
      return { success: false, error: result.error };
    } catch (error) {
      console.error('[AzureDevOps] Error getting current iteration:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get work items for iteration and area
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEMS,
    async (_event, projectId: string, iterationPath: string, areaPath?: string) => {
      try {
        console.log('[AzureDevOps] GET_WORK_ITEMS called with:', { projectId, iterationPath, areaPath });
        const result = await getWorkItemsForIteration(projectId, iterationPath, areaPath);
        console.log('[AzureDevOps] GET_WORK_ITEMS result:', { success: result.success, count: result.workItems?.length });
        return result;
      } catch (error) {
        console.error('[AzureDevOps] Error getting work items:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Get areas
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_GET_AREAS, async (_event, projectId: string) => {
    try {
      console.log('[AzureDevOps] GET_AREAS called with projectId:', projectId);
      const result = await getAreas(projectId);
      if (result.success && result.areas) {
        result.areas.forEach((area, idx) => {
          console.log(`  [${idx}] id: ${area.id}, name: ${area.name}, path: ${area.path}`);
        });
      }
      return result;
    } catch (error) {
      console.error('[AzureDevOps] Error getting areas:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get single work item
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM,
    async (_event, projectId: string, workItemId: number) => {
      try {
        const config = await getAzureDevOpsConfig(projectId);
        if (!config?.organizationUrl || !config?.project || !config?.personalAccessToken) {
          return { success: false, error: 'Azure DevOps configuration is incomplete' };
        }

        const url = `${config.organizationUrl}/${encodeURIComponent(config.project)}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=7.0`;
        const response = await azureDevOpsRequest<{
          id: number;
          rev: number;
          fields: Record<string, unknown>;
          _links?: { html?: { href: string } };
        }>(url, config.personalAccessToken);

        return { 
          success: true, 
          data: {
            id: response.id,
            rev: response.rev,
            title: response.fields['System.Title'] as string,
            description: response.fields['System.Description'] as string,
            state: response.fields['System.State'] as string,
            workItemType: response.fields['System.WorkItemType'] as string,
            htmlUrl: response._links?.html?.href
          }
        };
      } catch (error) {
        console.error('[AzureDevOps] Error getting work item:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[AzureDevOps] IPC handlers registered');
}
