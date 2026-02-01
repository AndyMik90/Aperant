import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import type {
  UseAzureDevOpsBoardReturn,
  AzureDevOpsIteration,
  AzureDevOpsWorkItem,
  AzureDevOpsSyncStatus,
  AzureDevOpsArea,
  BoardColumnData
} from '../types';
import { DEFAULT_STATE_COLUMNS } from '../types';

// Storage keys for persisting selections
const STORAGE_KEY_PREFIX = 'azure-devops-board';
const getStorageKey = (projectId: string, key: string) => `${STORAGE_KEY_PREFIX}:${projectId}:${key}`;

function getStoredSelection(projectId: string, key: string): string | undefined {
  try {
    const value = localStorage.getItem(getStorageKey(projectId, key));
    return value || undefined;
  } catch {
    return undefined;
  }
}

function setStoredSelection(projectId: string, key: string, value: string | undefined): void {
  try {
    const storageKey = getStorageKey(projectId, key);
    if (value) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
  }
}

const DEFAULT_COLUMNS: BoardColumnData[] = [
  { id: 'todo', name: 'To Do', workItems: [], columnType: 'incoming' },
  { id: 'inprogress', name: 'In Progress', workItems: [], columnType: 'inProgress' },
  { id: 'done', name: 'Done', workItems: [], columnType: 'outgoing' }
];

function groupWorkItemsIntoColumns(workItems: AzureDevOpsWorkItem[]): BoardColumnData[] {
  const columns: BoardColumnData[] = DEFAULT_COLUMNS.map(col => ({
    ...col,
    workItems: []
  }));

  const columnMap: Record<string, BoardColumnData> = {};
  for (const col of columns) {
    columnMap[col.name] = col;
  }

  for (const item of workItems) {
    const mappedColumn = DEFAULT_STATE_COLUMNS[item.state] || 'To Do';
    const column = columnMap[mappedColumn];
    if (column) {
      column.workItems.push(item);
    } else {
      columnMap['To Do']?.workItems.push(item);
    }
  }

  return columns;
}

export function useAzureDevOpsBoard(): UseAzureDevOpsBoardReturn {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);

  // Detect web mode
  const isWeb = typeof window !== 'undefined' && 
    (window.location?.protocol?.startsWith('http') || 
     (window as any).electronAPI?.platform === 'web');

  const [syncStatus, setSyncStatus] = useState<AzureDevOpsSyncStatus | null>(null);
  const [areas, setAreas] = useState<AzureDevOpsArea[]>([]);
  const [iterations, setIterations] = useState<AzureDevOpsIteration[]>([]);
  const [workItems, setWorkItems] = useState<AzureDevOpsWorkItem[]>([]);
  const [selectedAreaPath, setSelectedAreaPath] = useState<string | undefined>();
  const [selectedIterationId, setSelectedIterationId] = useState<string | undefined>();
  // Start with loading=true to prevent flash of "Not Connected" state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Use ref to track if initial fetch has been done for current project
  const initialFetchDoneRef = useRef<string | null>(null);

  // If in web mode, set error immediately
  useEffect(() => {
    if (isWeb) {
      setIsLoading(false);
      setError('Azure DevOps integration is only available in the desktop app. Please download and use the Auto Claude desktop application to access Azure DevOps features.');
      setSyncStatus({
        connected: false,
        error: 'Azure DevOps integration requires the desktop app'
      });
      return;
    }
  }, [isWeb]);

  const fetchAreas = useCallback(async (projectId: string) => {
    try {
      const result = await window.electronAPI.azureDevOps?.getAreas(projectId);

      if (result?.success && result.areas) {
        setAreas(result.areas);

        const storedAreaPath = getStoredSelection(projectId, 'areaPath');
        const validStoredArea = storedAreaPath && result.areas.some(a => a.path === storedAreaPath);

        if (validStoredArea) {
          setSelectedAreaPath(storedAreaPath);
        } else if (result.areas.length > 0) {
          setSelectedAreaPath(result.areas[0].path);
          setStoredSelection(projectId, 'areaPath', result.areas[0].path);
        }
      }
    } catch (err) {
      console.error('[AzureDevOps] Error fetching areas:', err);
    }
  }, []);

  const fetchIterations = useCallback(async (projectId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.azureDevOps?.getIterations(projectId);

      if (result?.success && result.iterations) {
        console.log('[AzureDevOps] Iterations fetched:', result.iterations);
        setIterations(result.iterations);
        setSyncStatus({
          connected: true,
          project: result.project,
          team: result.team,
          organizationUrl: result.organizationUrl
        });

        const storedIterationId = getStoredSelection(projectId, 'iterationId');
        const validStoredIteration = storedIterationId && result.iterations.some(i => i.id === storedIterationId);
        
        if (validStoredIteration) {
          console.log('[AzureDevOps] Restoring iteration from storage:', storedIterationId);
          setSelectedIterationId(storedIterationId);
        } else {
          const currentIteration = result.iterations.find(
            iter =>
              iter.isCurrent || iter.state === 'current' || iter.attributes?.timeFrame === 'current'
          );

          if (currentIteration) {
            console.log('[AzureDevOps] Auto-selecting current iteration:', currentIteration.id, currentIteration.path);
            setSelectedIterationId(currentIteration.id);
            setStoredSelection(projectId, 'iterationId', currentIteration.id);
          }
        }
      } else {
        setSyncStatus({
          connected: false,
          error: result?.error || 'Failed to fetch iterations'
        });
        setError(result?.error || 'Failed to fetch iterations');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setSyncStatus({ connected: false, error: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchWorkItems = useCallback(async (projectId: string, iterationPath: string, areaPath?: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await window.electronAPI.azureDevOps?.getWorkItemsForIteration(
        projectId,
        iterationPath,
        areaPath
      );

      if (result?.success && result.workItems) {
        setWorkItems(result.workItems);
        setSyncStatus((prev) => ({
          ...prev,
          connected: true,
          workItemCount: result.workItems?.length ?? 0,
          lastSyncedAt: new Date().toISOString()
        }));
      } else {
        setError(result?.error || 'Failed to fetch work items');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Effect for initial project load - only runs when project changes
  useEffect(() => {
    // Skip in web mode
    if (isWeb) return;
    
    if (selectedProjectId && initialFetchDoneRef.current !== selectedProjectId) {
      // Reset state for new project
      setAreas([]);
      setIterations([]);
      setWorkItems([]);
      setSelectedAreaPath(undefined);
      setSelectedIterationId(undefined);
      setSyncStatus(null);
      setError(null);
      setIsLoading(true);
      
      initialFetchDoneRef.current = selectedProjectId;
      // Fetch areas first, then iterations
      fetchAreas(selectedProjectId);
      fetchIterations(selectedProjectId);
    }
  }, [selectedProjectId, fetchAreas, fetchIterations, isWeb]);

  // Effect for fetching work items when iteration or area changes
  useEffect(() => {
    // Skip in web mode
    if (isWeb) return;
    
    if (selectedProjectId && selectedIterationId) {
      // Find the iteration to get its path (WIQL needs path, not ID)
      const iteration = iterations.find(i => i.id === selectedIterationId);
      if (iteration?.path) {
        // Pass selected area path if available
        fetchWorkItems(selectedProjectId, iteration.path, selectedAreaPath);
      }
    }
  }, [selectedProjectId, selectedIterationId, selectedAreaPath, iterations, fetchWorkItems, isWeb]);

  const columns = useMemo(() => groupWorkItemsIntoColumns(workItems), [workItems]);

  const selectedIteration = useMemo(
    () => iterations.find((iter) => iter.id === selectedIterationId) || null,
    [iterations, selectedIterationId]
  );

  const selectIteration = useCallback((iterationId: string) => {
    setSelectedIterationId(iterationId);
    if (selectedProjectId) {
      setStoredSelection(selectedProjectId, 'iterationId', iterationId);
    }
  }, [selectedProjectId]);

  const selectArea = useCallback((areaPath: string) => {
    setSelectedAreaPath(areaPath);
    if (selectedProjectId) {
      setStoredSelection(selectedProjectId, 'areaPath', areaPath);
    }
  }, [selectedProjectId]);

  const refresh = useCallback(() => {
    if (selectedProjectId) {
      fetchAreas(selectedProjectId);
      fetchIterations(selectedProjectId);
    }
  }, [selectedProjectId, fetchAreas, fetchIterations]);

  return {
    syncStatus,
    areas,
    iterations,
    workItems,
    columns,
    selectedAreaPath,
    selectedIteration,
    isLoading,
    error,
    selectArea,
    selectIteration,
    refresh
  };
}
