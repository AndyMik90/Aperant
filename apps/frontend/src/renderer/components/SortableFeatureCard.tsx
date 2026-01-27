import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { Play, ExternalLink, TrendingUp, Layers, ThumbsUp } from 'lucide-react';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS
} from '../../shared/constants';
import type { RoadmapFeature, Roadmap } from '../../shared/types';

interface SortableFeatureCardProps {
  feature: RoadmapFeature;
  roadmap?: Roadmap;
  onClick: () => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
}

export function SortableFeatureCard({
  feature,
  roadmap,
  onClick,
  onConvertToSpec,
  onGoToTask
}: SortableFeatureCardProps) {
  const { t } = useTranslation('roadmap');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id: feature.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  const hasCompetitorInsight =
    !!feature.competitorInsightIds && feature.competitorInsightIds.length > 0;

  // Get phase name for the feature
  const phaseName = roadmap?.phases.find((p) => p.id === feature.phaseId)?.name;

  // Check if feature has external source (e.g., Canny)
  const isExternal = feature.source?.provider && feature.source.provider !== 'internal';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'touch-none transition-all duration-200',
        isDragging && 'dragging-placeholder opacity-40 scale-[0.98]',
        isOver && !isDragging && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-background rounded-xl'
      )}
      {...attributes}
      {...listeners}
    >
      <Card
        className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
        onClick={onClick}
      >
        {/* Header - Title with priority badge and action button */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', ROADMAP_PRIORITY_COLORS[feature.priority])}
              >
                {ROADMAP_PRIORITY_LABELS[feature.priority]}
              </Badge>
              {phaseName && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30"
                    >
                      <Layers className="h-2.5 w-2.5 mr-0.5" />
                      {phaseName.length > 12 ? `${phaseName.slice(0, 12)}...` : phaseName}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('featureCard.phase', { name: phaseName })}
                  </TooltipContent>
                </Tooltip>
              )}
              {hasCompetitorInsight && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-primary border-primary/50"
                    >
                      <TrendingUp className="h-2.5 w-2.5" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('featureCard.competitorInsight')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <h3 className="font-medium text-sm leading-snug line-clamp-2">{feature.title}</h3>
          </div>
          <div className="shrink-0">
            {feature.linkedSpecId ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onGoToTask?.(feature.linkedSpecId!);
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('featureCard.task')}
              </Button>
            ) : (
              feature.status !== 'done' &&
              onConvertToSpec && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
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
        </div>

        {/* Description */}
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
          {feature.description}
        </p>

        {/* Metadata badges - compact row */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0', ROADMAP_COMPLEXITY_COLORS[feature.complexity])}
          >
            {feature.complexity}
          </Badge>
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0', ROADMAP_IMPACT_COLORS[feature.impact])}
          >
            {feature.impact}
          </Badge>
          {/* Show vote count if from external source */}
          {feature.votes !== undefined && feature.votes > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-muted-foreground"
                >
                  <ThumbsUp className="h-2.5 w-2.5 mr-0.5" />
                  {feature.votes}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('featureCard.votesFromFeedback', { votes: feature.votes })}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Show external source indicator */}
          {isExternal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-orange-500 border-orange-500/30"
                >
                  {feature.source?.provider === 'canny' ? t('featureCard.source.canny') : t('featureCard.source.external')}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('featureCard.importedFrom', { provider: feature.source?.provider || 'external' })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </Card>
    </div>
  );
}
