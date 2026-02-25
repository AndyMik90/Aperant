/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for FontConfigPanel component
 * Tests font family selection, font size/weight/line height/letter spacing controls,
 * input validation, and user interactions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { FontConfigPanel } from '../FontConfigPanel';
import type { TerminalFontSettings } from '../../../../stores/terminal-font-settings-store';
import i18n from '../../../../../shared/i18n';

// Mock font-discovery module
vi.mock('../../../../lib/font-discovery', () => ({
  COMMON_MONOSPACE_FONTS: {
    windows: ['Consolas', 'Courier New'],
    macos: ['SF Mono', 'Menlo'],
    linux: ['Ubuntu Mono', 'Liberation Mono'],
    popular: ['Fira Code', 'JetBrains Mono'],
  },
}));

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('FontConfigPanel', () => {
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

  const mockOnSettingChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render all font configuration controls', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getAllByText(/font family/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/font size/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/font weight/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/line height/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/letter spacing/i).length).toBeGreaterThan(0);
    });

    it('should display current settings values', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      // Font size display
      expect(screen.getByText('13px')).toBeInTheDocument();

      // Line height display
      expect(screen.getByText('1.2')).toBeInTheDocument();

      // Letter spacing display (0 without + sign)
      expect(screen.getByText('0px')).toBeInTheDocument();
    });

    it('should display font chain', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText(/font chain/i)).toBeInTheDocument();
      expect(screen.getByText('Ubuntu Mono, monospace')).toBeInTheDocument();
    });
  });

  describe('Font Size Control', () => {
    it('should increase font size when + button is clicked', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const increaseButtons = screen.getAllByTitle(/increase font size/i);
      fireEvent.click(increaseButtons[0]);

      expect(mockOnSettingChange).toHaveBeenCalledWith('fontSize', 14);
    });

    it('should decrease font size when - button is clicked', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const decreaseButtons = screen.getAllByTitle(/decrease font size/i);
      fireEvent.click(decreaseButtons[0]);

      expect(mockOnSettingChange).toHaveBeenCalledWith('fontSize', 12);
    });

    it('should disable - button at minimum font size', () => {
      const minSettings = { ...mockSettings, fontSize: 10 };
      renderWithI18n(
        <FontConfigPanel
          settings={minSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const decreaseButtons = screen.getAllByTitle(/decrease font size/i);
      expect(decreaseButtons[0]).toBeDisabled();
    });

    it('should disable + button at maximum font size', () => {
      const maxSettings = { ...mockSettings, fontSize: 24 };
      renderWithI18n(
        <FontConfigPanel
          settings={maxSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const increaseButtons = screen.getAllByTitle(/increase font size/i);
      expect(increaseButtons[0]).toBeDisabled();
    });
  });

  describe('Font Weight Control', () => {
    it('should update font weight when input changes', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '600' } });

      expect(mockOnSettingChange).toHaveBeenCalledWith('fontWeight', 600);
    });

    it('should increase font weight when + button is clicked', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const increaseButtons = screen.getAllByTitle(/increase font weight/i);
      fireEvent.click(increaseButtons[0]);

      expect(mockOnSettingChange).toHaveBeenCalledWith('fontWeight', 500);
    });

    it('should decrease font weight when - button is clicked', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const decreaseButtons = screen.getAllByTitle(/decrease font weight/i);
      fireEvent.click(decreaseButtons[0]);

      expect(mockOnSettingChange).toHaveBeenCalledWith('fontWeight', 300);
    });

    it('should disable - button at minimum font weight', () => {
      const minSettings = { ...mockSettings, fontWeight: 100 };
      renderWithI18n(
        <FontConfigPanel
          settings={minSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const decreaseButtons = screen.getAllByTitle(/decrease font weight/i);
      expect(decreaseButtons[0]).toBeDisabled();
    });

    it('should disable + button at maximum font weight', () => {
      const maxSettings = { ...mockSettings, fontWeight: 900 };
      renderWithI18n(
        <FontConfigPanel
          settings={maxSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const increaseButtons = screen.getAllByTitle(/increase font weight/i);
      expect(increaseButtons[0]).toBeDisabled();
    });
  });

  describe('Line Height Control', () => {
    it('should have line height slider with ARIA attributes', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const slider = screen.getByRole('slider', { name: /line height/i });
      expect(slider).toBeInTheDocument();
    });

    it('should display line height value', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText('1.2')).toBeInTheDocument();
    });

    it('should display min/max labels', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText('1.0')).toBeInTheDocument();
      expect(screen.getByText('2.0')).toBeInTheDocument();
    });
  });

  describe('Letter Spacing Control', () => {
    it('should have letter spacing slider with ARIA attributes', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const slider = screen.getByRole('slider', { name: /letter spacing/i });
      expect(slider).toBeInTheDocument();
    });

    it('should display letter spacing with + sign for positive values', () => {
      const settings = { ...mockSettings, letterSpacing: 1.5 };
      renderWithI18n(
        <FontConfigPanel
          settings={settings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText('+1.5px')).toBeInTheDocument();
    });

    it('should display letter spacing without + sign for zero', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText('0px')).toBeInTheDocument();
    });

    it('should display min/max labels', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByText('-2px')).toBeInTheDocument();
      expect(screen.getByText('+5px')).toBeInTheDocument();
    });
  });

  describe('ARIA Attributes', () => {
    it('should have proper ARIA labels on sliders', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      expect(screen.getByRole('slider', { name: /font size/i })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: /line height/i })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: /letter spacing/i })).toBeInTheDocument();
    });

    it('should have ARIA value attributes on sliders', () => {
      renderWithI18n(
        <FontConfigPanel
          settings={mockSettings}
          onSettingChange={mockOnSettingChange}
        />
      );

      const fontSizeSlider = screen.getByRole('slider', { name: /font size/i });
      expect(fontSizeSlider).toHaveAttribute('aria-valuemin', '10');
      expect(fontSizeSlider).toHaveAttribute('aria-valuemax', '24');
      expect(fontSizeSlider).toHaveAttribute('aria-valuenow', '13');
    });
  });
});
