import { useTranslation } from 'react-i18next';
import { FileText, GitCommit, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { TaskCard, CommitCard } from './ChangelogEntry';
import type { ChangelogTask, ChangelogSourceMode, GitCommit as GitCommitType } from '../../../shared/types';

interface ChangelogListProps {
  sourceMode: ChangelogSourceMode;
  // Task mode
  doneTasks: ChangelogTask[];
  selectedTaskIds: string[];
  onToggleTask: (taskId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  // Git mode
  previewCommits: GitCommitType[];
  isLoadingCommits: boolean;
  // Continue
  onContinue: () => void;
  canContinue: boolean;
}

export function ChangelogList({
  sourceMode,
  doneTasks,
  selectedTaskIds,
  onToggleTask,
  onSelectAll,
  onDeselectAll,
  previewCommits,
  isLoadingCommits,
  onContinue,
  canContinue
}: ChangelogListProps) {
  const { t } = useTranslation('changelog');

  // Get summary text for footer badge
  const getSummaryCount = () => {
    switch (sourceMode) {
      case 'tasks':
        return selectedTaskIds.length;
      case 'git-history':
      case 'branch-diff':
        return previewCommits.length;
      default:
        return 0;
    }
  };

  const getSummaryText = () => {
    const count = getSummaryCount();
    const isSingular = count === 1;
    switch (sourceMode) {
      case 'tasks':
        return t(isSingular ? 'list.summary.taskSingular' : 'list.summary.taskPlural', { count });
      case 'git-history':
      case 'branch-diff':
        return t(isSingular ? 'list.summary.commitSingular' : 'list.summary.commitPlural', {
          count
        });
      default:
        return t(isSingular ? 'list.summary.itemSingular' : 'list.summary.itemPlural', { count });
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tasks Mode - Task Selection */}
      {sourceMode === 'tasks' && (
        <>
          {/* Task selection header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-muted/30">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {t('list.tasksSelected', {
                  selected: selectedTaskIds.length,
                  total: doneTasks.length
                })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSelectAll}
                  className="h-7 px-2 text-xs"
                >
                  {t('list.selectAll')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDeselectAll}
                  className="h-7 px-2 text-xs"
                >
                  {t('list.clear')}
                </Button>
              </div>
            </div>
          </div>

          {/* Task grid */}
          <ScrollArea className="flex-1 p-6">
            {doneTasks.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center py-12">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground/30" />
                  <h3 className="mt-4 text-lg font-medium">{t('list.noCompletedTasksTitle')}</h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-md">
                    {t('list.noCompletedTasksDescription')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {doneTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isSelected={selectedTaskIds.includes(task.id)}
                    onToggle={() => onToggleTask(task.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}

      {/* Git History / Branch Diff Mode - Commit Preview */}
      {(sourceMode === 'git-history' || sourceMode === 'branch-diff') && (
        <>
          {/* Commit preview header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-muted/30">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {t(
                  previewCommits.length === 1
                    ? 'list.commitsFoundSingular'
                    : 'list.commitsFoundPlural',
                  { count: previewCommits.length }
                )}
              </span>
              {isLoadingCommits && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Commit list */}
          <ScrollArea className="flex-1 p-6">
            {isLoadingCommits ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center py-12">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">{t('list.loadingCommits')}</p>
                </div>
              </div>
            ) : previewCommits.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center py-12">
                  <GitCommit className="mx-auto h-12 w-12 text-muted-foreground/30" />
                  <h3 className="mt-4 text-lg font-medium">{t('list.noCommitsTitle')}</h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-md">
                    {sourceMode === 'git-history'
                      ? t('list.noCommitsGitHistory')
                      : t('list.noCommitsBranchDiff')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {previewCommits.map((commit) => (
                  <CommitCard key={commit.fullHash} commit={commit} />
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}

      {/* Footer with Continue button */}
      <div className="flex items-center justify-end border-t border-border px-6 py-4 bg-background">
        <Button onClick={onContinue} disabled={!canContinue} size="lg">
          {t('actions.continue')}
          <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
          {canContinue && (
            <Badge variant="secondary" className="ms-2">
              {getSummaryText()}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  );
}
