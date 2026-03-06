import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '../../ui/scroll-area';
import { IssueListItem } from './IssueListItem';
import { EmptyState } from './EmptyStates';
import type { IssueListProps } from '../types';

export function IssueList({
  issues,
  selectedIssueIid,
  isLoading,
  error,
  onSelectIssue,
  onInvestigate
}: IssueListProps) {
  const { t } = useTranslation('gitlab');
  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border-b border-destructive/30">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (issues.length === 0) {
    return <EmptyState message={t('empty.noIssues')} />;
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-1">
        {issues.map((issue) => (
          <IssueListItem
            key={issue.id}
            issue={issue}
            isSelected={selectedIssueIid === issue.iid}
            onClick={() => onSelectIssue(issue.iid)}
            onInvestigate={() => onInvestigate(issue)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
