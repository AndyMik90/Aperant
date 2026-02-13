/**
 * Shared Sentry Privacy Utilities
 *
 * Provides path masking functions for both main and renderer processes
 * to ensure user privacy in error reports.
 *
 * Privacy approach:
 * - Usernames are masked from all file paths
 * - Project paths remain visible (this is expected for debugging)
 * - All event fields are processed: stack traces, breadcrumbs, messages,
 *   tags, contexts, extra data, and user info
 */

// Using a generic event type to work with both main and renderer Sentry SDKs
// The actual type is Sentry.ErrorEvent but we define a compatible interface
// to avoid importing @sentry/electron which has different exports per process
export interface SentryErrorEvent {
  exception?: {
    values?: Array<{
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          abs_path?: string;
        }>;
      };
      value?: string;
    }>;
  };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
  }>;
  message?: string;
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown> | null>;
  extra?: Record<string, unknown>;
  user?: Record<string, unknown>;
  request?: {
    url?: string;
    headers?: Record<string, string>;
    data?: unknown;
  };
}

/**
 * Mask user-specific paths for privacy
 *
 * Replaces usernames in common OS path patterns:
 * - macOS: /Users/username/... becomes /Users/.../
 * - Windows: C:\Users\username\... becomes C:\Users\...\
 * - Linux: /home/username/... becomes /home/.../
 *
 * Note: Project paths remain visible for debugging purposes.
 * This is intentional - we need to know which file caused the error.
 */
export function maskUserPaths(text: string): string {
  if (!text) return text;

  // macOS: /Users/username/... or /Users/username (at end of string)
  // Uses lookahead to match with or without trailing slash
  text = text.replace(/\/Users\/[^/]+(?=\/|$)/g, '/Users/***');

  // Windows: C:\Users\username\... or C:\Users\username (at end of string)
  // Uses lookahead to match with or without trailing backslash
  text = text.replace(/[A-Z]:\\Users\\[^\\]+(?=\\|$)/gi, (match: string) => {
    const drive = match[0];
    return `${drive}:\\Users\\***`;
  });

  // Linux: /home/username/... or /home/username (at end of string)
  // Uses lookahead to match with or without trailing slash
  text = text.replace(/\/home\/[^/]+(?=\/|$)/g, '/home/***');

  return text;
}

/**
 * Sanitize text for safe inclusion in Sentry reports.
 * Masks user paths and redacts potential secrets (tokens, keys, credentials).
 */
export function sanitizeForSentry(text: string): string {
  if (!text) return text;

  text = maskUserPaths(text);

  // Redact common secret patterns (API keys, tokens, auth headers)
  // Bearer/token auth
  text = text.replace(/\b(Bearer|token|Token)\s+[A-Za-z0-9\-_.]+/gi, '$1 [REDACTED]');
  // API keys / secrets in key=value or key: value format
  text = text.replace(
    /\b(api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret[_-]?key|password|credential|private[_-]?key)[=:]\s*\S+/gi,
    '$1=[REDACTED]'
  );
  // Anthropic API key format
  text = text.replace(/\bsk-ant-[A-Za-z0-9\-_]{20,}/g, '[REDACTED_KEY]');
  // Generic long hex/base64 tokens (40+ chars, likely secrets)
  text = text.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[REDACTED_TOKEN]');

  return text;
}

/**
 * Recursively mask paths in an object
 * Handles nested objects and arrays
 */
function maskObjectPaths(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return maskUserPaths(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(maskObjectPaths);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[key] = maskObjectPaths((obj as Record<string, unknown>)[key]);
    }
    return result;
  }

  return obj;
}

/**
 * Process Sentry event to mask sensitive paths
 *
 * Comprehensive masking covers:
 * - Exception stack traces (filename, abs_path)
 * - Exception values (error messages)
 * - Breadcrumbs (messages and data)
 * - Top-level message
 * - Tags (custom tags might contain paths)
 * - Contexts (additional context data)
 * - Extra data (arbitrary data attached to events)
 * - User info (cleared entirely for privacy)
 * - Request data (URLs, headers)
 */
export function processEvent<T extends SentryErrorEvent>(event: T): T {
  // Mask paths in exception stack traces
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.stacktrace?.frames) {
        for (const frame of exception.stacktrace.frames) {
          if (frame.filename) {
            frame.filename = maskUserPaths(frame.filename);
          }
          if (frame.abs_path) {
            frame.abs_path = maskUserPaths(frame.abs_path);
          }
        }
      }
      if (exception.value) {
        exception.value = maskUserPaths(exception.value);
      }
    }
  }

  // Mask paths in breadcrumbs
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) {
        breadcrumb.message = maskUserPaths(breadcrumb.message);
      }
      if (breadcrumb.data) {
        breadcrumb.data = maskObjectPaths(breadcrumb.data) as Record<string, unknown>;
      }
    }
  }

  // Mask paths in message
  if (event.message) {
    event.message = maskUserPaths(event.message);
  }

  // Mask paths in tags
  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      if (typeof event.tags[key] === 'string') {
        event.tags[key] = maskUserPaths(event.tags[key]);
      }
    }
  }

  // Mask paths in contexts (recursively)
  if (event.contexts) {
    for (const contextKey of Object.keys(event.contexts)) {
      const context = event.contexts[contextKey];
      if (context && typeof context === 'object') {
        event.contexts[contextKey] = maskObjectPaths(context) as Record<string, unknown>;
      }
    }
  }

  // Mask paths in extra data (recursively)
  if (event.extra) {
    event.extra = maskObjectPaths(event.extra) as Record<string, unknown>;
  }

  // Clear user info entirely for privacy
  // We don't collect any user identifiers
  if (event.user) {
    event.user = {};
  }

  // Mask paths in request data
  if (event.request) {
    if (event.request.url) {
      event.request.url = maskUserPaths(event.request.url);
    }
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (typeof event.request.headers[key] === 'string') {
          event.request.headers[key] = maskUserPaths(event.request.headers[key]);
        }
      }
    }
    if (event.request.data) {
      event.request.data = maskObjectPaths(event.request.data);
    }
  }

  return event;
}

/**
 * Production trace sample rate
 * 10% of transactions are sampled for performance monitoring
 */
export const PRODUCTION_TRACE_SAMPLE_RATE = 0.1;
