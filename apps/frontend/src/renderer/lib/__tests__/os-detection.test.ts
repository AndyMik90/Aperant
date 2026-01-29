/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for os-detection utility
 * Tests OS detection functions for Windows, macOS, and Linux
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('os-detection', () => {
  let getOS: typeof import('../os-detection').getOS;
  let isWindows: typeof import('../os-detection').isWindows;
  let isMacOS: typeof import('../os-detection').isMacOS;
  let isLinux: typeof import('../os-detection').isLinux;

  const originalPlatform = navigator.platform;
  const originalUserAgentData = (navigator as any).userAgentData;

  beforeEach(async () => {
    vi.resetModules();

    // Import fresh module
    const osModule = await import('../os-detection');
    getOS = osModule.getOS;
    isWindows = osModule.isWindows;
    isMacOS = osModule.isMacOS;
    isLinux = osModule.isLinux;
  });

  afterEach(() => {
    // Restore original navigator.platform
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });

    // Restore original navigator.userAgentData
    if (originalUserAgentData) {
      Object.defineProperty(navigator, 'userAgentData', {
        value: originalUserAgentData,
        configurable: true,
      });
    } else {
      delete (navigator as any).userAgentData;
    }
  });

  const mockPlatform = (platform: string) => {
    // Mock navigator.userAgentData.platform (modern API)
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform },
      configurable: true,
      writable: true,
    });

    // Also mock navigator.platform (fallback API)
    Object.defineProperty(navigator, 'platform', {
      value: platform,
      configurable: true,
      writable: true,
    });
  };

  describe('getOS', () => {
    it('should return "windows" on Windows platform', () => {
      mockPlatform('Win32');

      expect(getOS()).toBe('windows');
    });

    it('should return "macos" on macOS platform', () => {
      mockPlatform('MacIntel');

      expect(getOS()).toBe('macos');
    });

    it('should return "linux" on Linux platform', () => {
      mockPlatform('Linux x86_64');

      expect(getOS()).toBe('linux');
    });

    it('should return "unknown" for unknown platforms', () => {
      mockPlatform('FreeBSD amd64');

      expect(getOS()).toBe('unknown');
    });
  });

  describe('isWindows', () => {
    it('should return true on Windows platform', () => {
      mockPlatform('Win32');

      expect(isWindows()).toBe(true);
    });

    it('should return false on macOS platform', () => {
      mockPlatform('MacIntel');

      expect(isWindows()).toBe(false);
    });

    it('should return false on Linux platform', () => {
      mockPlatform('Linux x86_64');

      expect(isWindows()).toBe(false);
    });
  });

  describe('isMacOS', () => {
    it('should return false on Windows platform', () => {
      mockPlatform('Win32');

      expect(isMacOS()).toBe(false);
    });

    it('should return true on macOS platform', () => {
      mockPlatform('MacIntel');

      expect(isMacOS()).toBe(true);
    });

    it('should return false on Linux platform', () => {
      mockPlatform('Linux x86_64');

      expect(isMacOS()).toBe(false);
    });
  });

  describe('isLinux', () => {
    it('should return false on Windows platform', () => {
      mockPlatform('Win32');

      expect(isLinux()).toBe(false);
    });

    it('should return false on macOS platform', () => {
      mockPlatform('MacIntel');

      expect(isLinux()).toBe(false);
    });

    it('should return true on Linux platform', () => {
      mockPlatform('Linux x86_64');

      expect(isLinux()).toBe(true);
    });
  });

  describe('OS detection consistency', () => {
    it('should only return true for one OS function at a time', () => {
      const platforms = ['Win32', 'MacIntel', 'Linux x86_64'] as const;

      for (const platform of platforms) {
        mockPlatform(platform);

        const results = [isWindows(), isMacOS(), isLinux()].filter(Boolean);
        expect(results.length).toBe(1);
      }
    });
  });
});
