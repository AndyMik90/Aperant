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
} from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';
import {
  loadActivities,
  clearActivities,
  type ActivityEntry,
  type ActivityType,
} from '../utils/activity-tracker';

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
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

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

  const handleCollapsedChange = useCallback((newCollapsed: boolean) => {
    setIsCollapsed(newCollapsed);
    onCollapsedChange?.(newCollapsed);
  }, [onCollapsedChange]);

  const handleClearActivities = useCallback(() => {
    clearActivities();
    setActivities([]);
  }, []);

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
        return <GitPullRequest className="h-3.5 w-3.5 text-primary" />;
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

  const displayedActivities = useMemo(
    () => activities.slice(0, maxItems),
    [activities, maxItems]
  );

  if (activities.length === 0 && isCollapsed) {
    return null;
  }

  return (
    <div className={cn('border rounded-lg bg-card', className)}>
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
        onClick={() => handleCollapsedChange(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t('tasks:activity.title', { defaultValue: 'Recent Activity' })}
          </span>
          {activities.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {activities.length}
            </span>
          )}
        </div>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="border-t">
          {activities.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t('tasks:activity.noActivity', { defaultValue: 'No recent activity' })}
            </div>
          ) : (
            <>
              <ScrollArea className="max-h-64">
                <div className="divide-y divide-border">
                  {displayedActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
                    >
                      <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" title={activity.taskTitle}>
                          {activity.taskTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getActivityMessage(activity)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {activities.length > 0 && (
                <div className="border-t p-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleClearActivities}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {t('common:buttons.clear', { defaultValue: 'Clear' })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
