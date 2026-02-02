import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Terminal,
  Loader2,
  FolderOpen,
  BrainCircuit,
  FileCheck,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Info,
  Clock,
  Activity
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../ui/collapsible';
import { cn } from '../../../lib/utils';
import type {
  PRLogs,
  PRLogPhase,
  PRPhaseLog,
  PRLogEntry
} from '../../../../preload/api/modules/github-api';

interface PRLogsProps {
  prNumber: number;
  logs: PRLogs | null;
  isLoading: boolean;
  isStreaming?: boolean;
}

const PHASE_LABELS: Record<PRLogPhase, string> = {
  context: 'Context Gathering',
  analysis: 'AI Analysis',
  synthesis: 'Synthesis'
};

const PHASE_ICONS: Record<PRLogPhase, typeof FolderOpen> = {
  context: FolderOpen,
  analysis: BrainCircuit,
  synthesis: FileCheck
};

const PHASE_COLORS: Record<PRLogPhase, string> = {
  context: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
  analysis: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
  synthesis: 'text-green-500 bg-green-500/10 border-green-500/30'
};

// Source colors for different log sources
const SOURCE_COLORS: Record<string, string> = {
  'Context': 'bg-blue-500/20 text-blue-400',
  'AI': 'bg-purple-500/20 text-purple-400',
  'Orchestrator': 'bg-orange-500/20 text-orange-400',
  'ParallelOrchestrator': 'bg-orange-500/20 text-orange-400',
  'Followup': 'bg-cyan-500/20 text-cyan-400',
  'ParallelFollowup': 'bg-cyan-500/20 text-cyan-400',
  'BotDetector': 'bg-amber-500/20 text-amber-400',
  'Progress': 'bg-green-500/20 text-green-400',
  'PR Review Engine': 'bg-indigo-500/20 text-indigo-400',
  'Summary': 'bg-emerald-500/20 text-emerald-400',
  // Specialist agents (from parallel orchestrator - old Task tool approach)
  'Agent:logic-reviewer': 'bg-blue-600/20 text-blue-400',
  'Agent:quality-reviewer': 'bg-indigo-600/20 text-indigo-400',
  'Agent:security-reviewer': 'bg-red-600/20 text-red-400',
  'Agent:ai-triage-reviewer': 'bg-slate-500/20 text-slate-400',
  // Specialist agents (from parallel followup reviewer)
  'Agent:resolution-verifier': 'bg-teal-600/20 text-teal-400',
  'Agent:new-code-reviewer': 'bg-cyan-600/20 text-cyan-400',
  'Agent:comment-analyzer': 'bg-gray-500/20 text-gray-400',
  // Parallel SDK specialists (new approach using parallel SDK sessions)
  'Specialist:security': 'bg-red-600/20 text-red-400',
  'Specialist:quality': 'bg-indigo-600/20 text-indigo-400',
  'Specialist:logic': 'bg-blue-600/20 text-blue-400',
  'Specialist:codebase-fit': 'bg-emerald-600/20 text-emerald-400',
  'default': 'bg-muted text-muted-foreground'
};

// Helper type for grouped agent entries
interface AgentGroup {
  agentName: string;
  entries: PRLogEntry[];
}

// Patterns that indicate orchestrator tool activity (vs. important messages)
const TOOL_ACTIVITY_PATTERNS = [
  /^Reading /,
  /^Searching for /,
  /^Finding files /,
  /^Running: /,
  /^Editing /,
  /^Writing /,
  /^Using tool: /,
  /^Processing\.\.\. \(\d+ messages/,
  /^Tool result \[/,
];

function isToolActivityLog(content: string): boolean {
  return TOOL_ACTIVITY_PATTERNS.some(pattern => pattern.test(content));
}

// Group entries by: agents, orchestrator activity, and other entries
function groupEntriesByAgent(entries: PRLogEntry[]): {
  agentGroups: AgentGroup[];
  orchestratorActivity: PRLogEntry[];
  otherEntries: PRLogEntry[];
} {
  const agentMap = new Map<string, PRLogEntry[]>();
  const orchestratorActivity: PRLogEntry[] = [];
  const otherEntries: PRLogEntry[] = [];

  for (const entry of entries) {
    if (entry.source?.startsWith('Agent:') || entry.source?.startsWith('Specialist:')) {
      // Agent/Specialist results (both old Task tool and new parallel SDK approaches)
      const existing = agentMap.get(entry.source) || [];
      existing.push(entry);
      agentMap.set(entry.source, existing);
    } else if (
      (entry.source === 'ParallelOrchestrator' || entry.source === 'ParallelFollowup') &&
      isToolActivityLog(entry.content)
    ) {
      // Orchestrator tool activity (verbose logs)
      orchestratorActivity.push(entry);
    } else {
      // Important messages (AI response, Invoking agent, etc.)
      otherEntries.push(entry);
    }
  }

  // Convert map to array of groups, sorted by first entry timestamp
  const agentGroups: AgentGroup[] = Array.from(agentMap.entries())
    .map(([agentName, agentEntries]) => ({ agentName, entries: agentEntries }))
    .sort((a, b) => {
      const aTime = a.entries[0]?.timestamp || '';
      const bTime = b.entries[0]?.timestamp || '';
      return aTime.localeCompare(bTime);
    });

  return { agentGroups, orchestratorActivity, otherEntries };
}

export function PRLogs({ prNumber, logs, isLoading, isStreaming = false }: PRLogsProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<PRLogPhase>>(new Set(['analysis']));
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const togglePhase = (phase: PRLogPhase) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const toggleAgent = (agentKey: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentKey)) {
        next.delete(agentKey);
      } else {
        next.add(agentKey);
      }
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
      <div className="p-4 space-y-2">
        {isLoading && !logs ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs ? (
          <>
            {/* Logs header */}
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                PR #{prNumber}
                {logs.is_followup && <Badge variant="outline" className="text-xs">Follow-up</Badge>}
                {isStreaming && (
                  <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500/30 flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Live
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(logs.updated_at).toLocaleString()}
              </div>
            </div>

            {/* Phase-based collapsible logs */}
            {(['context', 'analysis', 'synthesis'] as PRLogPhase[]).map((phase) => (
              <PhaseLogSection
                key={phase}
                phase={phase}
                phaseLog={logs.phases[phase]}
                isExpanded={expandedPhases.has(phase)}
                onToggle={() => togglePhase(phase)}
                isStreaming={isStreaming}
                expandedAgents={expandedAgents}
                onToggleAgent={toggleAgent}
              />
            ))}
          </>
        ) : isStreaming ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-blue-500" />
            <p>Waiting for logs...</p>
            <p className="text-xs mt-1">Review is starting</p>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Terminal className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No logs available</p>
            <p className="text-xs mt-1">Run a review to generate logs</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Phase Log Section Component
interface PhaseLogSectionProps {
  phase: PRLogPhase;
  phaseLog: PRPhaseLog | null;
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming?: boolean;
  expandedAgents: Set<string>;
  onToggleAgent: (agentKey: string) => void;
}

function PhaseLogSection({ phase, phaseLog, isExpanded, onToggle, isStreaming = false, expandedAgents, onToggleAgent }: PhaseLogSectionProps) {
  const Icon = PHASE_ICONS[phase];
  const status = phaseLog?.status || 'pending';
  const hasEntries = (phaseLog?.entries.length || 0) > 0;

  const getStatusBadge = () => {
    // Show streaming indicator for active phase during streaming
    if (status === 'active' || (isStreaming && status === 'pending')) {
      return (
        <Badge variant="outline" className="text-xs bg-info/10 text-info border-info/30 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {isStreaming ? 'Streaming' : 'Running'}
        </Badge>
      );
    }

    // Defensive check: During streaming, if a phase shows "completed" but has no entries,
    // treat it as pending (this catches edge cases where phases are marked complete incorrectly)
    if (isStreaming && status === 'completed' && !hasEntries) {
      return (
        <Badge variant="secondary" className="text-xs text-muted-foreground">
          Pending
        </Badge>
      );
    }

    switch (status) {
      case 'completed':
        return (
          <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Complete
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs text-muted-foreground">
            Pending
          </Badge>
        );
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center justify-between p-3 rounded-lg border transition-colors',
            'hover:bg-secondary/50',
            status === 'active' && PHASE_COLORS[phase],
            status === 'completed' && 'border-success/30 bg-success/5',
            status === 'failed' && 'border-destructive/30 bg-destructive/5',
            status === 'pending' && 'border-border bg-secondary/30'
          )}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Icon className={cn('h-4 w-4', status === 'active' ? PHASE_COLORS[phase].split(' ')[0] : 'text-muted-foreground')} />
            <span className="font-medium text-sm">{PHASE_LABELS[phase]}</span>
            {hasEntries && (
              <span className="text-xs text-muted-foreground">
                ({phaseLog?.entries.length} entries)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-6 border-l-2 border-border pl-4 py-2 space-y-2">
          {!hasEntries ? (
            <p className="text-xs text-muted-foreground italic">No logs yet</p>
          ) : (
            <GroupedLogEntries
              entries={phaseLog?.entries || []}
              phase={phase}
              expandedAgents={expandedAgents}
              onToggleAgent={onToggleAgent}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Grouped Log Entries Component - renders agents grouped with collapsible sections
interface GroupedLogEntriesProps {
  entries: PRLogEntry[];
  phase: PRLogPhase;
  expandedAgents: Set<string>;
  onToggleAgent: (agentKey: string) => void;
}

function GroupedLogEntries({ entries, phase, expandedAgents, onToggleAgent }: GroupedLogEntriesProps) {
  const { agentGroups, orchestratorActivity, otherEntries } = groupEntriesByAgent(entries);

  return (
    <div className="space-y-2">
      {/* Render important messages first (AI response, Invoking agent, etc.) */}
      {otherEntries.length > 0 && (
        <div className="space-y-1">
          {otherEntries.map((entry, idx) => (
            <LogEntry key={`other-${entry.timestamp}-${idx}`} entry={entry} />
          ))}
        </div>
      )}

      {/* Render orchestrator tool activity in collapsible section */}
      {orchestratorActivity.length > 0 && (
        <OrchestratorActivitySection
          entries={orchestratorActivity}
          phase={phase}
          isExpanded={expandedAgents.has(`${phase}-orchestrator-activity`)}
          onToggle={() => onToggleAgent(`${phase}-orchestrator-activity`)}
        />
      )}

      {/* Render agent groups with collapsible sections */}
      {agentGroups.map((group) => (
        <AgentLogGroup
          key={`${phase}-${group.agentName}`}
          group={group}
          phase={phase}
          isExpanded={expandedAgents.has(`${phase}-${group.agentName}`)}
          onToggle={() => onToggleAgent(`${phase}-${group.agentName}`)}
        />
      ))}
    </div>
  );
}

// Orchestrator Activity Section - collapsible section for tool activity logs
interface OrchestratorActivitySectionProps {
  entries: PRLogEntry[];
  phase: PRLogPhase;
  isExpanded: boolean;
  onToggle: () => void;
}

function OrchestratorActivitySection({ entries, isExpanded, onToggle }: OrchestratorActivitySectionProps) {
  const { t } = useTranslation(['common']);

  // Count different types of operations for summary
  const readCount = entries.filter(e => e.content.startsWith('Reading ')).length;
  const searchCount = entries.filter(e => e.content.startsWith('Searching for ')).length;
  const otherCount = entries.length - readCount - searchCount;

  // Build summary text
  const summaryParts: string[] = [];
  if (readCount > 0) summaryParts.push(`${readCount} file${readCount > 1 ? 's' : ''} read`);
  if (searchCount > 0) summaryParts.push(`${searchCount} search${searchCount > 1 ? 'es' : ''}`);
  if (otherCount > 0) summaryParts.push(`${otherCount} other`);
  const summary = summaryParts.join(', ') || `${entries.length} operations`;

  return (
    <div className="rounded-md border border-border/50 bg-secondary/10 overflow-hidden">
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between p-2 transition-colors',
          'hover:bg-secondary/30',
          isExpanded && 'bg-secondary/20'
        )}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <Activity className="h-3 w-3 text-orange-400" />
          <span className="text-xs text-muted-foreground">{t('common:prReview.logs.agentActivity')}</span>
        </div>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-orange-500/10 text-orange-400 border-orange-500/30">
          {summary}
        </Badge>
      </button>

      {isExpanded && (
        <div className="border-t border-border/30 p-2 space-y-0.5 max-h-[300px] overflow-y-auto">
          {entries.map((entry, idx) => (
            <div key={`activity-${entry.timestamp}-${idx}`} className="flex items-start gap-2 text-[10px] text-muted-foreground/80 py-0.5">
              <span className="text-muted-foreground/50 tabular-nums shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="break-words">{entry.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Agent Log Group Component - shows first message + expandable section for more
interface AgentLogGroupProps {
  group: AgentGroup;
  phase: PRLogPhase;
  isExpanded: boolean;
  onToggle: () => void;
}

// Patterns that are uninteresting as summary entries
const SKIP_AS_SUMMARY_PATTERNS = [
  /^Starting analysis\.\.\.$/,
  /^Processing SDK stream\.\.\.$/,
  /^Processing\.\.\./,
  /^Awaiting response stream\.\.\.$/,
];

function isBoringSummary(content: string): boolean {
  return SKIP_AS_SUMMARY_PATTERNS.some(pattern => pattern.test(content));
}

// Find a meaningful summary entry - skip boring entries and prefer "AI response" or "Complete"
function findSummaryEntry(entries: PRLogEntry[]): { summaryEntry: PRLogEntry | undefined; otherEntries: PRLogEntry[] } {
  if (entries.length === 0) return { summaryEntry: undefined, otherEntries: [] };

  // Look for the most informative entry to show as summary
  // Priority: 1) "Complete:" entry, 2) "AI response:" entry, 3) first non-boring entry
  const completeEntry = entries.find(e => e.content.startsWith('Complete:'));
  if (completeEntry) {
    return {
      summaryEntry: completeEntry,
      otherEntries: entries.filter(e => e !== completeEntry),
    };
  }

  const aiResponseEntry = entries.find(e => e.content.startsWith('AI response:'));
  if (aiResponseEntry) {
    return {
      summaryEntry: aiResponseEntry,
      otherEntries: entries.filter(e => e !== aiResponseEntry),
    };
  }

  // Find first non-boring entry
  const meaningfulEntry = entries.find(e => !isBoringSummary(e.content));
  if (meaningfulEntry) {
    return {
      summaryEntry: meaningfulEntry,
      otherEntries: entries.filter(e => e !== meaningfulEntry),
    };
  }

  // Fallback to first entry
  return {
    summaryEntry: entries[0],
    otherEntries: entries.slice(1),
  };
}

function AgentLogGroup({ group, isExpanded, onToggle }: AgentLogGroupProps) {
  const { t } = useTranslation(['common']);
  const { agentName, entries } = group;

  // Find a meaningful summary entry instead of just using the first one
  const { summaryEntry, otherEntries } = findSummaryEntry(entries);
  const hasMoreEntries = otherEntries.length > 0;

  // Extract display name from "Agent:logic-reviewer" -> "logic-reviewer" or "Specialist:security" -> "security"
  const displayName = agentName.replace('Agent:', '').replace('Specialist:', '');

  const getSourceColor = (source: string) => {
    return SOURCE_COLORS[source] || SOURCE_COLORS.default;
  };

  return (
    <div className="rounded-md border border-border/50 bg-secondary/20 overflow-hidden">
      {/* Agent header with first message always visible */}
      <div className="p-2 space-y-1">
        {/* Agent badge header */}
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0.5', getSourceColor(agentName))}
          >
            {displayName}
          </Badge>
          {hasMoreEntries && (
            <button
              onClick={onToggle}
              className={cn(
                'flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors',
                'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
                isExpanded && 'bg-secondary/50 text-foreground'
              )}
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>{t('common:prReview.logs.hideMore', { count: otherEntries.length })}</span>
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span>{t('common:prReview.logs.showMore', { count: otherEntries.length })}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Summary entry - always visible (most informative entry, not necessarily first) */}
        {summaryEntry && (
          <LogEntry entry={{ ...summaryEntry, source: undefined }} />
        )}
      </div>

      {/* Collapsible section for other entries */}
      {hasMoreEntries && isExpanded && (
        <div className="border-t border-border/30 bg-secondary/10 p-2 space-y-1">
          {otherEntries.map((entry, idx) => (
            <LogEntry key={`${entry.timestamp}-${idx}`} entry={{ ...entry, source: undefined }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Log Entry Component
interface LogEntryProps {
  entry: PRLogEntry;
}

function LogEntry({ entry }: LogEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetail = Boolean(entry.detail);

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getSourceColor = (source: string | undefined) => {
    if (!source) return SOURCE_COLORS.default;
    return SOURCE_COLORS[source] || SOURCE_COLORS.default;
  };

  if (entry.type === 'error') {
    return (
      <div className="flex flex-col">
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1">
          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="break-words flex-1">{entry.content}</span>
          {hasDetail && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded shrink-0',
                'text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors',
                isExpanded && 'bg-secondary/50'
              )}
            >
              {isExpanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            </button>
          )}
        </div>
        {hasDetail && isExpanded && (
          <div className="mt-1.5 ml-4 p-2 bg-destructive/5 rounded-md border border-destructive/20 overflow-x-auto">
            <pre className="text-[10px] text-destructive/80 whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
              {entry.detail}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'success') {
    return (
      <div className="flex items-start gap-2 text-xs text-success bg-success/10 rounded-md px-2 py-1">
        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
        <span className="break-words flex-1">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'info') {
    return (
      <div className="flex items-start gap-2 text-xs text-info bg-info/10 rounded-md px-2 py-1">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span className="break-words flex-1">{entry.content}</span>
      </div>
    );
  }

  // Default text entry with source badge
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 text-xs text-muted-foreground py-0.5">
        <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
          {formatTime(entry.timestamp)}
        </span>
        {entry.source && (
          <Badge variant="outline" className={cn('text-[9px] px-1 py-0 shrink-0', getSourceColor(entry.source))}>
            {entry.source}
          </Badge>
        )}
        <span className="break-words whitespace-pre-wrap flex-1">{entry.content}</span>
        {hasDetail && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded shrink-0',
              'text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors',
              isExpanded && 'bg-secondary/50'
            )}
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-2.5 w-2.5" />
                <span>Less</span>
              </>
            ) : (
              <>
                <ChevronRight className="h-2.5 w-2.5" />
                <span>More</span>
              </>
            )}
          </button>
        )}
      </div>
      {hasDetail && isExpanded && (
        <div className="mt-1.5 ml-12 p-2 bg-secondary/30 rounded-md border border-border/50 overflow-x-auto">
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
            {entry.detail}
          </pre>
        </div>
      )}
    </div>
  );
}
