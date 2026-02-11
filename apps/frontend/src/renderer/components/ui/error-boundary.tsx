import React from 'react';
import { ErrorBoundary as BaseErrorBoundary } from '@auto-claude/ui/primitives/error-boundary';
import { captureException } from '../../lib/sentry';

type BaseErrorBoundaryProps = React.ComponentProps<typeof BaseErrorBoundary>;

/**
 * App-level ErrorBoundary that automatically reports errors to Sentry.
 * Wraps the shared @auto-claude/ui ErrorBoundary with Sentry integration.
 */
export class ErrorBoundary extends React.Component<BaseErrorBoundaryProps> {
  private handleError = (error: Error, errorInfo: React.ErrorInfo): void => {
    captureException(error, { componentStack: errorInfo.componentStack });
    this.props.onError?.(error, errorInfo);
  };

  render(): React.ReactNode {
    return (
      <BaseErrorBoundary {...this.props} onError={this.handleError}>
        {this.props.children}
      </BaseErrorBoundary>
    );
  }
}
