import { Zap, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { Label } from '../../ui/label';
import type { TerminalFontSettings } from '../../../stores/terminal-font-settings-store';
import { SCROLLBACK_MIN, SCROLLBACK_MAX, SCROLLBACK_STEP, SLIDER_INPUT_CLASSES } from '../../../lib/terminal-font-constants';

interface PerformanceConfigPanelProps {
  settings: TerminalFontSettings;
  onSettingChange: <K extends keyof TerminalFontSettings>(
    key: K,
    value: TerminalFontSettings[K]
  ) => void;
}

/**
 * Performance configuration panel for terminal scrollback settings.
 * Provides controls for:
 * - Quick preset buttons (1K, 10K, 50K, 100K lines)
 * - Fine-tune slider (1K-100K lines in 1K increments)
 *
 * All changes apply immediately and persist via the parent store
 */
export function PerformanceConfigPanel({ settings, onSettingChange }: PerformanceConfigPanelProps) {
  const { t } = useTranslation('settings');

  // Format scrollback value for display (e.g., 10000 -> "10K")
  const formatScrollback = (value: number): string => {
    if (value >= 1000) {
      return t('terminalFonts.performanceConfig.kValue', {
        defaultValue: '{{value}}K',
        value: value / 1000,
      });
    }
    return value.toString();
  };

  // Preset scrollback values with labels (defined inside component to access t())
  const scrollbackPresets = [
    {
      value: 1000,
      label: formatScrollback(1000),
      description: t('terminalFonts.performanceConfig.presetMinimal', { defaultValue: 'Minimal' }),
    },
    {
      value: 10000,
      label: formatScrollback(10000),
      description: t('terminalFonts.performanceConfig.presetStandard', { defaultValue: 'Standard' }),
    },
    {
      value: 50000,
      label: formatScrollback(50000),
      description: t('terminalFonts.performanceConfig.presetExtended', { defaultValue: 'Extended' }),
    },
    {
      value: 100000,
      label: formatScrollback(100000),
      description: t('terminalFonts.performanceConfig.presetMaximum', { defaultValue: 'Maximum' }),
    },
  ] as const;

  // Handle scrollback change
  const handleScrollbackChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clampedValue = Math.max(SCROLLBACK_MIN, Math.min(SCROLLBACK_MAX, value));
    // Round to nearest 1K
    const steppedValue = Math.round(clampedValue / SCROLLBACK_STEP) * SCROLLBACK_STEP;
    onSettingChange('scrollback', steppedValue);
  };

  // Handle preset button clicks - apply immediately
  const handlePresetChange = (newScrollback: number) => {
    onSettingChange('scrollback', newScrollback);
  };

  return (
    <div className="space-y-6">
      {/* Preset Buttons */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Zap className="h-4 w-4" />
          {t('terminalFonts.performanceConfig.presets', { defaultValue: 'Quick Presets' })}
        </Label>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.performanceConfig.presetsDescription', {
            defaultValue: 'Common scrollback limits for different use cases',
          })}
        </p>
        <div className="grid grid-cols-4 gap-3 max-w-lg pt-1">
          {scrollbackPresets.map((preset) => {
            const isSelected = settings.scrollback === preset.value;
            return (
              <button
                type="button"
                key={preset.value}
                onClick={() => handlePresetChange(preset.value)}
                aria-pressed={isSelected}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-accent/50'
                )}
              >
                <Zap className="h-4 w-4" />
                <div className="text-center">
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="text-xs text-muted-foreground">{preset.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fine-tune Slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">
            {t('terminalFonts.performanceConfig.scrollback', { defaultValue: 'Scrollback Limit' })}
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">
              {formatScrollback(settings.scrollback)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleScrollbackChange(settings.scrollback - SCROLLBACK_STEP)}
                disabled={settings.scrollback <= SCROLLBACK_MIN}
                className={cn(
                  'p-1 rounded-md transition-colors',
                  'hover:bg-accent text-muted-foreground hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                )}
                title={t('terminalFonts.performanceConfig.decreaseScrollback', { step: formatScrollback(SCROLLBACK_STEP) })}
                aria-label={t('terminalFonts.performanceConfig.decreaseScrollback', { step: formatScrollback(SCROLLBACK_STEP) })}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleScrollbackChange(settings.scrollback + SCROLLBACK_STEP)}
                disabled={settings.scrollback >= SCROLLBACK_MAX}
                className={cn(
                  'p-1 rounded-md transition-colors',
                  'hover:bg-accent text-muted-foreground hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                )}
                title={t('terminalFonts.performanceConfig.increaseScrollback', { step: formatScrollback(SCROLLBACK_STEP) })}
                aria-label={t('terminalFonts.performanceConfig.increaseScrollback', { step: formatScrollback(SCROLLBACK_STEP) })}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.performanceConfig.scrollbackDescription', {
            defaultValue: 'Maximum number of lines to keep in terminal history (1K-100K)',
          })}
        </p>
        <input
          type="range"
          min={SCROLLBACK_MIN}
          max={SCROLLBACK_MAX}
          step={SCROLLBACK_STEP}
          value={settings.scrollback}
          onChange={(e) => handleScrollbackChange(parseInt(e.target.value, 10))}
          aria-label={t('terminalFonts.performanceConfig.scrollback', { defaultValue: 'Scrollback Limit' })}
          aria-valuemin={SCROLLBACK_MIN}
          aria-valuemax={SCROLLBACK_MAX}
          aria-valuenow={settings.scrollback}
          aria-valuetext={t('terminalFonts.performanceConfig.scrollbackValue', {
            defaultValue: '{{value}} lines',
            value: formatScrollback(settings.scrollback),
          })}
          className={cn(...SLIDER_INPUT_CLASSES)}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatScrollback(SCROLLBACK_MIN)}</span>
          <span>{formatScrollback(SCROLLBACK_MAX)}</span>
        </div>
      </div>
    </div>
  );
}
