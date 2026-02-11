import type React from 'react';
import { ErrorBoundary as BaseErrorBoundary } from '@auto-claude/ui/primitives/error-boundary';
import { captureException } from '../../lib/sentry';

type BaseErrorBoundaryProps = React.ComponentProps<typeof BaseErrorBoundary>;

/**
 * App-level ErrorBoundary that automatically reports errors to Sentry.
 * Wraps the shared @auto-claude/ui ErrorBoundary with Sentry integration.
 */
export function ErrorBoundary(props: BaseErrorBoundaryProps) {
  const handleError = (error: Error, errorInfo: React.ErrorInfo): void => {
    captureException(error, { componentStack: errorInfo.componentStack });
    props.onError?.(error, errorInfo);
  };

  return (
    <BaseErrorBoundary {...props} onError={handleError}>
      {props.children}
    </BaseErrorBoundary>
  );
}
