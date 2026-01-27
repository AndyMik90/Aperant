import { useTranslation } from 'react-i18next';
import { ExternalLink, Play, TrendingUp } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import type { FeatureCardProps } from './types';

export function FeatureCard({
  feature,
  onClick,
  onConvertToSpec,
  onGoToTask,
  hasCompetitorInsight = false,
}: FeatureCardProps) {
  const { t } = useTranslation('roadmap');

  return (
    <Card className="p-4 hover:bg-muted/50 cursor-pointer transition-colors" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[feature.priority]}>
              {t(`header.priorities.${feature.priority}`)}
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
              {feature.impact} {t('featureCard.impact')}
            </Badge>
            {hasCompetitorInsight && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs text-primary border-primary/50">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    {t('featureCard.competitorInsight')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{t('featureCard.competitorInsightTooltip')}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <h3 className="font-medium">{feature.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{feature.description}</p>
        </div>
        {feature.linkedSpecId ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onGoToTask(feature.linkedSpecId!);
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            {t('featureCard.goToTask')}
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
              {t('featureCard.build')}
            </Button>
          )
        )}
      </div>
    </Card>
  );
}
