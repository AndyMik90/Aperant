/**
 * Helper function for formatting dates with validation and locale support
 * @param dateString - ISO date string to format
 * @param locale - Locale for formatting (defaults to system locale)
 * @returns Formatted date string or empty string if invalid
 */
export function formatDate(dateString: string, locale?: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
