/**
 * FindingItem - Individual finding display with checkbox and details
 */

import { CheckCircle } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Checkbox } from '../../ui/checkbox';
import { cn } from '../../../lib/utils';
import { getCategoryIcon } from '../constants/severity-config';
import type { GitLabMRReviewFinding } from '../hooks/useGitLabMRs';

interface FindingItemProps {
  finding: GitLabMRReviewFinding;
  selected: boolean;
  posted?: boolean;
  onToggle: () => void;
}

export function FindingItem({ finding, selected, posted = false, onToggle }: FindingItemProps) {
  const CategoryIcon = getCategoryIcon(finding.category);

  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 space-y-2 transition-colors",
        selected && !posted && "ring-2 ring-primary/50",
        posted && "opacity-60"
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
              <CategoryIcon className="h-3 w-3 me-1" />
              {finding.category}
            </Badge>
            {posted && (
              <Badge variant="outline" className="text-xs shrink-0 text-success border-success/50">
                Posted
              </Badge>
            )}
            <span className="font-medium text-sm break-words">
              {finding.title}
            </span>
          </div>
          <p className="text-sm text-muted-foreground break-words">
            {finding.description}
          </p>
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
        <div className="ms-7 text-xs">
          <span className="text-muted-foreground font-medium">Suggested fix:</span>
          <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-w-full whitespace-pre-wrap break-words">
            {finding.suggestedFix}
          </pre>
        </div>
      )}
    </div>
  );
}
