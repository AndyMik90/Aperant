import { useTranslation } from 'react-i18next';
import {
  Gauge,
  Box,
  Database,
  Wifi,
  HardDrive,
  AlertCircle,
  TrendingUp,
  Wrench,
  FileCode,
  AlertTriangle
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card } from '../../ui/card';
import {
  IDEATION_IMPACT_COLORS,
  IDEATION_EFFORT_COLORS,
  getPerformanceCategoryLabels
} from '../../../../shared/constants';
import type { PerformanceOptimizationIdea } from '../../../../shared/types';

interface PerformanceOptimizationDetailsProps {
  idea: PerformanceOptimizationIdea;
}

// Get an icon for the performance category
function getCategoryIcon(category: string) {
  switch (category) {
    case 'bundle_size':
      return <Box className="h-4 w-4" />;
    case 'database':
      return <Database className="h-4 w-4" />;
    case 'network':
      return <Wifi className="h-4 w-4" />;
    case 'memory':
      return <HardDrive className="h-4 w-4" />;
    default:
      return <Gauge className="h-4 w-4" />;
  }
}

export function PerformanceOptimizationDetails({ idea }: PerformanceOptimizationDetailsProps) {
  const { t } = useTranslation('ideation');
  const performanceLabels = getPerformanceCategoryLabels(t);
  return (
    <>
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 text-center">
          <div className={`text-lg font-semibold ${IDEATION_IMPACT_COLORS[idea.impact]}`}>
            {idea.impact}
          </div>
          <div className="text-xs text-muted-foreground">Impact</div>
        </Card>
        <Card className="p-3 text-center">
          <div className={`text-lg font-semibold ${IDEATION_EFFORT_COLORS[idea.estimatedEffort]}`}>
            {idea.estimatedEffort}
          </div>
          <div className="text-xs text-muted-foreground">Effort</div>
        </Card>
      </div>

      {/* Category */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          {getCategoryIcon(idea.category)}
          Category
        </h3>
        <Badge variant="outline">
          {performanceLabels[idea.category]}
        </Badge>
      </div>

      {/* Current Metric */}
      {idea.currentMetric && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Current State
          </h3>
          <p className="text-sm text-muted-foreground">{idea.currentMetric}</p>
        </div>
      )}

      {/* Expected Improvement */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-success" />
          Expected Improvement
        </h3>
        <p className="text-sm text-muted-foreground">{idea.expectedImprovement}</p>
      </div>

      {/* Implementation */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Implementation
        </h3>
        <p className="text-sm text-muted-foreground whitespace-pre-line">{idea.implementation}</p>
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

      {/* Tradeoffs */}
      {idea.tradeoffs && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Tradeoffs
          </h3>
          <p className="text-sm text-muted-foreground">{idea.tradeoffs}</p>
        </div>
      )}
    </>
  );
}
