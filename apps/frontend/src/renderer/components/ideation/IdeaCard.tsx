import { useTranslation } from 'react-i18next';
import { ExternalLink, Play, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Checkbox } from '../ui/checkbox';
import {
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_COLORS,
  IDEATION_STATUS_COLORS,
  IDEATION_EFFORT_COLORS,
  IDEATION_IMPACT_COLORS,
  SECURITY_SEVERITY_COLORS,
  UIUX_CATEGORY_LABELS,
  DOCUMENTATION_CATEGORY_LABELS,
  CODE_QUALITY_SEVERITY_COLORS
} from '../../../shared/constants';
import type {
  Idea,
  CodeImprovementIdea,
  UIUXImprovementIdea,
  DocumentationGapIdea,
  SecurityHardeningIdea,
  PerformanceOptimizationIdea,
  CodeQualityIdea
} from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import {
  isCodeImprovementIdea,
  isUIUXIdea,
  isDocumentationGapIdea,
  isSecurityHardeningIdea,
  isPerformanceOptimizationIdea,
  isCodeQualityIdea
} from './type-guards';

interface IdeaCardProps {
  idea: Idea;
  isSelected: boolean;
  onClick: () => void;
  onConvert: (idea: Idea) => void;
  onGoToTask?: (taskId: string) => void;
  onDismiss: (idea: Idea) => void;
  onToggleSelect: (ideaId: string) => void;
}

export function IdeaCard({ idea, isSelected, onClick, onConvert, onGoToTask, onDismiss, onToggleSelect }: IdeaCardProps) {
  const { t } = useTranslation('common');
  const isDismissed = idea.status === 'dismissed';
  const isArchived = idea.status === 'archived';
  const isConverted = idea.status === 'converted';
  const isInactive = isDismissed || isArchived;

  return (
    <Card
      className={`p-4 hover:bg-muted/50 cursor-pointer transition-colors ${
        isInactive ? 'opacity-50' : ''
      } ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Selection checkbox */}
        <div
          className="pt-0.5"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(idea.id);
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(idea.id)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            aria-label={t('accessibility.selectIdeaAriaLabel', { title: idea.title })}
          />
        </div>

        <div className="flex-1 flex items-start justify-between">
          <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={IDEATION_TYPE_COLORS[idea.type]}>
              <TypeIcon type={idea.type} />
              <span className="ml-1">{IDEATION_TYPE_LABELS[idea.type]}</span>
            </Badge>
            {idea.status !== 'draft' && (
              <Badge variant="outline" className={IDEATION_STATUS_COLORS[idea.status]}>
                {idea.status}
              </Badge>
            )}
            {isCodeImprovementIdea(idea) && typeof (idea as CodeImprovementIdea).estimatedEffort === 'string' && (
              <Badge variant="outline" className={IDEATION_EFFORT_COLORS[(idea as CodeImprovementIdea).estimatedEffort]}>
                {(idea as CodeImprovementIdea).estimatedEffort}
              </Badge>
            )}
            {isUIUXIdea(idea) && typeof (idea as UIUXImprovementIdea).category === 'string' && (
              <Badge variant="outline">
                {UIUX_CATEGORY_LABELS[(idea as UIUXImprovementIdea).category]}
              </Badge>
            )}
            {isDocumentationGapIdea(idea) && typeof (idea as DocumentationGapIdea).category === 'string' && (
              <Badge variant="outline">
                {DOCUMENTATION_CATEGORY_LABELS[(idea as DocumentationGapIdea).category]}
              </Badge>
            )}
            {isSecurityHardeningIdea(idea) && typeof (idea as SecurityHardeningIdea).severity === 'string' && (
              <Badge variant="outline" className={SECURITY_SEVERITY_COLORS[(idea as SecurityHardeningIdea).severity]}>
                {(idea as SecurityHardeningIdea).severity}
              </Badge>
            )}
            {isPerformanceOptimizationIdea(idea) && typeof (idea as PerformanceOptimizationIdea).impact === 'string' && (
              <Badge variant="outline" className={IDEATION_IMPACT_COLORS[(idea as PerformanceOptimizationIdea).impact]}>
                {(idea as PerformanceOptimizationIdea).impact} impact
              </Badge>
            )}
            {isCodeQualityIdea(idea) && typeof (idea as CodeQualityIdea).severity === 'string' && (
              <Badge variant="outline" className={CODE_QUALITY_SEVERITY_COLORS[(idea as CodeQualityIdea).severity]}>
                {(idea as CodeQualityIdea).severity}
              </Badge>
            )}
          </div>
          <h3 className={`font-medium ${isInactive ? 'line-through' : ''}`}>
            {idea.title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{idea.description}</p>
          </div>
          {/* Action buttons */}
          {!isInactive && !isConverted && (
            <div className="flex items-center gap-1 ml-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConvert(idea);
                    }}
                    aria-label={t('accessibility.convertToTaskAriaLabel')}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('accessibility.convertToTaskAriaLabel')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(idea);
                    }}
                    aria-label={t('accessibility.dismissAriaLabel')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('accessibility.dismissAriaLabel')}</TooltipContent>
              </Tooltip>
            </div>
          )}
          {/* Archived ideas show link to task */}
          {isArchived && idea.taskId && onGoToTask && (
            <div className="flex items-center gap-1 ml-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToTask(idea.taskId!);
                    }}
                    aria-label={t('accessibility.goToTaskAriaLabel')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('accessibility.goToTaskAriaLabel')}</TooltipContent>
              </Tooltip>
            </div>
          )}
          {/* Legacy: converted status also shows link to task */}
          {isConverted && idea.taskId && onGoToTask && (
            <div className="flex items-center gap-1 ml-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToTask(idea.taskId!);
                    }}
                    aria-label={t('accessibility.goToTaskAriaLabel')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('accessibility.goToTaskAriaLabel')}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
