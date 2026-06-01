import { useState, useMemo } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Lightbulb,
  FileCode,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Flag,
  Pin,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { RendererMemory } from '../../../shared/types';
import { memoryTypeIcons, memoryTypeColors, memoryTypeLabels } from './constants';
import { formatDate } from './utils';
import { PRReviewCard } from './PRReviewCard';
import { cn } from '../../lib/utils';

interface MemoryCardProps {
  memory: RendererMemory;
  onVerify?: (memoryId: string) => void;
  onPin?: (memoryId: string, pinned: boolean) => void;
  onDeprecate?: (memoryId: string) => void;
}

interface ParsedMemoryContent {
  // Structured fields
  approach_tried?: string;
  why_it_failed?: string;
  alternative_used?: string;
  steps?: string[];
  scope?: string;
  // Legacy session insight fields
  spec_id?: string;
  session_number?: number;
  subtasks_completed?: string[];
  what_worked?: string[];
  what_failed?: string[];
  recommendations_for_next_session?: string[];
  discoveries?: {
    file_insights?: Array<{ path?: string; purpose?: string; changes_made?: string }>;
    patterns_discovered?: Array<{ pattern?: string; applies_to?: string } | string>;
    gotchas_discovered?: Array<{ gotcha?: string; trigger?: string; solution?: string } | string>;
    approach_outcome?: {
      success?: boolean;
      approach_used?: string;
      why_it_worked?: string;
      why_it_failed?: string;
    };
    recommendations?: string[];
    changed_files?: string[];
  };
}

function parseMemoryContent(content: string): ParsedMemoryContent | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function SectionHeader({
  icon: Icon,
  title,
  count
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium text-foreground">{title}</span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="text-xs px-1.5 py-0">
          {count}
        </Badge>
      )}
    </div>
  );
}

function ListItem({
  children,
  variant = 'default'
}: {
  children: React.ReactNode;
  variant?: 'success' | 'error' | 'default';
}) {
  const colorClass =
    variant === 'success'
      ? 'text-success'
      : variant === 'error'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <li
      className={`text-sm ${colorClass} py-1 ps-4 relative before:content-['•'] before:absolute before:start-0 before:text-muted-foreground/50`}
    >
      {children}
    </li>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5" title={`Confidence: ${pct}%`}>
      <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

// Check if memory content looks like a PR review (by content structure only)
function isPRReviewMemory(memory: RendererMemory): boolean {
  try {
    const parsed = JSON.parse(memory.content);
    return parsed.prNumber !== undefined && parsed.verdict !== undefined;
  } catch {
    return false;
  }
}

// Dead-end memory: parse structured approach/failure info
function DeadEndContent({ parsed, sections }: { parsed: ParsedMemoryContent; sections: Record<string, string> }) {
  const approachTried = parsed.approach_tried;
  const whyItFailed = parsed.why_it_failed;
  const alternativeUsed = parsed.alternative_used;

  if (!approachTried && !whyItFailed && !alternativeUsed) return null;

  return (
    <div className="space-y-2">
      {approachTried && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {sections.approachTried}
          </p>
          <p className="text-sm text-foreground ps-2">{approachTried}</p>
        </div>
      )}
      {whyItFailed && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {sections.whyItFailed}
          </p>
          <p className="text-sm text-destructive ps-2">{whyItFailed}</p>
        </div>
      )}
      {alternativeUsed && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {sections.alternativeUsed}
          </p>
          <p className="text-sm text-success ps-2">{alternativeUsed}</p>
        </div>
      )}
    </div>
  );
}

// Workflow recipe: show ordered steps if available
function WorkflowSteps({ steps, label }: { steps: string[]; label: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </p>
      <ol className="space-y-1 ps-4">
        {steps.map((step, idx) => (
          <li key={idx} className="text-sm text-muted-foreground flex gap-2">
            <span className="text-xs font-mono text-muted-foreground/50 shrink-0 mt-0.5">
              {idx + 1}.
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MemoryCard({ memory, onVerify, onPin, onDeprecate }: MemoryCardProps) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const parsed = useMemo(() => parseMemoryContent(memory.content), [memory.content]);

  // Determine if there's meaningful content to show
  const hasContent = useMemo(() => {
    if (!parsed) return false;
    const d = parsed.discoveries || {};
    return (
      (parsed.what_worked?.length ?? 0) > 0 ||
      (parsed.what_failed?.length ?? 0) > 0 ||
      (parsed.recommendations_for_next_session?.length ?? 0) > 0 ||
      (d.patterns_discovered?.length ?? 0) > 0 ||
      (d.gotchas_discovered?.length ?? 0) > 0 ||
      (d.file_insights?.length ?? 0) > 0 ||
      (d.changed_files?.length ?? 0) > 0 ||
      d.approach_outcome?.approach_used ||
      parsed.approach_tried ||
      parsed.why_it_failed ||
      parsed.alternative_used ||
      (parsed.steps?.length ?? 0) > 0 ||
      memory.relatedFiles.length > 0 ||
      memory.tags.length > 0
    );
  }, [parsed, memory.relatedFiles, memory.tags]);

  // Delegate PR reviews to specialized component
  if (isPRReviewMemory(memory)) {
    return <PRReviewCard memory={memory} />;
  }

  const Icon = memoryTypeIcons[memory.type] || memoryTypeIcons.module_insight;
  const typeColor = memoryTypeColors[memory.type] || '';
  const typeLabel =
    memoryTypeLabels[memory.type] ||
    t(`memory.types.${memory.type}`, { defaultValue: memory.type.replace(/_/g, ' ') });

  const sessionLabel = parsed?.session_number ? `Session #${parsed.session_number}` : null;
  const specId = parsed?.spec_id;
  const sourceLabel = t(`memory.sources.${memory.source}`, { defaultValue: memory.source });
  const sections = {
    whatWorked: t('memory.sections.whatWorked'),
    whatFailed: t('memory.sections.whatFailed'),
    approach: t('memory.sections.approach'),
    recommendations: t('memory.sections.recommendations'),
    patterns: t('memory.sections.patterns'),
    gotchas: t('memory.sections.gotchas'),
    changedFiles: t('memory.sections.changedFiles'),
    fileInsights: t('memory.sections.fileInsights'),
    subtasksCompleted: t('memory.sections.subtasksCompleted'),
    relatedFiles: t('memory.sections.relatedFiles'),
    tags: t('memory.sections.tags'),
    approachTried: t('memory.sections.approachTried'),
    whyItFailed: t('memory.sections.whyItFailed'),
    alternativeUsed: t('memory.sections.alternativeUsed'),
    steps: t('memory.sections.steps')
  };

  const isDeadEnd = memory.type === 'dead_end';
  const isWorkflowRecipe = memory.type === 'workflow_recipe';

  return (
    <Card className="bg-muted/30 border-border/50 hover:border-border transition-colors">
      <CardContent className="pt-4 pb-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg bg-accent/10 shrink-0">
              <Icon className="h-4 w-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              {/* Type badge + session label */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={cn('text-xs capitalize font-medium', typeColor)}
                >
                  {typeLabel}
                </Badge>
                {sessionLabel && (
                  <span className="text-sm font-medium text-foreground">{sessionLabel}</span>
                )}
                {memory.pinned && (
                  <Pin className="h-3.5 w-3.5 text-accent shrink-0" aria-label={t('memory.badges.pinned')} />
                )}
                {memory.needsReview && (
                  <Flag
                    className="h-3.5 w-3.5 text-amber-400 shrink-0"
                    aria-label={t('memory.badges.needsReview')}
                  />
                )}
                {memory.userVerified && (
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-green-400 shrink-0"
                    aria-label={t('memory.badges.verified')}
                  />
                )}
              </div>

              {/* Confidence + source + timestamp */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  {formatDate(memory.createdAt)}
                </div>
                <ConfidenceBar confidence={memory.confidence} />
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {sourceLabel}
                </Badge>
                {specId && (
                  <span
                    className="text-xs text-muted-foreground truncate max-w-[180px]"
                    title={specId}
                  >
                    {specId}
                  </span>
                )}
              </div>

              {/* Tags row */}
              {memory.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {memory.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Content preview for simple types */}
              {!hasContent && memory.content && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {memory.content}
                </p>
              )}
            </div>
          </div>

          {hasContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 gap-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  {t('memory.collapse')}
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  {t('memory.expand')}
                </>
              )}
            </Button>
          )}
        </div>

        {/* Actions */}
        {(onVerify || onPin || onDeprecate) && (
          <div className="flex items-center gap-1 mt-2">
            {!memory.userVerified && onVerify && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-green-400"
                onClick={() => onVerify(memory.id)}
                title={t('memory.actions.verify')}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('memory.actions.verify')}
              </Button>
            )}
            {onPin && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 text-xs',
                  memory.pinned ? 'text-accent' : 'text-muted-foreground hover:text-accent'
                )}
                onClick={() => onPin(memory.id, !memory.pinned)}
                title={memory.pinned ? t('memory.actions.unpin') : t('memory.actions.pin')}
              >
                <Pin className="h-3.5 w-3.5" />
                {memory.pinned ? t('memory.actions.unpin') : t('memory.actions.pin')}
              </Button>
            )}
            {onDeprecate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onDeprecate(memory.id)}
                title={t('memory.actions.deprecate')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('memory.actions.deprecate')}
              </Button>
            )}
          </div>
        )}

        {/* Expanded Content */}
        {expanded && (
          <div className="mt-4 space-y-4 pt-4 border-t border-border/50">
            {/* Plain content display for non-JSON or simple memories */}
            {!parsed && memory.content && (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-background rounded-lg max-h-64 overflow-auto border border-border/50">
                {memory.content}
              </pre>
            )}

            {/* Dead-end structured content */}
            {isDeadEnd && parsed && (
              <DeadEndContent parsed={parsed} sections={sections} />
            )}

            {/* Workflow recipe steps */}
            {isWorkflowRecipe && parsed?.steps && parsed.steps.length > 0 && (
              <WorkflowSteps steps={parsed.steps} label={sections.steps} />
            )}

            {/* What Worked */}
            {parsed?.what_worked && parsed.what_worked.length > 0 && (
              <div>
                <SectionHeader
                  icon={CheckCircle2}
                  title={sections.whatWorked}
                  count={parsed.what_worked.length}
                />
                <ul className="space-y-0.5">
                  {parsed.what_worked.map((item, idx) => (
                    <ListItem key={idx} variant="success">
                      {item}
                    </ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* What Failed */}
            {parsed?.what_failed && parsed.what_failed.length > 0 && (
              <div>
                <SectionHeader
                  icon={XCircle}
                  title={sections.whatFailed}
                  count={parsed.what_failed.length}
                />
                <ul className="space-y-0.5">
                  {parsed.what_failed.map((item, idx) => (
                    <ListItem key={idx} variant="error">
                      {item}
                    </ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* Approach Outcome */}
            {parsed?.discoveries?.approach_outcome?.approach_used && (
              <div>
                <SectionHeader
                  icon={
                    parsed.discoveries.approach_outcome.success ? CheckCircle2 : AlertTriangle
                  }
                  title={sections.approach}
                />
                <div className="ps-4 space-y-2">
                  <p className="text-sm text-foreground">
                    {parsed.discoveries.approach_outcome.approach_used}
                  </p>
                  {parsed.discoveries.approach_outcome.why_it_worked && (
                    <p className="text-sm text-success">
                      {parsed.discoveries.approach_outcome.why_it_worked}
                    </p>
                  )}
                  {parsed.discoveries.approach_outcome.why_it_failed && (
                    <p className="text-sm text-destructive">
                      {parsed.discoveries.approach_outcome.why_it_failed}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {((parsed?.recommendations_for_next_session?.length ?? 0) > 0 ||
              (parsed?.discoveries?.recommendations?.length ?? 0) > 0) && (
              <div>
                <SectionHeader
                  icon={Lightbulb}
                  title={sections.recommendations}
                  count={
                    (parsed?.recommendations_for_next_session?.length ?? 0) +
                    (parsed?.discoveries?.recommendations?.length ?? 0)
                  }
                />
                <ul className="space-y-0.5">
                  {parsed?.recommendations_for_next_session?.map((item, idx) => (
                    <ListItem key={`rec-${idx}`}>{item}</ListItem>
                  ))}
                  {parsed?.discoveries?.recommendations?.map((item, idx) => (
                    <ListItem key={`disc-rec-${idx}`}>{item}</ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* Patterns Discovered */}
            {parsed?.discoveries?.patterns_discovered &&
              parsed.discoveries.patterns_discovered.length > 0 && (
                <div>
                  <SectionHeader
                    icon={Sparkles}
                    title={sections.patterns}
                    count={parsed.discoveries.patterns_discovered.length}
                  />
                  <div className="flex flex-wrap gap-2 ps-4">
                    {parsed.discoveries.patterns_discovered.map((pattern, idx) => {
                      const text =
                        typeof pattern === 'string'
                          ? pattern
                          : pattern?.pattern || pattern?.applies_to || JSON.stringify(pattern);
                      return text ? (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {text}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              )}

            {/* Gotchas */}
            {parsed?.discoveries?.gotchas_discovered &&
              parsed.discoveries.gotchas_discovered.length > 0 && (
                <div>
                  <SectionHeader
                    icon={AlertTriangle}
                    title={sections.gotchas}
                    count={parsed.discoveries.gotchas_discovered.length}
                  />
                  <ul className="space-y-0.5">
                    {parsed.discoveries.gotchas_discovered.map((gotcha, idx) => {
                      const text =
                        typeof gotcha === 'string' ? gotcha : gotcha?.gotcha || JSON.stringify(gotcha);
                      return text ? (
                        <ListItem key={idx} variant="error">
                          {text}
                        </ListItem>
                      ) : null;
                    })}
                  </ul>
                </div>
              )}

            {/* Changed Files */}
            {parsed?.discoveries?.changed_files &&
              parsed.discoveries.changed_files.length > 0 && (
                <div>
                  <SectionHeader
                    icon={FileCode}
                    title={sections.changedFiles}
                    count={parsed.discoveries.changed_files.length}
                  />
                  <div className="flex flex-wrap gap-1.5 ps-4">
                    {parsed.discoveries.changed_files.map((file, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs font-mono">
                        {file}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

            {/* File Insights */}
            {parsed?.discoveries?.file_insights && parsed.discoveries.file_insights.length > 0 && (
              <div>
                <SectionHeader
                  icon={FileCode}
                  title={sections.fileInsights}
                  count={parsed.discoveries.file_insights.length}
                />
                <div className="space-y-2 ps-4">
                  {parsed.discoveries.file_insights.map((insight, idx) => (
                    <div key={idx} className="text-sm">
                      {insight.path && (
                        <Badge variant="outline" className="text-xs font-mono mb-1">
                          {insight.path}
                        </Badge>
                      )}
                      {insight.purpose && (
                        <p className="text-muted-foreground">{insight.purpose}</p>
                      )}
                      {insight.changes_made && (
                        <p className="text-foreground mt-0.5">{insight.changes_made}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Subtasks Completed */}
            {parsed?.subtasks_completed && parsed.subtasks_completed.length > 0 && (
              <div>
                <SectionHeader
                  icon={CheckCircle2}
                  title={sections.subtasksCompleted}
                  count={parsed.subtasks_completed.length}
                />
                <div className="flex flex-wrap gap-1.5 ps-4">
                  {parsed.subtasks_completed.map((task, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs font-mono">
                      {task}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Related Files (collapsible) */}
            {memory.relatedFiles.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setFilesExpanded(!filesExpanded)}
                  className="flex items-center gap-2 mb-2 group"
                >
                  <FileCode className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{sections.relatedFiles}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {memory.relatedFiles.length}
                  </Badge>
                  {filesExpanded ? (
                    <ChevronUp className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
                {filesExpanded && (
                  <div className="flex flex-wrap gap-1.5 ps-6">
                    {memory.relatedFiles.map((file) => (
                      <Badge key={file} variant="outline" className="text-xs font-mono">
                        {file}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* If no expandable content, show content inline for simple text-only memories */}
        {!hasContent && !memory.content && expanded && (
          <p className="mt-4 text-xs text-muted-foreground italic">No additional details available.</p>
        )}
      </CardContent>
    </Card>
  );
}
