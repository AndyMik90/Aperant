/**
 * List of issues with loading/empty states
 */

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '../../ui/scroll-area';
import { IssueCard } from './IssueCard';
import type { LinearIssue } from '../types';

interface IssueListProps {
  issues: LinearIssue[];
  selectedIssueIds: Set<string>;
  isLoadingIssues: boolean;
  selectedTeamId: string;
  searchQuery: string;
  filterState: string;
  onToggleIssue: (issueId: string) => void;
}

export function IssueList({
  issues,
  selectedIssueIds,
  isLoadingIssues,
  selectedTeamId,
  searchQuery,
  filterState,
  onToggleIssue
}: IssueListProps) {
  const { t } = useTranslation('linear');

  if (isLoadingIssues) {
    return (
      <ScrollArea className="flex-1 -mx-6 px-6 min-h-0">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ScrollArea>
    );
  }

  if (!selectedTeamId) {
    return (
      <ScrollArea className="flex-1 -mx-6 px-6 min-h-0">
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{t('selectTeamToView')}</p>
        </div>
      </ScrollArea>
    );
  }

  if (issues.length === 0) {
    return (
      <ScrollArea className="flex-1 -mx-6 px-6 min-h-0">
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">
            {searchQuery || filterState !== 'all'
              ? t('issueList.emptyFilter')
              : t('issueList.empty')}
          </p>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1 -mx-6 px-6 min-h-0">
      <div className="space-y-2 py-2">
        {issues.map(issue => (
          <IssueCard
            key={issue.id}
            issue={issue}
            isSelected={selectedIssueIds.has(issue.id)}
            onToggle={onToggleIssue}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
