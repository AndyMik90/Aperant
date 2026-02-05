/**
 * Time Formatting Utilities
 *
 * Shared utilities for formatting time differences and durations.
 * Designed for use with i18n translation functions.
 */

/**
 * Known hardcoded English patterns from main process to filter out
 *
 * The main process may send these sentinel values when time data is unavailable.
 * This helper is used to filter them out before displaying to users.
 *
 * @param text - The text to check
 * @returns true if text is a hardcoded sentinel value (undefined, null, 'Unknown', 'Expired', or whitespace-only)
 *
 * @example
 * hasHardcodedText('Unknown') // true
 * hasHardcodedText('Expired') // true
 * hasHardcodedText('   ') // true (whitespace-only)
 * hasHardcodedText('Resets in 2h') // false
 */
export function hasHardcodedText(text?: string | null): boolean {
  // Trim whitespace before checking - whitespace-only strings are treated as empty
  const trimmed = text?.trim();
  return !trimmed || trimmed === 'Unknown' || trimmed === 'Expired';
}

/**
 * Translation key mapping for backend usage window labels
 * Maps backend-provided English strings to i18n translation keys
 */
const USAGE_WINDOW_LABEL_MAP: Readonly<Record<string, string>> = {
  '5-hour window': 'window5Hour',
  '7-day window': 'window7Day',
  '5 Hours Quota': 'window5HoursQuota',
  'Monthly Tools Quota': 'windowMonthlyToolsQuota'
} as const;

/**
 * Map backend-provided usage window labels to localized translation keys
 *
 * The backend now provides i18n translation keys like "common:usage.window5Hour".
 * For backward compatibility, also handles legacy English strings like "5-hour window".
 *
 * @param backendLabel - The translation key or legacy English label from the backend API
 * @param t - i18next translation function
 * @param defaultKey - Optional default translation key (default: 'common:usage.sessionDefault')
 * @returns Localized label string
 *
 * @example
 * localizeUsageWindowLabel('common:usage.window5Hour', t)
 * // Returns: t('common:usage.window5Hour') → "5-hour window" (en) or localized equivalent
 *
 * @example
 * // Legacy backward compatibility
 * localizeUsageWindowLabel('5-hour window', t)
 * // Returns: t('common:usage.window5Hour') → "5-hour window" (en) or localized equivalent
 *
 * @example
 * localizeUsageWindowLabel('Unknown Label', t, 'common:usage.weeklyDefault')
 * // Returns: t('common:usage.weeklyDefault') → localized fallback, not the raw backend label
 */
export function localizeUsageWindowLabel(
  backendLabel: string | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
  defaultKey: string = 'common:usage.sessionDefault'
): string {
  if (!backendLabel) return t(defaultKey);

  // Check if backendLabel is already a translation key (contains colon)
  // New format: backend sends "common:usage.window5Hour" directly
  if (backendLabel.includes(':')) {
    const translated = t(backendLabel);
    // If translation returns the key itself (not found), use default
    return translated === backendLabel ? t(defaultKey) : translated;
  }

  // Legacy backward compatibility: map old hardcoded English strings to translation keys
  const translationKey = USAGE_WINDOW_LABEL_MAP[backendLabel];
  if (translationKey) {
    const translated = t(`common:usage.${translationKey}`);
    // If translation returns the key itself (not found), use backend label as fallback
    return translated === `common:usage.${translationKey}` ? backendLabel : translated;
  }

  // Unknown label - use localized default instead of raw backend text
  return t(defaultKey);
}

export interface FormatTimeRemainingOptions {
  /** Translation key for hours/minutes format (default: 'common:usage.resetsInHours') */
  hoursKey?: string;
  /** Translation key for days/hours format (default: 'common:usage.resetsInDays') */
  daysKey?: string;
}

/**
 * Format a timestamp as a human-readable "time remaining" string
 *
 * Calculates the time difference between the given timestamp and now,
 * then formats it using the provided translation function.
 *
 * @param timestamp - ISO timestamp string to format
 * @param t - i18next translation function
 * @param options - Optional configuration
 * @returns Formatted time string, or undefined if timestamp is invalid
 *
 * @example
 * formatTimeRemaining('2025-01-20T15:00:00Z', t)
 * // Returns: "Resets in 2h 30m" or "Resets in 3d 5h" depending on time difference
 *
 * @example
 * formatTimeRemaining('2025-01-20T15:00:00Z', t, {
 *   hoursKey: 'common:usage.resetsInHours',
 *   daysKey: 'common:usage.resetsInDays'
 * })
 */
export function formatTimeRemaining(
  timestamp: string | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
  options: FormatTimeRemainingOptions = {}
): string | undefined {
  if (!timestamp) return undefined;

  const { hoursKey = 'common:usage.resetsInHours', daysKey = 'common:usage.resetsInDays' } = options;

  try {
    const date = new Date(timestamp);

    // Handle invalid dates (isNaN check before using getTime())
    if (Number.isNaN(date.getTime())) return undefined;

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    // Handle past dates
    if (diffMs < 0) {
      // Return undefined for past dates - caller can provide fallback
      return undefined;
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours < 24) {
      return t(hoursKey, { hours: diffHours, minutes: diffMins });
    }

    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return t(daysKey, { days: diffDays, hours: remainingHours });
  } catch (_error) {
    return undefined;
  }
}

/**
 * Simple time formatting for main process (no i18n)
 *
 * Used in usage-monitor.ts for backend time formatting.
 * Returns simple "2h 30m" or "3d 5h" format.
 *
 * NOTE: This function returns hardcoded English strings ('Unknown', 'Expired')
 * because i18n is not available in the main process. These sentinel values
 * flow into ClaudeUsageSnapshot and should be replaced with localized text
 * in the renderer process before displaying to users.
 *
 * FUTURE: Consider returning structured data (e.g., { status: 'unknown' })
 * instead of strings to allow renderer-side localization.
 *
 * @param timestamp - ISO timestamp string
 * @returns Formatted time string, or 'Unknown'/'Expired' for special cases
 */
export function formatTimeRemainingSimple(timestamp: string | undefined): string {
  if (!timestamp) return 'Unknown';

  try {
    const date = new Date(timestamp);

    // Handle invalid dates
    if (Number.isNaN(date.getTime())) return 'Unknown';

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    // Handle past dates
    if (diffMs < 0) return 'Expired';

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours < 24) {
      return `${diffHours}h ${diffMins}m`;
    }

    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return `${diffDays}d ${remainingHours}h`;
  } catch (_error) {
    return 'Unknown';
  }
}
