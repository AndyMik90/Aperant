/**
 * DriftTab Component
 *
 * Displays drift monitoring information in the TaskDetailModal.
 * Shows drift score over time, component breakdown, and anomalies.
 */

import * as React from 'react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useDriftStore, useTaskDrift, type DriftReport } from '../../stores/drift-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { Progress } from '../ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { RefreshCw, AlertTriangle, CheckCircle2, Info, RotateCcw } from 'lucide-react';

interface DriftTabProps {
  taskId: string;
  specDir: string;
}

/**
 * Main drift monitoring tab content
 */
export function DriftTab({ taskId, specDir }: DriftTabProps) {
  const taskDrift = useTaskDrift(taskId);
  const loadDriftReport = useDriftStore((s) => s.loadDriftReport);
  const loadBaseline = useDriftStore((s) => s.loadBaseline);
  const resetBaseline = useDriftStore((s) => s.resetBaseline);
  const settings = useDriftStore((s) => s.settings);

  // Load drift data on mount
  useEffect(() => {
    loadDriftReport(taskId, specDir);
    loadBaseline(taskId, specDir);
  }, [taskId, specDir, loadDriftReport, loadBaseline]);

  const handleRefresh = () => {
    loadDriftReport(taskId, specDir);
    loadBaseline(taskId, specDir);
  };

  const handleResetBaseline = async () => {
    await resetBaseline(taskId, specDir);
  };

  if (!settings.enabled) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-muted-foreground" />
              Drift Monitoring Disabled
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Agent drift monitoring is currently disabled. Enable it in Settings
              to track behavioral changes during task execution.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (taskDrift?.loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const report = taskDrift?.report;
  const baseline = taskDrift?.baseline;

  if (!report) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-muted-foreground" />
              No Drift Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No drift data available for this task yet. Drift monitoring begins
              when the agent starts executing tool calls.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-5 space-y-5">
        {/* Header with score and actions */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Drift Analysis
              {report.is_interim && (
                <Badge variant="outline" className="text-xs">
                  Live
                </Badge>
              )}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Behavioral drift detection for agent session
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main drift score */}
        <DriftScoreCard report={report} />

        {/* Component breakdown */}
        <ComponentScoresCard report={report} />

        {/* Anomalies */}
        {report.anomalies.length > 0 && (
          <AnomaliesCard anomalies={report.anomalies} alertLevel={report.alert_level} />
        )}

        {/* Baseline info */}
        {baseline && (
          <BaselineCard baseline={baseline} onReset={handleResetBaseline} />
        )}

        {/* Recent tools (if available) */}
        {report.recent_tools && report.recent_tools.length > 0 && (
          <RecentToolsCard tools={report.recent_tools} />
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * Main drift score display card
 */
function DriftScoreCard({ report }: { report: DriftReport }) {
  const scorePercent = report.overall_drift_score * 100;

  const alertColors = {
    normal: 'text-emerald-500',
    warning: 'text-amber-500',
    critical: 'text-red-500',
  };

  const alertBg = {
    normal: 'bg-emerald-500/10',
    warning: 'bg-amber-500/10',
    critical: 'bg-red-500/10',
  };

  const alertIcons = {
    normal: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-500" />,
    critical: <AlertTriangle className="h-5 w-5 text-red-500" />,
  };

  const alertLabels = {
    normal: 'Normal Behavior',
    warning: 'Drift Warning',
    critical: 'Critical Drift',
  };

  return (
    <Card className={cn(alertBg[report.alert_level])}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {alertIcons[report.alert_level]}
            <div>
              <p className={cn('text-2xl font-bold font-mono', alertColors[report.alert_level])}>
                {scorePercent.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground">Drift Score</p>
            </div>
          </div>
          <Badge
            variant={
              report.alert_level === 'normal'
                ? 'success'
                : report.alert_level === 'warning'
                  ? 'warning'
                  : 'destructive'
            }
          >
            {alertLabels[report.alert_level]}
          </Badge>
        </div>

        {/* Visual progress bar */}
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>30% (Warning)</span>
            <span>50% (Critical)</span>
            <span>100%</span>
          </div>
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'absolute h-full transition-all duration-500',
                report.alert_level === 'normal' && 'bg-emerald-500',
                report.alert_level === 'warning' && 'bg-amber-500',
                report.alert_level === 'critical' && 'bg-red-500'
              )}
              style={{ width: `${Math.min(scorePercent, 100)}%` }}
            />
            {/* Threshold markers */}
            <div className="absolute left-[30%] top-0 bottom-0 w-px bg-amber-500/50" />
            <div className="absolute left-[50%] top-0 bottom-0 w-px bg-red-500/50" />
          </div>
        </div>

        {/* Session info */}
        {report.tool_count !== undefined && (
          <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
            <span>{report.tool_count} tools tracked</span>
            {report.session_duration_ms !== undefined && (
              <span>{(report.session_duration_ms / 1000).toFixed(1)}s session</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Component scores breakdown
 */
function ComponentScoresCard({ report }: { report: DriftReport }) {
  const components = [
    { key: 'tool_sequence', label: 'Tool Sequence', weight: 0.25 },
    { key: 'tool_frequency', label: 'Tool Frequency', weight: 0.20 },
    { key: 'timing', label: 'Timing', weight: 0.15 },
    { key: 'decision', label: 'Decision Patterns', weight: 0.15 },
    { key: 'file_access', label: 'File Access', weight: 0.10 },
    { key: 'network', label: 'Network', weight: 0.10 },
    { key: 'output', label: 'Output', weight: 0.05 },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Component Breakdown</CardTitle>
        <CardDescription>Drift contribution by behavior category</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {components.map(({ key, label, weight }) => {
            const score = report.component_scores[key] || 0;
            const scorePercent = score * 100;
            const isHigh = score > 0.3;
            const isCritical = score > 0.5;

            return (
              <TooltipProvider key={key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span
                          className={cn(
                            'font-mono',
                            isCritical && 'text-red-500',
                            isHigh && !isCritical && 'text-amber-500',
                            !isHigh && 'text-muted-foreground'
                          )}
                        >
                          {scorePercent.toFixed(0)}%
                        </span>
                      </div>
                      <Progress
                        value={scorePercent}
                        className={cn(
                          'h-1.5',
                          isCritical && '[&>div]:bg-red-500',
                          isHigh && !isCritical && '[&>div]:bg-amber-500'
                        )}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p className="text-xs">Weight: {(weight * 100).toFixed(0)}%</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Anomalies list card
 */
function AnomaliesCard({
  anomalies,
  alertLevel,
}: {
  anomalies: string[];
  alertLevel: 'normal' | 'warning' | 'critical';
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle
            className={cn(
              'h-4 w-4',
              alertLevel === 'warning' && 'text-amber-500',
              alertLevel === 'critical' && 'text-red-500'
            )}
          />
          Detected Anomalies ({anomalies.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {anomalies.map((anomaly, i) => (
            <li
              key={i}
              className="text-sm text-muted-foreground flex items-start gap-2"
            >
              <span className="text-muted-foreground/50 select-none">&bull;</span>
              {anomaly}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Baseline info card
 */
function BaselineCard({
  baseline,
  onReset,
}: {
  baseline: NonNullable<DriftReport['baseline_info']>;
  onReset: () => void;
}) {
  if (!baseline.exists) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Baseline</CardTitle>
          <CardDescription>No baseline established yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A baseline will be created automatically from the first session.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">Baseline</CardTitle>
            <CardDescription>Known-good behavior reference</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} className="text-xs">
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Sessions</p>
            <p className="font-medium">{baseline.run_count || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Historical Samples</p>
            <p className="font-medium">{baseline.historical_count || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Known Tools</p>
            <p className="font-medium">{baseline.tool_count || 0}</p>
          </div>
          {baseline.updated_at && (
            <div>
              <p className="text-muted-foreground">Last Updated</p>
              <p className="font-medium text-xs">
                {new Date(baseline.updated_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        {baseline.poisoning_warning && (
          <div className="mt-4 p-3 bg-amber-500/10 rounded-lg flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-500">Poisoning Warning</p>
              <p className="text-muted-foreground">
                Baseline has drifted significantly from its original state.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Recent tools activity card
 */
function RecentToolsCard({
  tools,
}: {
  tools: NonNullable<DriftReport['recent_tools']>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Recent Tool Activity</CardTitle>
        <CardDescription>Last {tools.length} tool calls</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {tools.slice(-10).reverse().map((tool, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm py-1"
            >
              <span className="font-mono text-muted-foreground">{tool.tool}</span>
              <span
                className={cn(
                  'text-xs',
                  tool.success ? 'text-emerald-500' : 'text-red-500'
                )}
              >
                {tool.success ? 'OK' : 'ERR'}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default DriftTab;
