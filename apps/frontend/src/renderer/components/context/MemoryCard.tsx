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
  ChevronUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { MemoryEpisode } from '../../../shared/types';
import { memoryTypeIcons, memoryTypeColors, memoryTypeLabels } from './constants';
import { formatDate } from './utils';
import { PRReviewCard } from './PRReviewCard';

interface MemoryCardProps {
  memory: MemoryEpisode;
}

interface ParsedSessionInsight {
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

function parseMemoryContent(content: string): ParsedSessionInsight | null {
  try {
    return JSON.parse(content);
  } catch {
    // Try to parse nested JSON (from our LadybugDB query)
    try {
      const outer = JSON.parse(content);
      if (typeof outer === 'object') {
        return outer;
      }
    } catch {
      return null;
    }
    return null;
  }
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ComponentType<{ className?: string }>; title: string; count?: number }) {
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

function ListItem({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'success' | 'error' | 'default' }) {
  const colorClass = variant === 'success'
    ? 'text-success'
    : variant === 'error'
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <li className={`text-sm ${colorClass} py-1 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-muted-foreground/50`}>
      {children}
    </li>
  );
}

// Check if memory content looks like a PR review
function isPRReviewMemory(memory: MemoryEpisode): boolean {
  // Check by type first
  if (memory.type === 'pr_review' || memory.type === 'pr_finding' ||
      memory.type === 'pr_pattern' || memory.type === 'pr_gotcha') {
    return true;
  }

  // Check by content structure (for session_insight type that's actually a PR review)
  try {
    const parsed = JSON.parse(memory.content);
    return parsed.prNumber !== undefined && parsed.verdict !== undefined;
  } catch {
    return false;
  }
}

export function MemoryCard({ memory }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = useMemo(() => parseMemoryContent(memory.content), [memory.content]);

  // Determine if there's meaningful content to show (must be called before early return)
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
      d.approach_outcome?.approach_used
    );
  }, [parsed]);

  // Delegate PR reviews to specialized component
  if (isPRReviewMemory(memory)) {
    return <PRReviewCard memory={memory} />;
  }

  const Icon = memoryTypeIcons[memory.type] || memoryTypeIcons.session_insight;
  const typeColor = memoryTypeColors[memory.type] || '';
  const typeLabel = memoryTypeLabels[memory.type] || memory.type.replace(/_/g, ' ');

  const sessionLabel = memory.session_number
    ? `Session #${memory.session_number}`
    : parsed?.session_number
      ? `Session #${parsed.session_number}`
      : null;

  const specId = parsed?.spec_id;

  return (
    <Card className="bg-muted/30 border-border/50 hover:border-border transition-colors">
      <CardContent className="pt-4 pb-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg bg-accent/10">
              <Icon className="h-4 w-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-xs capitalize font-medium ${typeColor}`}>
                  {typeLabel}
                </Badge>
                {sessionLabel && (
                  <span className="text-sm font-medium text-foreground">
                    {sessionLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDate(memory.timestamp)}
                </div>
                {specId && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={specId}>
                    {specId}
                  </span>
                )}
              </div>
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
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Expand
                </>
              )}
            </Button>
          )}
        </div>

        {/* Expanded Content */}
        {expanded && parsed && (
          <div className="mt-4 space-y-4 pt-4 border-t border-border/50">
            {/* What Worked */}
            {parsed.what_worked && parsed.what_worked.length > 0 && (
              <div>
                <SectionHeader icon={CheckCircle2} title="What Worked" count={parsed.what_worked.length} />
                <ul className="space-y-0.5">
                  {parsed.what_worked.map((item, idx) => (
                    <ListItem key={idx} variant="success">{item}</ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* What Failed */}
            {parsed.what_failed && parsed.what_failed.length > 0 && (
              <div>
                <SectionHeader icon={XCircle} title="What Failed" count={parsed.what_failed.length} />
                <ul className="space-y-0.5">
                  {parsed.what_failed.map((item, idx) => (
                    <ListItem key={idx} variant="error">{item}</ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* Approach Outcome */}
            {parsed.discoveries?.approach_outcome?.approach_used && (
              <div>
                <SectionHeader
                  icon={parsed.discoveries.approach_outcome.success ? CheckCircle2 : AlertTriangle}
                  title="Approach"
                />
                <div className="pl-4 space-y-2">
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
            {((parsed.recommendations_for_next_session?.length ?? 0) > 0 ||
              (parsed.discoveries?.recommendations?.length ?? 0) > 0) && (
              <div>
                <SectionHeader
                  icon={Lightbulb}
                  title="Recommendations"
                  count={(parsed.recommendations_for_next_session?.length ?? 0) + (parsed.discoveries?.recommendations?.length ?? 0)}
                />
                <ul className="space-y-0.5">
                  {parsed.recommendations_for_next_session?.map((item, idx) => (
                    <ListItem key={`rec-${idx}`}>{item}</ListItem>
                  ))}
                  {parsed.discoveries?.recommendations?.map((item, idx) => (
                    <ListItem key={`disc-rec-${idx}`}>{item}</ListItem>
                  ))}
                </ul>
              </div>
            )}

            {/* Patterns Discovered */}
            {parsed.discoveries?.patterns_discovered && parsed.discoveries.patterns_discovered.length > 0 && (
              <div>
                <SectionHeader icon={Sparkles} title="Patterns" count={parsed.discoveries.patterns_discovered.length} />
                <div className="flex flex-wrap gap-2 pl-4">
                  {parsed.discoveries.patterns_discovered.map((pattern, idx) => {
                    const text = typeof pattern === 'string'
                      ? pattern
                      : (pattern?.pattern || pattern?.applies_to || JSON.stringify(pattern));
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
            {parsed.discoveries?.gotchas_discovered && parsed.discoveries.gotchas_discovered.length > 0 && (
              <div>
                <SectionHeader icon={AlertTriangle} title="Gotchas" count={parsed.discoveries.gotchas_discovered.length} />
                <ul className="space-y-0.5">
                  {parsed.discoveries.gotchas_discovered.map((gotcha, idx) => {
                    const text = typeof gotcha === 'string'
                      ? gotcha
                      : (gotcha?.gotcha || JSON.stringify(gotcha));
                    return text ? (
                      <ListItem key={idx} variant="error">{text}</ListItem>
                    ) : null;
                  })}
                </ul>
              </div>
            )}

            {/* Changed Files */}
            {parsed.discoveries?.changed_files && parsed.discoveries.changed_files.length > 0 && (
              <div>
                <SectionHeader icon={FileCode} title="Changed Files" count={parsed.discoveries.changed_files.length} />
                <div className="flex flex-wrap gap-1.5 pl-4">
                  {parsed.discoveries.changed_files.map((file, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs font-mono">
                      {file}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* File Insights */}
            {parsed.discoveries?.file_insights && parsed.discoveries.file_insights.length > 0 && (
              <div>
                <SectionHeader icon={FileCode} title="File Insights" count={parsed.discoveries.file_insights.length} />
                <div className="space-y-2 pl-4">
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
            {parsed.subtasks_completed && parsed.subtasks_completed.length > 0 && (
              <div>
                <SectionHeader icon={CheckCircle2} title="Subtasks Completed" count={parsed.subtasks_completed.length} />
                <div className="flex flex-wrap gap-1.5 pl-4">
                  {parsed.subtasks_completed.map((task, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs font-mono">
                      {task}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Fallback for unparseable content */}
        {expanded && !parsed && (
          <pre className="mt-4 text-xs text-muted-foreground whitespace-pre-wrap font-mono p-3 bg-background rounded-lg max-h-64 overflow-auto border border-border/50">
            {memory.content}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
