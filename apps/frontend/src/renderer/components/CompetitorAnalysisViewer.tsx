import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ExternalLink, AlertCircle, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { AddCompetitorDialog } from './AddCompetitorDialog';
import type { CompetitorAnalysis } from '../../shared/types';

interface CompetitorAnalysisViewerProps {
  analysis: CompetitorAnalysis | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function CompetitorAnalysisViewer({
  analysis,
  open,
  onOpenChange,
  projectId,
}: CompetitorAnalysisViewerProps) {
  const { t } = useTranslation('common');
  const [showAddDialog, setShowAddDialog] = useState(false);

  if (!analysis) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {t('competitorAnalysis.analysisResults')}
          </DialogTitle>
          <DialogDescription>
            {t('competitorAnalysis.analysisDescription', { count: analysis.competitors.length })}
          </DialogDescription>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="mt-2 self-start"
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('competitorAnalysis.addCompetitor')}
          </Button>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto pr-4" style={{ maxHeight: 'calc(85vh - 120px)' }}>
          <div className="space-y-6 pb-4">
            {analysis.competitors.map((competitor) => (
              <div
                key={competitor.id}
                className="rounded-lg border border-border p-4 space-y-3"
              >
                {/* Competitor Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold">{competitor.name}</h3>
                      {competitor.source === 'manual' && (
                        <Badge variant="outline" className="text-xs">
                          {t('competitorAnalysis.manualBadge')}
                        </Badge>
                      )}
                      {competitor.marketPosition && (
                        <Badge variant="secondary" className="text-xs">
                          {competitor.marketPosition}
                        </Badge>
                      )}
                    </div>
                    {competitor.description && (
                      <p className="text-sm text-muted-foreground">
                        {competitor.description}
                      </p>
                    )}
                  </div>
                  {competitor.url && (
                    <a
                      href={competitor.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 text-sm ml-4"
                      aria-label={t('accessibility.visitExternalLink', { name: competitor.name })}
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      {t('competitorAnalysis.visit')}
                      <span className="sr-only">({t('accessibility.opensInNewWindow')})</span>
                    </a>
                  )}
                </div>

                {/* Pain Points */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-warning" />
                    {t('competitorAnalysis.identifiedPainPoints', { count: competitor.painPoints.length })}
                  </h4>
                  <div className="space-y-2">
                    {competitor.painPoints.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        {t('competitorAnalysis.noPainPointsIdentified')}
                      </p>
                    ) : (
                      competitor.painPoints.map((painPoint) => (
                        <div
                          key={painPoint.id}
                          className="rounded bg-muted/50 p-3 space-y-2"
                        >
                          <div className="flex items-start gap-2">
                            <Badge
                              variant={
                                painPoint.severity === 'high'
                                  ? 'destructive'
                                  : painPoint.severity === 'medium'
                                  ? 'default'
                                  : 'secondary'
                              }
                              className="mt-0.5"
                            >
                              {painPoint.severity}
                            </Badge>
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                {painPoint.description}
                              </p>
                              {painPoint.source && (
                                <div className="mt-2">
                                  <span className="text-xs text-muted-foreground">
                                    {t('competitorAnalysis.source')} <span className="italic">{painPoint.source}</span>
                                  </span>
                                </div>
                              )}
                              {painPoint.frequency && (
                                <div className="mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    {t('competitorAnalysis.frequency')} {painPoint.frequency}
                                  </span>
                                </div>
                              )}
                              {painPoint.opportunity && (
                                <div className="mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    {t('competitorAnalysis.opportunity')}{' '}
                                    <span className="font-medium text-foreground">
                                      {painPoint.opportunity}
                                    </span>
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Insights Summary */}
            {analysis.insightsSummary && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold">{t('competitorAnalysis.marketInsightsSummary')}</h4>

                {analysis.insightsSummary.topPainPoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('competitorAnalysis.topPainPoints')}</p>
                    <ul className="text-sm space-y-1">
                      {analysis.insightsSummary.topPainPoints.map((point, idx) => (
                        <li key={idx} className="text-muted-foreground">• {point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.insightsSummary.differentiatorOpportunities.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('competitorAnalysis.differentiatorOpportunities')}</p>
                    <ul className="text-sm space-y-1">
                      {analysis.insightsSummary.differentiatorOpportunities.map((opp, idx) => (
                        <li key={idx} className="text-muted-foreground">• {opp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.insightsSummary.marketTrends.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('competitorAnalysis.marketTrends')}</p>
                    <ul className="text-sm space-y-1">
                      {analysis.insightsSummary.marketTrends.map((trend, idx) => (
                        <li key={idx} className="text-muted-foreground">• {trend}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <AddCompetitorDialog
      open={showAddDialog}
      onOpenChange={setShowAddDialog}
      projectId={projectId}
    />
    </>
  );
}
