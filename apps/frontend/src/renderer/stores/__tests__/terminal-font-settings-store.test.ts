/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for terminal-font-settings-store
 * Tests store initialization, getters, setters, validation, preset application,
 * import/export, and OS-specific defaults
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock os-detection module
vi.mock('../../lib/os-detection', () => ({
  getOS: vi.fn(() => 'linux'),
  isWindows: vi.fn(() => false),
  isMacOS: vi.fn(() => false),
  isLinux: vi.fn(() => true),
}));

// Mock terminal-font-constants module
vi.mock('../../lib/terminal-font-constants', () => ({
  FONT_SIZE_MIN: 10,
  FONT_SIZE_MAX: 24,
  FONT_WEIGHT_MIN: 100,
  FONT_WEIGHT_MAX: 900,
  LINE_HEIGHT_MIN: 1.0,
  LINE_HEIGHT_MAX: 2.0,
  LETTER_SPACING_MIN: -2,
  LETTER_SPACING_MAX: 5,
  SCROLLBACK_MIN: 1000,
  SCROLLBACK_MAX: 100000,
  SCROLLBACK_STEP: 1000,
  MAX_IMPORT_FILE_SIZE: 10 * 1024,
  VALID_CURSOR_STYLES: ['block', 'underline', 'bar'],
  HEX_COLOR_REGEX: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
  isValidFontSize: vi.fn((value: number) => value >= 10 && value <= 24),
  isValidFontWeight: vi.fn((value: number) => value >= 100 && value <= 900 && value % 100 === 0),
  isValidLineHeight: vi.fn((value: number) => value >= 1.0 && value <= 2.0),
  isValidLetterSpacing: vi.fn((value: number) => value >= -2 && value <= 5),
  isValidScrollback: vi.fn((value: number) => value >= 1000 && value <= 100000),
  isValidCursorStyle: vi.fn((value: string) => ['block', 'underline', 'bar'].includes(value)),
  isValidHexColor: vi.fn((value: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)),
  isValidFontFamily: vi.fn((value: string[]) => Array.isArray(value) && value.length > 0),
}));

describe('terminal-font-settings-store', () => {
  let useTerminalFontSettingsStore: typeof import('../terminal-font-settings-store').useTerminalFontSettingsStore;
  let TERMINAL_PRESETS: typeof import('../terminal-font-settings-store').TERMINAL_PRESETS;
  let _getOS: typeof import('../../lib/os-detection').getOS;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-mock after reset to ensure fresh state
    const mockGetOS = vi.fn(() => 'linux');
    vi.doMock('../../lib/os-detection', () => ({
      getOS: mockGetOS,
      isWindows: vi.fn(() => false),
      isMacOS: vi.fn(() => false),
      isLinux: vi.fn(() => true),
    }));

    vi.doMock('../../lib/terminal-font-constants', () => ({
      FONT_SIZE_MIN: 10,
      FONT_SIZE_MAX: 24,
      FONT_WEIGHT_MIN: 100,
      FONT_WEIGHT_MAX: 900,
      LINE_HEIGHT_MIN: 1.0,
      LINE_HEIGHT_MAX: 2.0,
      LETTER_SPACING_MIN: -2,
      LETTER_SPACING_MAX: 5,
      SCROLLBACK_MIN: 1000,
      SCROLLBACK_MAX: 100000,
      SCROLLBACK_STEP: 1000,
      MAX_IMPORT_FILE_SIZE: 10 * 1024,
      VALID_CURSOR_STYLES: ['block', 'underline', 'bar'],
      HEX_COLOR_REGEX: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
      isValidFontSize: vi.fn((value: number) => value >= 10 && value <= 24),
      isValidFontWeight: vi.fn((value: number) => value >= 100 && value <= 900 && value % 100 === 0),
      isValidLineHeight: vi.fn((value: number) => value >= 1.0 && value <= 2.0),
      isValidLetterSpacing: vi.fn((value: number) => value >= -2 && value <= 5),
      isValidScrollback: vi.fn((value: number) => value >= 1000 && value <= 100000),
      isValidCursorStyle: vi.fn((value: string) => ['block', 'underline', 'bar'].includes(value)),
      isValidHexColor: vi.fn((value: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)),
      isValidFontFamily: vi.fn((value: string[]) => Array.isArray(value) && value.length > 0),
    }));

    // Import fresh module
    const storeModule = await import('../terminal-font-settings-store');
    useTerminalFontSettingsStore = storeModule.useTerminalFontSettingsStore;
    TERMINAL_PRESETS = storeModule.TERMINAL_PRESETS;
    _getOS = (await import('../../lib/os-detection')).getOS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Store initialization', () => {
    it('should initialize with OS-specific defaults', () => {
      const state = useTerminalFontSettingsStore.getState();

      expect(state).toBeDefined();
      expect(state.fontFamily).toEqual(['Ubuntu Mono', 'Source Code Pro', 'Liberation Mono', 'DejaVu Sans Mono', 'monospace']);
      expect(state.fontSize).toBe(13);
      expect(state.fontWeight).toBe(400);
      expect(state.lineHeight).toBe(1.2);
      expect(state.letterSpacing).toBe(0);
      expect(state.cursorStyle).toBe('block');
      expect(state.cursorBlink).toBe(true);
      expect(state.cursorAccentColor).toBe('#000000');
      expect(state.scrollback).toBe(10000);
    });

    it('should have all required properties', () => {
      const state = useTerminalFontSettingsStore.getState();

      expect(state.fontFamily).toBeDefined();
      expect(state.fontSize).toBeDefined();
      expect(state.fontWeight).toBeDefined();
      expect(state.lineHeight).toBeDefined();
      expect(state.letterSpacing).toBeDefined();
      expect(state.cursorStyle).toBeDefined();
      expect(state.cursorBlink).toBeDefined();
      expect(state.cursorAccentColor).toBeDefined();
      expect(state.scrollback).toBeDefined();
    });
  });

  describe('OS-specific defaults', () => {
    it('should initialize with Windows defaults', async () => {
      // Create a separate test context that mocks Windows
      vi.resetModules();
      vi.doMock('../../lib/os-detection', () => ({
        getOS: vi.fn(() => 'windows'),
        isWindows: vi.fn(() => true),
        isMacOS: vi.fn(() => false),
        isLinux: vi.fn(() => false),
      }));
      vi.doMock('../../lib/terminal-font-constants', () => ({
        FONT_SIZE_MIN: 10,
        FONT_SIZE_MAX: 24,
        FONT_WEIGHT_MIN: 100,
        FONT_WEIGHT_MAX: 900,
        LINE_HEIGHT_MIN: 1.0,
        LINE_HEIGHT_MAX: 2.0,
        LETTER_SPACING_MIN: -2,
        LETTER_SPACING_MAX: 5,
        SCROLLBACK_MIN: 1000,
        SCROLLBACK_MAX: 100000,
        SCROLLBACK_STEP: 1000,
        MAX_IMPORT_FILE_SIZE: 10 * 1024,
        VALID_CURSOR_STYLES: ['block', 'underline', 'bar'],
        HEX_COLOR_REGEX: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
        isValidFontSize: vi.fn((value: number) => value >= 10 && value <= 24),
        isValidFontWeight: vi.fn((value: number) => value >= 100 && value <= 900 && value % 100 === 0),
        isValidLineHeight: vi.fn((value: number) => value >= 1.0 && value <= 2.0),
        isValidLetterSpacing: vi.fn((value: number) => value >= -2 && value <= 5),
        isValidScrollback: vi.fn((value: number) => value >= 1000 && value <= 100000),
        isValidCursorStyle: vi.fn((value: string) => ['block', 'underline', 'bar'].includes(value)),
        isValidHexColor: vi.fn((value: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)),
        isValidFontFamily: vi.fn((value: string[]) => Array.isArray(value) && value.length > 0),
      }));

      const windowsStoreModule = await import('../terminal-font-settings-store');
      const windowsStore = windowsStoreModule.useTerminalFontSettingsStore.getState();

      expect(windowsStore.fontFamily).toEqual(['Cascadia Code', 'Consolas', 'Courier New', 'monospace']);
      expect(windowsStore.fontSize).toBe(14);
      expect(windowsStore.fontWeight).toBe(400);
    });

    it('should initialize with macOS defaults', async () => {
      // Create a separate test context that mocks macOS
      vi.resetModules();
      vi.doMock('../../lib/os-detection', () => ({
        getOS: vi.fn(() => 'macos'),
        isWindows: vi.fn(() => false),
        isMacOS: vi.fn(() => true),
        isLinux: vi.fn(() => false),
      }));
      vi.doMock('../../lib/terminal-font-constants', () => ({
        FONT_SIZE_MIN: 10,
        FONT_SIZE_MAX: 24,
        FONT_WEIGHT_MIN: 100,
        FONT_WEIGHT_MAX: 900,
        LINE_HEIGHT_MIN: 1.0,
        LINE_HEIGHT_MAX: 2.0,
        LETTER_SPACING_MIN: -2,
        LETTER_SPACING_MAX: 5,
        SCROLLBACK_MIN: 1000,
        SCROLLBACK_MAX: 100000,
        SCROLLBACK_STEP: 1000,
        MAX_IMPORT_FILE_SIZE: 10 * 1024,
        VALID_CURSOR_STYLES: ['block', 'underline', 'bar'],
        HEX_COLOR_REGEX: /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/,
        isValidFontSize: vi.fn((value: number) => value >= 10 && value <= 24),
        isValidFontWeight: vi.fn((value: number) => value >= 100 && value <= 900 && value % 100 === 0),
        isValidLineHeight: vi.fn((value: number) => value >= 1.0 && value <= 2.0),
        isValidLetterSpacing: vi.fn((value: number) => value >= -2 && value <= 5),
        isValidScrollback: vi.fn((value: number) => value >= 1000 && value <= 100000),
        isValidCursorStyle: vi.fn((value: string) => ['block', 'underline', 'bar'].includes(value)),
        isValidHexColor: vi.fn((value: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)),
        isValidFontFamily: vi.fn((value: string[]) => Array.isArray(value) && value.length > 0),
      }));

      const macStoreModule = await import('../terminal-font-settings-store');
      const macStore = macStoreModule.useTerminalFontSettingsStore.getState();

      expect(macStore.fontFamily).toEqual(['SF Mono', 'Menlo', 'Monaco', 'monospace']);
      expect(macStore.fontSize).toBe(13);
      expect(macStore.fontWeight).toBe(400);
    });

    it('should initialize with Linux defaults', () => {
      const state = useTerminalFontSettingsStore.getState();

      expect(state.fontFamily).toEqual(['Ubuntu Mono', 'Source Code Pro', 'Liberation Mono', 'DejaVu Sans Mono', 'monospace']);
      expect(state.fontSize).toBe(13);
      expect(state.fontWeight).toBe(400);
    });
  });

  describe('applySettings', () => {
    it('should update a single setting', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applySettings({ fontSize: 16 });

      expect(useTerminalFontSettingsStore.getState().fontSize).toBe(16);
    });

    it('should update multiple settings at once', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applySettings({
        fontSize: 18,
        fontWeight: 600,
        cursorStyle: 'underline',
      });

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontSize).toBe(18);
      expect(state.fontWeight).toBe(600);
      expect(state.cursorStyle).toBe('underline');
    });

    it('should preserve unspecified settings', () => {
      const store = useTerminalFontSettingsStore.getState();
      const originalFontFamily = store.fontFamily;

      store.applySettings({ fontSize: 20 });

      expect(useTerminalFontSettingsStore.getState().fontFamily).toEqual(originalFontFamily);
    });
  });

  describe('applyPreset', () => {
    it('should apply VS Code preset', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applyPreset('vscode');

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontFamily).toEqual(['Consolas', 'Courier New', 'monospace']);
      expect(state.fontSize).toBe(14);
      expect(state.cursorStyle).toBe('block');
    });

    it('should apply IntelliJ preset', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applyPreset('intellij');

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontFamily).toEqual(['JetBrains Mono', 'Consolas', 'monospace']);
      expect(state.fontSize).toBe(13);
      expect(state.cursorStyle).toBe('block');
    });

    it('should apply macOS Terminal preset', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applyPreset('macos');

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontFamily).toEqual(['SF Mono', 'Menlo', 'Monaco', 'monospace']);
      expect(state.fontSize).toBe(13);
      expect(state.cursorStyle).toBe('block');
    });

    it('should apply Ubuntu Terminal preset', () => {
      const store = useTerminalFontSettingsStore.getState();

      store.applyPreset('ubuntu');

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontFamily).toEqual(['Ubuntu Mono', 'monospace']);
      expect(state.fontSize).toBe(13);
      expect(state.cursorStyle).toBe('block');
    });

    it('should not apply invalid preset', () => {
      const store = useTerminalFontSettingsStore.getState();
      const originalState = { ...useTerminalFontSettingsStore.getState() };

      // Testing invalid preset (validation happens at runtime)
      store.applyPreset('invalid-preset');

      // State should remain unchanged
      const currentState = useTerminalFontSettingsStore.getState();
      expect(currentState.fontSize).toBe(originalState.fontSize);
      expect(currentState.fontFamily).toEqual(originalState.fontFamily);
    });
  });

  describe('resetToDefaults', () => {
    it('should reset to OS-specific defaults', () => {
      const store = useTerminalFontSettingsStore.getState();

      // Change some settings
      store.applySettings({
        fontSize: 20,
        fontWeight: 700,
        cursorStyle: 'bar',
      });

      // Reset
      store.resetToDefaults();

      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontSize).toBe(13); // Linux default
      expect(state.fontWeight).toBe(400);
      expect(state.cursorStyle).toBe('block');
    });
  });

  describe('exportSettings', () => {
    it('should export settings as JSON string', () => {
      const store = useTerminalFontSettingsStore.getState();
      store.applySettings({ fontSize: 18 });

      const exported = store.exportSettings();

      expect(typeof exported).toBe('string');
      const parsed = JSON.parse(exported);
      expect(parsed.fontSize).toBe(18);
    });

    it('should export all settings', () => {
      const exported = useTerminalFontSettingsStore.getState().exportSettings();
      const parsed = JSON.parse(exported);

      expect(parsed.fontFamily).toBeDefined();
      expect(parsed.fontSize).toBeDefined();
      expect(parsed.fontWeight).toBeDefined();
      expect(parsed.lineHeight).toBeDefined();
      expect(parsed.letterSpacing).toBeDefined();
      expect(parsed.cursorStyle).toBeDefined();
      expect(parsed.cursorBlink).toBeDefined();
      expect(parsed.cursorAccentColor).toBeDefined();
      expect(parsed.scrollback).toBeDefined();
    });
  });

  describe('importSettings', () => {
    it('should import valid settings', () => {
      const store = useTerminalFontSettingsStore.getState();
      const json = JSON.stringify({
        fontFamily: ['Fira Code', 'monospace'],
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: 0.5,
        cursorStyle: 'underline',
        cursorBlink: false,
        cursorAccentColor: '#ff0000',
        scrollback: 50000,
      });

      const success = store.importSettings(json);

      expect(success).toBe(true);
      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontSize).toBe(16);
      expect(state.fontFamily).toEqual(['Fira Code', 'monospace']);
    });

    it('should reject invalid JSON', () => {
      const store = useTerminalFontSettingsStore.getState();

      const success = store.importSettings('not valid json');

      expect(success).toBe(false);
    });

    it('should reject settings with out-of-range values', () => {
      const store = useTerminalFontSettingsStore.getState();
      const json = JSON.stringify({
        fontFamily: ['monospace'],
        fontSize: 999, // Invalid: > 24
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        cursorStyle: 'block',
        cursorBlink: true,
        cursorAccentColor: '#000000',
        scrollback: 10000,
      });

      const success = store.importSettings(json);

      expect(success).toBe(false);
    });

    it('should reject settings with invalid font family', () => {
      const store = useTerminalFontSettingsStore.getState();
      const json = JSON.stringify({
        fontFamily: [], // Invalid: empty array
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        cursorStyle: 'block',
        cursorBlink: true,
        cursorAccentColor: '#000000',
        scrollback: 10000,
      });

      const success = store.importSettings(json);

      expect(success).toBe(false);
    });

    it('should reject settings with invalid cursor style', () => {
      const store = useTerminalFontSettingsStore.getState();
      const json = JSON.stringify({
        fontFamily: ['monospace'],
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        cursorStyle: 'invalid', // Invalid cursor style
        cursorBlink: true,
        cursorAccentColor: '#000000',
        scrollback: 10000,
      });

      const success = store.importSettings(json);

      expect(success).toBe(false);
    });

    it('should reject non-object input', () => {
      const store = useTerminalFontSettingsStore.getState();

      const success = store.importSettings('null');

      expect(success).toBe(false);
    });
  });

  describe('TERMINAL_PRESETS', () => {
    it('should have all expected presets', () => {
      expect(TERMINAL_PRESETS.vscode).toBeDefined();
      expect(TERMINAL_PRESETS.intellij).toBeDefined();
      expect(TERMINAL_PRESETS.macos).toBeDefined();
      expect(TERMINAL_PRESETS.ubuntu).toBeDefined();
    });

    it('should have valid preset configurations', () => {
      const vsCodePreset = TERMINAL_PRESETS.vscode;

      expect(vsCodePreset.fontFamily).toBeDefined();
      expect(vsCodePreset.fontSize).toBeDefined();
      expect(vsCodePreset.fontWeight).toBeDefined();
      expect(vsCodePreset.lineHeight).toBeDefined();
      expect(vsCodePreset.letterSpacing).toBeDefined();
      expect(vsCodePreset.cursorStyle).toBeDefined();
      expect(vsCodePreset.cursorBlink).toBeDefined();
      expect(vsCodePreset.cursorAccentColor).toBeDefined();
      expect(vsCodePreset.scrollback).toBeDefined();
    });
  });
});
