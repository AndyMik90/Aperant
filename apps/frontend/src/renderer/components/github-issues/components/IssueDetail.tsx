import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, User, Clock, MessageCircle, CheckCircle2, Eye, X, RotateCcw, XCircle, AlertTriangle, SearchCode } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import {
  GITHUB_ISSUE_STATE_COLORS,
  GITHUB_ISSUE_STATE_LABELS,
} from '@shared/constants';
import { formatDate } from '../utils';
import { DependencyList } from './DependencyList';
import { CommentForm } from './CommentForm';
import { InlineEditor } from './InlineEditor';
import { LabelManager } from './LabelManager';
import { AssigneeManager } from './AssigneeManager';
import { InvestigateButton } from './InvestigateButton';
import { InvestigationNeedsAttention } from './InvestigationNeedsAttention';
import { InvestigationPanel, SEVERITY_COLORS } from './InvestigationPanel';
import { InvestigationLogs } from './InvestigationLogs';
import { CollapsibleCard } from '../../github-prs/components/CollapsibleCard';
import type { IssueDetailProps } from '../types';

export function IssueDetail({
  issue,
  onInvestigate,
  linkedTaskId,
  onViewTask,
  projectId,
  onEditTitle,
  onEditBody,
  onAddLabels,
  onRemoveLabels,
  repoLabels,
  onAddAssignees,
  onRemoveAssignees,
  collaborators,
  onClose,
  onReopen,
  onComment,
  dependencies,
  isDepsLoading,
  depsError,
  onNavigateDependency,
  // Investigation system (F5)
  investigationState,
  investigationReport,
  investigationProgress,
  investigationProgressData,
  isInvestigating,
  investigationError,
  investigationStartedAt,
  investigationCompletedAt,
  investigationSpecId,
  onCancelInvestigation,
  onCreateTask,
  onDismissIssue,
  onPostToGitHub,
  onAcceptLabel,
  onRejectLabel,
  isPostingToGitHub,
  githubCommentId,
  postedAt,
  investigationActivityLog,
  investigationHasResumeSessions,
}: IssueDetailProps) {
  const { t } = useTranslation('common');
  const [isClosing, setIsClosing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const renderedBody = useMemo(() => {
    if (!issue.body) return null;
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.body}</ReactMarkdown>
      </div>
    );
  }, [issue.body]);

  // Use new investigation state if available, fall back to old
  const derivedState = investigationState ?? 'new';
  const hasLinkedTask = !!linkedTaskId;

  const handleViewTask = () => {
    if (linkedTaskId && onViewTask) {
      onViewTask(linkedTaskId);
    }
  };

  const handleClose = async () => {
    if (!onClose) return;
    setIsClosing(true);
    try {
      await onClose();
    } finally {
      setIsClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!onReopen) return;
    setIsReopening(true);
    try {
      await onReopen();
    } finally {
      setIsReopening(false);
    }
  };

  // Show investigation cards for any non-new investigation state
  const showStatusTree = derivedState !== 'new';

  return (
    <ScrollArea className="flex-1 w-full">
      <div className="p-4 space-y-4 w-full min-w-0">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4 min-w-0 overflow-hidden">
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
          {onEditTitle ? (
            <h2 className="text-lg font-semibold text-foreground">
              <InlineEditor
                value={issue.title}
                onSave={onEditTitle}
                ariaLabel={t('mutations.editTitle')}
                required
              />
            </h2>
          ) : (
            <h2 className="text-lg font-semibold text-foreground">
              {issue.title}
            </h2>
          )}
        </div>

        {/* Warning banner for closed issues with active/pending investigation */}
        {issue.state === 'closed' && (derivedState === 'investigating' || derivedState === 'new' || derivedState === 'findings_ready') && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              {t('investigation.panel.closedIssueWarning', 'This issue is closed. Investigation results may not be actionable.')}
            </p>
          </div>
        )}

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground min-w-0">
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
              {t('phase5.commentCount', { count: issue.commentsCount })}
            </div>
          )}
          {/* Assignees — inline in meta row */}
          {onAddAssignees && onRemoveAssignees && collaborators ? (
            <AssigneeManager
              currentAssignees={issue.assignees}
              collaborators={collaborators}
              onAddAssignee={(login) => onAddAssignees([login])}
              onRemoveAssignee={(login) => onRemoveAssignees([login])}
              inline
            />
          ) : issue.assignees.length > 0 ? (
            <div className="flex items-center gap-1">
              {issue.assignees.map((assignee) => (
                <Badge key={assignee.login} variant="outline" className="text-xs">
                  <User className="h-3 w-3 mr-1" />
                  {assignee.login}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {/* Labels */}
        {onAddLabels && onRemoveLabels && repoLabels ? (
          <LabelManager
            currentLabels={issue.labels.map(l => l.name)}
            repoLabels={[...repoLabels, ...issue.labels.filter(il => !repoLabels.some(rl => rl.name === il.name))]}
            onAddLabel={(label) => onAddLabels([label])}
            onRemoveLabel={(label) => onRemoveLabels([label])}
          />
        ) : issue.labels.length > 0 ? (
          <div className="flex flex-wrap gap-2 min-w-0">
            {issue.labels.map((label) => {
              const color = `#${label.color}`;
              return (
                <Badge
                  key={label.id}
                  variant="outline"
                  style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}
                >
                  {label.name}
                </Badge>
              );
            })}
          </div>
        ) : null}

        {/* Investigation Actions */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {hasLinkedTask ? (
            <Button onClick={handleViewTask} className="flex-1" variant="secondary">
              <Eye className="h-4 w-4 mr-2" />
              {t('phase5.viewTask')}
            </Button>
          ) : !showStatusTree ? (
            <InvestigateButton
              state={derivedState}
              progress={investigationProgress}
              hasError={!!investigationError}
              hasResumeSessions={investigationHasResumeSessions}
              onInvestigate={onInvestigate}
              onCancel={onCancelInvestigation ?? (() => { /* noop */ })}
              onViewResults={() => {/* scroll to results handled inline */}}
              onCreateTask={onCreateTask ?? (() => { /* noop */ })}
              disabled={isInvestigating && !onCancelInvestigation}
            />
          ) : null}
          {/* Dismiss/Close/Reopen only shown here when no status tree (otherwise inside NeedsAttention card) */}
          {!showStatusTree && (
            <>
              {onDismissIssue && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <XCircle className="h-4 w-4 mr-1" />
                      {t('investigation.button.dismiss', 'Dismiss')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDismissIssue('wont_fix')}>
                      {t('investigation.dismiss.wontFix', "Won't Fix")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDismissIssue('duplicate')}>
                      {t('investigation.dismiss.duplicate', 'Duplicate')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDismissIssue('cannot_reproduce')}>
                      {t('investigation.dismiss.cannotReproduce', 'Cannot Reproduce')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDismissIssue('out_of_scope')}>
                      {t('investigation.dismiss.outOfScope', 'Out of Scope')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {issue.state === 'open' && onClose && (
                <Button variant="outline" size="sm" onClick={handleClose} disabled={isClosing}>
                  <X className="h-4 w-4 mr-1" />
                  {t('phase5.closeIssue')}
                </Button>
              )}
              {issue.state === 'closed' && onReopen && (
                <Button variant="outline" size="sm" onClick={handleReopen} disabled={isReopening}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  {t('phase5.reopenIssue')}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Investigation Panel — 3 collapsible cards */}
        {showStatusTree && projectId && (
          <>
            <InvestigationNeedsAttention
              state={derivedState}
              progress={investigationProgressData ?? null}
              report={investigationReport ?? null}
              error={investigationError ?? null}
              startedAt={investigationStartedAt ?? null}
              completedAt={investigationCompletedAt ?? null}
              githubCommentId={githubCommentId ?? null}
              postedAt={postedAt ?? null}
              specId={investigationSpecId ?? null}
              issueNumber={issue.number}
              projectId={projectId}
              onCancel={onCancelInvestigation ?? (() => { /* noop */ })}
              onInvestigate={onInvestigate}
              onCreateTask={onCreateTask ?? (() => { /* noop */ })}
              onPostToGitHub={onPostToGitHub}
              isPostingToGitHub={isPostingToGitHub}
              onDismissIssue={onDismissIssue}
              onCloseIssue={issue.state === 'open' && onClose ? handleClose : undefined}
              onReopenIssue={issue.state === 'closed' && onReopen ? handleReopen : undefined}
              isClosingIssue={isClosing}
              isReopeningIssue={isReopening}
              issueState={issue.state}
              hasResumeSessions={investigationHasResumeSessions ?? false}
            />

            {investigationReport && (
              <CollapsibleCard
                title={t('investigation.results.title', 'Investigation Results')}
                icon={<SearchCode className="h-4 w-4" />}
                badge={investigationReport.severity ? (
                  <Badge className={SEVERITY_COLORS[investigationReport.severity]}>
                    {investigationReport.severity.toUpperCase()}
                  </Badge>
                ) : undefined}
                defaultOpen
              >
                <InvestigationPanel
                  report={investigationReport}
                  state={derivedState}
                  showOriginal={showOriginal}
                  onToggleOriginal={() => setShowOriginal(!showOriginal)}
                  onAcceptLabel={onAcceptLabel}
                  onRejectLabel={onRejectLabel}
                  onCloseIssue={issue.state === 'open' && onClose ? handleClose : undefined}
                  isClosingIssue={isClosing}
                />
              </CollapsibleCard>
            )}

            <InvestigationLogs
              issueNumber={issue.number}
              projectId={projectId}
              isInvestigating={derivedState === 'investigating' || derivedState === 'queued'}
            />
          </>
        )}

        {/* Task Linked Info */}
        {hasLinkedTask && (
          <Card className="bg-success/5 border-success/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t('phase5.taskLinked')}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t('phase5.taskId')} {linkedTaskId}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Body / Description */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('phase5.description')}</CardTitle>
          </CardHeader>
          <CardContent>
            {onEditBody ? (
              <InlineEditor
                value={issue.body ?? ''}
                onSave={onEditBody}
                ariaLabel={t('mutations.editBody')}
                multiline
              />
            ) : renderedBody ? (
              renderedBody
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t('phase5.noDescription')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Dependencies */}
        {dependencies && (
          <Card>
            <CardContent className="pt-4">
              <DependencyList
                dependencies={dependencies}
                isLoading={isDepsLoading ?? false}
                error={depsError ?? null}
                onNavigate={onNavigateDependency}
              />
            </CardContent>
          </Card>
        )}


        {/* Milestone */}
        {issue.milestone && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('phase5.milestone')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{issue.milestone.title}</Badge>
            </CardContent>
          </Card>
        )}

        {/* Comment Form */}
        {onComment && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('phase5.addComment')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentForm onSubmit={onComment} />
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
