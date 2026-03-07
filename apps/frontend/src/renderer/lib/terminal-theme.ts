/**
 * Default terminal color theme for xterm.js
 *
 * This theme is used consistently across:
 * - useXterm.ts (actual agent terminals)
 * - LivePreviewTerminal.tsx (settings preview terminal)
 *
 * The theme uses a dark color scheme with muted pastel colors
 * that match the Auto Claude application design.
 */
export const DEFAULT_TERMINAL_THEME = {
  background: '#0B0B0F',
  foreground: '#E8E6E3',
  cursor: '#D6D876',
  selectionBackground: '#D6D87640',
  selectionForeground: '#E8E6E3',
  black: '#1A1A1F',
  red: '#FF6B6B',
  green: '#87D687',
  yellow: '#D6D876',
  blue: '#6BB3FF',
  magenta: '#C792EA',
  cyan: '#89DDFF',
  white: '#E8E6E3',
  brightBlack: '#4A4A50',
  brightRed: '#FF8A8A',
  brightGreen: '#A5E6A5',
  brightYellow: '#E8E87A',
  brightBlue: '#8AC4FF',
  brightMagenta: '#DEB3FF',
  brightCyan: '#A6E8FF',
  brightWhite: '#FFFFFF',
} as const;

/**
 * Type for terminal theme with optional cursorAccent override
 */
export type TerminalTheme = typeof DEFAULT_TERMINAL_THEME & {
  cursorAccent?: string;
};
