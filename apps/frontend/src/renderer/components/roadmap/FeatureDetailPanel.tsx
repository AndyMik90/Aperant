import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Lightbulb,
  Users,
  CheckCircle2,
  Circle,
  Zap,
  ExternalLink,
  TrendingUp,
  Trash2,
  Link,
  AlertTriangle,
  Package,
} from 'lucide-react';
import { TaskOutcomeBadge } from './TaskOutcomeBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import type { FeatureDetailPanelProps } from './types';
import { useRoadmapStore } from '../../stores/roadmap-store';
import { getReverseDependencies } from './utils';

export function FeatureDetailPanel({
  feature,
  features,
  onClose,
  onConvertToSpec,
  onGoToTask,
  onDelete,
  competitorInsights = [],
  onDependencyClick,
}: FeatureDetailPanelProps) {
  const { t } = useTranslation(['roadmap', 'common']);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const openDependencyDetail = useRoadmapStore(s => s.openDependencyDetail);

  // Calculate reverse dependencies using shared utility
  const reverseDependencies = getReverseDependencies(feature, features);

  const handleDependencyClick = (depId: string) => {
    if (onDependencyClick) {
      onDependencyClick(depId);
    } else {
      openDependencyDetail(depId);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(feature.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[448px] bg-card border-l border-border shadow-lg flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border electron-no-drag">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="font-semibold break-words leading-snug">{feature.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[feature.priority]}>
                {ROADMAP_PRIORITY_LABELS[feature.priority]}
              </Badge>
              <Badge
                variant="outline"
                className={`${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
              >
                {feature.complexity}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 relative z-10 pointer-events-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              aria-label={t('accessibility.deleteFeatureAriaLabel')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t('accessibility.closeFeatureDetailsAriaLabel')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-medium mb-2">{t('featureDetailPanel.descriptionLabel')}</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>

        {/* Rationale */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            {t('featureDetailPanel.rationale')}
          </h3>
          <p className="text-sm text-muted-foreground">{feature.rationale}</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3 text-center">
            <div
              className={`text-lg font-semibold ${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
            >
              {feature.complexity}
            </div>
            <div className="text-xs text-muted-foreground">{t('featureDetailPanel.metrics.complexity')}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className={`text-lg font-semibold ${ROADMAP_IMPACT_COLORS[feature.impact]}`}>
              {feature.impact}
            </div>
            <div className="text-xs text-muted-foreground">{t('featureDetailPanel.metrics.impact')}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-lg font-semibold">{feature.dependencies.length}</div>
            <div className="text-xs text-muted-foreground">{t('featureDetailPanel.metrics.dependencies')}</div>
          </Card>
        </div>

        {/* User Stories */}
        {feature.userStories.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t('featureDetailPanel.userStories')}
            </h3>
            <div className="space-y-2">
              {feature.userStories.map((story, i) => (
                <div key={i} className="text-sm p-2 bg-muted/50 rounded-md italic">
                  "{story}"
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acceptance Criteria */}
        {feature.acceptanceCriteria.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {t('featureDetailPanel.acceptanceCriteria')}
            </h3>
            <ul className="space-y-1">
              {feature.acceptanceCriteria.map((criterion, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1.5 shrink-0" />
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dependencies */}
        {feature.dependencies.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t('featureDetailPanel.dependenciesSection.dependencies', { count: feature.dependencies.length })}
            </h3>
            <div className="flex flex-wrap gap-1 break-words">
              {feature.dependencies.map((depId) => {
                const depFeature = features.find(f => f.id === depId);
                const isMissing = !depFeature;

                return (
                  <button
                    key={depId}
                    className={`
                      px-2 py-1 rounded-md text-xs font-medium
                      transition-all flex items-center gap-1
                      ${isMissing
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 cursor-not-allowed'
                        : 'bg-primary/10 text-primary hover:bg-primary/20 hover:underline cursor-pointer'
                      }
                    `}
                    onClick={() => !isMissing && handleDependencyClick(depId)}
                    disabled={isMissing}
                    title={isMissing ? t('featureDetailPanel.dependenciesSection.notFound', { id: depId }) : depFeature?.title || depId}
                  >
                    {isMissing && <AlertTriangle className="h-3 w-3" />}
                    <span>{depFeature?.title || depId}</span>
                    {!isMissing && <ChevronRight className="h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Reverse Dependencies */}
        {reverseDependencies && reverseDependencies.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Link className="h-4 w-4" />
              {t('featureDetailPanel.dependenciesSection.requiredBy', { count: reverseDependencies.length })}
            </h3>
            <div className="flex flex-wrap gap-1 break-words">
              {reverseDependencies.map((depId) => {
                const depFeature = features.find(f => f.id === depId);
                return (
                  <button
                    type="button"
                    key={depId}
                    className="px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 hover:underline cursor-pointer transition-all flex items-center gap-1"
                    onClick={() => handleDependencyClick(depId)}
                    title={depFeature?.title || depId}
                  >
                    <span>{depFeature?.title || depId}</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Competitor Insights */}
        {competitorInsights.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t('featureDetailPanel.competitorInsights.title')}
            </h3>
            <div className="space-y-2">
              {competitorInsights.map((insight) => (
                <div
                  key={insight.id}
                  className="p-2 bg-primary/5 border border-primary/20 rounded-md"
                >
                  <p className="text-sm text-foreground">{insight.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {t('featureDetailPanel.competitorInsights.source', { source: insight.source })}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        insight.severity === 'high'
                          ? 'text-red-500 border-red-500/50'
                          : insight.severity === 'medium'
                          ? 'text-yellow-500 border-yellow-500/50'
                          : 'text-green-500 border-green-500/50'
                      }`}
                    >
                      {t('featureDetailPanel.competitorInsights.severity', { severity: insight.severity })}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </ScrollArea>

      {/* Actions */}
      {feature.taskOutcome ? (
        <div className="shrink-0 p-4 border-t border-border">
          <div className="flex items-center justify-center gap-2 py-2">
            <TaskOutcomeBadge outcome={feature.taskOutcome} size="lg" />
          </div>
        </div>
      ) : feature.linkedSpecId ? (
        <div className="shrink-0 p-4 border-t border-border">
          <Button className="w-full" onClick={() => onGoToTask(feature.linkedSpecId!)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('featureDetailPanel.actions.goToTask')}
          </Button>
        </div>
      ) : (
        feature.status !== 'done' && (
          <div className="shrink-0 p-4 border-t border-border">
            <Button className="w-full" onClick={() => onConvertToSpec(feature)}>
              <Zap className="h-4 w-4 mr-2" />
              {t('featureDetailPanel.actions.convertToAutoBuild')}
            </Button>
          </div>
        )
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/95 flex items-center justify-center p-6 z-10">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold">{t('featureDetailPanel.deleteConfirmation.title')}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t('featureDetailPanel.deleteConfirmation.message', { title: feature.title })}
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                {t('featureDetailPanel.deleteConfirmation.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('featureDetailPanel.deleteConfirmation.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
