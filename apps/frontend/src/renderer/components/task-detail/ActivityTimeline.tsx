import React, { useMemo } from 'react';
import {
  Circle,
  AlertTriangle,
  CheckCircle2,
  Play,
  Clock,
  Flag,
} from 'lucide-react';
import { useTaskStore } from '../../stores/task-store';
import { cn } from '../../lib/utils';

interface ActivityTimelineProps {
  taskId: string;
}

interface TimelineEvent {
  timestamp: Date;
  type: 'status' | 'phase' | 'error' | 'completion' | 'info' | 'start';
  title: string;
  description?: string;
  dotColor: string;
}

/**
 * Formats a date to relative time (e.g., "2m ago", "3 hours ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Extracts timeline events from task logs and execution progress
 */
function extractTimelineEvents(task: any): TimelineEvent[] {
  if (!task) return [];

  const events: TimelineEvent[] = [];

  // Add task creation event
  events.push({
    timestamp: task.createdAt,
    type: 'info',
    title: 'Task created',
    dotColor: 'bg-muted-foreground',
  });

  // Parse logs for events
  if (task.logs && task.logs.length > 0) {
    const logSet = new Set<string>();

    for (const logLine of task.logs) {
      if (!logLine.trim() || logSet.has(logLine)) continue;
      logSet.add(logLine);

      const now = new Date();
      const estimatedTimeOffset = Math.floor((task.logs.indexOf(logLine) / task.logs.length) * 3600000);
      const estimatedTime = new Date(now.getTime() - estimatedTimeOffset);

      // Error detection
      if (logLine.includes('[ERROR]') || logLine.toUpperCase().includes('ERROR')) {
        const errorMatch = logLine.match(/\[ERROR\]\s*(.+?)(?:\s*[-–]|$)/);
        const errorMsg = errorMatch ? errorMatch[1].trim() : logLine.substring(0, 80);
        events.push({
          timestamp: estimatedTime,
          type: 'error',
          title: 'Error occurred',
          description: errorMsg.substring(0, 100),
          dotColor: 'bg-destructive',
        });
      }

      // Phase change detection
      if (
        logLine.includes('planning') ||
        logLine.includes('__EXEC_PHASE__') ||
        logLine.includes('Phase:')
      ) {
        let phaseName = '';
        if (logLine.includes('planning')) phaseName = 'Planning';
        else if (logLine.includes('coding')) phaseName = 'Coding';
        else if (logLine.includes('qa') || logLine.includes('validation')) phaseName = 'QA/Validation';
        else if (logLine.includes('review')) phaseName = 'Review';

        if (phaseName) {
          events.push({
            timestamp: estimatedTime,
            type: 'phase',
            title: `${phaseName} phase started`,
            dotColor: 'bg-purple-500',
          });
        }
      }

      // Status change detection
      if (
        logLine.includes('status') ||
        logLine.includes('Status:') ||
        logLine.includes('Transitioned')
      ) {
        const statusMatch = logLine.match(/(?:to|:)\s*(planning|coding|ai_review|human_review|done)/i);
        if (statusMatch) {
          const status = statusMatch[1];
          events.push({
            timestamp: estimatedTime,
            type: 'status',
            title: `Status changed to ${status}`,
            dotColor: 'bg-info',
          });
        }
      }

      // Milestone/completion detection
      if (
        logLine.includes('completed') ||
        logLine.includes('finished') ||
        logLine.includes('ready') ||
        logLine.includes('success') ||
        logLine.toUpperCase().includes('✓') ||
        logLine.toUpperCase().includes('SUCCESS')
      ) {
        const milestoneMatch = logLine.match(/(?:spec|build|implementation|review|merge)\s+(?:is\s+)?(?:ready|completed|finished|success)/i);
        if (milestoneMatch) {
          const milestone = logLine.substring(0, 80);
          events.push({
            timestamp: estimatedTime,
            type: 'completion',
            title: 'Milestone reached',
            description: milestone,
            dotColor: 'bg-success',
          });
        }
      }
    }
  }

  // Add execution progress events if available
  if (task.executionProgress) {
    const phaseStartTime = task.executionProgress.startedAt
      ? new Date(task.executionProgress.startedAt)
      : new Date(task.updatedAt.getTime() - 60000);

    if (task.executionProgress.phase !== 'idle') {
      const phaseNames: Record<string, string> = {
        planning: 'Planning',
        coding: 'Coding',
        qa_review: 'QA Review',
        qa_fixing: 'QA Fixing',
        pr_review: 'PR Review',
        complete: 'Complete',
        failed: 'Failed',
        idle: 'Idle',
        starting: 'Starting',
      };

      const phaseName = phaseNames[task.executionProgress.phase] || task.executionProgress.phase;
      events.push({
        timestamp: phaseStartTime,
        type: 'phase',
        title: `${phaseName} phase`,
        description: `${task.executionProgress.phaseProgress}% complete`,
        dotColor: task.executionProgress.phase === 'failed' ? 'bg-destructive' :
                  task.executionProgress.phase === 'complete' ? 'bg-success' : 'bg-purple-500',
      });
    }
  }

  // Add status change event if task has moved through statuses
  if (task.status && task.status !== 'planning') {
    events.push({
      timestamp: task.updatedAt,
      type: 'status',
      title: `Status: ${task.status}`,
      dotColor: 'bg-info',
    });
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return events;
}

export function ActivityTimeline({ taskId }: ActivityTimelineProps) {
  const task = useTaskStore((state) => {
    const t = state.tasks.find((task) => task.id === taskId);
    return t;
  });

  const events = useMemo(() => extractTimelineEvents(task), [task]);

  if (!task) {
    return null;
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Clock className="h-5 w-5 mb-2 opacity-50" />
        <p className="text-xs">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="relative pl-5">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />

      {/* Timeline events */}
      <div className="space-y-0.5">
        {events.map((event, index) => (
          <div key={index} className="relative flex items-start gap-3 py-1">
            {/* Timeline dot */}
            <div className={cn(
              'absolute -left-5 top-[7px] h-[7px] w-[7px] rounded-full shrink-0',
              event.dotColor,
            )} />

            {/* Event content - single line */}
            <div className="flex items-baseline justify-between gap-2 min-w-0 flex-1">
              <span className={cn(
                'text-xs leading-tight truncate',
                event.type === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}>
                {event.title}
                {event.description && (
                  <span className="text-muted-foreground/60"> — {event.description}</span>
                )}
              </span>
              <time className="text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0">
                {formatRelativeTime(event.timestamp)}
              </time>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
