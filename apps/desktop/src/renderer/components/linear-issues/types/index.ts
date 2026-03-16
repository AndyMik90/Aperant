import type { LinearIssue, LinearInvestigationResult, LinearInvestigationStatus, } from '../../../../shared/types';

export type LinearFilterState = 'all' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface LinearIssuesProps {
  onOpenSettings?: () => void;
  /** Navigate to view a task in the kanban board */
  onNavigateToTask?: (taskId: string) => void;
}

export interface LinearIssueListItemProps {
  issue: LinearIssue;
  isSelected: boolean;
  onClick: () => void;
  onInvestigate: () => void;
}

export interface LinearIssueDetailProps {
  issue: LinearIssue;
  onInvestigate: () => void;
  investigationResult: LinearInvestigationResult | null;
  /** ID of existing task linked to this issue (from metadata.linearIssueId) */
  linkedTaskId?: string;
  /** Handler to navigate to view the linked task */
  onViewTask?: (taskId: string) => void;
  /** Project ID for sync functionality */
  projectId?: string;
}

export interface LinearInvestigationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIssue: LinearIssue | null;
  investigationStatus: LinearInvestigationStatus;
  onStartInvestigation: (selectedCommentIds: string[]) => void;
  onClose: () => void;
  projectId?: string;
}

export interface LinearIssueListHeaderProps {
  teamName: string;
  activeIssuesCount: number;
  isLoading: boolean;
  searchQuery: string;
  filterState: LinearFilterState;
  onSearchChange: (query: string) => void;
  onFilterChange: (state: LinearFilterState) => void;
  onRefresh: () => void;
}

export interface LinearIssueListProps {
  issues: LinearIssue[];
  selectedIssueId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelectIssue: (issueId: string) => void;
  onInvestigate: (issue: LinearIssue) => void;
  onRetry?: () => void;
  onOpenSettings?: () => void;
}

export interface LinearEmptyStateProps {
  searchQuery?: string;
  icon?: React.ComponentType<{ className?: string }>;
  message: string;
}

export interface LinearNotConnectedStateProps {
  error: string | null;
  onOpenSettings?: () => void;
}

export interface SyncStatusBadgeProps {
  lastSyncEvent?: {
    success: boolean;
    error?: string;
    toStatus: string;
  } | null;
}
