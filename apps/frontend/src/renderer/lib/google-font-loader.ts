/**
 * Google Font Loader - Dynamic runtime loading of Google Fonts
 *
 * Utility to load Google Fonts at runtime for tweakcn theme compatibility.
 * Injects <link> tags and tracks loaded fonts to prevent duplicates.
 */

/* -- State ---------------------------------------------------------------- */

const loadedFonts = new Set<string>();

/* -- Helpers -------------------------------------------------------------- */

function buildGoogleFontsUrl(family: string, weights: number[] = [400, 500, 600, 700]): string {
  const weightParam = weights.join(';');
  const encodedFamily = encodeURIComponent(family);
  return `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weightParam}&display=swap`;
}

/* -- Public API ----------------------------------------------------------- */

/**
 * Load a Google Font by injecting a <link> tag into the document head.
 * Tracks loaded fonts to prevent duplicate <link> tags.
 *
 * @param family - The font family name (e.g., "Inter", "Roboto Mono")
 * @param weights - Array of font weights to load (default: [400, 500, 600, 700])
 * @returns Promise that resolves when the font stylesheet is loaded
 */
export function loadGoogleFont(family: string, weights?: number[]): Promise<void> {
  const key = `${family}:${(weights || [400, 500, 600, 700]).join(',')}`;

  if (loadedFonts.has(key)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = buildGoogleFontsUrl(family, weights);
    link.onload = () => {
      loadedFonts.add(key);
      resolve();
    };
    link.onerror = () => reject(new Error(`Failed to load font: ${family}`));
    document.head.appendChild(link);
  });
}

/**
 * Apply theme font families from a theme config.
 * Loads Google Fonts as needed and sets CSS custom properties.
 *
 * @param config - Object with optional sans, serif, mono font family strings
 */
export async function applyThemeFonts(config: {
  sans?: string;
  serif?: string;
  mono?: string;
}): Promise<void> {
  const root = document.documentElement;
  const loadPromises: Promise<void>[] = [];

  if (config.sans) {
    loadPromises.push(loadGoogleFont(config.sans));
    root.style.setProperty('--font-sans', `'${config.sans}', sans-serif`);
  }

  if (config.serif) {
    loadPromises.push(loadGoogleFont(config.serif));
    root.style.setProperty('--font-serif', `'${config.serif}', serif`);
  }

  if (config.mono) {
    loadPromises.push(loadGoogleFont(config.mono));
    root.style.setProperty('--font-mono', `'${config.mono}', monospace`);
  }

  await Promise.all(loadPromises);
}

/**
 * Check if a specific Google Font has already been loaded.
 */
export function isFontLoaded(family: string): boolean {
  return Array.from(loadedFonts).some((key) => key.startsWith(`${family}:`));
}
