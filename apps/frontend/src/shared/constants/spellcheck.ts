/**
 * Spell check language configuration constants.
 *
 * Maps app language codes to Chromium spell checker language codes.
 * Electron uses Chromium's spell checker which may use different codes
 * than standard locale codes (e.g., 'en-US' vs 'en').
 */

/**
 * Map app language codes to spell checker language codes.
 * Each app language can map to multiple spell checker languages for better coverage.
 */
export const SPELL_CHECK_LANGUAGE_MAP: Record<string, string[]> = {
  en: ['en-US', 'en-GB'],
  fr: ['fr-FR', 'fr'],
};

/**
 * Default spell check language when the preferred language isn't available.
 */
export const DEFAULT_SPELL_CHECK_LANGUAGE = 'en-US';

/**
 * Localized labels for "Add to Dictionary" context menu item.
 * Uses app language (not OS locale) to match the in-app language setting.
 */
export const ADD_TO_DICTIONARY_LABELS: Record<string, string> = {
  en: 'Add to Dictionary',
  fr: 'Ajouter au dictionnaire',
};
