import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Clock,
  Key,
  Shield,
  WifiOff,
  SearchX,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import { cn } from '../../../lib/utils';
import { parseGitHubError } from '../utils/github-error-parser';
import type { GitHubErrorInfo, GitHubErrorType } from '../types';

/**
 * Props for the GitHubErrorDisplay component.
 */
export interface GitHubErrorDisplayProps {
  /** Raw error string or pre-parsed GitHubErrorInfo */
  error: string | GitHubErrorInfo | null;
  /** Callback when user clicks retry button */
  onRetry?: () => void;
  /** Callback when user clicks settings button */
  onOpenSettings?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show as compact inline error (vs full-width card) */
  compact?: boolean;
}

/**
 * Configuration for each error type: icon, color, title key.
 */
const ERROR_CONFIG: Record<
  GitHubErrorType,
  {
    icon: React.ComponentType<{ className?: string }>;
    titleKey: string;
    iconColorClass: string;
  }
> = {
  rate_limit: {
    icon: Clock,
    titleKey: 'githubErrors.rateLimitTitle',
    iconColorClass: 'text-warning',
  },
  auth: {
    icon: Key,
    titleKey: 'githubErrors.authTitle',
    iconColorClass: 'text-destructive',
  },
  permission: {
    icon: Shield,
    titleKey: 'githubErrors.permissionTitle',
    iconColorClass: 'text-destructive',
  },
  not_found: {
    icon: SearchX,
    titleKey: 'githubErrors.notFoundTitle',
    iconColorClass: 'text-muted-foreground',
  },
  network: {
    icon: WifiOff,
    titleKey: 'githubErrors.networkTitle',
    iconColorClass: 'text-warning',
  },
  unknown: {
    icon: AlertTriangle,
    titleKey: 'githubErrors.unknownTitle',
    iconColorClass: 'text-destructive',
  },
};

/**
 * Base message keys for each error type.
 * Hoisted to module scope to avoid recreation on every function call.
 */
const BASE_MESSAGE_KEYS: Record<GitHubErrorType, string> = {
  rate_limit: 'githubErrors.rateLimitMessage',
  auth: 'githubErrors.authMessage',
  permission: 'githubErrors.permissionMessage',
  not_found: 'githubErrors.notFoundMessage',
  network: 'githubErrors.networkMessage',
  unknown: 'githubErrors.unknownMessage',
};

/**
 * Countdown time components for i18n-friendly formatting.
 */
interface CountdownComponents {
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Calculate countdown time components from reset time.
 * Returns numeric values for i18n-friendly formatting in the component.
 */
function getCountdownComponents(resetTime: Date): CountdownComponents | null {
  const now = new Date();
  const diffMs = resetTime.getTime() - now.getTime();

  if (diffMs <= 0) {
    return null;
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  return {
    hours: diffHours,
    minutes: diffHours > 0 ? diffMins % 60 : diffMins,
    seconds: diffSecs % 60,
  };
}

/**
 * Select the most specific message key based on available metadata.
 * Pure function extracted to module scope to avoid recreation on each render.
 * @param info - The error info object
 * @param rateLimitDiffMs - Pre-computed time difference in milliseconds (avoids dual calculation)
 */
function getMessageKey(info: GitHubErrorInfo, rateLimitDiffMs?: number): string {
  if (info.type === 'rate_limit' && rateLimitDiffMs !== undefined && rateLimitDiffMs > 0) {
    const diffMins = Math.ceil(rateLimitDiffMs / 60000);
    return diffMins >= 60
      ? 'githubErrors.rateLimitMessageHours'
      : 'githubErrors.rateLimitMessageMinutes';
  }
  if (info.type === 'permission' && info.requiredScopes && info.requiredScopes.length > 0) {
    return 'githubErrors.permissionMessageScopes';
  }
  return BASE_MESSAGE_KEYS[info.type];
}

/**
 * Component that displays GitHub API errors with appropriate icons,
 * messages, and action buttons based on error type.
 *
 * @example
 * ```tsx
 * // With raw error string
 * <GitHubErrorDisplay
 *   error="GitHub API error: 403 - Rate limit exceeded"
 *   onRetry={handleRetry}
 * />
 *
 * // With pre-parsed error info
 * <GitHubErrorDisplay
 *   error={errorInfo}
 *   onOpenSettings={handleOpenSettings}
 *   compact
 * />
 * ```
 */
export function GitHubErrorDisplay({
  error,
  onRetry,
  onOpenSettings,
  className,
  compact = false,
}: GitHubErrorDisplayProps) {
  const { t } = useTranslation('common');

  // Parse error if it's a string, otherwise use the provided GitHubErrorInfo
  // Memoize to prevent useEffect churn from new Date references on each render
  const errorInfo: GitHubErrorInfo = useMemo(
    () =>
      typeof error === 'string' || error === null
        ? parseGitHubError(error)
        : error,
    [error]
  );

  // State for rate limit countdown components
  const [countdownComponents, setCountdownComponents] = useState<CountdownComponents | null>(() =>
    errorInfo.rateLimitResetTime
      ? getCountdownComponents(errorInfo.rateLimitResetTime)
      : null
  );

  // Update countdown every second for rate limit errors
  // Extract timestamp for stable useEffect dependency (avoids optional chaining in deps)
  const resetTimeMs = errorInfo.rateLimitResetTime?.getTime();

  useEffect(() => {
    if (errorInfo.type !== 'rate_limit' || !errorInfo.rateLimitResetTime) {
      // Clear stale countdown state when error type changes away from rate_limit
      setCountdownComponents(null);
      return;
    }

    const resetTime = errorInfo.rateLimitResetTime;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const updateCountdown = () => {
      const components = getCountdownComponents(resetTime);
      setCountdownComponents(components);
      // Stop the interval when countdown expires
      if (!components && intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    // Update immediately
    updateCountdown();

    // Only set interval if countdown is still active
    if (getCountdownComponents(resetTime)) {
      intervalId = setInterval(updateCountdown, 1000);
    }

    // Cleanup on unmount or when error changes
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [errorInfo.type, resetTimeMs]);

  // Format countdown using i18n
  const formatCountdownDisplay = (components: CountdownComponents | null): string => {
    if (!components) return '';
    if (components.hours > 0) {
      return t('githubErrors.countdownHoursMinutes', {
        hours: components.hours,
        minutes: components.minutes,
      });
    }
    return t('githubErrors.countdownMinutesSeconds', {
      minutes: components.minutes,
      seconds: components.seconds,
    });
  };

  // Get configuration for this error type
  const config = ERROR_CONFIG[errorInfo.type];
  const Icon = config.icon;

  // Determine which actions to show
  const showRetry = ['rate_limit', 'network', 'unknown'].includes(errorInfo.type);
  const showSettings = ['auth', 'permission'].includes(errorInfo.type);
  const isRateLimitExpired =
    errorInfo.type === 'rate_limit' &&
    errorInfo.rateLimitResetTime &&
    new Date() >= errorInfo.rateLimitResetTime;

  // Don't render if no error
  if (!error) return null;

  // Compute time remaining once for both message key selection and translation
  const rateLimitDiffMs = errorInfo.rateLimitResetTime
    ? errorInfo.rateLimitResetTime.getTime() - Date.now()
    : undefined;

  // Get the translated message with appropriate interpolation values
  const messageKey = getMessageKey(errorInfo, rateLimitDiffMs);
  // Only pass positive minutes/hours values to avoid stale negative/zero values
  const rawMinutes = rateLimitDiffMs ? Math.ceil(rateLimitDiffMs / 60000) : undefined;
  const minutes = rawMinutes && rawMinutes > 0 ? rawMinutes : undefined;
  const hours = minutes ? Math.ceil(minutes / 60) : undefined;

  const errorMessage = t(messageKey, {
    defaultValue: errorInfo.message,
    minutes,
    hours,
    scopes: errorInfo.requiredScopes?.join(', '),
  });

  // Compact variant for inline display
  if (compact) {
    return (
      <div
        role="alert"
        aria-label={errorMessage}
        className={cn(
          'flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border',
          className
        )}
        title={errorMessage}
      >
        <Icon className={cn('h-4 w-4 shrink-0', config.iconColorClass)} />
        <span className="text-sm text-muted-foreground flex-1 truncate">
          {t(config.titleKey)}
        </span>
        {showRetry && onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="h-7 px-2"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('buttons.retry')}
          </Button>
        )}
        {showSettings && onOpenSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="h-7 px-2"
          >
            <Settings2 className="h-3 w-3 mr-1" />
            {t('actions.settings')}
          </Button>
        )}
      </div>
    );
  }

  // Full card variant for blocking errors
  return (
    <Card role="alert" className={cn('border-destructive/50 m-4', className)}>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
            <Icon className={cn('h-6 w-6', config.iconColorClass)} />
          </div>
          <div className="space-y-2 max-w-md">
            <h3 className="font-semibold text-lg text-foreground">
              {t(config.titleKey)}
            </h3>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            {/* Rate limit countdown display */}
            {errorInfo.type === 'rate_limit' && countdownComponents && (
              <p className="text-xs text-warning font-medium">
                {t('githubErrors.resetsIn', { time: formatCountdownDisplay(countdownComponents) })}
              </p>
            )}
            {/* Rate limit expired - show retry prompt */}
            {isRateLimitExpired && (
              <p className="text-xs text-primary">
                {t('githubErrors.rateLimitExpired')}
              </p>
            )}
            {/* Required scopes for permission errors */}
            {errorInfo.requiredScopes && errorInfo.requiredScopes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('githubErrors.requiredScopes')}:{' '}
                <code className="bg-muted px-1 rounded">
                  {errorInfo.requiredScopes.join(', ')}
                </code>
              </p>
            )}
          </div>
          {/* Action buttons */}
          <div className="flex gap-2">
            {showRetry && onRetry && (
              <Button onClick={onRetry} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('buttons.retry')}
              </Button>
            )}
            {showSettings && onOpenSettings && (
              <Button onClick={onOpenSettings} variant="outline" size="sm">
                <Settings2 className="h-4 w-4 mr-2" />
                {t('actions.settings')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
