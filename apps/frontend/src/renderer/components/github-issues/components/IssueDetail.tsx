import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, User, Clock, MessageCircle, Sparkles, CheckCircle2, Eye } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import {
  GITHUB_ISSUE_STATE_COLORS,
  GITHUB_ISSUE_STATE_LABELS,
  GITHUB_COMPLEXITY_COLORS
} from '../../../../shared/constants';
import { formatDate } from '../utils';
import { AutoFixButton } from './AutoFixButton';
import type { IssueDetailProps } from '../types';

export function IssueDetail({
  issue,
  onInvestigate,
  investigationResult,
  linkedTaskId,
  onViewTask,
  projectId,
  autoFixConfig,
  autoFixQueueItem,
}: IssueDetailProps) {
  const { t } = useTranslation('common');
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
                className={`${GITHUB_ISSUE_STATE_COLORS[issue.state]}`}
              >
                {GITHUB_ISSUE_STATE_LABELS[issue.state]}
              </Badge>
              <span className="text-sm text-muted-foreground">#{issue.number}</span>
            </div>
            <Button variant="ghost" size="icon" asChild aria-label={t('accessibility.openOnGitHubAriaLabel')}>
              <a href={issue.htmlUrl} target="_blank" rel="noopener noreferrer">
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
            {issue.author.login}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {formatDate(issue.createdAt)}
          </div>
          {issue.commentsCount > 0 && (
            <div className="flex items-center gap-1">
              <MessageCircle className="h-4 w-4" />
              {issue.commentsCount} comments
            </div>
          )}
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {issue.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                style={{
                  backgroundColor: `#${label.color}20`,
                  borderColor: `#${label.color}50`,
                  color: `#${label.color}`
                }}
              >
                {label.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {hasLinkedTask ? (
            <Button onClick={handleViewTask} className="flex-1" variant="secondary">
              <Eye className="h-4 w-4 mr-2" />
              View Task
            </Button>
          ) : (
            <>
              <Button onClick={onInvestigate} className="flex-1">
                <Sparkles className="h-4 w-4 mr-2" />
                Create Task
              </Button>
              {projectId && autoFixConfig?.enabled && (
                <AutoFixButton
                  issue={issue}
                  projectId={projectId}
                  config={autoFixConfig}
                  queueItem={autoFixQueueItem ?? null}
                />
              )}
            </>
          )}
        </div>

        {/* Task Linked Info */}
        {hasLinkedTask && (
          <Card className="bg-success/5 border-success/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                Task Linked
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {investigationResult?.success ? (
                <>
                  <p className="text-foreground">{investigationResult.analysis.summary}</p>
                  <div className="flex items-center gap-2">
                    <Badge className={GITHUB_COMPLEXITY_COLORS[investigationResult.analysis.estimatedComplexity]}>
                      {investigationResult.analysis.estimatedComplexity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Task ID: {taskId}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Task ID: {taskId}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Body */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent>
            {issue.body ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.body}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description provided.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Assignees */}
        {issue.assignees.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Assignees</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {issue.assignees.map((assignee) => (
                  <Badge key={assignee.login} variant="outline">
                    <User className="h-3 w-3 mr-1" />
                    {assignee.login}
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
              <CardTitle className="text-sm">Milestone</CardTitle>
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
