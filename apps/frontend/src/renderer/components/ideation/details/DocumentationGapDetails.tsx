import { useTranslation } from 'react-i18next';
import {
  Users,
  AlertCircle,
  CheckCircle2,
  FileCode
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card } from '../../ui/card';
import {
  getDocumentationCategoryLabels,
  IDEATION_EFFORT_COLORS,
  IDEATION_IMPACT_COLORS
} from '../../../../shared/constants';
import type { DocumentationGapIdea } from '../../../../shared/types';

interface DocumentationGapDetailsProps {
  idea: DocumentationGapIdea;
}

export function DocumentationGapDetails({ idea }: DocumentationGapDetailsProps) {
  const { t } = useTranslation('ideation');
  const docLabels = getDocumentationCategoryLabels(t);
  return (
    <>
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 text-center">
          <div className="text-lg font-semibold">
            {docLabels[idea.category]}
          </div>
          <div className="text-xs text-muted-foreground">Category</div>
        </Card>
        <Card className="p-3 text-center">
          <div className={`text-lg font-semibold ${IDEATION_EFFORT_COLORS[idea.estimatedEffort]}`}>
            {idea.estimatedEffort}
          </div>
          <div className="text-xs text-muted-foreground">Effort</div>
        </Card>
      </div>

      {/* Target Audience */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Users className="h-4 w-4" />
          Target Audience
        </h3>
        <Badge variant="outline" className="capitalize">
          {idea.targetAudience}
        </Badge>
      </div>

      {/* Current Documentation */}
      {idea.currentDocumentation && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Current Documentation
          </h3>
          <p className="text-sm text-muted-foreground">{idea.currentDocumentation}</p>
        </div>
      )}

      {/* Proposed Content */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Proposed Content
        </h3>
        <p className="text-sm text-muted-foreground">{idea.proposedContent}</p>
      </div>

      {/* Affected Areas */}
      {idea.affectedAreas && idea.affectedAreas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Affected Areas
          </h3>
          <ul className="space-y-1">
            {idea.affectedAreas.map((area, i) => (
              <li key={i} className="text-sm font-mono text-muted-foreground">
                {area}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Priority */}
      <div>
        <h3 className="text-sm font-medium mb-2">Priority</h3>
        <Badge variant="outline" className={IDEATION_IMPACT_COLORS[idea.priority]}>
          {idea.priority}
        </Badge>
      </div>
    </>
  );
}
