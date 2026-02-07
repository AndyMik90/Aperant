/**
 * Theme Import/Save Utility - tweakcn.com theme compatibility
 *
 * Utilities for importing, applying, saving, loading, and exporting
 * custom themes. Works with raw CSS variable strings so any color format
 * (hex, HSL, OKLCH, RGB) is supported.
 */

/* -- Types ---------------------------------------------------------------- */

/** Parsed theme variables as key-value pairs (variable name without --) */
export interface ThemeVariables {
  [key: string]: string;
}

/** Full theme config with metadata */
export interface CustomTheme {
  name: string;
  variables: ThemeVariables;
  fonts?: {
    sans?: string;
    serif?: string;
    mono?: string;
  };
}

/* -- Storage Key ---------------------------------------------------------- */

const STORAGE_KEY = 'auto-claude-custom-themes';

/* -- Parser --------------------------------------------------------------- */

/**
 * Parse a CSS variable block exported from tweakcn.com into a structured
 * theme object. Accepts CSS with `:root { ... }` or bare variable declarations.
 *
 * @param cssString - Raw CSS string from tweakcn export
 * @returns Parsed theme variables
 */
export function parseTweakcnCSS(cssString: string): ThemeVariables {
  const variables: ThemeVariables = {};

  // Match CSS custom property declarations: --name: value;
  const regex = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cssString)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    variables[name] = value;
  }

  return variables;
}

/* -- Apply ---------------------------------------------------------------- */

/**
 * Apply all CSS variables from a theme to the document root element.
 *
 * @param themeVars - Theme variables to apply
 */
export function applyThemeVariables(themeVars: ThemeVariables): void {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(themeVars)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/**
 * Remove all inline CSS variable overrides from the document root.
 * Restores the theme to its default CSS-defined values.
 */
export function clearThemeVariables(themeVars: ThemeVariables): void {
  const root = document.documentElement;

  for (const key of Object.keys(themeVars)) {
    root.style.removeProperty(`--${key}`);
  }
}

/* -- Persistence ---------------------------------------------------------- */

/**
 * Save a custom theme to localStorage for persistence.
 *
 * @param name - Theme name identifier
 * @param themeVars - Theme variables to save
 * @param fonts - Optional font configuration
 */
export function saveCustomTheme(
  name: string,
  themeVars: ThemeVariables,
  fonts?: CustomTheme['fonts']
): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const themes: Record<string, CustomTheme> = stored ? JSON.parse(stored) : {};

    themes[name] = { name, variables: themeVars, fonts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Load a custom theme from localStorage and apply it.
 *
 * @param name - Theme name to load
 * @returns The loaded theme, or null if not found
 */
export function loadCustomTheme(name: string): CustomTheme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const themes: Record<string, CustomTheme> = JSON.parse(stored);
    const theme = themes[name];

    if (theme) {
      applyThemeVariables(theme.variables);
      return theme;
    }
  } catch {
    // localStorage may be unavailable or data corrupted
  }

  return null;
}

/**
 * List all saved custom theme names.
 */
export function listCustomThemes(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const themes: Record<string, CustomTheme> = JSON.parse(stored);
    return Object.keys(themes);
  } catch {
    return [];
  }
}

/**
 * Delete a saved custom theme.
 */
export function deleteCustomTheme(name: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const themes: Record<string, CustomTheme> = JSON.parse(stored);
    delete themes[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // localStorage may be unavailable
  }
}

/* -- Export ---------------------------------------------------------------- */

/**
 * Export theme variables as a CSS string that can be pasted into tweakcn
 * or used in a stylesheet.
 *
 * @param themeVars - Theme variables to export
 * @param selector - CSS selector to wrap variables in (default: ':root')
 * @returns CSS string
 */
export function exportThemeAsCSS(
  themeVars: ThemeVariables,
  selector: string = ':root'
): string {
  const lines = Object.entries(themeVars)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n');

  return `${selector} {\n${lines}\n}`;
}
