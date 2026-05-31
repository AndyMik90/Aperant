/**
 * Internationalization constants
 * Available languages and display labels
 */

export type SupportedLanguage = 'en' | 'fr' | 'ar';

export const AVAILABLE_LANGUAGES = [
  { value: 'en' as const, label: 'English', nativeLabel: 'English' },
  { value: 'fr' as const, label: 'French', nativeLabel: 'Français' },
  { value: 'ar' as const, label: 'Arabic', nativeLabel: 'العربية' }
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const RTL_LANGUAGES: SupportedLanguage[] = ['ar'];
