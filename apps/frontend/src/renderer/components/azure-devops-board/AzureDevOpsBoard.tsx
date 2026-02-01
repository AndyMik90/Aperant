import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { useProjectStore } from '../../stores/project-store';
import { useTaskStore } from '../../stores/task-store';
import { BoardHeader } from './components/BoardHeader';
import { BoardColumns } from './components/BoardColumns';
import { WorkItemDetailDialog } from './components/WorkItemDetailDialog';
import { useAzureDevOpsBoard } from './hooks/useAzureDevOpsBoard';
import { stripHtmlTags } from '../../../shared/utils/html';
import type { AzureDevOpsBoardProps, AzureDevOpsWorkItem } from './types';

interface NotConnectedStateProps {
  error?: string | null;
  onOpenSettings?: () => void;
}

function NotConnectedState({ error, onOpenSettings }: NotConnectedStateProps) {
  const { t } = useTranslation(['azureDevOps', 'common']);
  
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <AlertCircle className="h-12 w-12" />
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">
          {t('azureDevOps:notConnected.title', 'Azure DevOps Not Connected')}
        </p>
        <p className="text-sm max-w-md">
          {error || t('azureDevOps:notConnected.description', 'Configure Azure DevOps in project settings to view and manage work items.')}
        </p>
      </div>
      {onOpenSettings && (
        <Button variant="outline" onClick={onOpenSettings}>
          <Settings className="h-4 w-4 mr-2" />
          {t('common:buttons.openSettings', 'Open Settings')}
        </Button>
      )}
    </div>
  );
}

export function AzureDevOpsBoard({ onNavigateToTask, onOpenSettings }: AzureDevOpsBoardProps) {
  const { t } = useTranslation(['azureDevOps', 'common']);
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selectedProject = projects.find((p) => p.id === (activeProjectId || selectedProjectId));
  
  const addTask = useTaskStore((state) => state.addTask);
  
  const {
    syncStatus,
    areas,
    iterations,
    columns,
    selectedAreaPath,
    selectedIteration,
    isLoading,
    error,
    selectArea,
    selectIteration,
    refresh
  } = useAzureDevOpsBoard();
  
  const [selectedWorkItem, setSelectedWorkItem] = useState<AzureDevOpsWorkItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  
  const handleCardClick = useCallback((workItem: AzureDevOpsWorkItem) => {
    setSelectedWorkItem(workItem);
    setIsDetailOpen(true);
  }, []);
  
  const handleConvertToKanban = useCallback(async (workItem: AzureDevOpsWorkItem) => {
    if (!selectedProject?.id) return;
    
    setIsConverting(true);
    try {
      const taskTitle = `${workItem.id} - ${workItem.title}`;
      const result = await window.electronAPI.createTask(
        selectedProject.id,
        taskTitle,
        stripHtmlTags(workItem.description),
        {
          azureDevOpsWorkItemId: workItem.id,
          azureDevOpsUrl: workItem.htmlUrl || workItem.url,
          acceptanceCriteria: workItem.acceptanceCriteria ? [stripHtmlTags(workItem.acceptanceCriteria)] : undefined
        }
      );
      
      if (result.success && result.data) {
        addTask(result.data);
        
        setIsDetailOpen(false);
        setSelectedWorkItem(null);
        
        if (onNavigateToTask) {
          onNavigateToTask(result.data.id);
        }
      } else {
        console.error('Failed to convert work item to task:', result.error);
      }
    } catch (err) {
      console.error('Failed to convert work item to task:', err);
    } finally {
      setIsConverting(false);
    }
  }, [selectedProject?.id, addTask, onNavigateToTask]);
  
  const handleIterationChange = useCallback((iterationId: string) => {
    selectIteration(iterationId);
  }, [selectIteration]);

  const handleAreaChange = useCallback((areaPath: string) => {
    selectArea(areaPath);
  }, [selectArea]);
  
  // Show loading state while initial fetch is in progress
  if (isLoading && !syncStatus) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>{t('azureDevOps:board.loading', 'Loading...')}</span>
          </div>
        </div>
      </div>
    );
  }
  
  // Not connected state (only show after loading completes)
  if (!syncStatus?.connected) {
    return (
      <NotConnectedState
        error={syncStatus?.error || error}
        onOpenSettings={onOpenSettings}
      />
    );
  }
  
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <BoardHeader
        projectName={syncStatus.project}
        teamName={syncStatus.team}
        areas={areas}
        selectedAreaPath={selectedAreaPath}
        onAreaChange={handleAreaChange}
        iterations={iterations}
        selectedIterationId={selectedIteration?.id}
        onIterationChange={handleIterationChange}
        onRefresh={refresh}
        isLoading={isLoading}
        workItemCount={syncStatus.workItemCount}
      />
      
      {/* Board Columns */}
      <div className="flex-1 overflow-hidden">
        <BoardColumns
          columns={columns}
          onCardClick={handleCardClick}
          isLoading={isLoading}
        />
      </div>
      
      {/* Work Item Detail Dialog */}
      <WorkItemDetailDialog
        workItem={selectedWorkItem}
        isOpen={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        onConvertToKanban={handleConvertToKanban}
        isConverting={isConverting}
      />
    </div>
  );
}
