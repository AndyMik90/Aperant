import { Archive, TrendingUp, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PhaseCard } from './PhaseCard';
import { FeatureCard } from './FeatureCard';
import { RoadmapKanbanView } from '../RoadmapKanbanView';
import { getFeaturesByPhase } from '../../stores/roadmap-store';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import { hasCompetitorInsight } from './utils';
import type { RoadmapTabsProps } from './types';
import type { RoadmapFeature, RoadmapPhase } from '../../../shared/types';

export function RoadmapTabs({
  roadmap,
  activeTab,
  onTabChange,
  onFeatureSelect,
  onConvertToSpec,
  onGoToTask,
  onArchive,
  onSave,
}: RoadmapTabsProps) {
  const { t } = useTranslation('common');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col">
      <TabsList className="shrink-0 mx-4 mt-4">
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        <TabsTrigger value="phases">Phases</TabsTrigger>
        <TabsTrigger value="features">All Features</TabsTrigger>
        <TabsTrigger value="priorities">By Priority</TabsTrigger>
      </TabsList>

      {/* Kanban View */}
      <TabsContent value="kanban" className="flex-1 min-h-0 overflow-hidden">
        <RoadmapKanbanView
          key={roadmap.updatedAt?.toString()}
          roadmap={roadmap}
          onFeatureClick={onFeatureSelect}
          onConvertToSpec={onConvertToSpec}
          onGoToTask={onGoToTask}
          onArchive={onArchive}
          onSave={onSave}
        />
      </TabsContent>

      {/* Phases View */}
      <TabsContent value="phases" className="flex-1 min-h-0 overflow-auto p-4">
        <div className="space-y-6">
          {roadmap.phases.map((phase: RoadmapPhase, index: number) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              features={getFeaturesByPhase(roadmap, phase.id)}
              isFirst={index === 0}
              onFeatureSelect={onFeatureSelect}
              onConvertToSpec={onConvertToSpec}
              onGoToTask={onGoToTask}
              onArchive={onArchive}
            />
          ))}
        </div>
      </TabsContent>

      {/* All Features View */}
      <TabsContent value="features" className="flex-1 min-h-0 overflow-auto p-4">
        <div className="grid gap-3">
          {roadmap.features.map((feature: RoadmapFeature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              onClick={() => onFeatureSelect(feature)}
              onConvertToSpec={onConvertToSpec}
              onGoToTask={onGoToTask}
              onArchive={onArchive}
              hasCompetitorInsight={hasCompetitorInsight(feature)}
            />
          ))}
        </div>
      </TabsContent>

      {/* By Priority View */}
      <TabsContent value="priorities" className="flex-1 min-h-0 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-4">
          {['must', 'should', 'could', 'wont'].map((priority: string) => {
            const features = roadmap.features.filter((f: RoadmapFeature) => f.priority === priority);
            return (
              <Card key={priority} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[priority]}>
                    {ROADMAP_PRIORITY_LABELS[priority]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{features.length} features</span>
                </div>
                <div className="space-y-2">
                  {features.map((feature: RoadmapFeature) => {
                    const isDone = feature.status === 'done';
                    return (
                      <div
                        key={feature.id}
                        className="p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <button
                          type="button"
                          className="w-full text-left cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => onFeatureSelect(feature)}
                        >
                          <div className="font-medium text-sm">{feature.title}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                            {hasCompetitorInsight(feature) && (
                              <Badge variant="outline" className="text-xs text-primary border-primary/50">
                                <TrendingUp className="h-3 w-3 mr-1" />
                                Insight
                              </Badge>
                            )}
                          </div>
                        </button>
                        {isDone && onArchive && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-success" />
                              Completed
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2"
                              title={t('roadmap.archiveFeature')}
                              onClick={(e) => {
                                e.stopPropagation();
                                onArchive(feature.id);
                              }}
                            >
                              <Archive className="h-3 w-3 mr-1" />
                              Archive
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </TabsContent>
    </Tabs>
  );
}
