import { CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import type { Task, WorktreeStatus, WorktreeDiff, MergeConflict, MergeStats, GitConflictInfo, ImageAttachment, WorktreeCreatePRResult } from '../../../shared/types';
import {
  StagedSuccessMessage,
  WorkspaceStatus,
  QAFeedbackSection,
  DiscardDialog,
  DiffViewDialog,
  ConflictDetailsDialog,
  LoadingMessage,
  NoWorkspaceMessage,
  StagedInProjectMessage,
  CreatePRDialog
} from './task-review';

interface TaskReviewProps {
  task: Task;
  feedback: string;
  isSubmitting: boolean;
  worktreeStatus: WorktreeStatus | null;
  worktreeDiff: WorktreeDiff | null;
  isLoadingWorktree: boolean;
  isMerging: boolean;
  isDiscarding: boolean;
  showDiscardDialog: boolean;
  showDiffDialog: boolean;
  workspaceError: string | null;
  stageOnly: boolean;
  stagedSuccess: string | null;
  stagedProjectPath: string | undefined;
  suggestedCommitMessage: string | undefined;
  mergedSuccess: string | null;
  mergePreview: { files: string[]; conflicts: MergeConflict[]; summary: MergeStats; gitConflicts?: GitConflictInfo; uncommittedChanges?: { hasChanges: boolean; files: string[]; count: number } | null } | null;
  isLoadingPreview: boolean;
  showConflictDialog: boolean;
  onFeedbackChange: (value: string) => void;
  onReject: () => void;
  /** Image attachments for visual feedback */
  images?: ImageAttachment[];
  /** Callback when images change */
  onImagesChange?: (images: ImageAttachment[]) => void;
  onMerge: () => void;
  onMarkDone: () => void;
  onDiscard: () => void;
  onShowDiscardDialog: (show: boolean) => void;
  onShowDiffDialog: (show: boolean) => void;
  onStageOnlyChange: (value: boolean) => void;
  onShowConflictDialog: (show: boolean) => void;
  onLoadMergePreview: () => void;
  onClose?: () => void;
  onSwitchToTerminals?: () => void;
  onOpenInbuiltTerminal?: (id: string, cwd: string) => void;
  onReviewAgain?: () => void;
  // PR creation
  showPRDialog: boolean;
  isCreatingPR: boolean;
  onShowPRDialog: (show: boolean) => void;
  onCreatePR: (options: { targetBranch?: string; title?: string; draft?: boolean }) => Promise<WorktreeCreatePRResult | null>;
}

/**
 * TaskReview Component
 *
 * Main component for reviewing task completion, displaying workspace status,
 * merge previews, and providing options to merge, stage, or discard changes.
 *
 * This component has been refactored into smaller, focused sub-components for better
 * maintainability. See ./task-review/ directory for individual component implementations.
 */
export function TaskReview({
  task,
  feedback,
  isSubmitting,
  worktreeStatus,
  worktreeDiff,
  isLoadingWorktree,
  isMerging,
  isDiscarding,
  showDiscardDialog,
  showDiffDialog,
  workspaceError,
  stageOnly,
  stagedSuccess,
  stagedProjectPath,
  suggestedCommitMessage,
  mergedSuccess,
  mergePreview,
  isLoadingPreview,
  showConflictDialog,
  onFeedbackChange,
  onReject,
  images,
  onImagesChange,
  onMerge,
  onMarkDone,
  onDiscard,
  onShowDiscardDialog,
  onShowDiffDialog,
  onStageOnlyChange,
  onShowConflictDialog,
  onLoadMergePreview,
  onClose,
  onSwitchToTerminals,
  onOpenInbuiltTerminal,
  onReviewAgain,
  showPRDialog,
  isCreatingPR,
  onShowPRDialog,
  onCreatePR
}: TaskReviewProps) {
  return (
    <div className="space-y-4">
      {/* Section divider */}
      <div className="section-divider-gradient" />

      {/* Staged Success Message */}
      {stagedSuccess && (
        <StagedSuccessMessage
          stagedSuccess={stagedSuccess}
          suggestedCommitMessage={suggestedCommitMessage}
        />
      )}

      {/* Workspace Status - priority: loading > fresh staging > merged (Mark as Done) > already staged > worktree exists > no workspace */}
      {isLoadingWorktree ? (
        <LoadingMessage />
      ) : stagedSuccess ? (
        /* Fresh staging just completed - StagedSuccessMessage is rendered above */
        null
      ) : mergedSuccess || task.mergedAt ? (
        /* Merged - show "Mark as Done" button */
        <div className="rounded-xl border border-success/30 bg-success/10 p-4">
          <h3 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Changes Merged Successfully
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {mergedSuccess || 'Your changes have been merged into the project. Click "Mark as Done" to complete this task.'}
          </p>
          <Button variant="success" onClick={onMarkDone} className="w-full">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Mark as Done
          </Button>
        </div>
      ) : task.stagedInMainProject ? (
        /* Task was previously staged (persisted state) - show even if worktree still exists */
        <StagedInProjectMessage
          task={task}
          projectPath={stagedProjectPath}
          hasWorktree={worktreeStatus?.exists || false}
          onClose={onClose}
          onReviewAgain={onReviewAgain}
        />
      ) : worktreeStatus?.exists ? (
        /* Worktree exists but not yet staged - show staging UI */
        <WorkspaceStatus
          worktreeStatus={worktreeStatus}
          workspaceError={workspaceError}
          stageOnly={stageOnly}
          mergePreview={mergePreview}
          isLoadingPreview={isLoadingPreview}
          isMerging={isMerging}
          isDiscarding={isDiscarding}
          isCreatingPR={isCreatingPR}
          onShowDiffDialog={onShowDiffDialog}
          onShowDiscardDialog={onShowDiscardDialog}
          onShowConflictDialog={onShowConflictDialog}
          onLoadMergePreview={onLoadMergePreview}
          onStageOnlyChange={onStageOnlyChange}
          onMerge={onMerge}
          onShowPRDialog={onShowPRDialog}
          onClose={onClose}
          onSwitchToTerminals={onSwitchToTerminals}
          onOpenInbuiltTerminal={onOpenInbuiltTerminal}
        />
      ) : (
        <NoWorkspaceMessage task={task} onClose={onClose} />
      )}

      {/* QA Feedback Section */}
      <QAFeedbackSection
        feedback={feedback}
        isSubmitting={isSubmitting}
        onFeedbackChange={onFeedbackChange}
        onReject={onReject}
        images={images}
        onImagesChange={onImagesChange}
      />

      {/* Discard Confirmation Dialog */}
      <DiscardDialog
        open={showDiscardDialog}
        task={task}
        worktreeStatus={worktreeStatus}
        isDiscarding={isDiscarding}
        onOpenChange={onShowDiscardDialog}
        onDiscard={onDiscard}
      />

      {/* Diff View Dialog */}
      <DiffViewDialog
        open={showDiffDialog}
        worktreeDiff={worktreeDiff}
        onOpenChange={onShowDiffDialog}
      />

      {/* Conflict Details Dialog */}
      <ConflictDetailsDialog
        open={showConflictDialog}
        mergePreview={mergePreview}
        stageOnly={stageOnly}
        onOpenChange={onShowConflictDialog}
        onMerge={onMerge}
      />

      {/* Create PR Dialog */}
      <CreatePRDialog
        open={showPRDialog}
        task={task}
        worktreeStatus={worktreeStatus}
        onOpenChange={onShowPRDialog}
        onCreatePR={onCreatePR}
      />
    </div>
  );
}
