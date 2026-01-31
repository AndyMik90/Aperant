import i18n from '../../shared/i18n';

/**
 * Get the current locale from i18n settings.
 * Falls back to 'en' if no language is set.
 */
export function getAppLocale(): string {
  return i18n.language || 'en';
}

/**
 * Format a date according to the app's current language setting.
 * Uses the i18n language to ensure consistency with the UI.
 */
export function formatDate(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleDateString(getAppLocale(), options);
}

/**
 * Format a time according to the app's current language setting.
 */
export function formatTime(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleTimeString(getAppLocale(), options);
}

/**
 * Format a date and time according to the app's current language setting.
 */
export function formatDateTime(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString(getAppLocale(), options);
}
