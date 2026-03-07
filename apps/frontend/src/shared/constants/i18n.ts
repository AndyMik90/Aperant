/**
 * Internationalization constants
 * Available languages and display labels
 */

export type SupportedLanguage = 'en' | 'fr' | 'ru';

export const AVAILABLE_LANGUAGES = [
  { value: 'en' as const, label: 'English', nativeLabel: 'English' },
  { value: 'fr' as const, label: 'French', nativeLabel: 'Français' },
  { value: 'ru' as const, label: 'Russian', nativeLabel: 'Русский' }
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
