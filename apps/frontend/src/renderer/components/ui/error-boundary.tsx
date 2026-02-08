import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { Card, CardContent } from './card';
import { captureException } from '../../lib/sentry';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
  // i18n translations (passed from functional wrapper)
  title?: string;
  message?: string;
  tryAgainLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component to gracefully handle render errors.
 * Prevents the entire page from crashing when a component fails.
 */
class ErrorBoundaryImpl extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Report to Sentry with React component stack
    captureException(error, {
      componentStack: errorInfo.componentStack,
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const title = this.props.title || 'Something went wrong';
      const message = this.props.message || 'An error occurred while rendering this content.';
      const tryAgainLabel = this.props.tryAgainLabel || 'Try Again';

      return (
        <Card className="border-destructive m-4" role="alert">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">{title}</h3>
                <p className="text-sm text-muted-foreground">
                  {message}
                </p>
                {this.state.error && (
                  <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded max-w-md overflow-auto" aria-label="Error details">
                    {this.state.error.message}
                  </p>
                )}
              </div>
              <Button onClick={this.handleReset} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                {tryAgainLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Functional wrapper that provides i18n to the Error Boundary class component
 */
export function ErrorBoundary(props: Omit<ErrorBoundaryProps, 'title' | 'message' | 'tryAgainLabel'>): React.ReactElement {
  const { t } = useTranslation();

  return (
    <ErrorBoundaryImpl
      {...props}
      title={t('errors.errorBoundary.title', { defaultValue: 'Something went wrong' })}
      message={t('errors.errorBoundary.message', { defaultValue: 'An error occurred while rendering this content.' })}
      tryAgainLabel={t('errors.errorBoundary.tryAgain', { defaultValue: 'Try Again' })}
    />
  );
}
