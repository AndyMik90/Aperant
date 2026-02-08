/**
 * Theme Import/Save Utility - tweakcn.com theme compatibility
 *
 * Utilities for importing, applying, saving, loading, and exporting
 * custom themes. Works with raw CSS variable strings so any color format
 * (hex, HSL, OKLCH, RGB) is supported.
 */

import type { ColorThemeDefinition } from '../../shared/types/settings';

/* -- Types ---------------------------------------------------------------- */

/** Parsed theme variables as key-value pairs (variable name without --) */
export interface ThemeVariables {
  [key: string]: string;
}

/** Full theme config with metadata */
export interface CustomTheme {
  name: string;
  variables: ThemeVariables;
  darkVariables?: ThemeVariables;
  fonts?: {
    sans?: string;
    serif?: string;
    mono?: string;
  };
}

/* -- Storage Key ---------------------------------------------------------- */

const STORAGE_KEY = 'auto-claude-custom-themes';

/* -- Applied variable tracking -------------------------------------------- */

/** Tracks which CSS variables were applied by custom themes so they can be cleanly removed */
const appliedVariables = new Set<string>();

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

/**
 * Parse CSS with separate :root and .dark sections.
 * Falls back to flat parse (all variables as light) if no sections found.
 */
export function parseTweakcnCSSWithSections(cssString: string): {
  lightVariables: ThemeVariables;
  darkVariables: ThemeVariables;
} {
  const lightVariables: ThemeVariables = {};
  const darkVariables: ThemeVariables = {};

  // Extract :root { ... } block
  const rootMatch = cssString.match(/:root\s*\{([^}]*)\}/s);
  // Extract .dark { ... } block
  const darkMatch = cssString.match(/\.dark\s*\{([^}]*)\}/s);

  if (rootMatch) {
    Object.assign(lightVariables, parseTweakcnCSS(rootMatch[1]));
  }

  if (darkMatch) {
    Object.assign(darkVariables, parseTweakcnCSS(darkMatch[1]));
  }

  // If neither section was found, treat all variables as light (bare CSS)
  if (!rootMatch && !darkMatch) {
    Object.assign(lightVariables, parseTweakcnCSS(cssString));
  }

  return { lightVariables, darkVariables };
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

/**
 * Clear all CSS variables that were applied by custom themes.
 * Uses the tracked set of applied variable names.
 */
export function clearAllCustomVariables(): void {
  const root = document.documentElement;

  for (const key of appliedVariables) {
    root.style.removeProperty(`--${key}`);
  }
  appliedVariables.clear();
}

/**
 * Apply a saved custom theme by name. Clears previous custom overrides first,
 * then applies light variables, and overlays dark variables if dark mode is active.
 *
 * @param name - Theme name to apply
 * @param isDark - Whether dark mode is currently active
 */
export function applyCustomTheme(name: string, isDark: boolean): void {
  const theme = getCustomTheme(name);
  if (!theme) return;

  // Clear previous custom overrides
  clearAllCustomVariables();

  const root = document.documentElement;

  // Apply light variables first
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
    appliedVariables.add(key);
  }

  // Overlay dark variables if dark mode
  if (isDark && theme.darkVariables) {
    for (const [key, value] of Object.entries(theme.darkVariables)) {
      root.style.setProperty(`--${key}`, value);
      appliedVariables.add(key);
    }
  }

  // Apply font variables if present
  if (theme.fonts) {
    if (theme.fonts.sans) {
      root.style.setProperty('--font-sans', theme.fonts.sans);
      appliedVariables.add('font-sans');
    }
    if (theme.fonts.serif) {
      root.style.setProperty('--font-serif', theme.fonts.serif);
      appliedVariables.add('font-serif');
    }
    if (theme.fonts.mono) {
      root.style.setProperty('--font-mono', theme.fonts.mono);
      appliedVariables.add('font-mono');
    }
  }
}

/* -- Persistence ---------------------------------------------------------- */

/**
 * Save a custom theme to localStorage for persistence.
 *
 * @param name - Theme name identifier
 * @param themeVars - Light theme variables to save
 * @param fonts - Optional font configuration
 * @param darkVars - Optional dark mode variables
 */
export function saveCustomTheme(
  name: string,
  themeVars: ThemeVariables,
  fonts?: CustomTheme['fonts'],
  darkVars?: ThemeVariables
): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const themes: Record<string, CustomTheme> = stored ? JSON.parse(stored) : {};

    const theme: CustomTheme = { name, variables: themeVars, fonts };
    if (darkVars && Object.keys(darkVars).length > 0) {
      theme.darkVariables = darkVars;
    }
    themes[name] = theme;
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
 * Get a custom theme from localStorage without applying it.
 *
 * @param name - Theme name to retrieve
 * @returns The theme, or null if not found
 */
export function getCustomTheme(name: string): CustomTheme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const themes: Record<string, CustomTheme> = JSON.parse(stored);
    return themes[name] ?? null;
  } catch {
    return null;
  }
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

/* -- Preview / Definitions ------------------------------------------------ */

/**
 * Extract preview colors from a custom theme for swatch display.
 * Reads --background and --primary from light and dark variables.
 */
export function extractPreviewColors(theme: CustomTheme): {
  bg: string;
  accent: string;
  darkBg: string;
  darkAccent?: string;
} {
  const bg = theme.variables['background'] ?? '#f5f5f5';
  const accent = theme.variables['primary'] ?? '#666666';
  const darkVars = theme.darkVariables ?? theme.variables;
  const darkBg = darkVars['background'] ?? '#1a1a1a';
  const darkAccent = darkVars['primary'];

  return { bg, accent, darkBg, darkAccent };
}

/**
 * Get ColorThemeDefinition[] for all saved custom themes.
 * Used to merge custom themes into the theme selector grid.
 */
export function getAllCustomThemeDefinitions(): ColorThemeDefinition[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const themes: Record<string, CustomTheme> = JSON.parse(stored);
    return Object.values(themes).map((theme) => {
      const preview = extractPreviewColors(theme);
      return {
        id: `custom:${theme.name}` as ColorThemeDefinition['id'],
        name: theme.name,
        description: 'Custom imported theme',
        previewColors: preview,
        isCustom: true,
      };
    });
  } catch {
    return [];
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
