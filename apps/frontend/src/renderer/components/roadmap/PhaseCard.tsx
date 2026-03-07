import { useState } from 'react';
import { Archive, CheckCircle2, ChevronDown, ChevronUp, Circle, ExternalLink, Play, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskOutcomeBadge } from './TaskOutcomeBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';
import { ROADMAP_PRIORITY_COLORS } from '../../../shared/constants';
import type { PhaseCardProps } from './types';

const INITIAL_VISIBLE_COUNT = 5;

export function PhaseCard({
  phase,
  features,
  isFirst: _isFirst,
  onFeatureSelect,
  onConvertToSpec,
  onGoToTask,
  onArchive,
}: PhaseCardProps) {
  const { t } = useTranslation('common');
  const [isExpanded, setIsExpanded] = useState(false);
  const completedCount = features.filter((f) => f.status === 'done').length;
  const progress = features.length > 0 ? (completedCount / features.length) * 100 : 0;
  const visibleFeatures = isExpanded ? features : features.slice(0, INITIAL_VISIBLE_COUNT);
  const hiddenCount = features.length - INITIAL_VISIBLE_COUNT;
  const hasMoreFeatures = hiddenCount > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              phase.status === 'completed'
                ? 'bg-success/10 text-success'
                : phase.status === 'in_progress'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {phase.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <span className="text-sm font-semibold">{phase.order}</span>
            )}
          </div>
          <div>
            <h3 className="font-semibold">{phase.name}</h3>
            <p className="text-sm text-muted-foreground">{phase.description}</p>
          </div>
        </div>
        <Badge variant={phase.status === 'completed' ? 'default' : 'outline'}>
          {phase.status}
        </Badge>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-muted-foreground">Progress</span>
          <span>
            {completedCount}/{features.length} features
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Milestones */}
      {phase.milestones.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium mb-2">Milestones</h4>
          <div className="space-y-2">
            {phase.milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-center gap-2 text-sm">
                {milestone.status === 'achieved' ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span
                  className={
                    milestone.status === 'achieved' ? 'line-through text-muted-foreground' : ''
                  }
                >
                  {milestone.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div>
        <h4 className="text-sm font-medium mb-2">Features ({features.length})</h4>
        <div className="grid gap-2">
          {visibleFeatures.map((feature) => {
            const isDone = feature.status === 'done';
            const archiveButton = isDone && onArchive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                title={t('roadmap.archiveFeature')}
                aria-label={t('accessibility.archiveFeatureAriaLabel')}
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(feature.id);
                }}
              >
                <Archive className="h-3 w-3" />
              </Button>
            );
            return (
            <div
              key={feature.id}
              className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
            >
              <button
                type="button"
                className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onFeatureSelect(feature)}
              >
                <Badge
                  variant="outline"
                  className={`text-xs ${ROADMAP_PRIORITY_COLORS[feature.priority]}`}
                >
                  {feature.priority}
                </Badge>
                <span className="text-sm truncate">{feature.title}</span>
                {feature.competitorInsightIds && feature.competitorInsightIds.length > 0 && (
                  <TrendingUp className="h-3 w-3 text-primary flex-shrink-0" />
                )}
              </button>
              {feature.taskOutcome ? (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <TaskOutcomeBadge outcome={feature.taskOutcome} size="lg" showLabel={false} />
                  {archiveButton}
                </span>
              ) : isDone ? (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {archiveButton}
                </span>
              ) : feature.linkedSpecId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGoToTask(feature.linkedSpecId!);
                  }}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  {t('roadmap.viewTask')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConvertToSpec(feature);
                  }}
                >
                  <Play className="h-3 w-3 mr-1" />
                  {t('roadmap.build')}
                </Button>
              )}
            </div>
            );
          })}
          {hasMoreFeatures && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
              className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground w-full"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  {t('roadmap.showLessFeatures')}
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  {t('roadmap.showMoreFeatures', { count: hiddenCount })}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
