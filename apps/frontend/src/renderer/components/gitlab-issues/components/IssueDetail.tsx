import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, User, Clock, MessageCircle, Sparkles, CheckCircle2, Eye } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { formatDate } from '../utils';
import type { IssueDetailProps } from '../types';

// GitLab issue state colors
const GITLAB_ISSUE_STATE_COLORS: Record<string, string> = {
  opened: 'bg-green-500/10 text-green-500 border-green-500/20',
  closed: 'bg-purple-500/10 text-purple-500 border-purple-500/20'
};

const GITLAB_COMPLEXITY_COLORS: Record<string, string> = {
  simple: 'bg-green-500/10 text-green-500',
  standard: 'bg-yellow-500/10 text-yellow-500',
  complex: 'bg-red-500/10 text-red-500'
};

export function IssueDetail({ issue, onInvestigate, investigationResult, linkedTaskId, onViewTask }: IssueDetailProps) {
  const { t } = useTranslation(['gitlab', 'common']);
  // Determine which task ID to use - either already linked or just created
  const taskId = linkedTaskId || (investigationResult?.success ? investigationResult.taskId : undefined);
  const hasLinkedTask = !!taskId;

  const handleViewTask = () => {
    if (taskId && onViewTask) {
      onViewTask(taskId);
    }
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`${GITLAB_ISSUE_STATE_COLORS[issue.state] || ''}`}
              >
                {t(`states.${issue.state}`)}
              </Badge>
              <span className="text-sm text-muted-foreground">#{issue.iid}</span>
            </div>
            <Button variant="ghost" size="icon" asChild aria-label={t('common:accessibility.openOnGitLabAriaLabel')}>
              <a href={issue.webUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {issue.title}
          </h2>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <User className="h-4 w-4" />
            {issue.author.username}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDate(issue.createdAt)}
          </div>
          {issue.userNotesCount > 0 && (
            <div className="flex items-center gap-1">
              <MessageCircle className="h-4 w-4" />
              {issue.userNotesCount} {t('detail.notes')}
            </div>
          )}
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {issue.labels.map((label, index) => (
              <Badge
                key={index}
                variant="outline"
                className="bg-orange-500/10 text-orange-500 border-orange-500/20"
              >
                {label}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {hasLinkedTask ? (
            <Button onClick={handleViewTask} className="flex-1" variant="secondary">
              <Eye className="h-4 w-4 mr-2" />
              {t('detail.viewTask')}
            </Button>
          ) : (
            <Button onClick={onInvestigate} className="flex-1">
              <Sparkles className="h-4 w-4 mr-2" />
              {t('detail.createTask')}
            </Button>
          )}
        </div>

        {/* Task Linked Info */}
        {hasLinkedTask && (
          <Card className="bg-success/5 border-success/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t('detail.taskLinked')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {investigationResult?.success ? (
                <>
                  <p className="text-foreground">{investigationResult.analysis.summary}</p>
                  <div className="flex items-center gap-2">
                    <Badge className={GITLAB_COMPLEXITY_COLORS[investigationResult.analysis.estimatedComplexity]}>
                      {t(`complexity.${investigationResult.analysis.estimatedComplexity}`)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t('detail.taskId')}: {taskId}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('detail.taskId')}: {taskId}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Body */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('detail.description')}</CardTitle>
          </CardHeader>
          <CardContent>
            {issue.description ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.description}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t('detail.noDescription')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Assignees */}
        {issue.assignees.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('detail.assignees')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {issue.assignees.map((assignee) => (
                  <Badge key={assignee.username} variant="outline">
                    <User className="h-3 w-3 mr-1" />
                    {assignee.username}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Milestone */}
        {issue.milestone && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('detail.milestone')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{issue.milestone.title}</Badge>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
