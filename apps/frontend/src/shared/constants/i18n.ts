/**
 * Internationalization constants
 * Available languages and display labels
 */

export type SupportedLanguage = 'en' | 'fr' | 'de';

export const AVAILABLE_LANGUAGES = [
  { value: 'en' as const, label: 'English', nativeLabel: 'English' },
  { value: 'fr' as const, label: 'French', nativeLabel: 'Français' },
  { value: 'de' as const, label: 'German', nativeLabel: 'Deutsch' }
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
