import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { useToast } from '../../../hooks/use-toast';
import { SettingsSection } from '../SettingsSection';
import { useTerminalFontSettingsStore } from '../../../stores/terminal-font-settings-store';
import type { TerminalFontSettings } from '../../../stores/terminal-font-settings-store';
import { MAX_IMPORT_FILE_SIZE } from '../../../lib/terminal-font-constants';

// Child components
import { FontConfigPanel } from './FontConfigPanel';
import { CursorConfigPanel } from './CursorConfigPanel';
import { PerformanceConfigPanel } from './PerformanceConfigPanel';
import { PresetsPanel } from './PresetsPanel';
import { LivePreviewTerminal } from './LivePreviewTerminal';

/**
 * Terminal font settings main container component
 * Orchestrates all terminal font customization panels:
 * - Font configuration (family, size, weight, line height, letter spacing)
 * - Cursor configuration (style, blink, accent color)
 * - Performance settings (scrollback limit)
 * - Quick presets (VS Code, IntelliJ, macOS, Ubuntu)
 * - Live preview terminal (real-time updates, 300ms debounced)
 *
 * All settings persist via localStorage through the Zustand store
 * Changes apply immediately to all active terminal instances
 */
export function TerminalFontSettings() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();

  // Get current settings from store using individual selectors to prevent infinite re-render loop
  // Each selector only re-renders when its specific value changes
  const fontFamily = useTerminalFontSettingsStore((state) => state.fontFamily);
  const fontSize = useTerminalFontSettingsStore((state) => state.fontSize);
  const fontWeight = useTerminalFontSettingsStore((state) => state.fontWeight);
  const lineHeight = useTerminalFontSettingsStore((state) => state.lineHeight);
  const letterSpacing = useTerminalFontSettingsStore((state) => state.letterSpacing);
  const cursorStyle = useTerminalFontSettingsStore((state) => state.cursorStyle);
  const cursorBlink = useTerminalFontSettingsStore((state) => state.cursorBlink);
  const cursorAccentColor = useTerminalFontSettingsStore((state) => state.cursorAccentColor);
  const scrollback = useTerminalFontSettingsStore((state) => state.scrollback);

  // Reconstruct settings object with stable reference using useMemo
  // This prevents the infinite re-render loop caused by creating new object references
  const settings = useMemo<TerminalFontSettings>(
    () => ({
      fontFamily,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
      cursorStyle,
      cursorBlink,
      cursorAccentColor,
      scrollback,
    }),
    [fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, cursorStyle, cursorBlink, cursorAccentColor, scrollback]
  );

  // Get action methods from store
  const updateSettings = useTerminalFontSettingsStore((state) => state.applySettings);
  const resetToDefaults = useTerminalFontSettingsStore((state) => state.resetToDefaults);
  const applyPreset = useTerminalFontSettingsStore((state) => state.applyPreset);
  const exportSettings = useTerminalFontSettingsStore((state) => state.exportSettings);
  const importSettings = useTerminalFontSettingsStore((state) => state.importSettings);

  /**
   * Handle individual setting updates
   * This wrapper ensures type safety and could add validation/logging in future
   */
  const handleSettingChange = <K extends keyof TerminalFontSettings>(
    key: K,
    value: TerminalFontSettings[K]
  ) => {
    updateSettings({ [key]: value });
  };

  /**
   * Handle preset application
   */
  const handlePresetApply = (presetName: string) => {
    applyPreset(presetName);
  };

  /**
   * Handle reset to OS defaults
   */
  const handleReset = () => {
    resetToDefaults();
  };

  /**
   * Handle export configuration to JSON file
   */
  const handleExport = () => {
    try {
      const json = exportSettings();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'terminal-font-settings.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: t('terminalFonts.importExport.exportSuccess', { defaultValue: 'Settings exported successfully' }),
      });
    } catch (error) {
      console.error('Failed to export settings:', error);
      toast({
        variant: 'destructive',
        title: t('terminalFonts.importExport.exportFailed', { defaultValue: 'Failed to export settings' }),
      });
    }
  };

  /**
   * Handle import configuration from JSON file
   */
  const handleImport = (file: File) => {
    // Check file size
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      toast({
        variant: 'destructive',
        title: t('terminalFonts.importExport.fileTooLarge', { defaultValue: 'Import file too large (max 10KB)' }),
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const success = importSettings(json);

        if (success) {
          toast({
            title: t('terminalFonts.importExport.importSuccess', { defaultValue: 'Settings imported successfully' }),
          });
        } else {
          toast({
            variant: 'destructive',
            title: t('terminalFonts.importExport.importFailed', { defaultValue: 'Failed to import settings: Invalid JSON format' }),
            description: t('terminalFonts.importExport.importFailedRange', { defaultValue: 'Values must be within valid ranges' }),
          });
        }
      } catch (error) {
        console.error('Failed to import settings:', error);
        toast({
          variant: 'destructive',
          title: t('terminalFonts.importExport.readError', { defaultValue: 'Failed to read file' }),
        });
      }
    };

    reader.onerror = () => {
      toast({
        variant: 'destructive',
        title: t('terminalFonts.importExport.readError', { defaultValue: 'Failed to read file' }),
      });
    };

    reader.readAsText(file);
  };

  /**
   * Handle copy configuration to clipboard
   */
  const handleCopyToClipboard = async () => {
    try {
      const json = exportSettings();
      await navigator.clipboard.writeText(json);

      toast({
        title: t('terminalFonts.importExport.copySuccess', { defaultValue: 'Settings copied to clipboard' }),
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast({
        variant: 'destructive',
        title: t('terminalFonts.importExport.copyFailed', { defaultValue: 'Failed to copy to clipboard' }),
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: Settings panels (scrollable) */}
      <div className="space-y-6">
        {/* Header section with title and description */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Terminal className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-foreground">
              {t('terminalFonts.title', { defaultValue: 'Terminal Fonts' })}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('terminalFonts.description', {
                defaultValue: 'Customize terminal font appearance, cursor behavior, and performance settings. Changes apply immediately to all active terminals.',
              })}
            </p>
          </div>
        </div>

        {/* Import/Export Actions */}
        <div className="flex items-center gap-2 p-4 rounded-lg border bg-card">
          <span className="text-sm font-medium text-foreground">
            {t('terminalFonts.configActions', { defaultValue: 'Configuration:' })}
          </span>
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-accent text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('terminalFonts.export', { defaultValue: 'Export JSON' })}
          </button>
          <label className="px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-accent text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('terminalFonts.import', { defaultValue: 'Import JSON' })}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImport(file);
                  e.target.value = ''; // Reset to allow re-importing same file
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleCopyToClipboard}
            className="px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-accent text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('terminalFonts.copy', { defaultValue: 'Copy to Clipboard' })}
          </button>
        </div>

        {/* Font Configuration Panel */}
        <SettingsSection
          title={t('terminalFonts.fontConfig.title', { defaultValue: 'Font Configuration' })}
          description={t('terminalFonts.fontConfig.description', {
            defaultValue: 'Customize font family, size, weight, line height, and letter spacing',
          })}
        >
          <FontConfigPanel
            settings={settings}
            onSettingChange={handleSettingChange}
          />
        </SettingsSection>

        {/* Cursor Configuration Panel */}
        <SettingsSection
          title={t('terminalFonts.cursorConfig.title', { defaultValue: 'Cursor Configuration' })}
          description={t('terminalFonts.cursorConfig.description', {
            defaultValue: 'Customize cursor style, blinking behavior, and accent color',
          })}
        >
          <CursorConfigPanel
            settings={settings}
            onSettingChange={handleSettingChange}
          />
        </SettingsSection>

        {/* Performance Configuration Panel */}
        <SettingsSection
          title={t('terminalFonts.performanceConfig.title', { defaultValue: 'Performance Settings' })}
          description={t('terminalFonts.performanceConfig.description', {
            defaultValue: 'Adjust scrollback limit and other performance-related settings',
          })}
        >
          <PerformanceConfigPanel
            settings={settings}
            onSettingChange={handleSettingChange}
          />
        </SettingsSection>

        {/* Presets Panel */}
        <SettingsSection
          title={t('terminalFonts.presets.title', { defaultValue: 'Quick Presets' })}
          description={t('terminalFonts.presets.description', {
            defaultValue: 'Apply pre-configured presets from popular IDEs and terminals',
          })}
        >
          <PresetsPanel
            onPresetApply={handlePresetApply}
            onReset={handleReset}
            currentSettings={settings}
          />
        </SettingsSection>
      </div>

      {/* Right column: Live Preview Terminal (sticky) */}
      <div>
        <div className="lg:sticky lg:top-6 space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Terminal className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('terminalFonts.preview.title', { defaultValue: 'Live Preview' })}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            {t('terminalFonts.preview.description', {
              defaultValue: 'Preview your terminal settings in real-time (updates within 300ms)',
            })}
          </p>
          <div className="rounded-lg border bg-card overflow-hidden">
            <LivePreviewTerminal settings={settings} />
          </div>
        </div>
      </div>
    </div>
  );
}
