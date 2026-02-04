/**
 * DriftAlertBanner Component
 *
 * Displays a prominent alert banner when critical drift is detected.
 * Shows at the top of the main content area to alert users of potential
 * prompt injection or behavioral drift.
 */

import * as React from 'react';
import { cn } from '../../lib/utils';
import { useDriftStore } from '../../stores/drift-store';
import { Button } from '../ui/button';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';

interface DriftAlertBannerProps {
  className?: string;
  onViewTask?: (taskId: string) => void;
}

/**
 * Alert banner for critical drift notifications
 */
export function DriftAlertBanner({ className, onViewTask }: DriftAlertBannerProps) {
  const activeAlerts = useDriftStore((s) => s.activeAlerts);
  const settings = useDriftStore((s) => s.settings);
  const dismissAlert = useDriftStore((s) => s.dismissAlert);

  // Don't render if disabled or no alerts
  if (!settings.enabled || !settings.showAlertBanner || activeAlerts.length === 0) {
    return null;
  }

  // Get the most critical alert
  const criticalAlerts = activeAlerts.filter((a) => a.level === 'critical');
  const mostCriticalAlert = criticalAlerts[0] || activeAlerts[0];

  if (!mostCriticalAlert) {
    return null;
  }

  const isCritical = mostCriticalAlert.level === 'critical';

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 px-4 py-3 rounded-lg border',
        isCritical
          ? 'bg-red-500/10 border-red-500/30 text-red-500'
          : 'bg-amber-500/10 border-amber-500/30 text-amber-500',
        className
      )}
      role="alert"
    >
      <AlertTriangle className={cn('h-5 w-5 shrink-0', isCritical ? 'text-red-500' : 'text-amber-500')} />

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">
          {isCritical ? 'Critical Behavioral Drift Detected' : 'Drift Warning'}
        </p>
        <p className="text-xs opacity-80 mt-0.5 line-clamp-1">
          {mostCriticalAlert.anomalies[0] || 'Agent behavior has deviated significantly from baseline'}
        </p>
        {activeAlerts.length > 1 && (
          <p className="text-xs opacity-60 mt-1">
            +{activeAlerts.length - 1} more alert{activeAlerts.length > 2 ? 's' : ''}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* View details button */}
        {onViewTask && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2 text-xs',
              isCritical ? 'hover:bg-red-500/20' : 'hover:bg-amber-500/20'
            )}
            onClick={() => onViewTask(mostCriticalAlert.taskId)}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View
          </Button>
        )}

        {/* Dismiss button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7',
            isCritical ? 'hover:bg-red-500/20' : 'hover:bg-amber-500/20'
          )}
          onClick={() => dismissAlert(mostCriticalAlert.taskId)}
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact alert indicator for sidebar or header
 */
export function DriftAlertIndicator({ className }: { className?: string }) {
  const activeAlerts = useDriftStore((s) => s.activeAlerts);
  const settings = useDriftStore((s) => s.settings);

  if (!settings.enabled || activeAlerts.length === 0) {
    return null;
  }

  const hasCritical = activeAlerts.some((a) => a.level === 'critical');

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium animate-pulse',
        hasCritical
          ? 'bg-red-500/10 text-red-500'
          : 'bg-amber-500/10 text-amber-500',
        className
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      <span>{activeAlerts.length}</span>
    </div>
  );
}

export default DriftAlertBanner;
