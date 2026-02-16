interface SentryErrorEvent {
  [key: string]: unknown;
}

interface SentryScope {
  setContext: (key: string, value: Record<string, unknown>) => void;
}

interface SentryInitOptions {
  beforeSend?: (event: SentryErrorEvent) => SentryErrorEvent | null;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
  dsn?: string;
  environment?: string;
  release?: string;
  debug?: boolean;
  enabled?: boolean;
}

interface SentryBreadcrumb {
  category?: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  data?: Record<string, unknown>;
}

interface SentryCaptureContext {
  contexts?: Record<string, Record<string, unknown>>;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

declare module '@sentry/electron/main' {
  export type ErrorEvent = SentryErrorEvent;
  export function init(options: SentryInitOptions): void;
  export function captureException(error: Error, context?: SentryCaptureContext): void;
  export function withScope(callback: (scope: SentryScope) => void): void;
  export function addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
}

declare module '@sentry/electron/renderer' {
  export type ErrorEvent = SentryErrorEvent;
  export function init(options: SentryInitOptions): void;
  export function captureException(error: Error, context?: SentryCaptureContext): void;
  export function withScope(callback: (scope: SentryScope) => void): void;
  export function addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
}
