import { useState, useEffect, useRef } from 'react';
import { Monitor, RotateCcw, Save, Trash2, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../hooks/use-toast';
import { cn } from '../../../lib/utils';
import { Label } from '../../ui/label';
import type { TerminalFontSettings } from '../../../stores/terminal-font-settings-store';
import { useTerminalFontSettingsStore } from '../../../stores/terminal-font-settings-store';
import { getOS } from '../../../lib/os-detection';
import {
  isValidFontSize,
  isValidFontWeight,
  isValidLineHeight,
  isValidLetterSpacing,
  isValidScrollback,
  isValidCursorStyle,
  isValidHexColor,
  isValidFontFamily,
} from '../../../lib/terminal-font-constants';

interface PresetsPanelProps {
  currentSettings: TerminalFontSettings;
  onPresetApply: (presetName: string) => void;
  onReset: () => void;
}

// Storage key for custom presets
const CUSTOM_PRESETS_STORAGE_KEY = 'terminal-font-custom-presets';

// Built-in presets configuration
const BUILTIN_PRESETS = [
  {
    id: 'vscode',
    nameKey: 'settings:terminalFonts.presets.vscodeName',
    description: 'settings:terminalFonts.presets.vscode',
    icon: Monitor,
  },
  {
    id: 'intellij',
    nameKey: 'settings:terminalFonts.presets.intellijName',
    description: 'settings:terminalFonts.presets.intellij',
    icon: Monitor,
  },
  {
    id: 'macos',
    nameKey: 'settings:terminalFonts.presets.macosName',
    description: 'settings:terminalFonts.presets.macos',
    icon: Monitor,
  },
  {
    id: 'ubuntu',
    nameKey: 'settings:terminalFonts.presets.ubuntuName',
    description: 'settings:terminalFonts.presets.ubuntu',
    icon: Monitor,
  },
];

interface CustomPreset {
  id: string;
  name: string;
  nameKey?: string; // Optional i18n key for built-in presets
  settings: TerminalFontSettings;
  createdAt: number;
}

/**
 * Validates that a value has the required structure of a CustomPreset
 * including validation of nested settings values
 */
function isValidCustomPreset(value: unknown): value is CustomPreset {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;

  // Validate structure
  if (
    typeof obj.id !== 'string' ||
    obj.id.length === 0 ||
    typeof obj.name !== 'string' ||
    obj.name.length === 0 ||
    typeof obj.settings !== 'object' ||
    obj.settings === null ||
    typeof obj.createdAt !== 'number' ||
    obj.createdAt <= 0
  ) {
    return false;
  }

  // Validate settings values
  const settings = obj.settings as Record<string, unknown>;
  return (
    isValidFontFamily(settings.fontFamily) &&
    isValidFontSize(typeof settings.fontSize === 'number' ? settings.fontSize : 0) &&
    isValidFontWeight(typeof settings.fontWeight === 'number' ? settings.fontWeight : 0) &&
    isValidLineHeight(typeof settings.lineHeight === 'number' ? settings.lineHeight : 0) &&
    isValidLetterSpacing(typeof settings.letterSpacing === 'number' ? settings.letterSpacing : 0) &&
    isValidScrollback(typeof settings.scrollback === 'number' ? settings.scrollback : 0) &&
    isValidCursorStyle(settings.cursorStyle as string) &&
    typeof settings.cursorBlink === 'boolean' &&
    isValidHexColor(settings.cursorAccentColor as string)
  );
}

/**
 * Presets panel for quick application of pre-configured terminal font settings.
 * Provides:
 * - Built-in presets (VS Code, IntelliJ, macOS Terminal, Ubuntu Terminal)
 * - Reset to OS default button
 * - Custom preset management (save, list, apply, delete)
 *
 * Custom presets are stored in localStorage under 'terminal-font-custom-presets'
 */
export function PresetsPanel({ currentSettings, onPresetApply, onReset }: PresetsPanelProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { toast } = useToast();

  // Get store actions for applying custom presets
  const applySettings = useTerminalFontSettingsStore((state) => state.applySettings);

  // State for custom presets
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

  // State for new preset name input
  const [newPresetName, setNewPresetName] = useState('');

  // Track whether initial load from localStorage is complete
  // This prevents the save effect from clearing localStorage on mount
  const isLoadedRef = useRef(false);

  // Load custom presets from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate structure before setting state - filter out invalid entries
        if (Array.isArray(parsed)) {
          const validPresets = parsed.filter(isValidCustomPreset);
          setCustomPresets(validPresets);
        } else {
          setCustomPresets([]);
        }
      }
    } catch {
      // If localStorage is unavailable or corrupted, start with empty list
      setCustomPresets([]);
    } finally {
      // Mark as loaded after initial load completes
      isLoadedRef.current = true;
    }
  }, []);

  // Save custom presets to localStorage whenever they change
  // Skip the initial save to prevent clearing localStorage before load completes
  useEffect(() => {
    // Skip save on mount - only save after initial load is complete
    if (!isLoadedRef.current) {
      return;
    }
    try {
      if (customPresets.length > 0) {
        localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(customPresets));
      } else {
        localStorage.removeItem(CUSTOM_PRESETS_STORAGE_KEY);
      }
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }, [customPresets]);

  // Handle applying a built-in preset
  const handleApplyBuiltInPreset = (presetId: string) => {
    onPresetApply(presetId);
  };

  // Handle reset to OS defaults
  const handleResetToDefaults = () => {
    onReset();
  };

  // Handle saving current configuration as a custom preset
  const handleSaveCustomPreset = () => {
    const trimmedName = newPresetName.trim();
    if (!trimmedName) return;

    // Check for duplicate names
    const isDuplicate = customPresets.some((preset) => preset.name === trimmedName);
    if (isDuplicate) {
      toast({
        variant: 'destructive',
        title: t('terminalFonts.presets.duplicateName', { defaultValue: 'A preset with this name already exists' }),
      });
      return;
    }

    const newPreset: CustomPreset = {
      id: `custom-${Date.now()}`,
      name: trimmedName,
      settings: { ...currentSettings },
      createdAt: Date.now(),
    };

    setCustomPresets((prev) => [...prev, newPreset]);
    setNewPresetName('');

    toast({
      title: t('terminalFonts.presets.saved', { defaultValue: 'Preset "{{name}}" saved successfully', name: trimmedName }),
    });
  };

  // Handle applying a custom preset
  const handleApplyCustomPreset = (preset: CustomPreset) => {
    // Apply all settings from the preset using the store's applySettings method
    const success = applySettings(preset.settings);

    // Show error toast if application failed
    if (!success) {
      toast({
        variant: 'destructive',
        title: t('terminalFonts.presets.applyFailed', {
          defaultValue: 'Failed to apply preset "{{name}}"',
          name: preset.name,
        }),
      });
    }
  };

  // Handle deleting a custom preset
  const handleDeleteCustomPreset = (presetId: string) => {
    const preset = customPresets.find((p) => p.id === presetId);
    setCustomPresets((prev) => prev.filter((p) => p.id !== presetId));

    if (preset) {
      toast({
        title: t('terminalFonts.presets.deleted', { defaultValue: 'Preset "{{name}}" deleted', name: preset.name }),
      });
    }
  };

  // Get current OS name for reset button label
  const currentOS = getOS();

  // Map OS value to localized label
  const osLabel =
    currentOS === 'windows'
      ? t('common:os.windows', { defaultValue: 'Windows' })
      : currentOS === 'macos'
        ? t('common:os.macos', { defaultValue: 'macOS' })
        : currentOS === 'linux'
          ? t('common:os.linux', { defaultValue: 'Linux' })
          : t('common:os.unknown', { defaultValue: 'your OS' });

  return (
    <div className="space-y-6">
        {/* Built-in Presets */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            {t('settings:terminalFonts.presets.builtin', { defaultValue: 'Built-in Presets' })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('settings:terminalFonts.presets.builtinDescription', {
              defaultValue: 'Click to apply a pre-configured preset',
            })}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            {BUILTIN_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => handleApplyBuiltInPreset(preset.id)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'border-border hover:border-primary/50 hover:bg-accent/50'
                  )}
                  title={t(preset.description)}
                >
                  <Icon className="h-5 w-5" />
                  <div className="text-center">
                    <div className="text-sm font-medium">{t(preset.nameKey)}</div>
                    <div className="text-xs text-muted-foreground">{t(preset.description)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reset to OS Default */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            {t('settings:terminalFonts.presets.reset', { defaultValue: 'Reset to Defaults' })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('settings:terminalFonts.presets.resetDescription', {
              defaultValue: 'Restore the default settings for your operating system',
            })}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={handleResetToDefaults}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'border-border hover:border-primary/50 hover:bg-accent/50 text-sm font-medium'
              )}
              title={t('settings:terminalFonts.presets.resetToOS', {
                os: osLabel,
                defaultValue: 'Reset to {{os}} defaults',
              })}
            >
              <RotateCcw className="h-4 w-4" />
              <span>
                {t('settings:terminalFonts.presets.resetButton', {
                  defaultValue: 'Reset to OS Default',
                })}
              </span>
            </button>
          </div>
        </div>

        {/* Custom Presets */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            {t('settings:terminalFonts.presets.custom', { defaultValue: 'Custom Presets' })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('settings:terminalFonts.presets.customDescription', {
              defaultValue: 'Save your current configuration as a custom preset',
            })}
          </p>

          {/* Save New Custom Preset */}
          <div className="flex items-center gap-2 max-w-md pt-1">
            <input
              type="text"
              id="newPresetNameInput"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveCustomPreset();
                }
              }}
              placeholder={t('settings:terminalFonts.presets.presetNamePlaceholder', {
                defaultValue: 'Preset name...',
              })}
              aria-label={t('settings:terminalFonts.presets.presetNameLabel', {
                defaultValue: 'Preset name',
              })}
              className={cn(
                'flex-1 h-10 px-3 rounded-lg',
                'border border-border bg-card',
                'text-sm text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
                'transition-colors duration-200'
              )}
            />
            <button
              type="button"
              onClick={handleSaveCustomPreset}
              disabled={!newPresetName.trim()}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary',
                'text-sm font-medium'
              )}
              title={t('settings:terminalFonts.presets.savePreset', {
                defaultValue: 'Save current configuration as a preset',
              })}
            >
              <Save className="h-4 w-4" />
              <span>
                {t('common:buttons.save', { defaultValue: 'Save' })}
              </span>
            </button>
          </div>

          {/* List of Custom Presets */}
          {customPresets.length > 0 && (
            <div className="space-y-2 pt-2">
              {customPresets.map((preset) => {
                return (
                  <div
                  key={preset.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border',
                    'border-border bg-card',
                    'transition-colors'
                  )}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('settings:terminalFonts.presets.summary', {
                        font: preset.settings.fontFamily[0] ?? t('settings:terminalFonts.presets.unknownFont', { defaultValue: 'Unknown' }),
                        size: preset.settings.fontSize,
                        cursor: preset.settings.cursorStyle,
                        defaultValue: '{{font}}, {{size}}px, {{cursor}} cursor',
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleApplyCustomPreset(preset)}
                      className={cn(
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors',
                        'bg-primary text-primary-foreground hover:bg-primary/90',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'text-xs font-medium'
                      )}
                      title={t('settings:terminalFonts.presets.applyPreset', {
                        defaultValue: 'Apply this preset',
                      })}
                    >
                      <FolderOpen className="h-3 w-3" />
                      <span>{t('common:buttons.apply', { defaultValue: 'Apply' })}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomPreset(preset.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors',
                        'hover:bg-destructive/10 text-destructive hover:text-destructive',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'text-xs font-medium'
                      )}
                      title={t('settings:terminalFonts.presets.deletePreset', {
                        defaultValue: 'Delete this preset',
                      })}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{t('common:buttons.delete', { defaultValue: 'Delete' })}</span>
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {customPresets.length === 0 && (
            <div className="p-6 rounded-lg border border-dashed border-border text-center">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t('settings:terminalFonts.presets.noCustomPresets', {
                  defaultValue: 'No custom presets yet. Save your current configuration to get started.',
                })}
              </p>
            </div>
          )}
        </div>
      </div>
  );
}
