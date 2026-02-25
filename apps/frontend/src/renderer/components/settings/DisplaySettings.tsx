import { useState } from 'react';
import { Monitor, ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Label } from '../ui/label';
import { SettingsSection } from './SettingsSection';
import { useSettingsStore } from '../../stores/settings-store';
import { UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT, UI_SCALE_STEP } from '../../../shared/constants';
import type { AppSettings, GpuAcceleration } from '../../../shared/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface DisplaySettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

// Preset scale values with translation keys
const SCALE_PRESETS = [
  { value: UI_SCALE_DEFAULT, label: '100%', descriptionKey: 'scale.default' },
  { value: 125, label: '125%', descriptionKey: 'scale.comfortable' },
  { value: 150, label: '150%', descriptionKey: 'scale.large' }
] as const;

/**
 * Display settings section for UI scale/zoom control
 * Provides preset buttons (100%, 125%, 150%) and a fine-tune slider (75-200%)
 * Changes apply immediately for live preview (like theme), saved on "Save Settings"
 */
export function DisplaySettings({ settings, onSettingsChange }: DisplaySettingsProps) {
  const { t } = useTranslation('settings');
  const updateStoreSettings = useSettingsStore((state) => state.updateSettings);

  const currentScale = settings.uiScale ?? UI_SCALE_DEFAULT;

  // Local state for pending scale changes - prevents view reload until user applies
  const [pendingScale, setPendingScale] = useState<number | null>(null);

  // Track the last scale that was committed to the store (triggers view reload)
  // This is different from currentScale which updates on every onSettingsChange call
  const [committedScale, setCommittedScale] = useState<number>(currentScale);

  // Display value: use pending scale if set, otherwise use current applied scale
  const displayScale = pendingScale ?? currentScale;

  // Check if there are pending changes to apply
  // Compare against committedScale (store-applied value), not currentScale (display value)
  const hasPendingChanges = pendingScale !== null && pendingScale !== committedScale;

  // Update pending scale (for slider and +/- buttons) - doesn't trigger view reload
  const updatePendingScale = (newScale: number) => {
    const clampedScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, newScale));
    setPendingScale(clampedScale);
    // Update settings for display but don't trigger store update (no view reload)
    onSettingsChange({ ...settings, uiScale: clampedScale });
  };

  // Apply pending changes to store (triggers view reload)
  const handleApplyChanges = () => {
    if (pendingScale !== null) {
      updateStoreSettings({ uiScale: pendingScale });
      setCommittedScale(pendingScale);
      setPendingScale(null);
    }
  };

  // Handle preset button clicks - apply immediately (presets are intentional selections)
  const handlePresetChange = (newScale: number) => {
    const clampedScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, newScale));
    onSettingsChange({ ...settings, uiScale: clampedScale });
    updateStoreSettings({ uiScale: clampedScale });
    setCommittedScale(clampedScale);
    setPendingScale(null);
  };

  // Handle slider drag - only update pending state
  const handleSliderChange = (newScale: number) => {
    if (Number.isNaN(newScale)) return;
    updatePendingScale(newScale);
  };

  // Handle zoom button clicks - increment/decrement by step (updates pending state)
  const handleZoomOut = () => {
    updatePendingScale(displayScale - UI_SCALE_STEP);
  };

  const handleZoomIn = () => {
    updatePendingScale(displayScale + UI_SCALE_STEP);
  };

  const handleReset = () => {
    handlePresetChange(UI_SCALE_DEFAULT);
  };

  return (
    <SettingsSection
      title={t('sections.display.title')}
      description={t('sections.display.description')}
    >
      <div className="space-y-6">
        {/* Preset Buttons */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">{t('scale.presets')}</Label>
          <p className="text-sm text-muted-foreground">
            {t('scale.presetsDescription')}
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-md pt-1">
            {SCALE_PRESETS.map((preset) => {
              const isSelected = currentScale === preset.value;
              return (
                <button
                  type="button"
                  key={preset.value}
                  onClick={() => handlePresetChange(preset.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  )}
                >
                  <Monitor className="h-4 w-4" />
                  <div className="text-center">
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="text-xs text-muted-foreground">{t(preset.descriptionKey)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fine-tune Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-foreground">{t('scale.fineTune')}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-muted-foreground">
                {displayScale}%
              </span>
              {displayScale !== UI_SCALE_DEFAULT && (
                <button
                  type="button"
                  onClick={handleReset}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    'hover:bg-accent text-muted-foreground hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                  title="Reset to default (100%)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('scale.fineTuneDescription')}
          </p>

          {/* Slider with zoom buttons and apply button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={displayScale <= UI_SCALE_MIN}
              className={cn(
                'p-1 rounded-md transition-colors shrink-0',
                'hover:bg-accent text-muted-foreground hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
              )}
              title={`Decrease scale by ${UI_SCALE_STEP}%`}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={UI_SCALE_MIN}
              max={UI_SCALE_MAX}
              step={UI_SCALE_STEP}
              value={displayScale}
              onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
              className={cn(
                'flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                // Webkit (Chrome, Safari, Edge)
                '[&::-webkit-slider-thumb]:appearance-none',
                '[&::-webkit-slider-thumb]:w-4',
                '[&::-webkit-slider-thumb]:h-4',
                '[&::-webkit-slider-thumb]:rounded-full',
                '[&::-webkit-slider-thumb]:bg-primary',
                '[&::-webkit-slider-thumb]:cursor-pointer',
                '[&::-webkit-slider-thumb]:transition-all',
                '[&::-webkit-slider-thumb]:hover:scale-110',
                // Firefox
                '[&::-moz-range-thumb]:w-4',
                '[&::-moz-range-thumb]:h-4',
                '[&::-moz-range-thumb]:rounded-full',
                '[&::-moz-range-thumb]:bg-primary',
                '[&::-moz-range-thumb]:border-0',
                '[&::-moz-range-thumb]:cursor-pointer',
                '[&::-moz-range-thumb]:transition-all',
                '[&::-moz-range-thumb]:hover:scale-110'
              )}
            />
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={displayScale >= UI_SCALE_MAX}
              className={cn(
                'p-1 rounded-md transition-colors shrink-0',
                'hover:bg-accent text-muted-foreground hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
              )}
              title={`Increase scale by ${UI_SCALE_STEP}%`}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleApplyChanges}
              disabled={!hasPendingChanges}
              className={cn(
                'px-2 py-1 rounded-md transition-colors shrink-0 flex items-center gap-1',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary'
              )}
              title="Apply scale changes"
            >
              <Check className="h-4 w-4" />
              <span className="text-sm font-medium">Apply</span>
            </button>
          </div>

          {/* Scale markers */}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{UI_SCALE_MIN}%</span>
            <span>{UI_SCALE_MAX}%</span>
          </div>
        </div>

        {/* Log Order Setting */}
        <div className="space-y-3">
          <div className="flex items-center justify-between max-w-md">
            <div className="space-y-1">
              <Label htmlFor="logOrder" className="text-sm font-medium text-foreground">
                {t('logOrder.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('logOrder.description')}
              </p>
            </div>
            <Select
              value={settings.logOrder || 'chronological'}
              onValueChange={(value) => onSettingsChange({
                ...settings,
                logOrder: value as 'chronological' | 'reverse-chronological'
              })}
            >
              <SelectTrigger id="logOrder" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="chronological">
                  {t('logOrder.chronological')}
                </SelectItem>
                <SelectItem value="reverse-chronological">
                  {t('logOrder.reverseChronological')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* GPU Acceleration Setting */}
        <div className="space-y-3">
          <div className="flex items-center justify-between max-w-md">
            <div className="space-y-1">
              <Label htmlFor="gpuAcceleration" className="text-sm font-medium text-foreground">
                {t('gpuAcceleration.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('gpuAcceleration.description')}
              </p>
            </div>
            <Select
              value={settings.gpuAcceleration || 'off'}
              onValueChange={(value) => onSettingsChange({
                ...settings,
                gpuAcceleration: value as GpuAcceleration
              })}
            >
              <SelectTrigger id="gpuAcceleration" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="auto">
                  {t('gpuAcceleration.auto')}
                </SelectItem>
                <SelectItem value="on">
                  {t('gpuAcceleration.on')}
                </SelectItem>
                <SelectItem value="off">
                  {t('gpuAcceleration.off')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('gpuAcceleration.helperText')}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
