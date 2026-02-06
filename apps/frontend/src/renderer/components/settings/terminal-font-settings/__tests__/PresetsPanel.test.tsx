/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for PresetsPanel component
 * Tests built-in preset application, reset to defaults, custom preset management
 * (save, apply, delete), and localStorage persistence
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { PresetsPanel } from '../PresetsPanel';
import type { TerminalFontSettings } from '../../../../stores/terminal-font-settings-store';
import i18n from '../../../../../shared/i18n';

// Mock os-detection module
vi.mock('../../../../lib/os-detection', () => ({
  getOS: vi.fn(() => 'linux'),
}));

// Mock terminal-font-settings-store
vi.mock('../../../../stores/terminal-font-settings-store', () => ({
  useTerminalFontSettingsStore: vi.fn((selector) => {
    const state = {
      applySettings: vi.fn(),
      resetToDefaults: vi.fn(),
    };
    if (typeof selector === 'function') {
      return selector(state);
    }
    return state;
  }),
  TERMINAL_PRESETS: {
    vscode: {
      fontFamily: ['Consolas', 'monospace'],
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block' as const,
      cursorBlink: true,
      cursorAccentColor: '#000000',
      scrollback: 10000,
    },
  },
}));

// Mock use-toast
vi.mock('../../../../hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('PresetsPanel', () => {
  const mockSettings: TerminalFontSettings = {
    fontFamily: ['Ubuntu Mono', 'monospace'],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    cursorAccentColor: '#000000',
    scrollback: 10000,
  };

  const mockOnPresetApply = vi.fn();
  const mockOnReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  describe('Rendering', () => {
    it('should render all preset sections', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      expect(screen.getByText(/built-in presets/i)).toBeInTheDocument();
      expect(screen.getByText(/reset to defaults/i)).toBeInTheDocument();
      // Use getAllByText since "custom presets" appears in both label and description
      expect(screen.getAllByText(/custom presets/i).length).toBeGreaterThan(0);
    });

    it('should render all built-in preset buttons', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      expect(screen.getByText('VS Code')).toBeInTheDocument();
      expect(screen.getByText('IntelliJ IDEA')).toBeInTheDocument();
      expect(screen.getByText('macOS Terminal')).toBeInTheDocument();
      expect(screen.getByText('Ubuntu Terminal')).toBeInTheDocument();
    });

    it('should show empty state for custom presets', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      // Check for the empty state message
      expect(screen.getByText(/no custom presets yet/i)).toBeInTheDocument();
    });
  });

  describe('Built-in Preset Application', () => {
    it('should call onPresetApply with VS Code preset ID', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const vscodeButton = screen.getByText('VS Code').closest('button');
      fireEvent.click(vscodeButton!);

      expect(mockOnPresetApply).toHaveBeenCalledWith('vscode');
    });

    it('should call onPresetApply with IntelliJ preset ID', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const intellijButton = screen.getByText('IntelliJ IDEA').closest('button');
      fireEvent.click(intellijButton!);

      expect(mockOnPresetApply).toHaveBeenCalledWith('intellij');
    });

    it('should call onPresetApply with macOS preset ID', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const macosButton = screen.getByText('macOS Terminal').closest('button');
      fireEvent.click(macosButton!);

      expect(mockOnPresetApply).toHaveBeenCalledWith('macos');
    });

    it('should call onPresetApply with Ubuntu preset ID', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const ubuntuButton = screen.getByText('Ubuntu Terminal').closest('button');
      fireEvent.click(ubuntuButton!);

      expect(mockOnPresetApply).toHaveBeenCalledWith('ubuntu');
    });
  });

  describe('Reset to Defaults', () => {
    it('should call onReset when reset button is clicked', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const resetButton = screen.getByText(/reset to os default/i);
      fireEvent.click(resetButton);

      expect(mockOnReset).toHaveBeenCalled();
    });
  });

  describe('Custom Preset Management', () => {
    it('should save a new custom preset', async () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const input = screen.getByPlaceholderText(/preset name/i);
      fireEvent.change(input, { target: { value: 'My Custom Preset' } });

      // Use getAllByText and find the button element since "Save" appears in multiple places
      const saveButtons = screen.getAllByText(/save/i);
      const saveButton = saveButtons.find(btn => btn.tagName === 'SPAN' && btn.parentElement?.tagName === 'BUTTON');
      expect(saveButton).toBeDefined();
      const buttonElement = saveButton?.closest('button');
      expect(buttonElement).toBeDefined();
      fireEvent.click(buttonElement as HTMLButtonElement);

      await waitFor(() => {
        expect(screen.getByText('My Custom Preset')).toBeInTheDocument();
      });
    });

    it('should save preset on Enter key press', async () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const input = screen.getByPlaceholderText(/preset name/i);
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      // After Enter without typing, nothing should happen
      // Let's type and then press Enter
      fireEvent.change(input, { target: { value: 'Test Preset' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(screen.getByText('Test Preset')).toBeInTheDocument();
      });
    });

    it('should show empty state when no custom presets exist', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      expect(screen.getByText(/no custom presets yet/i)).toBeInTheDocument();
    });

    it('should hide empty state when custom presets exist', async () => {
      // Pre-populate localStorage
      const preset = {
        id: 'custom-123',
        name: 'Existing Preset',
        settings: mockSettings,
        createdAt: Date.now(),
      };
      localStorage.setItem('terminal-font-custom-presets', JSON.stringify([preset]));

      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      expect(screen.queryByText(/no custom presets yet/i)).not.toBeInTheDocument();
      expect(screen.getByText('Existing Preset')).toBeInTheDocument();
    });
  });

  describe('Preset Display', () => {
    it('should display preset details correctly', async () => {
      const settings: TerminalFontSettings = {
        ...mockSettings,
        fontFamily: ['Fira Code', 'monospace'],
        fontSize: 16,
        cursorStyle: 'underline',
      };

      // Pre-populate localStorage
      const preset = {
        id: 'custom-123',
        name: 'Dev Setup',
        settings,
        createdAt: Date.now(),
      };
      localStorage.setItem('terminal-font-custom-presets', JSON.stringify([preset]));

      renderWithI18n(
        <PresetsPanel
          currentSettings={settings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      // Should show font name, size, and cursor style
      expect(screen.getByText(/Fira Code, 16px, underline cursor/i)).toBeInTheDocument();
    });

    it('should display apply and delete buttons for each custom preset', async () => {
      // Pre-populate localStorage
      const preset = {
        id: 'custom-123',
        name: 'Test Preset',
        settings: mockSettings,
        createdAt: Date.now(),
      };
      localStorage.setItem('terminal-font-custom-presets', JSON.stringify([preset]));

      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      expect(screen.getByText('Apply')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('Input Validation', () => {
    it('should disable save button when input is empty', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      // Use getAllByText and find the button element since "Save" appears in multiple places
      const saveButtons = screen.getAllByText(/save/i);
      const saveButton = saveButtons.find(btn => btn.tagName === 'SPAN' && btn.parentElement?.tagName === 'BUTTON');
      expect(saveButton?.closest('button')).toBeDisabled();
    });

    it('should enable save button when input has text', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const input = screen.getByPlaceholderText(/preset name/i);
      fireEvent.change(input, { target: { value: 'Test' } });

      // Use getAllByText and find the button element since "Save" appears in multiple places
      const saveButtons = screen.getAllByText(/save/i);
      const saveButton = saveButtons.find(btn => btn.tagName === 'SPAN' && btn.parentElement?.tagName === 'BUTTON');
      expect(saveButton?.closest('button')).not.toBeDisabled();
    });
  });

  describe('ARIA Attributes', () => {
    it('should have proper labels on built-in preset buttons', () => {
      renderWithI18n(
        <PresetsPanel
          currentSettings={mockSettings}
          onPresetApply={mockOnPresetApply}
          onReset={mockOnReset}
        />
      );

      const vscodeButton = screen.getByText('VS Code').closest('button');
      expect(vscodeButton).toHaveAttribute('title');
    });
  });
});
