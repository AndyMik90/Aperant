import { useTranslation } from 'react-i18next';
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Wrench,
  FileCode,
  ExternalLink
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card } from '../../ui/card';
import {
  SECURITY_SEVERITY_COLORS,
  getSecurityCategoryLabels
} from '../../../../shared/constants';
import type { SecurityHardeningIdea } from '../../../../shared/types';

interface SecurityHardeningDetailsProps {
  idea: SecurityHardeningIdea;
}

export function SecurityHardeningDetails({ idea }: SecurityHardeningDetailsProps) {
  const { t } = useTranslation('ideation');
  const securityLabels = getSecurityCategoryLabels(t);
  return (
    <>
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 text-center">
          <div className={`text-lg font-semibold ${SECURITY_SEVERITY_COLORS[idea.severity]}`}>
            {idea.severity}
          </div>
          <div className="text-xs text-muted-foreground">Severity</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-semibold">
            {idea.affectedFiles?.length ?? 0}
          </div>
          <div className="text-xs text-muted-foreground">Files</div>
        </Card>
      </div>

      {/* Category */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Category
        </h3>
        <Badge variant="outline">
          {securityLabels[idea.category]}
        </Badge>
      </div>

      {/* Vulnerability */}
      {idea.vulnerability && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Vulnerability
          </h3>
          <p className="text-sm font-mono text-muted-foreground">{idea.vulnerability}</p>
        </div>
      )}

      {/* Current Risk */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Current Risk
        </h3>
        <p className="text-sm text-muted-foreground">{idea.currentRisk}</p>
      </div>

      {/* Remediation */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Remediation
        </h3>
        <p className="text-sm text-muted-foreground">{idea.remediation}</p>
      </div>

      {/* Affected Files */}
      {idea.affectedFiles && idea.affectedFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Affected Files
          </h3>
          <ul className="space-y-1">
            {idea.affectedFiles.map((file, i) => (
              <li key={i} className="text-sm font-mono text-muted-foreground">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* References */}
      {idea.references && idea.references.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <ExternalLink className="h-4 w-4" />
            References
          </h3>
          <ul className="space-y-1">
            {idea.references.map((ref, i) => (
              <li key={i} className="text-sm text-primary hover:underline">
                <a href={ref} target="_blank" rel="noopener noreferrer">{ref}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Compliance */}
      {idea.compliance && idea.compliance.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Compliance</h3>
          <div className="flex flex-wrap gap-1">
            {idea.compliance.map((comp, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {comp}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
