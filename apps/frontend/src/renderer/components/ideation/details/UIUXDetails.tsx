import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Users,
  FileCode
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { getUIUXCategoryLabels } from '../../../../shared/constants';
import type { UIUXImprovementIdea } from '../../../../shared/types';

interface UIUXDetailsProps {
  idea: UIUXImprovementIdea;
}

export function UIUXDetails({ idea }: UIUXDetailsProps) {
  const { t } = useTranslation('ideation');
  const uiuxLabels = getUIUXCategoryLabels(t);
  return (
    <>
      {/* Category */}
      <div>
        <Badge variant="outline" className="text-sm">
          {uiuxLabels[idea.category]}
        </Badge>
      </div>

      {/* Current State */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Current State
        </h3>
        <p className="text-sm text-muted-foreground">{idea.currentState}</p>
      </div>

      {/* Proposed Change */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Proposed Change
        </h3>
        <p className="text-sm text-muted-foreground">{idea.proposedChange}</p>
      </div>

      {/* User Benefit */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Users className="h-4 w-4" />
          User Benefit
        </h3>
        <p className="text-sm text-muted-foreground">{idea.userBenefit}</p>
      </div>

      {/* Affected Components */}
      {idea.affectedComponents && idea.affectedComponents.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Affected Components
          </h3>
          <ul className="space-y-1">
            {idea.affectedComponents.map((component, i) => (
              <li key={i} className="text-sm font-mono text-muted-foreground">
                {component}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
