import { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  FileCode,
  Plus,
  Minus,
  Eye,
  GitMerge,
  GitPullRequest,
  FolderX,
  Loader2,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  GitCommit,
  Code,
  Terminal,
  Info,
  CheckCheck
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { cn } from '../../../lib/utils';
import { MergeProgressOverlay } from './MergeProgressOverlay';
import type { WorktreeStatus, MergeConflict, MergeStats, GitConflictInfo, SupportedIDE, SupportedTerminal, MergeProgress, MergeLogEntry, MergeLogEntryType } from '../../../../shared/types';
import { useSettingsStore } from '../../../stores/settings-store';

// Maximum log entries to keep to prevent memory issues during long merges
const MAX_LOG_ENTRIES = 500;

interface WorkspaceStatusProps {
  taskId: string;
  worktreeStatus: WorktreeStatus;
  workspaceError: string | null;
  stageOnly: boolean;
  mergePreview: { files: string[]; conflicts: MergeConflict[]; summary: MergeStats; gitConflicts?: GitConflictInfo; uncommittedChanges?: { hasChanges: boolean; files: string[]; count: number } | null } | null;
  isLoadingPreview: boolean;
  isMerging: boolean;
  isDiscarding: boolean;
  isCreatingPR?: boolean;
  onShowDiffDialog: (show: boolean) => void;
  onShowDiscardDialog: (show: boolean) => void;
  onShowConflictDialog: (show: boolean) => void;
  onLoadMergePreview: () => void;
  onStageOnlyChange: (value: boolean) => void;
  onMerge: () => void;
  onShowPRDialog?: (show: boolean) => void;
  onClose?: () => void;
  onSwitchToTerminals?: () => void;
  onOpenInbuiltTerminal?: (id: string, cwd: string) => void;
}

/**
 * Displays the workspace status including change summary, merge preview, and action buttons
 */
// IDE display names for button labels (short names for buttons)
const IDE_LABELS: Partial<Record<SupportedIDE, string>> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublime: 'Sublime',
  webstorm: 'WebStorm',
  intellij: 'IntelliJ',
  pycharm: 'PyCharm',
  xcode: 'Xcode',
  vim: 'Vim',
  neovim: 'Neovim',
  emacs: 'Emacs',
  custom: 'IDE'
};

// Terminal display names for button labels (short names for buttons)
const TERMINAL_LABELS: Partial<Record<SupportedTerminal, string>> = {
  system: 'Terminal',
  terminal: 'Terminal',
  iterm2: 'iTerm',
  warp: 'Warp',
  ghostty: 'Ghostty',
  alacritty: 'Alacritty',
  kitty: 'Kitty',
  wezterm: 'WezTerm',
  hyper: 'Hyper',
  windowsterminal: 'Terminal',
  gnometerminal: 'Terminal',
  konsole: 'Konsole',
  custom: 'Terminal'
};

export function WorkspaceStatus({
  taskId,
  worktreeStatus,
  workspaceError,
  stageOnly,
  mergePreview,
  isLoadingPreview,
  isMerging,
  isDiscarding,
  isCreatingPR,
  onShowDiffDialog,
  onShowDiscardDialog,
  onShowConflictDialog,
  onLoadMergePreview,
  onStageOnlyChange,
  onMerge,
  onShowPRDialog,
  onClose,
  onSwitchToTerminals,
  onOpenInbuiltTerminal
}: WorkspaceStatusProps) {
  const { t } = useTranslation(['taskReview', 'common', 'tasks']);
  const { settings } = useSettingsStore();
  const preferredIDE = settings.preferredIDE || 'vscode';
  const preferredTerminal = settings.preferredTerminal || 'system';

  // Merge progress state
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [logEntries, setLogEntries] = useState<MergeLogEntry[]>([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const prevIsMergingRef = useRef(isMerging);
  const mergeStartTimeRef = useRef<number | null>(null);
  const minDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ipcCleanupRef = useRef<(() => void) | null>(null);

  // Reset state when isMerging transitions from false → true
  useEffect(() => {
    if (isMerging && !prevIsMergingRef.current) {
      setMergeProgress(null);
      setLogEntries([]);
      setShowOverlay(true);
      mergeStartTimeRef.current = Date.now();
    }
    prevIsMergingRef.current = isMerging;
  }, [isMerging]);

  // Minimum display time: keep overlay visible for at least 500ms after merge ends
  // Also wait for terminal progress event (complete/error) to avoid hiding before final message
  useEffect(() => {
    if (!isMerging && showOverlay && mergeStartTimeRef.current !== null) {
      // Check if we received a terminal progress event (complete or error)
      const hasTerminalEvent = mergeProgress?.stage === 'complete' || mergeProgress?.stage === 'error';

      // Only hide if we have a terminal event OR if a fallback timeout expires
      if (hasTerminalEvent) {
        const elapsed = Date.now() - mergeStartTimeRef.current;
        const MIN_DISPLAY_MS = 500;
        const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

        if (remaining > 0) {
          minDisplayTimerRef.current = setTimeout(() => {
            setShowOverlay(false);
            mergeStartTimeRef.current = null;
          }, remaining);
        } else {
          setShowOverlay(false);
          mergeStartTimeRef.current = null;
        }
      } else {
        // Fallback: hide after 2s if no terminal event received (defensive)
        minDisplayTimerRef.current = setTimeout(() => {
          setShowOverlay(false);
          mergeStartTimeRef.current = null;
        }, 2000);
      }
    }

    return () => {
      if (minDisplayTimerRef.current) {
        clearTimeout(minDisplayTimerRef.current);
        minDisplayTimerRef.current = null;
      }
    };
  }, [isMerging, showOverlay, mergeProgress?.stage]);

  // Subscribe to merge progress IPC events
  useEffect(() => {
    if (!isMerging) return;

    const stageToLogType = (stage: string): MergeLogEntryType => {
      switch (stage) {
        case 'complete': return 'success';
        case 'error': return 'error';
        case 'resolving': return 'warning';
        default: return 'info';
      }
    };

    const cleanup = window.electronAPI.onMergeProgress((eventTaskId: string, progress: MergeProgress) => {
      // Filter by task ID to prevent cross-task event leakage
      if (eventTaskId !== taskId) return;

      setMergeProgress(progress);
      setLogEntries(prev => {
        const newEntry = {
          timestamp: new Date().toISOString(),
          type: stageToLogType(progress.stage),
          message: progress.message,
          details: progress.details?.current_file,
        };
        // Limit log entries to prevent unbounded growth during long merges
        const updated = [...prev, newEntry];
        if (updated.length > MAX_LOG_ENTRIES) {
          return updated.slice(-MAX_LOG_ENTRIES);
        }
        return updated;
      });
    });

    // Store cleanup ref so we can call it on unmount even if isMerging changes
    ipcCleanupRef.current = cleanup;

    return cleanup;
  }, [isMerging, taskId]);

  // Ensure IPC listener cleanup on unmount during active merge
  useEffect(() => {
    return () => {
      if (ipcCleanupRef.current) {
        ipcCleanupRef.current();
        ipcCleanupRef.current = null;
      }
      if (minDisplayTimerRef.current) {
        clearTimeout(minDisplayTimerRef.current);
      }
    };
  }, []);

  const handleOpenInIDE = async () => {
    if (!worktreeStatus.worktreePath) return;
    try {
      await window.electronAPI.worktreeOpenInIDE(
        worktreeStatus.worktreePath,
        preferredIDE,
        settings.customIDEPath
      );
    } catch (err) {
      console.error('Failed to open in IDE:', err);
    }
  };

  const handleOpenInTerminal = async () => {
    if (!worktreeStatus.worktreePath) return;
    try {
      await window.electronAPI.worktreeOpenInTerminal(
        worktreeStatus.worktreePath,
        preferredTerminal,
        settings.customTerminalPath
      );
    } catch (err) {
      console.error('Failed to open in terminal:', err);
    }
  };

  const hasGitConflicts = mergePreview?.gitConflicts?.hasConflicts;
  const hasUncommittedChanges = mergePreview?.uncommittedChanges?.hasChanges;
  const uncommittedCount = mergePreview?.uncommittedChanges?.count || 0;
  const hasAIConflicts = mergePreview && mergePreview.conflicts.length > 0;

  // Conflict scenario detection for better UX messaging
  const conflictScenario = mergePreview?.gitConflicts?.scenario;
  const alreadyMergedFiles = mergePreview?.gitConflicts?.alreadyMergedFiles || [];
  const isAlreadyMerged = conflictScenario === 'already_merged';
  const isSuperseded = conflictScenario === 'superseded';

  // Check if branch needs rebase (main has advanced since spec was created)
  // This requires AI merge even if no explicit file conflicts are detected
  const needsRebase = mergePreview?.gitConflicts?.needsRebase;
  const commitsBehind = mergePreview?.gitConflicts?.commitsBehind || 0;

  // Path-mapped files that need AI merge due to file renames
  const pathMappedAIMergeCount = mergePreview?.summary?.pathMappedAIMergeCount || 0;
  const totalRenames = mergePreview?.gitConflicts?.totalRenames || 0;

  // Branch is behind if needsRebase is true and there are commits to catch up on
  // This triggers AI merge for path-mapped files even without explicit conflicts
  const isBranchBehind = needsRebase && commitsBehind > 0;

  // Has path-mapped files that need AI merge
  const hasPathMappedMerges = pathMappedAIMergeCount > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header with stats */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm text-foreground flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-purple-400" />
            Build Ready for Review
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShowDiffDialog(true)}
            className="h-7 px-2 text-xs"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            View
          </Button>
        </div>

        {/* Compact stats row */}
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FileCode className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{worktreeStatus.filesChanged || 0}</span> {t('taskReview:merge.status.files')}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <GitCommit className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{worktreeStatus.commitCount || 0}</span> commits
          </span>
          <span className="flex items-center gap-1 text-success">
            <Plus className="h-3.5 w-3.5" />
            <span className="font-medium">{worktreeStatus.additions || 0}</span>
          </span>
          <span className="flex items-center gap-1 text-destructive">
            <Minus className="h-3.5 w-3.5" />
            <span className="font-medium">{worktreeStatus.deletions || 0}</span>
          </span>
        </div>

        {/* Branch info: spec branch → user's current branch (merge target) */}
        {worktreeStatus.branch && (
          <div className="mt-2 text-xs text-muted-foreground">
            <code className="bg-background/80 px-1.5 py-0.5 rounded text-[11px]">{worktreeStatus.branch}</code>
            <span className="mx-1.5">→</span>
            <code className="bg-background/80 px-1.5 py-0.5 rounded text-[11px]">{worktreeStatus.currentProjectBranch || worktreeStatus.baseBranch || 'main'}</code>
          </div>
        )}

        {/* Worktree path display */}
        {worktreeStatus.worktreePath && (
          <div className="mt-2 text-xs text-muted-foreground font-mono">
            📁 {worktreeStatus.worktreePath}
          </div>
        )}

        {/* Open in IDE/Terminal buttons */}
        {worktreeStatus.worktreePath && (
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInIDE}
              className="h-7 px-2 text-xs"
            >
              <Code className="h-3.5 w-3.5 mr-1" />
              Open in {IDE_LABELS[preferredIDE]}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInTerminal}
              className="h-7 px-2 text-xs"
            >
              <Terminal className="h-3.5 w-3.5 mr-1" />
              Open in {TERMINAL_LABELS[preferredTerminal]}
            </Button>
          </div>
        )}
      </div>

      {/* Status/Warnings Section */}
      <div className="px-4 py-3 space-y-3">
        {/* Workspace Error */}
        {workspaceError && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-sm text-destructive">{workspaceError}</p>
          </div>
        )}

        {/* Uncommitted Changes Warning */}
        {hasUncommittedChanges && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warning">
                {uncommittedCount} uncommitted {uncommittedCount === 1 ? 'change' : 'changes'} in main project
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Commit or stash them in your terminal before staging to avoid conflicts.
              </p>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoadingPreview && !mergePreview && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking for conflicts...
          </div>
        )}

        {/* Already Merged Scenario - Show friendly message when task changes exist in target */}
        {mergePreview && isAlreadyMerged && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-success/10 border border-success/20">
            <CheckCheck className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-success">
                {t('taskReview:merge.alreadyMergedTitle')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('taskReview:merge.alreadyMergedDescription')}
              </p>
              {alreadyMergedFiles.length > 0 && alreadyMergedFiles.length <= 5 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">{t('taskReview:merge.matchingFiles')}:</span>
                  <ul className="mt-1 list-disc list-inside">
                    {alreadyMergedFiles.map(file => (
                      <li key={file} className="truncate">{file}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Superseded Scenario - Target has newer version of changes */}
        {mergePreview && isSuperseded && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-info/10 border border-info/20">
            <Info className="h-4 w-4 text-info mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-info">
                {t('taskReview:merge.supersededTitle')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('taskReview:merge.supersededDescription')}
              </p>
            </div>
          </div>
        )}

        {/* Merge Status */}
        {mergePreview && !isAlreadyMerged && !isSuperseded && (
          <div className={cn(
            "flex items-center justify-between p-2.5 rounded-lg border",
            hasGitConflicts || isBranchBehind || hasPathMappedMerges
              ? "bg-warning/10 border-warning/20"
              : !hasAIConflicts
                ? "bg-success/10 border-success/20"
                : "bg-warning/10 border-warning/20"
          )}>
            <div className="flex items-center gap-2">
              {hasGitConflicts ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <div>
                    <span className="text-sm font-medium text-warning">{t('taskReview:merge.status.branchDiverged')}</span>
                    <span className="text-xs text-muted-foreground ml-2">{t('taskReview:merge.status.aiWillResolve')}</span>
                  </div>
                </>
              ) : isBranchBehind || hasPathMappedMerges ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <div>
                    <span className="text-sm font-medium text-warning">
                      {hasPathMappedMerges ? t('taskReview:merge.status.filesRenamed') : t('taskReview:merge.status.branchBehind')}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {t('taskReview:merge.status.aiWillResolve')} ({hasPathMappedMerges ? `${pathMappedAIMergeCount} ${t('taskReview:merge.status.files')}` : `${commitsBehind} commits`})
                    </span>
                  </div>
                </>
              ) : !hasAIConflicts ? (
                <>
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-success">{t('taskReview:merge.status.readyToMerge')}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    {mergePreview.summary.totalFiles} {t('taskReview:merge.status.files')}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium text-warning">
                    {mergePreview.conflicts.length} {mergePreview.conflicts.length !== 1 ? t('taskReview:merge.status.conflicts') : t('taskReview:merge.status.conflict')}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(hasGitConflicts || isBranchBehind || hasPathMappedMerges || hasAIConflicts) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onShowConflictDialog(true)}
                  className="h-7 text-xs"
                >
                  {t('taskReview:merge.status.details')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMergePreview}
                disabled={isLoadingPreview}
                className="h-7 px-2"
                title={t('taskReview:merge.status.refresh')}
              >
                {isLoadingPreview ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Git Conflicts Details - hide for already_merged/superseded scenarios */}
        {hasGitConflicts && mergePreview?.gitConflicts && !isAlreadyMerged && !isSuperseded && (
          <div className="text-xs text-muted-foreground pl-6">
            {t('taskReview:merge.branchHasNewCommits', { branch: mergePreview.gitConflicts.baseBranch, count: mergePreview.gitConflicts.commitsBehind })}
            {mergePreview.gitConflicts.conflictingFiles.length > 0 && (
              <span className="text-warning">
                {' '}{t('taskReview:merge.filesNeedMerging', { count: mergePreview.gitConflicts.conflictingFiles.length })}
              </span>
            )}
          </div>
        )}

        {/* Branch Behind Details (no explicit conflicts but needs AI merge due to path mappings) */}
        {!hasGitConflicts && isBranchBehind && mergePreview?.gitConflicts && !isAlreadyMerged && !isSuperseded && (
          <div className="text-xs text-muted-foreground pl-6">
            {t('taskReview:merge.branchHasNewCommitsSinceBuild', { branch: mergePreview.gitConflicts.baseBranch, count: commitsBehind })}
            {hasPathMappedMerges ? (
              <span className="text-warning">
                {' '}{t(totalRenames === 1 ? 'taskReview:merge.filesNeedAIMergeDueToRenames' : 'taskReview:merge.filesNeedAIMergeDueToRenamesPlural', { renameCount: totalRenames, count: pathMappedAIMergeCount })}
              </span>
            ) : totalRenames > 0 ? (
              <span className="text-warning"> {t('taskReview:merge.fileRenamesDetected', { count: totalRenames })}</span>
            ) : (
              <span className="text-warning"> {t('taskReview:merge.filesRenamedOrMoved')}</span>
            )}
          </div>
        )}
      </div>

      {/* Merge Progress Overlay — shown during merge and for minimum display time after */}
      {(isMerging || showOverlay) && (
        <MergeProgressOverlay mergeProgress={mergeProgress} logEntries={logEntries} />
      )}

      {/* Actions Footer */}
      <div className="px-4 py-3 bg-muted/20 border-t border-border space-y-3">
        {/* Stage Only Option - only show after conflicts have been checked (not for already_merged/superseded) */}
        {mergePreview && !isAlreadyMerged && !isSuperseded && (
          <label className="inline-flex items-center gap-2.5 text-sm cursor-pointer select-none px-3 py-2 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors">
            <Checkbox
              checked={stageOnly}
              onCheckedChange={(checked) => onStageOnlyChange(checked === true)}
              className="border-muted-foreground/50 data-[state=checked]:border-primary"
            />
            <span className={cn(
              "transition-colors",
              stageOnly ? "text-foreground" : "text-muted-foreground"
            )}>{t('taskReview:merge.status.stageOnly')}</span>
          </label>
        )}

        {/* Primary Actions */}
        <div className="flex gap-2">
          {/* State 1: No merge preview yet - show "Check for Conflicts" */}
          {!mergePreview && !isLoadingPreview && (
            <Button
              variant="default"
              onClick={onLoadMergePreview}
              disabled={isMerging || isDiscarding}
              className="flex-1"
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Check for Conflicts
            </Button>
          )}

          {/* State 2: Loading merge preview */}
          {isLoadingPreview && (
            <Button
              variant="default"
              disabled
              className="flex-1"
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking for conflicts...
            </Button>
          )}

          {/* State 3a: Already Merged - show "Mark as Done" as primary action */}
          {mergePreview && !isLoadingPreview && isAlreadyMerged && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="success"
                  onClick={onMerge}
                  disabled={isMerging || isDiscarding}
                  className="flex-1"
                >
                  {isMerging ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('taskReview:merge.buttons.completing')}
                    </>
                  ) : (
                    <>
                      <CheckCheck className="mr-2 h-4 w-4" />
                      {t('taskReview:merge.actions.markAsDone')}
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  {t('taskReview:merge.alreadyMergedTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* State 3b: Superseded - show both "View Comparison" and "Discard" */}
          {mergePreview && !isLoadingPreview && isSuperseded && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={() => onShowConflictDialog(true)}
                    disabled={isMerging || isDiscarding}
                    className="flex-1"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {t('taskReview:merge.actions.viewComparison')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    {t('taskReview:merge.supersededCompareTooltip')}
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    onClick={() => onShowDiscardDialog(true)}
                    disabled={isMerging || isDiscarding}
                    className="flex-1"
                  >
                    <FolderX className="mr-2 h-4 w-4" />
                    {t('taskReview:merge.actions.discardTask')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    {t('taskReview:merge.supersededDiscardTooltip')}
                  </p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          {/* State 3c: Normal merge - show appropriate merge/stage button */}
          {mergePreview && !isLoadingPreview && !isAlreadyMerged && !isSuperseded && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={hasGitConflicts || isBranchBehind || hasPathMappedMerges ? "warning" : "success"}
                  onClick={onMerge}
                  disabled={isMerging || isDiscarding}
                  className="flex-1"
                >
                  {isMerging ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {hasGitConflicts || isBranchBehind || hasPathMappedMerges
                        ? t('taskReview:merge.buttons.resolving')
                        : stageOnly
                          ? t('taskReview:merge.buttons.staging')
                          : t('taskReview:merge.buttons.merging')}
                    </>
                  ) : (
                    <>
                      <GitMerge className="mr-2 h-4 w-4" />
                      {hasGitConflicts || isBranchBehind || hasPathMappedMerges
                        ? (stageOnly ? t('taskReview:merge.buttons.stageWithAIMerge') : t('taskReview:merge.buttons.mergeWithAI'))
                        : (stageOnly
                            ? t('taskReview:merge.buttons.stageTo', { branch: worktreeStatus.currentProjectBranch || worktreeStatus.baseBranch || 'main' })
                            : t('taskReview:merge.buttons.mergeTo', { branch: worktreeStatus.currentProjectBranch || worktreeStatus.baseBranch || 'main' }))}
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  {t('tasks:review.mergeTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Create PR Button - hide for already_merged/superseded scenarios */}
          {onShowPRDialog && !isAlreadyMerged && !isSuperseded && (
            <Button
              variant="info"
              onClick={() => onShowPRDialog(true)}
              disabled={isMerging || isDiscarding || isCreatingPR}
              className="flex-1"
            >
              {isCreatingPR ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('taskReview:pr.actions.creating')}
                </>
              ) : (
                <>
                  <GitPullRequest className="mr-2 h-4 w-4" />
                  {t('common:buttons.createPR')}
                </>
              )}
            </Button>
          )}

          {/* Discard button - hide for superseded (shown as primary action there) */}
          {!isSuperseded && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onShowDiscardDialog(true)}
              disabled={isMerging || isDiscarding || isCreatingPR}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
              title={t('taskReview:merge.status.discardBuild')}
            >
              <FolderX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
