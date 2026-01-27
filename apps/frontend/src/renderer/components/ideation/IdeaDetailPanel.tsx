import { useTranslation } from 'react-i18next';
import { ChevronRight, ExternalLink, Lightbulb, Loader2, Play, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  getIdeationTypeLabels,
  IDEATION_TYPE_COLORS,
  IDEATION_STATUS_COLORS
} from '../../../shared/constants';
import type { Idea } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import {
  isCodeImprovementIdea,
  isUIUXIdea,
  isDocumentationGapIdea,
  isSecurityHardeningIdea,
  isPerformanceOptimizationIdea,
  isCodeQualityIdea
} from './type-guards';
import { CodeImprovementDetails } from './details/CodeImprovementDetails';
import { UIUXDetails } from './details/UIUXDetails';
import { DocumentationGapDetails } from './details/DocumentationGapDetails';
import { SecurityHardeningDetails } from './details/SecurityHardeningDetails';
import { PerformanceOptimizationDetails } from './details/PerformanceOptimizationDetails';
import { CodeQualityDetails } from './details/CodeQualityDetails';

interface IdeaDetailPanelProps {
  idea: Idea;
  onClose: () => void;
  onConvert: (idea: Idea) => void;
  onGoToTask?: (taskId: string) => void;
  onDismiss: (idea: Idea) => void;
  isConverting?: boolean;
}

export function IdeaDetailPanel({ idea, onClose, onConvert, onGoToTask, onDismiss, isConverting }: IdeaDetailPanelProps) {
  const { t } = useTranslation(['common', 'ideation']);
  const typeLabels = getIdeationTypeLabels(t);
  const isDismissed = idea.status === 'dismissed';
  const isConverted = idea.status === 'converted';

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-lg flex flex-col z-50">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border electron-no-drag">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={IDEATION_TYPE_COLORS[idea.type]}>
                <TypeIcon type={idea.type} />
                <span className="ml-1">{typeLabels[idea.type]}</span>
              </Badge>
              {idea.status !== 'draft' && (
                <Badge variant="outline" className={IDEATION_STATUS_COLORS[idea.status]}>
                  {idea.status}
                </Badge>
              )}
            </div>
            <h2 className="font-semibold">{idea.title}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('accessibility.closePanelAriaLabel')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Description */}
        <div>
          <h3 className="text-sm font-medium mb-2">{t('common:ideation.description')}</h3>
          <p className="text-sm text-muted-foreground">{idea.description}</p>
        </div>

        {/* Rationale */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            {t('common:ideation.rationale')}
          </h3>
          <p className="text-sm text-muted-foreground">{idea.rationale}</p>
        </div>

        {/* Type-specific content */}
        {isCodeImprovementIdea(idea) && <CodeImprovementDetails idea={idea} />}
        {isUIUXIdea(idea) && <UIUXDetails idea={idea} />}
        {isDocumentationGapIdea(idea) && <DocumentationGapDetails idea={idea} />}
        {isSecurityHardeningIdea(idea) && <SecurityHardeningDetails idea={idea} />}
        {isPerformanceOptimizationIdea(idea) && <PerformanceOptimizationDetails idea={idea} />}
        {isCodeQualityIdea(idea) && <CodeQualityDetails idea={idea} />}
      </div>

      {/* Actions */}
      {!isDismissed && !isConverted && (
        <div className="shrink-0 p-4 border-t border-border space-y-2">
          <Button className="w-full" onClick={() => onConvert(idea)} disabled={isConverting}>
            {isConverting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isConverting ? t('common:ideation.converting') : t('common:ideation.convertToTask')}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onDismiss(idea);
              onClose();
            }}
          >
            <X className="h-4 w-4 mr-2" />
            {t('common:ideation.dismissIdea')}
          </Button>
        </div>
      )}
      {isConverted && idea.taskId && onGoToTask && (
        <div className="shrink-0 p-4 border-t border-border">
          <Button className="w-full" onClick={() => onGoToTask(idea.taskId!)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('common:ideation.goToTask')}
          </Button>
        </div>
      )}
    </div>
  );
}
