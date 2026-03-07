import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Lightbulb,
  Users,
  CheckCircle2,
  Circle,
  ArrowRight,
  Zap,
  ExternalLink,
  TrendingUp,
  Trash2,
  Archive,
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

export function FeatureDetailPanel({
  feature,
  onClose,
  onConvertToSpec,
  onGoToTask,
  onDelete,
  onArchive,
  competitorInsights = [],
}: FeatureDetailPanelProps) {
  const { t } = useTranslation('common');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleArchive = () => {
    onArchive?.(feature.id);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(feature.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-lg flex flex-col z-50">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border electron-no-drag">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
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
            <h2 className="font-semibold truncate">{feature.title}</h2>
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
            <h3 className="text-sm font-medium mb-2">Description</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>

        {/* Rationale */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Rationale
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
            <div className="text-xs text-muted-foreground">Complexity</div>
          </Card>
          <Card className="p-3 text-center">
            <div className={`text-lg font-semibold ${ROADMAP_IMPACT_COLORS[feature.impact]}`}>
              {feature.impact}
            </div>
            <div className="text-xs text-muted-foreground">Impact</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-lg font-semibold">{feature.dependencies.length}</div>
            <div className="text-xs text-muted-foreground">Dependencies</div>
          </Card>
        </div>

        {/* User Stories */}
        {feature.userStories.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" />
              User Stories
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
              Acceptance Criteria
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
              <ArrowRight className="h-4 w-4" />
              Dependencies
            </h3>
            <div className="flex flex-wrap gap-1">
              {feature.dependencies.map((dep) => (
                <Badge key={dep} variant="outline" className="text-xs">
                  {dep}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Competitor Insights */}
        {competitorInsights.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Addresses Competitor Pain Points
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
                      {insight.source}
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
                      {insight.severity} severity
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
      {(() => {
        const archiveButton = feature.status === 'done' && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleArchive}
            aria-label={t('accessibility.archiveFeatureAriaLabel')}
          >
            <Archive className="h-4 w-4 mr-2" />
            {t('roadmap.archiveFeature')}
          </Button>
        );

        if (feature.taskOutcome) return (
          <div className="shrink-0 p-4 border-t border-border space-y-3">
            <div className="flex items-center justify-center gap-2 py-2">
              <TaskOutcomeBadge outcome={feature.taskOutcome} size="lg" />
            </div>
            {archiveButton}
          </div>
        );

        if (feature.linkedSpecId) return (
          <div className="shrink-0 p-4 border-t border-border space-y-2">
            <Button className="w-full" onClick={() => onGoToTask(feature.linkedSpecId!)}>
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('roadmap.goToTask')}
            </Button>
            {archiveButton}
          </div>
        );

        if (feature.status === 'done') return (
          <div className="shrink-0 p-4 border-t border-border">
            {archiveButton}
          </div>
        );

        return (
          <div className="shrink-0 p-4 border-t border-border">
            <Button className="w-full" onClick={() => onConvertToSpec(feature)}>
              <Zap className="h-4 w-4 mr-2" />
              {t('roadmap.convertToTask')}
            </Button>
          </div>
        );
      })()}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/95 flex items-center justify-center p-6 z-10">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold">Delete Feature?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This will permanently remove "{feature.title}" from your roadmap.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
