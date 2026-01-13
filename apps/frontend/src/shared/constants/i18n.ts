/**
 * Internationalization constants
 * Available languages and display labels
 */

/**
 * Language configuration array - single source of truth for supported languages
 * Use `as const` to enable type-level inference
 */
export const AVAILABLE_LANGUAGES = [
  { code: 'en' as const, label: 'English', nativeLabel: 'English' },
  { code: 'fr' as const, label: 'French', nativeLabel: 'Français' },
  { code: 'ja' as const, label: 'Japanese', nativeLabel: '日本語' }
] as const;

/**
 * Supported language code type - automatically derived from AVAILABLE_LANGUAGES
 * This ensures type safety when adding new languages (just update the array above)
 */
export type SupportedLanguage = typeof AVAILABLE_LANGUAGES[number]['code'];

/**
 * Language configuration object type - inferred from the array structure
 * Readonly ensures immutability at type level
 */
export type LanguageConfig = typeof AVAILABLE_LANGUAGES[number];

/**
 * Default language for the application
 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
