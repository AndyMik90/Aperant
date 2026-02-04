/**
 * AnalyticsDashboard - Task analytics and statistics
 *
 * SUG-14: Analytics Dashboard
 * Shows metrics about task completion, status distribution, and trends.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  CheckCircle,
  Clock,
  ListTodo,
  TrendingUp,
  AlertCircle,
  GitPullRequest,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTaskStore } from '../stores/task-store';
import type { Task, TaskStatus } from '../../shared/types';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description?: string;
  trend?: { value: number; label: string };
  className?: string;
}

function StatCard({ title, value, icon, description, trend, className }: StatCardProps) {
  return (
    <div className={cn('p-4 rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        {icon}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold">{value}</span>
        {trend && (
          <span className={cn(
            'text-xs flex items-center gap-0.5',
            trend.value >= 0 ? 'text-success' : 'text-destructive'
          )}>
            <TrendingUp className={cn('h-3 w-3', trend.value < 0 && 'rotate-180')} />
            {trend.label}
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

interface StatusBarProps {
  status: TaskStatus;
  count: number;
  total: number;
  label: string;
  color: string;
}

function StatusBar({ status, count, total, label, color }: StatusBarProps) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface AnalyticsDashboardProps {
  className?: string;
}

export function AnalyticsDashboard({ className }: AnalyticsDashboardProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const tasks = useTaskStore((state) => state.tasks);

  // Calculate statistics
  const stats = useMemo(() => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Filter out archived tasks for active counts
    const activeTasks = tasks.filter(t => !t.metadata?.archivedAt);

    // Status distribution
    const byStatus: Record<TaskStatus, Task[]> = {
      planning: [],
      coding: [],
      ai_review: [],
      human_review: [],
      pr_created: [],
      done: [],
    };

    activeTasks.forEach(task => {
      byStatus[task.status].push(task);
    });

    // Completion stats
    const completed = byStatus.done.length;
    const inProgress = byStatus.coding.length + byStatus.ai_review.length;
    const needsReview = byStatus.human_review.length;
    const prCreated = byStatus.pr_created.length;

    // Tasks created this week
    const createdThisWeek = tasks.filter(
      t => new Date(t.createdAt) >= oneWeekAgo
    ).length;

    // Tasks completed this week
    const completedThisWeek = byStatus.done.filter(
      t => t.updatedAt && new Date(t.updatedAt) >= oneWeekAgo
    ).length;

    // Average subtasks per task
    const tasksWithSubtasks = tasks.filter(t => t.subtasks && t.subtasks.length > 0);
    const avgSubtasks = tasksWithSubtasks.length > 0
      ? Math.round(tasksWithSubtasks.reduce((sum, t) => sum + t.subtasks.length, 0) / tasksWithSubtasks.length)
      : 0;

    // Completion rate
    const completionRate = activeTasks.length > 0
      ? Math.round((completed / activeTasks.length) * 100)
      : 0;

    return {
      total: activeTasks.length,
      completed,
      inProgress,
      needsReview,
      prCreated,
      planning: byStatus.planning.length,
      createdThisWeek,
      completedThisWeek,
      avgSubtasks,
      completionRate,
      byStatus,
    };
  }, [tasks]);

  // Status color mapping
  const statusColors: Record<TaskStatus, string> = {
    planning: 'bg-blue-500',
    coding: 'bg-yellow-500',
    ai_review: 'bg-purple-500',
    human_review: 'bg-orange-500',
    pr_created: 'bg-green-500',
    done: 'bg-emerald-500',
  };

  // Status labels
  const statusLabels: Record<TaskStatus, string> = {
    planning: t('tasks:status.planning'),
    coding: t('tasks:status.coding'),
    ai_review: t('tasks:columns.ai_review', { defaultValue: 'AI Review' }),
    human_review: t('tasks:columns.human_review', { defaultValue: 'Human Review' }),
    pr_created: t('tasks:status.prCreated'),
    done: t('tasks:status.complete'),
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">
          {t('tasks:analytics.title', { defaultValue: 'Analytics' })}
        </h2>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title={t('tasks:analytics.totalTasks', { defaultValue: 'Total Tasks' })}
          value={stats.total}
          icon={<ListTodo className="h-4 w-4 text-muted-foreground" />}
          description={t('tasks:analytics.activeTasks', { defaultValue: 'Active tasks' })}
        />
        <StatCard
          title={t('tasks:analytics.completed', { defaultValue: 'Completed' })}
          value={stats.completed}
          icon={<CheckCircle className="h-4 w-4 text-success" />}
          trend={stats.completedThisWeek > 0 ? {
            value: stats.completedThisWeek,
            label: `+${stats.completedThisWeek} ${t('tasks:analytics.thisWeek', { defaultValue: 'this week' })}`
          } : undefined}
        />
        <StatCard
          title={t('tasks:analytics.inProgress', { defaultValue: 'In Progress' })}
          value={stats.inProgress}
          icon={<Clock className="h-4 w-4 text-warning" />}
        />
        <StatCard
          title={t('tasks:analytics.completionRate', { defaultValue: 'Completion Rate' })}
          value={`${stats.completionRate}%`}
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
        />
      </div>

      {/* Status Distribution */}
      <div className="p-4 rounded-lg border bg-card">
        <h3 className="text-sm font-medium mb-4">
          {t('tasks:analytics.statusDistribution', { defaultValue: 'Status Distribution' })}
        </h3>
        <div className="space-y-3">
          {(Object.keys(stats.byStatus) as TaskStatus[]).map(status => (
            <StatusBar
              key={status}
              status={status}
              count={stats.byStatus[status].length}
              total={stats.total}
              label={statusLabels[status]}
              color={statusColors[status]}
            />
          ))}
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium">
              {t('tasks:analytics.needsReview', { defaultValue: 'Needs Review' })}
            </span>
          </div>
          <span className="text-2xl font-bold">{stats.needsReview}</span>
          <p className="text-xs text-muted-foreground mt-1">
            {t('tasks:analytics.awaitingApproval', { defaultValue: 'Awaiting your approval' })}
          </p>
        </div>

        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <GitPullRequest className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">
              {t('tasks:analytics.prsReady', { defaultValue: 'PRs Ready' })}
            </span>
          </div>
          <span className="text-2xl font-bold">{stats.prCreated}</span>
          <p className="text-xs text-muted-foreground mt-1">
            {t('tasks:analytics.readyToMerge', { defaultValue: 'Ready to merge' })}
          </p>
        </div>
      </div>

      {/* Weekly Activity */}
      <div className="p-4 rounded-lg border bg-card">
        <h3 className="text-sm font-medium mb-2">
          {t('tasks:analytics.weeklyActivity', { defaultValue: 'This Week' })}
        </h3>
        <div className="flex items-center gap-6">
          <div>
            <span className="text-lg font-bold">{stats.createdThisWeek}</span>
            <span className="text-sm text-muted-foreground ml-1">
              {t('tasks:analytics.created', { defaultValue: 'created' })}
            </span>
          </div>
          <div>
            <span className="text-lg font-bold">{stats.completedThisWeek}</span>
            <span className="text-sm text-muted-foreground ml-1">
              {t('tasks:analytics.completedWord', { defaultValue: 'completed' })}
            </span>
          </div>
          <div>
            <span className="text-lg font-bold">{stats.avgSubtasks}</span>
            <span className="text-sm text-muted-foreground ml-1">
              {t('tasks:analytics.avgSubtasks', { defaultValue: 'avg subtasks' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
