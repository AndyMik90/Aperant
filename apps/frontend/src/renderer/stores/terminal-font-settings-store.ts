import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isWindows, isMacOS, isLinux } from '../lib/os-detection';
import {
  isValidFontSize,
  isValidFontWeight,
  isValidLineHeight,
  isValidLetterSpacing,
  isValidScrollback,
  isValidCursorStyle,
  isValidHexColor,
  isValidFontFamily,
} from '../lib/terminal-font-constants';

/**
 * Terminal font settings interface
 */
export interface TerminalFontSettings {
  fontFamily: string[];
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  cursorAccentColor: string;
  scrollback: number;
}

/**
 * Get OS-specific default font settings
 */
function getOSDefaults(): TerminalFontSettings {
  if (isWindows()) {
    return {
      fontFamily: ['Cascadia Code', 'Consolas', 'Courier New', 'monospace'],
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      cursorAccentColor: '#000000',
      scrollback: 10000,
    };
  }

  if (isMacOS()) {
    return {
      fontFamily: ['SF Mono', 'Menlo', 'Monaco', 'monospace'],
      fontSize: 13,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      cursorAccentColor: '#000000',
      scrollback: 10000,
    };
  }

  if (isLinux()) {
    return {
      fontFamily: ['Ubuntu Mono', 'Source Code Pro', 'Liberation Mono', 'DejaVu Sans Mono', 'monospace'],
      fontSize: 13,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      cursorAccentColor: '#000000',
      scrollback: 10000,
    };
  }

  // Fallback for unknown platforms
  return {
    fontFamily: ['monospace'],
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#000000',
    scrollback: 10000,
  };
}

/**
 * Preset configurations for popular IDEs and terminals
 */
export const TERMINAL_PRESETS: Record<string, TerminalFontSettings> = {
  'vscode': {
    fontFamily: ['Consolas', 'Courier New', 'monospace'],
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#000000',
    scrollback: 10000,
  },
  'intellij': {
    fontFamily: ['JetBrains Mono', 'Consolas', 'monospace'],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#000000',
    scrollback: 10000,
  },
  'macos': {
    fontFamily: ['SF Mono', 'Menlo', 'Monaco', 'monospace'],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#000000',
    scrollback: 10000,
  },
  'ubuntu': {
    fontFamily: ['Ubuntu Mono', 'monospace'],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#ffffff',
    scrollback: 10000,
  },
};

interface TerminalFontSettingsStore extends TerminalFontSettings {
  // Actions
  setFontFamily: (fonts: string[]) => void;
  setFontSize: (size: number) => void;
  setFontWeight: (weight: number) => void;
  setLineHeight: (height: number) => void;
  setLetterSpacing: (spacing: number) => void;
  setCursorStyle: (style: 'block' | 'underline' | 'bar') => void;
  setCursorBlink: (blink: boolean) => void;
  setCursorAccentColor: (color: string) => void;
  setScrollback: (scrollback: number) => void;

  // Bulk actions
  applyPreset: (presetName: string) => boolean;
  resetToDefaults: () => void;
  applySettings: (settings: Partial<TerminalFontSettings>) => boolean;

  // Import/Export
  exportSettings: () => string;
  importSettings: (json: string) => boolean;
}

/**
 * Zustand store for terminal font settings with localStorage persistence
 */
export const useTerminalFontSettingsStore = create<TerminalFontSettingsStore>()(
  persist(
    (set, get) => ({
      // Initial state with OS-specific defaults
      ...getOSDefaults(),

      // Font setters with validation
      setFontFamily: (fontFamily) => {
        if (isValidFontFamily(fontFamily)) {
          set({ fontFamily });
        }
      },

      setFontSize: (fontSize) => {
        if (isValidFontSize(fontSize)) {
          set({ fontSize });
        }
      },

      setFontWeight: (fontWeight) => {
        if (isValidFontWeight(fontWeight)) {
          set({ fontWeight });
        }
      },

      setLineHeight: (lineHeight) => {
        if (isValidLineHeight(lineHeight)) {
          set({ lineHeight });
        }
      },

      setLetterSpacing: (letterSpacing) => {
        if (isValidLetterSpacing(letterSpacing)) {
          set({ letterSpacing });
        }
      },

      // Cursor setters with validation
      setCursorStyle: (cursorStyle) => {
        if (isValidCursorStyle(cursorStyle)) {
          set({ cursorStyle });
        }
      },

      setCursorBlink: (cursorBlink) => set({ cursorBlink }),

      setCursorAccentColor: (cursorAccentColor) => {
        if (isValidHexColor(cursorAccentColor)) {
          set({ cursorAccentColor });
        }
      },

      // Performance setter with validation
      setScrollback: (scrollback) => {
        if (isValidScrollback(scrollback)) {
          set({ scrollback });
        }
      },

      // Bulk actions with validation
      applyPreset: (presetName: string): boolean => {
        const preset = TERMINAL_PRESETS[presetName];
        if (preset) {
          set(preset);
          return true;
        }
        return false;
      },

      resetToDefaults: () => set(getOSDefaults()),

      applySettings: (settings: Partial<TerminalFontSettings>): boolean => {
        // Validate all provided settings before applying
        if (settings.fontFamily !== undefined && !isValidFontFamily(settings.fontFamily)) {
          return false;
        }
        if (settings.fontSize !== undefined && !isValidFontSize(settings.fontSize)) {
          return false;
        }
        if (settings.fontWeight !== undefined && !isValidFontWeight(settings.fontWeight)) {
          return false;
        }
        if (settings.lineHeight !== undefined && !isValidLineHeight(settings.lineHeight)) {
          return false;
        }
        if (settings.letterSpacing !== undefined && !isValidLetterSpacing(settings.letterSpacing)) {
          return false;
        }
        if (settings.scrollback !== undefined && !isValidScrollback(settings.scrollback)) {
          return false;
        }
        if (settings.cursorStyle !== undefined && !isValidCursorStyle(settings.cursorStyle)) {
          return false;
        }
        if (settings.cursorAccentColor !== undefined && !isValidHexColor(settings.cursorAccentColor)) {
          return false;
        }
        if (settings.cursorBlink !== undefined && typeof settings.cursorBlink !== 'boolean') {
          return false;
        }

        // All validations passed, apply the settings
        set((state) => ({
          ...state,
          ...settings,
        }));
        return true;
      },

      // Import/Export
      exportSettings: (): string => {
        const state = get();
        return JSON.stringify({
          fontFamily: state.fontFamily,
          fontSize: state.fontSize,
          fontWeight: state.fontWeight,
          lineHeight: state.lineHeight,
          letterSpacing: state.letterSpacing,
          cursorStyle: state.cursorStyle,
          cursorBlink: state.cursorBlink,
          cursorAccentColor: state.cursorAccentColor,
          scrollback: state.scrollback,
        }, null, 2);
      },

      importSettings: (json: string) => {
        try {
          const parsed = JSON.parse(json);

          // Validate parsed object is an object
          if (typeof parsed !== 'object' || parsed === null) {
            return false;
          }

          // Build a validated settings object
          const validatedSettings: Partial<TerminalFontSettings> = {};

          // Validate fontFamily array
          if (parsed.fontFamily !== undefined) {
            if (!isValidFontFamily(parsed.fontFamily)) {
              return false;
            }
            validatedSettings.fontFamily = parsed.fontFamily;
          }

          // Validate numeric ranges
          if (parsed.fontSize !== undefined) {
            if (typeof parsed.fontSize !== 'number' || !isValidFontSize(parsed.fontSize)) {
              return false;
            }
            validatedSettings.fontSize = parsed.fontSize;
          }

          if (parsed.fontWeight !== undefined) {
            if (typeof parsed.fontWeight !== 'number' || !isValidFontWeight(parsed.fontWeight)) {
              return false;
            }
            validatedSettings.fontWeight = parsed.fontWeight;
          }

          if (parsed.lineHeight !== undefined) {
            if (typeof parsed.lineHeight !== 'number' || !isValidLineHeight(parsed.lineHeight)) {
              return false;
            }
            validatedSettings.lineHeight = parsed.lineHeight;
          }

          if (parsed.letterSpacing !== undefined) {
            if (typeof parsed.letterSpacing !== 'number' || !isValidLetterSpacing(parsed.letterSpacing)) {
              return false;
            }
            validatedSettings.letterSpacing = parsed.letterSpacing;
          }

          if (parsed.scrollback !== undefined) {
            if (typeof parsed.scrollback !== 'number' || !isValidScrollback(parsed.scrollback)) {
              return false;
            }
            validatedSettings.scrollback = parsed.scrollback;
          }

          // Validate cursor style enum
          if (parsed.cursorStyle !== undefined) {
            if (!isValidCursorStyle(parsed.cursorStyle)) {
              return false;
            }
            validatedSettings.cursorStyle = parsed.cursorStyle;
          }

          // Validate boolean
          if (parsed.cursorBlink !== undefined) {
            if (typeof parsed.cursorBlink !== 'boolean') {
              return false;
            }
            validatedSettings.cursorBlink = parsed.cursorBlink;
          }

          // Validate hex color
          if (parsed.cursorAccentColor !== undefined) {
            if (typeof parsed.cursorAccentColor !== 'string' || !isValidHexColor(parsed.cursorAccentColor)) {
              return false;
            }
            validatedSettings.cursorAccentColor = parsed.cursorAccentColor;
          }

          // Apply imported settings (now properly typed)
          set(validatedSettings);
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'terminal-font-settings',
      onRehydrateStorage: () => (state) => {
        // Validate state after rehydration from localStorage
        if (!state) return;

        // Reset to OS defaults if any critical validation fails
        let needsReset = false;

        if (!isValidFontFamily(state.fontFamily)) {
          needsReset = true;
        }
        if (!isValidFontSize(state.fontSize)) {
          needsReset = true;
        }
        if (!isValidFontWeight(state.fontWeight)) {
          needsReset = true;
        }
        if (!isValidLineHeight(state.lineHeight)) {
          needsReset = true;
        }
        if (!isValidLetterSpacing(state.letterSpacing)) {
          needsReset = true;
        }
        if (!isValidScrollback(state.scrollback)) {
          needsReset = true;
        }
        if (!isValidCursorStyle(state.cursorStyle)) {
          needsReset = true;
        }
        if (!isValidHexColor(state.cursorAccentColor)) {
          needsReset = true;
        }
        if (typeof state.cursorBlink !== 'boolean') {
          needsReset = true;
        }

        // If any validation failed, reset to OS defaults
        if (needsReset) {
          const defaults = getOSDefaults();
          state.fontFamily = defaults.fontFamily;
          state.fontSize = defaults.fontSize;
          state.fontWeight = defaults.fontWeight;
          state.lineHeight = defaults.lineHeight;
          state.letterSpacing = defaults.letterSpacing;
          state.cursorStyle = defaults.cursorStyle;
          state.cursorBlink = defaults.cursorBlink;
          state.cursorAccentColor = defaults.cursorAccentColor;
          state.scrollback = defaults.scrollback;
        }
      },
    }
  )
);
