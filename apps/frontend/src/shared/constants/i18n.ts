/**
 * Internationalization constants
 * Available languages and display labels
 */

export type SupportedLanguage = 'en' | 'fr' | 'zh-TW';

export const AVAILABLE_LANGUAGES = [
  { value: 'en' as const, label: 'English', nativeLabel: 'English' },
  { value: 'fr' as const, label: 'French', nativeLabel: 'Français' },
  { value: 'zh-TW' as const, label: 'Chinese (Traditional)', nativeLabel: '繁體中文' }
] as const;

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
