import { getAppLocale } from '../../../lib/date-utils';

/**
 * Helper function for formatting dates with validation and locale support
 * @param dateString - ISO date string to format
 * @param locale - Locale for formatting (defaults to app's i18n language)
 * @returns Formatted date string or empty string if invalid
 */
export function formatDate(dateString: string, locale?: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale ?? getAppLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
