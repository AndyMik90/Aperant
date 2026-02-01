/**
 * Azure DevOps Board component types
 */
import type {
  AzureDevOpsWorkItem,
  AzureDevOpsIteration,
  AzureDevOpsSyncStatus,
  AzureDevOpsBoardColumn
} from '../../../shared/types/integrations';

export type { AzureDevOpsWorkItem, AzureDevOpsIteration, AzureDevOpsSyncStatus, AzureDevOpsBoardColumn };

export interface AzureDevOpsArea {
  id: string;
  name: string;
  path: string;
}

export interface AzureDevOpsBoardProps {
  onNavigateToTask?: (taskId: string) => void;
  onOpenSettings?: () => void;
}

export interface BoardHeaderProps {
  projectName?: string;
  teamName?: string;
  areas: AzureDevOpsArea[];
  selectedAreaPath?: string;
  onAreaChange: (areaPath: string) => void;
  iterations: AzureDevOpsIteration[];
  selectedIterationId?: string;
  onIterationChange: (iterationId: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  workItemCount?: number;
}

export interface BoardColumnsProps {
  columns: BoardColumnData[];
  onCardClick: (workItem: AzureDevOpsWorkItem) => void;
  isLoading?: boolean;
}

export interface BoardColumnData {
  id: string;
  name: string;
  workItems: AzureDevOpsWorkItem[];
  columnType?: 'incoming' | 'inProgress' | 'outgoing';
}

export interface WorkItemCardProps {
  workItem: AzureDevOpsWorkItem;
  onClick: () => void;
}

export interface WorkItemDetailDialogProps {
  workItem: AzureDevOpsWorkItem | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConvertToKanban: (workItem: AzureDevOpsWorkItem) => void;
  isConverting?: boolean;
}

export interface UseAzureDevOpsBoardReturn {
  // Data
  syncStatus: AzureDevOpsSyncStatus | null;
  areas: AzureDevOpsArea[];
  iterations: AzureDevOpsIteration[];
  workItems: AzureDevOpsWorkItem[];
  columns: BoardColumnData[];
  selectedAreaPath: string | undefined;
  selectedIteration: AzureDevOpsIteration | null;
  
  // State
  isLoading: boolean;
  error: string | null;
  
  // Actions
  selectArea: (areaPath: string) => void;
  selectIteration: (iterationId: string) => void;
  refresh: () => void;
}

// Default column mapping for Azure DevOps states
export const DEFAULT_STATE_COLUMNS: Record<string, string> = {
  'New': 'To Do',
  'Active': 'In Progress',
  'Resolved': 'In Progress',
  'Closed': 'Done',
  'Removed': 'Done',
  // Common Agile states
  'To Do': 'To Do',
  'Doing': 'In Progress',
  'Done': 'Done',
  // Scrum states
  'Approved': 'To Do',
  'Committed': 'In Progress',
  // CMMI states
  'Proposed': 'To Do',
  'Ready': 'To Do'
};
