/**
 * ActivityFeed - Displays recent task activities
 *
 * SUG-9: Activity Feed
 * Shows a chronological feed of recent activities like:
 * - Task created
 * - Task status changed
 * - Task completed
 * - Build started/finished
 *
 * Activities are stored in localStorage and limited to last 50 entries.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Plus,
  Play,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Trash2,
  GitPullRequest,
  Filter,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';
import {
  loadActivities,
  clearActivities,
  type ActivityEntry,
  type ActivityType,
} from '../utils/activity-tracker';
import { formatDurationShort } from '../utils/format-time';

// Re-export for consumers that import from ActivityFeed
export { addActivity, clearActivities, type ActivityEntry, type ActivityType } from '../utils/activity-tracker';

interface ActivityFeedProps {
  /** Maximum number of items to display */
  maxItems?: number;
  /** Whether to show in collapsed mode initially */
  collapsed?: boolean;
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** CSS class name */
  className?: string;
}

export function ActivityFeed({
  maxItems = 10,
  collapsed: initialCollapsed = false,
  onCollapsedChange,
  className,
}: ActivityFeedProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<ActivityType>>(new Set());

  // Load activities on mount and listen for updates
  useEffect(() => {
    setActivities(loadActivities());

    // Listen for activity updates from activity-tracker
    const handleActivityAdded = () => {
      setActivities(loadActivities());
    };

    const handleActivitiesCleared = () => {
      setActivities([]);
    };

    window.addEventListener('activity-added', handleActivityAdded);
    window.addEventListener('activities-cleared', handleActivitiesCleared);

    return () => {
      window.removeEventListener('activity-added', handleActivityAdded);
      window.removeEventListener('activities-cleared', handleActivitiesCleared);
    };
  }, []);

  const handleClearActivities = useCallback(() => {
    clearActivities();
    setActivities([]);
  }, []);

  const toggleFilter = useCallback((type: ActivityType) => {
    setActiveFilters((prev) => {
      const newFilters = new Set(prev);
      if (newFilters.has(type)) {
        newFilters.delete(type);
      } else {
        newFilters.add(type);
      }
      return newFilters;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFilters(new Set());
  }, []);

  // Get node color for timeline based on activity type
  const getNodeColor = (type: ActivityType): string => {
    switch (type) {
      case 'task_completed':
        return 'bg-success border-success';
      case 'task_failed':
        return 'bg-destructive border-destructive';
      case 'task_started':
        return 'bg-info border-info';
      case 'status_changed':
        return 'bg-warning border-warning';
      case 'pr_created':
        return 'bg-accent border-accent';
      case 'task_created':
        return 'bg-primary border-primary';
      default:
        return 'bg-muted-foreground border-muted-foreground';
    }
  };

  // Get icon and color for activity type
  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'task_created':
        return <Plus className="h-3.5 w-3.5 text-primary" />;
      case 'task_started':
        return <Play className="h-3.5 w-3.5 text-info" />;
      case 'task_completed':
        return <CheckCircle className="h-3.5 w-3.5 text-success" />;
      case 'task_failed':
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'status_changed':
        return <Clock className="h-3.5 w-3.5 text-warning" />;
      case 'pr_created':
        return <GitPullRequest className="h-3.5 w-3.5 text-accent-foreground" />;
      case 'task_archived':
        return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Get activity message
  const getActivityMessage = (activity: ActivityEntry): string => {
    switch (activity.type) {
      case 'task_created':
        return t('tasks:activity.taskCreated', { defaultValue: 'Task created' });
      case 'task_started':
        return t('tasks:activity.taskStarted', { defaultValue: 'Build started' });
      case 'task_completed':
        return t('tasks:activity.taskCompleted', { defaultValue: 'Task completed' });
      case 'task_failed':
        return t('tasks:activity.taskFailed', { defaultValue: 'Task failed' });
      case 'status_changed':
        return t('tasks:activity.statusChanged', {
          defaultValue: 'Status changed to {{status}}',
          status: activity.details?.toStatus,
        });
      case 'pr_created':
        return t('tasks:activity.prCreated', { defaultValue: 'PR created' });
      case 'task_archived':
        return t('tasks:activity.taskArchived', { defaultValue: 'Task archived' });
      default:
        return t('tasks:activity.unknown', { defaultValue: 'Activity' });
    }
  };

  // Format relative time
  const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('common:time.justNow', { defaultValue: 'Just now' });
    if (diffMins < 60) return t('common:time.minutesAgo', { defaultValue: '{{count}}m ago', count: diffMins });
    if (diffHours < 24) return t('common:time.hoursAgo', { defaultValue: '{{count}}h ago', count: diffHours });
    return t('common:time.daysAgo', { defaultValue: '{{count}}d ago', count: diffDays });
  };

  // formatDuration: use shared utility with includeSeconds=true for activity detail
  const formatDuration = (durationMs: number): string => formatDurationShort(durationMs, true);

  // Get status badge variant for activity type
  const getBadgeVariant = (type: ActivityType): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (type) {
      case 'task_completed':
        return 'default';
      case 'task_failed':
        return 'destructive';
      case 'task_started':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const displayedActivities = useMemo(() => {
    // Filter activities based on active filters
    let filtered = activities;
    if (activeFilters.size > 0) {
      filtered = activities.filter((activity) => activeFilters.has(activity.type));
    }
    return filtered.slice(0, maxItems);
  }, [activities, maxItems, activeFilters]);

  // Group activities by date
  const groupedActivities = useMemo(() => {
    const groups: { label: string; activities: ActivityEntry[] }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateGroups = new Map<string, ActivityEntry[]>();

    displayedActivities.forEach((activity) => {
      const activityDate = new Date(activity.timestamp);
      activityDate.setHours(0, 0, 0, 0);

      let dateKey: string;
      if (activityDate.getTime() === today.getTime()) {
        dateKey = t('common:time.today', { defaultValue: 'Today' });
      } else if (activityDate.getTime() === yesterday.getTime()) {
        dateKey = t('common:time.yesterday', { defaultValue: 'Yesterday' });
      } else {
        dateKey = activityDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: activityDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
        });
      }

      if (!dateGroups.has(dateKey)) {
        dateGroups.set(dateKey, []);
      }
      dateGroups.get(dateKey)!.push(activity);
    });

    dateGroups.forEach((activities, label) => {
      groups.push({ label, activities });
    });

    return groups;
  }, [displayedActivities, t]);

  // Define available filter types
  const filterTypes: { type: ActivityType; label: string; icon: React.ReactNode }[] = [
    {
      type: 'task_created',
      label: t('tasks:activity.created', { defaultValue: 'Created' }),
      icon: <Plus className="h-3 w-3" />,
    },
    {
      type: 'task_started',
      label: t('tasks:activity.started', { defaultValue: 'Started' }),
      icon: <Play className="h-3 w-3" />,
    },
    {
      type: 'task_completed',
      label: t('tasks:activity.completed', { defaultValue: 'Completed' }),
      icon: <CheckCircle className="h-3 w-3" />,
    },
    {
      type: 'task_failed',
      label: t('tasks:activity.failed', { defaultValue: 'Failed' }),
      icon: <XCircle className="h-3 w-3" />,
    },
    {
      type: 'pr_created',
      label: t('tasks:activity.pr', { defaultValue: 'PR' }),
      icon: <GitPullRequest className="h-3 w-3" />,
    },
  ];

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t('tasks:activity.title', { defaultValue: 'Recent Activity' })}
            </span>
            {activities.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {displayedActivities.length}/{activities.length}
              </span>
            )}
          </div>
          {activities.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClearActivities}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t('common:buttons.clear', { defaultValue: 'Clear' })}
            </Button>
          )}
        </div>

        {/* Filter chips */}
        {activities.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {filterTypes.map((filter) => (
              <button
                key={filter.type}
                onClick={() => toggleFilter(filter.type)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-colors border',
                  activeFilters.has(filter.type)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted border-border'
                )}
              >
                {filter.icon}
                {filter.label}
              </button>
            ))}
            {activeFilters.size > 0 && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-muted/50 text-muted-foreground hover:bg-muted transition-colors border border-border"
              >
                <X className="h-3 w-3" />
                {t('common:buttons.clearAll', { defaultValue: 'Clear All' })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timeline Content */}
      <ScrollArea className="flex-1">
        {activities.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('tasks:activity.noActivity', { defaultValue: 'No recent activity' })}
          </div>
        ) : (
          <div className="p-4">
            {/* Timeline container with date groups */}
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[15px] top-0 bottom-0 w-0.5 bg-border" />

              {/* Date groups */}
              <div className="space-y-6">
                {groupedActivities.map((group, groupIndex) => (
                  <div key={group.label} className="relative">
                    {/* Date header */}
                    <div className="sticky top-0 z-20 bg-card pb-2 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                          {group.label}
                        </div>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    </div>

                    {/* Timeline events for this date */}
                    <div className="space-y-4">
                      {group.activities.map((activity, index) => (
                        <div key={activity.id} className="relative flex items-start gap-4">
                          {/* Timeline node */}
                          <div className="relative z-10 flex-shrink-0">
                            <div
                              className={cn(
                                'w-[12px] h-[12px] rounded-full border-2 ml-[9px]',
                                getNodeColor(activity.type)
                              )}
                            />
                          </div>

                          {/* Event card */}
                          <div className="flex-1 min-w-0 max-w-[600px]">
                            <div
                              className="border rounded-lg p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                              onClick={() => {
                                // Future: navigate to task
                                console.log('Navigate to task:', activity.taskId);
                              }}
                            >
                              {/* Card header with title and timestamp */}
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <div className="flex-shrink-0">{getActivityIcon(activity.type)}</div>
                                  <h4 className="text-sm font-medium truncate" title={activity.taskTitle}>
                                    {activity.taskTitle}
                                  </h4>
                                </div>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatRelativeTime(activity.timestamp)}
                                </span>
                              </div>

                              {/* Event description */}
                              <p className="text-xs text-muted-foreground mb-2">
                                {getActivityMessage(activity)}
                              </p>

                              {/* Card footer with badge and duration */}
                              <div className="flex items-center gap-2">
                                <Badge variant={getBadgeVariant(activity.type)} className="text-xs">
                                  {activity.type.replace('task_', '').replace('_', ' ')}
                                </Badge>
                                {activity.duration && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatDuration(activity.duration)}
                                  </span>
                                )}
                                {activity.phaseInfo && (
                                  <span className="text-xs text-muted-foreground">
                                    • {activity.phaseInfo}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
