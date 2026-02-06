import { useState, useRef, useLayoutEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Target,
  Bug,
  Wrench,
  FileCode,
  Shield,
  Gauge,
  Palette,
  Lightbulb,
  Users,
  GitBranch,
  GitPullRequest,
  ListChecks,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn, formatRelativeTime } from '../../lib/utils';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_COMPLEXITY_COLORS,
  TASK_IMPACT_LABELS,
  TASK_IMPACT_COLORS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_COLORS,
  IDEATION_TYPE_LABELS,
  JSON_ERROR_PREFIX
} from '../../../shared/constants';
import type { Task, TaskCategory } from '../../../shared/types';

// Category icon mapping
const CategoryIcon: Record<TaskCategory, typeof Target> = {
  feature: Target,
  bug_fix: Bug,
  refactoring: Wrench,
  documentation: FileCode,
  security: Shield,
  performance: Gauge,
  ui_ux: Palette,
  infrastructure: Wrench,
  testing: FileCode
};

interface TaskMetadataProps {
  task: Task;
}

// Height threshold for collapsing long descriptions (~8 lines)
const COLLAPSED_HEIGHT = 200;

export function TaskMetadata({ task }: TaskMetadataProps) {
  const { t } = useTranslation(['tasks', 'errors']);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  // Handle JSON error description with i18n
  const displayDescription = (() => {
    if (!task.description) return null;
    if (task.description.startsWith(JSON_ERROR_PREFIX)) {
      const errorMessage = task.description.slice(JSON_ERROR_PREFIX.length);
      return t('errors:task.jsonError.description', { error: errorMessage });
    }
    return task.description;
  })();

  // Detect if content overflows the collapsed height
  // Re-check when description changes (content height depends on rendered description)
  // Reset expand state when switching tasks to avoid stale expanded state
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.description triggers re-render which changes content height
  useLayoutEffect(() => {
    setIsExpanded(false);
    const element = contentRef.current;
    if (element) {
      const hasContentOverflow = element.scrollHeight > COLLAPSED_HEIGHT;
      setHasOverflow(hasContentOverflow);
    }
  }, [task.id, task.description]);

  const hasClassification = task.metadata && (
    task.metadata.category ||
    task.metadata.priority ||
    task.metadata.complexity ||
    task.metadata.impact ||
    task.metadata.securitySeverity ||
    task.metadata.sourceType
  );

  return (
    <div className="space-y-5">
      {/* Compact Metadata Bar: Classification + Timeline */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
        {/* Classification Badges - Left */}
        {hasClassification && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category */}
            {task.metadata?.category && (
              <Badge
                variant="outline"
                className={cn('text-xs', TASK_CATEGORY_COLORS[task.metadata.category])}
              >
                {CategoryIcon[task.metadata.category] && (() => {
                  const Icon = CategoryIcon[task.metadata.category!];
                  return <Icon className="h-3 w-3 mr-1" />;
                })()}
                {TASK_CATEGORY_LABELS[task.metadata.category]}
              </Badge>
            )}
            {/* Priority */}
            {task.metadata?.priority && (
              <Badge
                variant="outline"
                className={cn('text-xs', TASK_PRIORITY_COLORS[task.metadata.priority])}
              >
                {TASK_PRIORITY_LABELS[task.metadata.priority]}
              </Badge>
            )}
            {/* Complexity */}
            {task.metadata?.complexity && (
              <Badge
                variant="outline"
                className={cn('text-xs', TASK_COMPLEXITY_COLORS[task.metadata.complexity])}
              >
                {TASK_COMPLEXITY_LABELS[task.metadata.complexity]}
              </Badge>
            )}
            {/* Impact */}
            {task.metadata?.impact && (
              <Badge
                variant="outline"
                className={cn('text-xs', TASK_IMPACT_COLORS[task.metadata.impact])}
              >
                {TASK_IMPACT_LABELS[task.metadata.impact]}
              </Badge>
            )}
            {/* Security Severity */}
            {task.metadata?.securitySeverity && (
              <Badge
                variant="outline"
                className={cn('text-xs', TASK_IMPACT_COLORS[task.metadata.securitySeverity])}
              >
                <Shield className="h-3 w-3 mr-1" />
                {task.metadata.securitySeverity}
              </Badge>
            )}
            {/* Source Type */}
            {task.metadata?.sourceType && (
              <Badge variant="secondary" className="text-xs">
                {task.metadata.sourceType === 'ideation' && task.metadata.ideationType
                  ? IDEATION_TYPE_LABELS[task.metadata.ideationType] || task.metadata.ideationType
                  : task.metadata.sourceType}
              </Badge>
            )}
          </div>
        )}

        {/* Timeline - Right */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Created {formatRelativeTime(task.createdAt)}
          </span>
          <span className="text-border">•</span>
          <span>Updated {formatRelativeTime(task.updatedAt)}</span>
        </div>
      </div>

      {/* Description - Primary Content */}
      {displayDescription && (
        <div className="bg-muted/30 rounded-lg px-4 py-3 border border-border/50 overflow-hidden max-w-full">
          {/* Content container with conditional max-height */}
          <div className="relative">
            <div
              ref={contentRef}
              id={contentId}
              className={cn(
                'prose prose-sm dark:prose-invert max-w-none overflow-hidden prose-p:text-foreground/90 prose-p:leading-relaxed prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground/90 prose-ul:my-2 prose-li:my-0.5 prose-a:break-all prose-pre:overflow-x-auto prose-img:max-w-full [&_img]:!max-w-full [&_img]:h-auto [&_code]:break-all [&_code]:whitespace-pre-wrap [&_*]:max-w-full',
                !isExpanded && hasOverflow && 'max-h-[200px]'
              )}
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayDescription}
              </ReactMarkdown>
            </div>

            {/* Gradient overlay when collapsed and has overflow */}
            {!isExpanded && hasOverflow && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-muted/80 to-transparent pointer-events-none" />
            )}
          </div>

          {/* Expand/Collapse button */}
          {hasOverflow && (
            <div className="flex justify-center mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-muted-foreground hover:text-foreground"
                aria-expanded={isExpanded}
                aria-controls={contentId}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" aria-hidden="true" />
                    {t('tasks:metadata.showLess')}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" aria-hidden="true" />
                    {t('tasks:metadata.showMore')}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Secondary Details */}
      {task.metadata && (
        <div className="space-y-4 pt-2">
          {/* Rationale */}
          {task.metadata.rationale && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Lightbulb className="h-3 w-3 text-warning" />
                Rationale
              </h3>
              <p className="text-sm text-foreground/80">{task.metadata.rationale}</p>
            </div>
          )}

          {/* Problem Solved */}
          {task.metadata.problemSolved && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Target className="h-3 w-3 text-success" />
                Problem Solved
              </h3>
              <p className="text-sm text-foreground/80">{task.metadata.problemSolved}</p>
            </div>
          )}

          {/* Target Audience */}
          {task.metadata.targetAudience && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Users className="h-3 w-3 text-info" />
                Target Audience
              </h3>
              <p className="text-sm text-foreground/80">{task.metadata.targetAudience}</p>
            </div>
          )}

          {/* Dependencies */}
          {task.metadata.dependencies && task.metadata.dependencies.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <GitBranch className="h-3 w-3 text-purple-400" />
                Dependencies
              </h3>
              <ul className="text-sm text-foreground/80 list-disc list-inside space-y-0.5">
                {task.metadata.dependencies.map((dep, idx) => (
                  <li key={idx}>{dep}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Pull Request */}
          {task.metadata.prUrl && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <GitPullRequest className="h-3 w-3 text-info" />
                {t('tasks:metadata.pullRequest')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (task.metadata?.prUrl) {
                    window.electronAPI.openExternal(task.metadata.prUrl);
                  }
                }}
                className="text-sm text-info hover:underline flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-left"
              >
                {task.metadata.prUrl}
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Acceptance Criteria */}
          {task.metadata.acceptanceCriteria && task.metadata.acceptanceCriteria.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <ListChecks className="h-3 w-3 text-success" />
                Acceptance Criteria
              </h3>
              <ul className="text-sm text-foreground/80 list-disc list-inside space-y-0.5">
                {task.metadata.acceptanceCriteria.map((criteria, idx) => (
                  <li key={idx}>{criteria}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Affected Files */}
          {task.metadata.affectedFiles && task.metadata.affectedFiles.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <FileCode className="h-3 w-3" />
                Affected Files
              </h3>
              <div className="flex flex-wrap gap-1">
                {task.metadata.affectedFiles.map((file, idx) => (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="text-xs font-mono cursor-help">
                        {file.split('/').pop()}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="font-mono text-xs">
                      {file}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
