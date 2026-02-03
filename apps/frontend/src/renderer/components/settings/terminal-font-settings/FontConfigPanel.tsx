import { useState, useEffect, useMemo } from 'react';
import { Type, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { Label } from '../../ui/label';
import { Combobox, ComboboxOption } from '../../ui/combobox';
import type { TerminalFontSettings } from '../../../stores/terminal-font-settings-store';
import { COMMON_MONOSPACE_FONTS } from '../../../lib/font-discovery';
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_STEP,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_STEP,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_STEP,
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  LETTER_SPACING_STEP,
  SLIDER_INPUT_CLASSES,
} from '../../../lib/terminal-font-constants';

interface FontConfigPanelProps {
  settings: TerminalFontSettings;
  onSettingChange: <K extends keyof TerminalFontSettings>(
    key: K,
    value: TerminalFontSettings[K]
  ) => void;
}

/**
 * Font configuration panel for terminal font customization.
 * Provides controls for:
 * - Font family (combobox with common monospace fonts)
 * - Font size (slider: 10-24px)
 * - Font weight (number input: 100-900)
 * - Line height (slider: 1.0-2.0)
 * - Letter spacing (slider: -2 to 5px)
 *
 * All changes apply immediately and persist via the parent store
 */
export function FontConfigPanel({ settings, onSettingChange }: FontConfigPanelProps) {
  const { t, i18n } = useTranslation('settings');

  // Locale-aware number formatter for decimals
  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  }, [i18n.language]);

  // State for available fonts (will be populated from font-discovery)
  const [availableFonts, setAvailableFonts] = useState<ComboboxOption[]>([]);

  // Load available fonts on mount
  useEffect(() => {
    // Combine all common monospace fonts
    const allFonts = [
      ...COMMON_MONOSPACE_FONTS.windows,
      ...COMMON_MONOSPACE_FONTS.macos,
      ...COMMON_MONOSPACE_FONTS.linux,
      ...COMMON_MONOSPACE_FONTS.popular,
    ];

    // Remove duplicates and filter out 'monospace' generic
    const uniqueFonts = [...new Set(allFonts)].filter((f) => f.toLowerCase() !== 'monospace');

    // Convert to Combobox options
    const fontOptions: ComboboxOption[] = uniqueFonts.map((font) => ({
      value: font,
      label: font,
    }));

    setAvailableFonts(fontOptions);
  }, []);

  // Current font family (primary font from the array)
  const currentFontFamily = settings.fontFamily[0] || '';

  // Handle font family change
  const handleFontFamilyChange = (fontFamily: string) => {
    // Replace the entire font chain with the selected font as primary
    // Keep 'monospace' as ultimate fallback
    const newFontChain = [fontFamily, 'monospace'];
    onSettingChange('fontFamily', newFontChain);
  };

  // Handle font size change
  const handleFontSizeChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clampedValue = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, value));
    onSettingChange('fontSize', clampedValue);
  };

  // Handle font weight change
  const handleFontWeightChange = (value: string) => {
    const numValue = parseInt(value, 10);
    if (Number.isNaN(numValue)) return;

    // Clamp to valid font weights (100-900, step of 100)
    const clampedValue = Math.max(FONT_WEIGHT_MIN, Math.min(FONT_WEIGHT_MAX, numValue));
    const steppedValue = Math.round(clampedValue / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP;

    onSettingChange('fontWeight', steppedValue);
  };

  // Handle line height change
  const handleLineHeightChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clampedValue = Math.max(LINE_HEIGHT_MIN, Math.min(LINE_HEIGHT_MAX, value));
    // Round to 1 decimal place
    const roundedValue = Math.round(clampedValue * 10) / 10;
    onSettingChange('lineHeight', roundedValue);
  };

  // Handle letter spacing change
  const handleLetterSpacingChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clampedValue = Math.max(LETTER_SPACING_MIN, Math.min(LETTER_SPACING_MAX, value));
    // Round to 1 decimal place
    const roundedValue = Math.round(clampedValue * 10) / 10;
    onSettingChange('letterSpacing', roundedValue);
  };

  return (
    <div className="space-y-6">
      {/* Font Family */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Type className="h-4 w-4" />
          {t('terminalFonts.fontConfig.fontFamily', { defaultValue: 'Font Family' })}
        </Label>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.fontConfig.fontFamilyDescription', {
            defaultValue: 'Primary monospace font for terminal text',
          })}
        </p>
        <div className="max-w-md">
          <Combobox
            value={currentFontFamily}
            onValueChange={handleFontFamilyChange}
            options={availableFonts}
            placeholder={t('terminalFonts.fontConfig.selectFont', { defaultValue: 'Select a font...' })}
            searchPlaceholder={t('terminalFonts.fontConfig.searchFont', { defaultValue: 'Search fonts...' })}
            emptyMessage={t('terminalFonts.fontConfig.noFonts', { defaultValue: 'No fonts found' })}
          />
        </div>
        {/* Current font chain display */}
        <div className="text-xs text-muted-foreground">
          {t('terminalFonts.fontConfig.fontChain', { defaultValue: 'Font chain:' })}{' '}
          <code className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {settings.fontFamily.join(', ')}
          </code>
        </div>
      </div>

      {/* Font Size */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">
            {t('terminalFonts.fontConfig.fontSize', { defaultValue: 'Font Size' })}
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">
              {settings.fontSize}px
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleFontSizeChange(settings.fontSize - FONT_SIZE_STEP)}
                disabled={settings.fontSize <= FONT_SIZE_MIN}
                className={cn(
                  'p-1 rounded-md transition-colors',
                  'hover:bg-accent text-muted-foreground hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                )}
                title={t('terminalFonts.fontConfig.decreaseFontSize', { step: FONT_SIZE_STEP })}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleFontSizeChange(settings.fontSize + FONT_SIZE_STEP)}
                disabled={settings.fontSize >= FONT_SIZE_MAX}
                className={cn(
                  'p-1 rounded-md transition-colors',
                  'hover:bg-accent text-muted-foreground hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                )}
                title={t('terminalFonts.fontConfig.increaseFontSize', { step: FONT_SIZE_STEP })}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.fontConfig.fontSizeDescription', {
            defaultValue: 'Base font size in pixels (10-24px)',
          })}
        </p>
        <input
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={FONT_SIZE_STEP}
          value={settings.fontSize}
          onChange={(e) => handleFontSizeChange(parseInt(e.target.value, 10))}
          aria-label={t('terminalFonts.fontConfig.fontSize', { defaultValue: 'Font Size' })}
          aria-valuemin={FONT_SIZE_MIN}
          aria-valuemax={FONT_SIZE_MAX}
          aria-valuenow={settings.fontSize}
          aria-valuetext={`${settings.fontSize} ${t('terminalFonts.fontConfig.pixels', { defaultValue: 'pixels' })}`}
          className={cn(...SLIDER_INPUT_CLASSES)}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{FONT_SIZE_MIN}px</span>
          <span>{FONT_SIZE_MAX}px</span>
        </div>
      </div>

      {/* Font Weight */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">
          {t('terminalFonts.fontConfig.fontWeight', { defaultValue: 'Font Weight' })}
        </Label>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.fontConfig.fontWeightDescription', {
            defaultValue: 'Font weight from 100 (thin) to 900 (black), in steps of 100',
          })}
        </p>
        <div className="flex items-center gap-3 max-w-xs">
          <input
            type="number"
            min={FONT_WEIGHT_MIN}
            max={FONT_WEIGHT_MAX}
            step={FONT_WEIGHT_STEP}
            value={settings.fontWeight}
            onChange={(e) => handleFontWeightChange(e.target.value)}
            className={cn(
              'w-24 h-10 px-3 rounded-lg',
              'border border-border bg-card',
              'text-sm text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors duration-200'
            )}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleFontWeightChange((settings.fontWeight - FONT_WEIGHT_STEP).toString())}
              disabled={settings.fontWeight <= FONT_WEIGHT_MIN}
              className={cn(
                'p-1 rounded-md transition-colors',
                'hover:bg-accent text-muted-foreground hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
              )}
              title={t('terminalFonts.fontConfig.decreaseFontWeight', { step: FONT_WEIGHT_STEP })}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleFontWeightChange((settings.fontWeight + FONT_WEIGHT_STEP).toString())}
              disabled={settings.fontWeight >= FONT_WEIGHT_MAX}
              className={cn(
                'p-1 rounded-md transition-colors',
                'hover:bg-accent text-muted-foreground hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
              )}
              title={t('terminalFonts.fontConfig.increaseFontWeight', { step: FONT_WEIGHT_STEP })}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {t('terminalFonts.fontConfig.commonWeights', {
            defaultValue: 'Common: 400 (normal), 600 (semi-bold), 700 (bold)',
          })}
        </div>
      </div>

      {/* Line Height */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">
            {t('terminalFonts.fontConfig.lineHeight', { defaultValue: 'Line Height' })}
          </Label>
          <span className="text-sm font-mono text-muted-foreground">
            {numberFormatter.format(settings.lineHeight)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.fontConfig.lineHeightDescription', {
            defaultValue: 'Line height as a multiple of font size (1.0-2.0)',
          })}
        </p>
        <input
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          value={settings.lineHeight}
          onChange={(e) => handleLineHeightChange(parseFloat(e.target.value))}
          aria-label={t('terminalFonts.fontConfig.lineHeight', { defaultValue: 'Line Height' })}
          aria-valuemin={LINE_HEIGHT_MIN}
          aria-valuemax={LINE_HEIGHT_MAX}
          aria-valuenow={settings.lineHeight}
          aria-valuetext={numberFormatter.format(settings.lineHeight)}
          className={cn(...SLIDER_INPUT_CLASSES)}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{LINE_HEIGHT_MIN.toFixed(1)}</span>
          <span>{LINE_HEIGHT_MAX.toFixed(1)}</span>
        </div>
      </div>

      {/* Letter Spacing */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">
            {t('terminalFonts.fontConfig.letterSpacing', { defaultValue: 'Letter Spacing' })}
          </Label>
          <span className="text-sm font-mono text-muted-foreground">
            {settings.letterSpacing > 0 ? `+${numberFormatter.format(settings.letterSpacing)}` : numberFormatter.format(settings.letterSpacing)}px
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.fontConfig.letterSpacingDescription', {
            defaultValue: 'Horizontal spacing between characters (-2 to 5px)',
          })}
        </p>
        <input
          type="range"
          min={LETTER_SPACING_MIN}
          max={LETTER_SPACING_MAX}
          step={LETTER_SPACING_STEP}
          value={settings.letterSpacing}
          onChange={(e) => handleLetterSpacingChange(parseFloat(e.target.value))}
          aria-label={t('terminalFonts.fontConfig.letterSpacing', { defaultValue: 'Letter Spacing' })}
          aria-valuemin={LETTER_SPACING_MIN}
          aria-valuemax={LETTER_SPACING_MAX}
          aria-valuenow={settings.letterSpacing}
          aria-valuetext={`${settings.letterSpacing > 0 ? '+' : ''}${numberFormatter.format(settings.letterSpacing)} ${t('terminalFonts.fontConfig.pixels', { defaultValue: 'pixels' })}`}
          className={cn(...SLIDER_INPUT_CLASSES)}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{LETTER_SPACING_MIN}px</span>
          <span>+{LETTER_SPACING_MAX}px</span>
        </div>
      </div>
    </div>
  );
}
