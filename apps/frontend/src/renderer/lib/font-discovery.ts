/**
 * Font discovery utility using the FontFaceSet API (document.fonts).
 * Provides functions to detect available monospace fonts and check font availability.
 */
import { getOS } from './os-detection';

/**
 * Common monospace font families organized by platform.
 * Used as fallback lists for OS-specific defaults.
 */
export const COMMON_MONOSPACE_FONTS = {
  windows: [
    'Cascadia Code',
    'Cascadia Mono',
    'Consolas',
    'Courier New',
    'Lucida Console',
    'monospace',
  ],
  macos: [
    'SF Mono',
    'Menlo',
    'Monaco',
    'Courier New',
    'monospace',
  ],
  linux: [
    'Ubuntu Mono',
    'Source Code Pro',
    'Liberation Mono',
    'DejaVu Sans Mono',
    'Courier New',
    'monospace',
  ],
  // Popular cross-platform coding fonts
  popular: [
    'JetBrains Mono',
    'Fira Code',
    'Fira Mono',
    'Roboto Mono',
    'Inconsolata',
    'Source Code Pro',
    'Anonymous Pro',
    'Ubuntu Mono',
    'Hack',
    'monospace',
  ],
} as const;

/**
 * Check if a specific font family is available and loaded.
 * Uses the FontFaceSet API to test font availability.
 * @param fontFamily The font family name to check
 * @param testString Optional test string (default: 'WWWWWWWWWW') - W is wide, good for monospace detection
 * @returns Promise<boolean> True if the font is available/loaded, false otherwise
 */
export async function isFontAvailable(
  fontFamily: string,
  testString: string = 'WWWWWWWWWW'
): Promise<boolean> {
  // Check if document.fonts API is available (should be in all modern browsers)
  if (typeof document === 'undefined' || !document.fonts) {
    // Fallback: assume font is available if we're in a browser environment
    return true;
  }

  try {
    // Use document.fonts.check() to test if the font is available
    // The check() method tests if a font is available for rendering
    const isAvailable = document.fonts.check(
      `16px "${fontFamily}"`,
      testString
    );

    return isAvailable;
  } catch (_error) {
    // If check() fails, conservatively assume font is not available
    return false;
  }
}

/**
 * Check if multiple fonts are available.
 * @param fontFamilies Array of font family names to check
 * @param testString Optional test string for font detection
 * @returns Promise<Record<string, boolean>> Map of font family names to availability
 */
export async function checkMultipleFonts(
  fontFamilies: string[],
  testString?: string
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  // Check all fonts in parallel for better performance
  await Promise.all(
    fontFamilies.map(async (fontFamily) => {
      results[fontFamily] = await isFontAvailable(fontFamily, testString);
    })
  );

  return results;
}

/**
 * Filter a list of fonts to only those that are available.
 * @param fontFamilies Array of font family names to filter
 * @param testString Optional test string for font detection
 * @returns Promise<string[]> Array of available font family names
 */
export async function getAvailableFonts(
  fontFamilies: string[],
  testString?: string
): Promise<string[]> {
  const availability = await checkMultipleFonts(fontFamilies, testString);

  return fontFamilies.filter((font) => availability[font]);
}

/**
 * Get a list of available monospace fonts from a predefined list.
 * Checks common monospace fonts across all platforms.
 * @param platform Optional platform hint ('windows' | 'macos' | 'linux' | 'all')
 * @returns Promise<string[]> Array of available monospace font family names
 */
export async function getAvailableMonospaceFonts(
  platform: 'windows' | 'macos' | 'linux' | 'all' = 'all'
): Promise<string[]> {
  let fontsToCheck: string[] = [];

  if (platform === 'all') {
    // Check all platform-specific and popular fonts
    fontsToCheck = [
      ...COMMON_MONOSPACE_FONTS.windows,
      ...COMMON_MONOSPACE_FONTS.macos,
      ...COMMON_MONOSPACE_FONTS.linux,
      ...COMMON_MONOSPACE_FONTS.popular,
    ];
    // Remove duplicates
    fontsToCheck = [...new Set(fontsToCheck)];
  } else {
    // Check platform-specific fonts plus popular ones
    fontsToCheck = [
      ...COMMON_MONOSPACE_FONTS[platform],
      ...COMMON_MONOSPACE_FONTS.popular,
    ];
    // Remove duplicates
    fontsToCheck = [...new Set(fontsToCheck)];
  }

  return getAvailableFonts(fontsToCheck);
}

/**
 * Wait for all fonts to be loaded.
 * Uses the document.fonts.ready promise which resolves when all fonts are loaded.
 * @returns Promise<void> Resolves when all fonts are loaded
 */
export function waitForFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    // If API not available, resolve immediately
    return Promise.resolve();
  }

  // Cast to Promise<void> since callers typically don't need the FontFaceSet
  return document.fonts.ready as unknown as Promise<void>;
}

/**
 * Load a specific font family and wait for it to be ready.
 * Note: This only works for fonts that are already defined in CSS @font-face.
 * To load custom fonts, you need to add them to the document first.
 * @param fontFamily The font family name to wait for
 * @param timeoutMs Optional timeout in milliseconds (default: 5000ms)
 * @returns Promise<boolean> True if font loaded successfully, false if timeout
 */
export async function waitForFontLoad(
  fontFamily: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) {
    return false;
  }

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });

    // Wait for fonts to be ready
    await Promise.race([document.fonts.ready, timeoutPromise]);

    // Check if the font is now available
    return await isFontAvailable(fontFamily);
  } catch (_error) {
    return false;
  }
}

/**
 * Get a font family string suitable for CSS font-family property.
 * Ensures proper fallback to monospace.
 * @param fontFamilies Array of font family names (ordered by preference)
 * @returns CSS font-family string with monospace fallback
 */
export function buildFontFamilyString(...fontFamilies: string[]): string {
  if (fontFamilies.length === 0) {
    return 'monospace';
  }

  // Remove duplicates while preserving order
  const uniqueFonts = [...new Set(fontFamilies)];

  // Ensure 'monospace' is at the end as the ultimate fallback
  const cleanedFonts = uniqueFonts.filter((f) => f.toLowerCase() !== 'monospace');
  cleanedFonts.push('monospace');

  // Build the font-family string, quoting fonts with spaces
  return cleanedFonts
    .map((font) => (font.includes(' ') ? `"${font}"` : font))
    .join(', ');
}

/**
 * Suggest a font family chain based on platform and availability.
 * Checks platform-specific fonts first, then falls back to popular monospace fonts.
 * @param platform Optional platform hint ('windows' | 'macos' | 'linux')
 * @returns Promise<string> CSS font-family string with available fonts
 */
export async function suggestOptimalFontChain(
  platform?: 'windows' | 'macos' | 'linux'
): Promise<string> {
  // Detect platform if not provided using centralized OS detection
  if (!platform) {
    const detectedOS = getOS();
    // Fall back to 'linux' for unknown platforms
    platform = detectedOS === 'unknown' ? 'linux' : detectedOS;
  }

  // Get available fonts for this platform
  const availableFonts = await getAvailableMonospaceFonts(platform);

  // Prioritize: platform-specific fonts first, then popular fonts
  const platformFonts = COMMON_MONOSPACE_FONTS[platform];
  const prioritizedFonts = [
    ...platformFonts.filter((f) => availableFonts.includes(f)),
    ...COMMON_MONOSPACE_FONTS.popular.filter((f) => availableFonts.includes(f)),
  ];

  return buildFontFamilyString(...prioritizedFonts);
}
