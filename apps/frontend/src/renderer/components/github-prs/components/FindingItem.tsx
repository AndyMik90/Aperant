/**
 * FindingItem - Individual finding display with checkbox and details
 */

import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Checkbox } from '../../ui/checkbox';
import { cn } from '../../../lib/utils';
import { getCategoryIcon } from '../constants/severity-config';
import type { PRReviewFinding } from '../hooks/useGitHubPRs';

interface FindingItemProps {
  finding: PRReviewFinding;
  selected: boolean;
  posted?: boolean;
  disputed?: boolean;
  onToggle: () => void;
}

// Helper to translate category names
function getCategoryTranslationKey(category: string): string {
  // Map category values to translation keys
  const categoryMap: Record<string, string> = {
    'security': 'prReview.category.security',
    'logic': 'prReview.category.logic',
    'quality': 'prReview.category.quality',
    'performance': 'prReview.category.performance',
    'style': 'prReview.category.style',
    'documentation': 'prReview.category.documentation',
    'testing': 'prReview.category.testing',
    'other': 'prReview.category.other',
  };
  return categoryMap[category.toLowerCase()] || category;
}

export function FindingItem({ finding, selected, posted = false, disputed = false, onToggle }: FindingItemProps) {
  const { t } = useTranslation('common');
  const CategoryIcon = getCategoryIcon(finding.category);

  // Get translated category name (falls back to original if translation not found)
  const categoryKey = getCategoryTranslationKey(finding.category);
  const categoryLabel = t(categoryKey, { defaultValue: finding.category });

  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 space-y-2 transition-colors",
        selected && !posted && !disputed && "ring-2 ring-primary/50",
        selected && disputed && "ring-2 ring-purple-500/50",
        (posted || (disputed && !selected)) && "opacity-60"
      )}
    >
      {/* Finding Header */}
      <div className="flex items-start gap-3">
        {posted ? (
          <CheckCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
        ) : (
          <Checkbox
            id={finding.id}
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-0.5"
          />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs shrink-0">
              <CategoryIcon className="h-3 w-3 mr-1" />
              {categoryLabel}
            </Badge>
            {posted && (
              <Badge variant="outline" className="text-xs shrink-0 text-success border-success/50">
                {t('prReview.posted')}
              </Badge>
            )}
            {disputed && (
              <Badge variant="outline" className="text-xs shrink-0 bg-purple-500/10 text-purple-500 border-purple-500/30">
                {t('prReview.disputed')}
              </Badge>
            )}
            {finding.crossValidated && finding.sourceAgents && finding.sourceAgents.length > 1 && (
              <Badge variant="outline" className="text-xs shrink-0 bg-green-500/10 text-green-500 border-green-500/30">
                {t('prReview.crossValidatedBy', { count: finding.sourceAgents.length })}
              </Badge>
            )}
            <span className="font-medium text-sm break-words">
              {finding.title}
            </span>
          </div>
          <p className="text-sm text-muted-foreground break-words">
            {finding.description}
          </p>
          {disputed && finding.validationExplanation && (
            <p className="text-xs text-purple-500/80 italic break-words">
              {finding.validationExplanation}
            </p>
          )}
          <div className="text-xs text-muted-foreground">
            <code className="bg-muted px-1 py-0.5 rounded break-all">
              {finding.file}:{finding.line}
              {finding.endLine && finding.endLine !== finding.line && `-${finding.endLine}`}
            </code>
          </div>
        </div>
      </div>

      {/* Suggested Fix */}
      {finding.suggestedFix && (
        <div className="ml-7 text-xs">
          <span className="text-muted-foreground font-medium">{t('prReview.suggestedFix')}</span>
          <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-w-full whitespace-pre-wrap break-words">
            {finding.suggestedFix}
          </pre>
        </div>
      )}
    </div>
  );
}
