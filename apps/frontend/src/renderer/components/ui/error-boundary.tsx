/**
 * ErrorBoundary - Graceful error handling for React component trees
 *
 * @see https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';
import { captureException } from '../../lib/sentry';

/* -- Types ---------------------------------------------------------------- */

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/* -- Fallback Component --------------------------------------------------- */

function ErrorBoundaryFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation('errors');
  return (
    <Card className="border-destructive m-4">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('errors:errorBoundary.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('errors:errorBoundary.description')}
            </p>
            {error && (
              <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded max-w-md overflow-auto">
                {error.message}
              </p>
            )}
          </div>
          <Button onClick={onReset} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('errors:errorBoundary.retryButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* -- Components ----------------------------------------------------------- */

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
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

      return (
        <ErrorBoundaryFallback
          error={this.state.error!}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
