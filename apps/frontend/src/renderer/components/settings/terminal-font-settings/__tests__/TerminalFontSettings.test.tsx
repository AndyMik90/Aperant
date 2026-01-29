/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for TerminalFontSettings component
 * Tests the infinite re-render loop fix using individual selectors + useMemo
 * Verifies component renders without errors and maintains stable object references
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { act } from 'react';
import { TerminalFontSettings } from '../TerminalFontSettings';
import { useTerminalFontSettingsStore } from '../../../../stores/terminal-font-settings-store';
import i18n from '../../../../../shared/i18n';

// Polyfill ResizeObserver for jsdom environment
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = ResizeObserverMock;

// Mock the toast hook
vi.mock('../../../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock xterm.js to prevent initialization errors in tests
// vi.mock calls are hoisted to the top, so we use function keyword
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function() {
    return {
      open: vi.fn(),
      write: vi.fn(),
      loadAddon: vi.fn(),
      options: {},
      refresh: vi.fn(),
      dispose: vi.fn(),
      rows: 24,
    };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function() {
    return {
      fit: vi.fn(),
    };
  }),
}));

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('TerminalFontSettings - Infinite Re-render Loop Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default state before each test
    const store = useTerminalFontSettingsStore.getState();
    store.resetToDefaults();
  });

  // Note: This fix addresses a React/Zustand selector issue that is platform-agnostic.
  // The bug occurred on all platforms, so platform-specific mocking is not required.

  describe('Component Rendering', () => {
    it('should render without throwing errors', () => {
      expect(() => {
        renderWithI18n(<TerminalFontSettings />);
      }).not.toThrow();
    });

    it('should render all expected sections', () => {
      renderWithI18n(<TerminalFontSettings />);

      // Main sections - use getAllByText for text that may appear multiple times
      expect(screen.getAllByText(/terminal fonts/i).length).toBeGreaterThan(0);

      // Import/Export buttons
      expect(screen.getAllByText(/export json/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/import json/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/copy to clipboard/i).length).toBeGreaterThan(0);

      // Configuration sections
      expect(screen.getAllByText(/font configuration/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/cursor configuration/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/performance settings/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/quick presets/i).length).toBeGreaterThan(0);

      // Preview section
      expect(screen.getAllByText(/live preview/i).length).toBeGreaterThan(0);
    });

    it('should complete render cycle without hanging', async () => {
      renderWithI18n(<TerminalFontSettings />);

      // Wait for component to fully render
      // The waitFor timeout provides the safety net for catching hangs/infinite loops
      await waitFor(
        () => {
          expect(screen.getByText(/terminal fonts/i)).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Store Integration', () => {
    it('should access all store properties without errors', () => {
      renderWithI18n(<TerminalFontSettings />);

      const state = useTerminalFontSettingsStore.getState();

      // Verify all properties are accessible
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

    it('should update store state when component is rendered', () => {
      renderWithI18n(<TerminalFontSettings />);

      // Update a single setting via store
      act(() => {
        useTerminalFontSettingsStore.getState().setFontSize(16);
      });

      // Verify store state updated
      expect(useTerminalFontSettingsStore.getState().fontSize).toBe(16);
    });
  });

  describe('State Updates - No Infinite Loop', () => {
    it('should handle rapid state changes without infinite loop', async () => {
      renderWithI18n(<TerminalFontSettings />);

      // Simulate rapid state changes (like dragging a slider)
      const sizes = [14, 15, 16, 17, 18, 17, 16, 15, 14];

      for (const size of sizes) {
        act(() => {
          useTerminalFontSettingsStore.getState().setFontSize(size);
        });
      }

      // If we reach here without timeout, the infinite loop is fixed
      expect(useTerminalFontSettingsStore.getState().fontSize).toBe(14);
    });

    it('should handle preset application without infinite loop', async () => {
      renderWithI18n(<TerminalFontSettings />);

      // Apply a preset (which updates multiple values at once)
      await act(async () => {
        useTerminalFontSettingsStore.getState().applyPreset('vscode');
      });

      // Verify preset was applied
      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontFamily).toContain('Consolas');
    });

    it('should handle reset to defaults without infinite loop', async () => {
      // Capture defaults before mutating
      const defaults = useTerminalFontSettingsStore.getState();
      const defaultFontSize = defaults.fontSize;
      const defaultFontWeight = defaults.fontWeight;
      const defaultFontFamily = defaults.fontFamily;
      const defaultLineHeight = defaults.lineHeight;

      // First change some settings
      act(() => {
        useTerminalFontSettingsStore.getState().setFontSize(20);
        useTerminalFontSettingsStore.getState().setFontWeight(700);
      });

      renderWithI18n(<TerminalFontSettings />);

      // Verify settings changed
      expect(useTerminalFontSettingsStore.getState().fontSize).toBe(20);

      // Get the OS-specific defaults to know what to expect
      const store = useTerminalFontSettingsStore.getState();

      // Reset to defaults - if there's an infinite loop, this will timeout
      await act(async () => {
        store.resetToDefaults();
      });

      // Verify reset restored default values
      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontSize).toBe(defaultFontSize);
      expect(state.fontWeight).toBe(defaultFontWeight);
      expect(state.fontFamily).toEqual(defaultFontFamily);
      expect(state.lineHeight).toBe(defaultLineHeight);
    });

    it('should handle concurrent updates without race conditions', async () => {
      renderWithI18n(<TerminalFontSettings />);

      // Simulate concurrent updates
      const promises = [
        Promise.resolve().then(() => act(() => useTerminalFontSettingsStore.getState().setFontSize(16))),
        Promise.resolve().then(() => act(() => useTerminalFontSettingsStore.getState().setFontWeight(500))),
        Promise.resolve().then(() => act(() => useTerminalFontSettingsStore.getState().setLineHeight(1.5))),
      ];

      await Promise.all(promises);

      // Verify final state is consistent
      const state = useTerminalFontSettingsStore.getState();
      expect(state.fontSize).toBe(16);
      expect(state.fontWeight).toBe(500);
      expect(state.lineHeight).toBe(1.5);
    });
  });

  describe('Import/Export Operations', () => {
    it('should export settings without errors', () => {
      renderWithI18n(<TerminalFontSettings />);

      const exported = useTerminalFontSettingsStore.getState().exportSettings();

      expect(exported).toBeTruthy();
      expect(typeof exported).toBe('string');

      // Verify it's valid JSON
      expect(() => JSON.parse(exported)).not.toThrow();

      const parsed = JSON.parse(exported);
      expect(parsed.fontFamily).toBeDefined();
      expect(parsed.fontSize).toBeDefined();
    });

    it('should import settings and update store state', () => {
      renderWithI18n(<TerminalFontSettings />);

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

      const success = useTerminalFontSettingsStore.getState().importSettings(json);

      expect(success).toBe(true);

      // Verify store state reflects imported settings
      expect(useTerminalFontSettingsStore.getState().fontSize).toBe(16);
      expect(useTerminalFontSettingsStore.getState().fontFamily).toEqual(['Fira Code', 'monospace']);
    });
  });

  describe('Child Component Integration', () => {
    it('should render FontConfigPanel with current settings', () => {
      renderWithI18n(<TerminalFontSettings />);

      // Verify FontConfigPanel renders
      expect(screen.getAllByText(/font size/i).length).toBeGreaterThan(0);

      // Verify the current font size value is accessible from store
      const fontSize = useTerminalFontSettingsStore.getState().fontSize;
      expect(fontSize).toBeGreaterThan(0);
      expect(fontSize).toBeLessThanOrEqual(24);
    });
  });

  describe('Regression Prevention', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should not log React warnings about getSnapshot caching', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      renderWithI18n(<TerminalFontSettings />);

      // Check for getSnapshot-related warnings
      const warnCalls = consoleWarnSpy.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('getSnapshot'))
      );

      expect(warnCalls.length).toBe(0);
    });

    it('should not cause "Maximum update depth exceeded" error', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderWithI18n(<TerminalFontSettings />);

      // Check for infinite loop errors
      const errorCalls = consoleErrorSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' &&
            (arg.includes('Maximum update depth') || arg.includes('infinite loop'))
        )
      );

      expect(errorCalls.length).toBe(0);
    });
  });

  describe('Memoization - Stable References', () => {
    it('should maintain stable component state across re-renders', () => {
      // This test verifies useMemo provides stable references
      // by checking that multiple re-renders don't break the component

      const { rerender } = renderWithI18n(<TerminalFontSettings />);

      // Rerender multiple times without state changes
      // If useMemo wasn't working correctly, this might cause issues
      for (let i = 0; i < 5; i++) {
        act(() => {
          rerender(<I18nextProvider i18n={i18n}><TerminalFontSettings /></I18nextProvider>);
        });
      }

      // Verify component still renders correctly after multiple re-renders
      expect(screen.getAllByText(/terminal fonts/i).length).toBeGreaterThan(0);
    });
  });
});
