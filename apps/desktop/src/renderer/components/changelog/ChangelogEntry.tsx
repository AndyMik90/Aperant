import { useTranslation } from 'react-i18next';
import { GitCommit } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { ChangelogTask, GitCommit as GitCommitType } from '../../../shared/types';

interface TaskCardProps {
  task: ChangelogTask;
  isSelected: boolean;
  onToggle: () => void;
}

export function TaskCard({ task, isSelected, onToggle }: TaskCardProps) {
  const { t } = useTranslation('changelog');
  const completedDate = new Date(task.completedAt).toLocaleDateString();

  return (
    <label
      className={cn(
        'flex flex-col rounded-lg border p-4 cursor-pointer transition-all',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-muted/30'
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm leading-tight">{task.title}</h3>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            {task.hasSpecs && (
              <Badge variant="secondary" className="text-xs">
                {t('entry.hasSpecs')}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {completedDate}
            </span>
          </div>
        </div>
      </div>
    </label>
  );
}

interface CommitCardProps {
  commit: GitCommitType;
}

export function CommitCard({ commit }: CommitCardProps) {
  const { t } = useTranslation('changelog');
  const commitDate = new Date(commit.date).toLocaleDateString();

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3 bg-background">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        <GitCommit className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight line-clamp-2">{commit.subject}</p>
          <code className="text-xs text-muted-foreground font-mono shrink-0">{commit.hash}</code>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{commit.author}</span>
          <span>{commitDate}</span>
          {commit.filesChanged !== undefined && (
            <span>
              {t(
                commit.filesChanged === 1 ? 'entry.filesSingular' : 'entry.filesPlural',
                { count: commit.filesChanged }
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
