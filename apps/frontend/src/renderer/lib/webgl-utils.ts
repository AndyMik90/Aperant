/**
 * WebGL Utilities
 *
 * Feature detection and compatibility checks for WebGL rendering.
 * Inspired by Hyper's WebGL2 detection patterns.
 */

/**
 * Check if WebGL2 is supported in the current browser
 */
export function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * Check if WebGL (version 1) is supported
 */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * Check if the current browser is Safari
 * Note: Chrome's user agent also contains "Safari", so we need to exclude it
 */
export function isSafari(): boolean {
  try {
    const userAgent = navigator.userAgent.toLowerCase();
    // Safari includes "safari" but not "chrome" or "chromium"
    // Chrome/Chromium include both "safari" and "chrome"/"chromium"
    return (
      userAgent.includes('safari') &&
      !userAgent.includes('chrome') &&
      !userAgent.includes('chromium')
    );
  } catch {
    return false;
  }
}

/**
 * Get the maximum number of WebGL contexts supported by the browser
 * This is a conservative estimate - browsers typically support 8-16
 */
export function getMaxWebGLContexts(): number {
  // Conservative default
  let maxContexts = 8;

  try {
    // Try to detect browser
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('chrome') || userAgent.includes('chromium')) {
      // Chrome/Chromium typically supports 16
      maxContexts = 16;
    } else if (userAgent.includes('firefox')) {
      // Firefox typically supports 32
      maxContexts = 32;
    } else if (isSafari()) {
      // Safari is more conservative
      maxContexts = 8;
    }

    // For Electron, we can be a bit more generous
    if (userAgent.includes('electron')) {
      maxContexts = Math.min(maxContexts, 12); // Use 12 for safety
    }
  } catch {
    // Fallback to conservative default
  }

  return maxContexts;
}

/**
 * Check if terminal configuration is compatible with WebGL
 * Some features don't work well with WebGL rendering
 */
export function canUseWebGL(options: {
  transparency?: boolean;
  ligatures?: boolean;
}): boolean {
  // WebGL doesn't work well with transparency (Hyper finding)
  if (options.transparency) {
    return false;
  }

  // Ligatures can cause issues with WebGL in some terminals
  if (options.ligatures) {
    return false;
  }

  return supportsWebGL2() || supportsWebGL();
}

/**
 * Get WebGL info for debugging
 */
export function getWebGLInfo(): {
  webgl1Supported: boolean;
  webgl2Supported: boolean;
  maxContexts: number;
  renderer?: string;
  vendor?: string;
} {
  const info = {
    webgl1Supported: supportsWebGL(),
    webgl2Supported: supportsWebGL2(),
    maxContexts: getMaxWebGLContexts(),
    renderer: undefined as string | undefined,
    vendor: undefined as string | undefined,
  };

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        info.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        info.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      }
    }
  } catch {
    // Info not available
  }

  return info;
}

/**
 * Test WebGL context creation to verify it's working
 */
export function testWebGLContext(): {
  success: boolean;
  error?: string;
} {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!gl) {
      return {
        success: false,
        error: 'Failed to create WebGL context',
      };
    }

    // Try a simple render to verify it works
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
