import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { Play, ExternalLink, TrendingUp, Layers, ThumbsUp, Package, Link, RefreshCw } from 'lucide-react';
import { TaskOutcomeBadge, getTaskOutcomeColorClass } from './roadmap/TaskOutcomeBadge';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS
} from '../../shared/constants';
import type { RoadmapFeature, Roadmap } from '../../shared/types';
import { getReverseDependencies } from './roadmap/utils';

interface SortableFeatureCardProps {
  feature: RoadmapFeature;
  roadmap?: Roadmap;
  onClick: () => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
  onDependencyClick?: (featureId: string) => void;
}

export function SortableFeatureCard({
  feature,
  roadmap,
  onClick,
  onConvertToSpec,
  onGoToTask,
  onDependencyClick
}: SortableFeatureCardProps) {
  const { t } = useTranslation(['roadmap', 'common']);

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

  // Helper function to get a feature by ID
  const getFeatureById = (featureId: string) => roadmap?.features.find(f => f.id === featureId);

  // Calculate reverse dependencies using shared utility
  const reverseDependencies = roadmap?.features
    ? getReverseDependencies(feature, roadmap.features)
    : [];

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
                    {t('sortableFeatureCard.phaseLabel', { name: phaseName })}
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
                    {t('sortableFeatureCard.addressesCompetitorPainPoints')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <h3 className="font-medium text-sm leading-snug line-clamp-2">{feature.title}</h3>
          </div>
          <div className="shrink-0">
            {feature.taskOutcome ? (
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${getTaskOutcomeColorClass(feature.taskOutcome)}`}
              >
                <TaskOutcomeBadge outcome={feature.taskOutcome} size="sm" />
              </Badge>
            ) : feature.linkedSpecId ? (
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
                {t('sortableFeatureCard.votesFromUserFeedback', { count: feature.votes })}
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
                  {feature.source?.provider === 'canny' ? 'Canny' : 'External'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('sortableFeatureCard.importedFrom', { provider: feature.source?.provider })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Dependencies - compact indicator */}
        {(feature.dependencies?.length > 0 || reverseDependencies.length > 0) && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {feature.dependencies?.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Package className="h-2.5 w-2.5" />
                      <span>{t('sortableFeatureCard.depsCount', { count: feature.dependencies.length })}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">{t('sortableFeatureCard.dependenciesLabel')}</p>
                      {feature.dependencies.slice(0, 3).map((depId) => {
                        const dep = getFeatureById(depId);
                        return (
                          <button
                            key={depId}
                            type="button"
                            className="text-xs text-left hover:text-foreground transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDependencyClick?.(depId);
                            }}
                          >
                            {dep?.title || depId}
                          </button>
                        );
                      })}
                      {feature.dependencies.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          {t('sortableFeatureCard.andMore', { count: feature.dependencies.length - 3 })}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {reverseDependencies.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <Link className="h-2.5 w-2.5" />
                      <span>{t('sortableFeatureCard.requiredByCount', { count: reverseDependencies.length })}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">{t('sortableFeatureCard.requiredByLabel')}</p>
                      {reverseDependencies.slice(0, 3).map((depId) => {
                        const dep = getFeatureById(depId);
                        return (
                          <button
                            key={depId}
                            type="button"
                            className="text-xs text-left hover:text-foreground transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDependencyClick?.(depId);
                            }}
                          >
                            {dep?.title || depId}
                          </button>
                        );
                      })}
                      {reverseDependencies.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          {t('sortableFeatureCard.andMore', { count: reverseDependencies.length - 3 })}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Validation warning */}
              {feature.dependencyValidation?.hasCircular && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-purple-500">
                      <RefreshCw className="h-2.5 w-2.5" />
                      <span>{t('sortableFeatureCard.circularDependency')}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t('sortableFeatureCard.circularDependency')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
