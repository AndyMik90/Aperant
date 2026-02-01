import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  AzureDevOpsIteration,
  AzureDevOpsWorkItem,
  AzureDevOpsSyncStatus,
  AzureDevOpsConfig,
  IPCResult
} from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * Azure DevOps Integration API response types
 */
export interface AzureDevOpsIterationsResponse {
  success: boolean;
  iterations?: AzureDevOpsIteration[];
  project?: string;
  team?: string;
  organizationUrl?: string;
  error?: string;
}

export interface AzureDevOpsWorkItemsResponse {
  success: boolean;
  workItems?: AzureDevOpsWorkItem[];
  error?: string;
}

export interface AzureDevOpsAreasResponse {
  success: boolean;
  areas?: Array<{ id: string; name: string; path: string }>;
  error?: string;
}

/**
 * Azure DevOps Integration API operations
 */
export interface AzureDevOpsAPI {
  getConfig: (projectId: string) => Promise<IPCResult<AzureDevOpsConfig>>;
  getIterations: (projectId: string) => Promise<AzureDevOpsIterationsResponse>;
  getCurrentIteration: (projectId: string) => Promise<IPCResult<AzureDevOpsIteration>>;
  getWorkItemsForIteration: (projectId: string, iterationPath: string, areaPath?: string) => Promise<AzureDevOpsWorkItemsResponse>;
  getWorkItem: (projectId: string, workItemId: number) => Promise<IPCResult<AzureDevOpsWorkItem>>;
  getAreas: (projectId: string) => Promise<AzureDevOpsAreasResponse>;
  checkConnection: (projectId: string) => Promise<IPCResult<AzureDevOpsSyncStatus>>;
}

/**
 * Creates the Azure DevOps Integration API implementation
 */
export const createAzureDevOpsAPI = (): AzureDevOpsAPI => ({
  getConfig: (projectId: string): Promise<IPCResult<AzureDevOpsConfig>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_CONFIG, projectId),

  getIterations: (projectId: string): Promise<AzureDevOpsIterationsResponse> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_ITERATIONS, projectId),

  getCurrentIteration: (projectId: string): Promise<IPCResult<AzureDevOpsIteration>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_CURRENT_ITERATION, projectId),

  getWorkItemsForIteration: (projectId: string, iterationPath: string, areaPath?: string): Promise<AzureDevOpsWorkItemsResponse> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEMS, projectId, iterationPath, areaPath),

  getWorkItem: (projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsWorkItem>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_WORK_ITEM, projectId, workItemId),

  getAreas: (projectId: string): Promise<AzureDevOpsAreasResponse> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_AREAS, projectId),

  checkConnection: (projectId: string): Promise<IPCResult<AzureDevOpsSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION, projectId)
});
