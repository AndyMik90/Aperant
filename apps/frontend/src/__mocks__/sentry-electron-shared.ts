export type SentryErrorEvent = Record<string, unknown>;

export type SentryScope = {
  setContext: (key: string, value: Record<string, unknown>) => void;
};

export type SentryInitOptions = {
  beforeSend?: (event: SentryErrorEvent) => SentryErrorEvent | null;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
  dsn?: string;
  environment?: string;
  release?: string;
  debug?: boolean;
  enabled?: boolean;
};

export function init(_options: SentryInitOptions): void {
  // Mock: no-op for tests
}

export function captureException(_error: Error): void {
  // Mock: no-op for tests
}

export function withScope(callback: (scope: SentryScope) => void): void {
  callback({
    setContext: () => {
      // Mock: no-op for tests
    }
  });
}
