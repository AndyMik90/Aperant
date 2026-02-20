import { Archive, ExternalLink, Play, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskOutcomeBadge, getTaskOutcomeColorClass } from './TaskOutcomeBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import type { FeatureCardProps } from './types';

export function FeatureCard({
  feature,
  onClick,
  onConvertToSpec,
  onGoToTask,
  onArchive,
  hasCompetitorInsight = false,
}: FeatureCardProps) {
  const { t } = useTranslation('common');

  return (
    <Card className="p-4 hover:bg-muted/50 cursor-pointer transition-colors" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[feature.priority]}>
              {ROADMAP_PRIORITY_LABELS[feature.priority]}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
            >
              {feature.complexity}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${ROADMAP_IMPACT_COLORS[feature.impact]}`}
            >
              {feature.impact} impact
            </Badge>
            {hasCompetitorInsight && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs text-primary border-primary/50">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    Competitor Insight
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>This feature addresses competitor pain points</TooltipContent>
              </Tooltip>
            )}
          </div>
          <h3 className="font-medium">{feature.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{feature.description}</p>
        </div>
        <div className="flex items-center gap-1">
          {feature.taskOutcome ? (
            <Badge variant="outline" className={`text-xs ${getTaskOutcomeColorClass(feature.taskOutcome)}`}>
              <TaskOutcomeBadge outcome={feature.taskOutcome} size="md" />
            </Badge>
          ) : feature.linkedSpecId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGoToTask(feature.linkedSpecId!);
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('roadmap.goToTask')}
            </Button>
          ) : (
            feature.status !== 'done' && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onConvertToSpec(feature);
                }}
              >
                <Play className="h-3 w-3 mr-1" />
                {t('roadmap.build')}
              </Button>
            )
          )}
          {feature.status === 'done' && onArchive && (
            <Button
              variant="ghost"
              size="sm"
              title={t('roadmap.archiveFeature')}
              aria-label={t('accessibility.archiveFeatureAriaLabel')}
              onClick={(e) => {
                e.stopPropagation();
                onArchive(feature.id);
              }}
            >
              <Archive className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
