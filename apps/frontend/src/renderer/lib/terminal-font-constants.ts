/**
 * Constants for terminal font settings validation and constraints
 * Used in both UI components and store validation
 */

// Font size constraints
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_STEP = 1;

// Font weight constraints
export const FONT_WEIGHT_MIN = 100;
export const FONT_WEIGHT_MAX = 900;
export const FONT_WEIGHT_STEP = 100;

// Line height constraints
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_STEP = 0.1;

// Letter spacing constraints
export const LETTER_SPACING_MIN = -2;
export const LETTER_SPACING_MAX = 5;
export const LETTER_SPACING_STEP = 0.5;

// Scrollback constraints
export const SCROLLBACK_MIN = 1000;
export const SCROLLBACK_MAX = 100000;
export const SCROLLBACK_STEP = 1000;

// Maximum font array length to prevent DoS
export const MAX_FONT_FAMILY_LENGTH = 10;

// Maximum file size for import (10KB)
export const MAX_IMPORT_FILE_SIZE = 10 * 1024;

// Valid cursor styles
export const VALID_CURSOR_STYLES = ['block', 'underline', 'bar'] as const;
export type CursorStyle = typeof VALID_CURSOR_STYLES[number];

// Hex color regex (3-digit, 6-digit, or 8-digit)
export const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

/**
 * Shared Tailwind CSS classes for range input sliders
 * Custom styling for webkit (Chrome, Safari, Edge) and Firefox thumb controls
 */
export const SLIDER_INPUT_CLASSES = [
  'w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  // Webkit (Chrome, Safari, Edge)
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:w-4',
  '[&::-webkit-slider-thumb]:h-4',
  '[&::-webkit-slider-thumb]:rounded-full',
  '[&::-webkit-slider-thumb]:bg-primary',
  '[&::-webkit-slider-thumb]:cursor-pointer',
  '[&::-webkit-slider-thumb]:transition-all',
  '[&::-webkit-slider-thumb]:hover:scale-110',
  // Firefox
  '[&::-moz-range-thumb]:w-4',
  '[&::-moz-range-thumb]:h-4',
  '[&::-moz-range-thumb]:rounded-full',
  '[&::-moz-range-thumb]:bg-primary',
  '[&::-moz-range-thumb]:border-0',
  '[&::-moz-range-thumb]:cursor-pointer',
  '[&::-moz-range-thumb]:transition-all',
  '[&::-moz-range-thumb]:hover:scale-110',
] as const;

/**
 * Validates a font size value is within bounds
 */
export function isValidFontSize(value: number): boolean {
  return value >= FONT_SIZE_MIN && value <= FONT_SIZE_MAX;
}

/**
 * Validates a font weight value is within bounds and is a multiple of 100
 * CSS font-weight only accepts 100, 200, 300... 900
 */
export function isValidFontWeight(value: number): boolean {
  return (
    value >= FONT_WEIGHT_MIN &&
    value <= FONT_WEIGHT_MAX &&
    value % FONT_WEIGHT_STEP === 0
  );
}

/**
 * Validates a line height value is within bounds
 */
export function isValidLineHeight(value: number): boolean {
  return value >= LINE_HEIGHT_MIN && value <= LINE_HEIGHT_MAX;
}

/**
 * Validates a letter spacing value is within bounds
 */
export function isValidLetterSpacing(value: number): boolean {
  return value >= LETTER_SPACING_MIN && value <= LETTER_SPACING_MAX;
}

/**
 * Validates a scrollback value is within bounds
 */
export function isValidScrollback(value: number): boolean {
  return value >= SCROLLBACK_MIN && value <= SCROLLBACK_MAX;
}

/**
 * Validates a cursor style is one of the valid options
 */
export function isValidCursorStyle(value: string): value is CursorStyle {
  return VALID_CURSOR_STYLES.includes(value as CursorStyle);
}

/**
 * Validates a hex color string
 */
export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

/**
 * Validates font family array
 */
export function isValidFontFamily(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_FONT_FAMILY_LENGTH &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}
