import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, Trash2 } from 'lucide-react';
import type { TaskOutcome } from '../../../shared/types';

interface TaskOutcomeConfig {
  icon: typeof CheckCircle2;
  label: string;
  colorClass: string;
}

function useTaskOutcomeConfig(outcome: TaskOutcome): TaskOutcomeConfig {
  const { t } = useTranslation('common');

  switch (outcome) {
    case 'completed':
      return { icon: CheckCircle2, label: t('roadmap.taskCompleted'), colorClass: 'text-success' };
    case 'archived':
      return { icon: Archive, label: t('roadmap.taskArchived'), colorClass: 'text-success' };
    case 'deleted':
      return { icon: Trash2, label: t('roadmap.taskDeleted'), colorClass: 'text-muted-foreground' };
  }
}

export type TaskOutcomeBadgeSize = 'sm' | 'md' | 'lg';

const ICON_SIZES: Record<TaskOutcomeBadgeSize, string> = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-4 w-4',
};

interface TaskOutcomeBadgeProps {
  outcome: TaskOutcome;
  size?: TaskOutcomeBadgeSize;
  showLabel?: boolean;
}

/**
 * Renders a consistent task outcome icon + label across all roadmap views.
 * Returns the icon and label as inline elements (caller wraps in Badge/div as needed).
 */
export function TaskOutcomeBadge({ outcome, size = 'md', showLabel = true }: TaskOutcomeBadgeProps) {
  const config = useTaskOutcomeConfig(outcome);
  const Icon = config.icon;
  const iconSize = ICON_SIZES[size];

  return (
    <span className={`inline-flex items-center gap-0.5 ${config.colorClass}`}>
      <Icon className={iconSize} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Returns the color class for a task outcome (for use in parent wrapper styling).
 */
export function getTaskOutcomeColorClass(outcome: TaskOutcome): string {
  return outcome === 'deleted' ? 'text-muted-foreground border-muted-foreground/50' : 'text-success border-success/50';
}
