import { MousePointer2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import type { TerminalFontSettings } from '../../../stores/terminal-font-settings-store';

interface CursorConfigPanelProps {
  settings: TerminalFontSettings;
  onSettingChange: <K extends keyof TerminalFontSettings>(
    key: K,
    value: TerminalFontSettings[K]
  ) => void;
}

/**
 * Cursor configuration panel for terminal cursor customization.
 * Provides controls for:
 * - Cursor style (select: block/underline/bar)
 * - Cursor blink (switch: on/off)
 * - Cursor accent color (color picker)
 *
 * All changes apply immediately and persist via the parent store
 */
export function CursorConfigPanel({ settings, onSettingChange }: CursorConfigPanelProps) {
  const { t } = useTranslation('settings');

  // Cursor style options (defined inside component to access t())
  const cursorStyles = [
    {
      value: 'block' as const,
      label: t('terminalFonts.cursorConfig.styleBlock', { defaultValue: 'Block' }),
      description: t('terminalFonts.cursorConfig.styleBlockDescription', { defaultValue: 'Full block cursor' }),
    },
    {
      value: 'underline' as const,
      label: t('terminalFonts.cursorConfig.styleUnderline', { defaultValue: 'Underline' }),
      description: t('terminalFonts.cursorConfig.styleUnderlineDescription', { defaultValue: 'Underline cursor' }),
    },
    {
      value: 'bar' as const,
      label: t('terminalFonts.cursorConfig.styleBar', { defaultValue: 'Bar' }),
      description: t('terminalFonts.cursorConfig.styleBarDescription', { defaultValue: 'Vertical bar cursor' }),
    },
  ];

  // Handle cursor style change
  const handleCursorStyleChange = (value: 'block' | 'underline' | 'bar') => {
    onSettingChange('cursorStyle', value);
  };

  // Handle cursor blink change
  const handleCursorBlinkChange = (checked: boolean) => {
    onSettingChange('cursorBlink', checked);
  };

  // Handle cursor accent color change
  const handleCursorAccentColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const color = event.target.value;
    onSettingChange('cursorAccentColor', color);
  };

  return (
    <div className="space-y-6">
      {/* Cursor Style */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground flex items-center gap-2">
          <MousePointer2 className="h-4 w-4" />
          {t('terminalFonts.cursorConfig.cursorStyle', { defaultValue: 'Cursor Style' })}
        </Label>
        <p className="text-sm text-muted-foreground">
          {t('terminalFonts.cursorConfig.cursorStyleDescription', {
            defaultValue: 'Choose the appearance of the terminal cursor',
          })}
        </p>
        <div className="max-w-md">
          <Select value={settings.cursorStyle} onValueChange={handleCursorStyleChange}>
            <SelectTrigger id="cursor-style">
              <SelectValue placeholder={t('terminalFonts.cursorConfig.selectStyle', { defaultValue: 'Select cursor style...' })} />
            </SelectTrigger>
            <SelectContent>
              {cursorStyles.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  <div className="flex flex-col">
                    <span className="font-medium">{style.label}</span>
                    <span className="text-xs text-muted-foreground">{style.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Current cursor style display */}
        <div className="text-xs text-muted-foreground">
          {t('terminalFonts.cursorConfig.currentStyle', { defaultValue: 'Current:' })}{' '}
          <span className="font-medium text-foreground">
            {cursorStyles.find((s) => s.value === settings.cursorStyle)?.label || settings.cursorStyle}
          </span>
        </div>
      </div>

      {/* Cursor Blink */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-foreground">
              {t('terminalFonts.cursorConfig.cursorBlink', { defaultValue: 'Cursor Blink' })}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('terminalFonts.cursorConfig.cursorBlinkDescription', {
                defaultValue: 'Enable or disable cursor blinking animation',
              })}
            </p>
          </div>
          <Switch
            id="cursor-blink"
            checked={settings.cursorBlink}
            onCheckedChange={handleCursorBlinkChange}
            className="shrink-0"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {t('terminalFonts.cursorConfig.blinkStatus', { defaultValue: 'Status:' })}{' '}
          <span className={cn('font-medium', settings.cursorBlink ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
            {settings.cursorBlink
              ? t('terminalFonts.cursorConfig.enabled', { defaultValue: 'Enabled' })
              : t('terminalFonts.cursorConfig.disabled', { defaultValue: 'Disabled' })}
          </span>
        </div>
      </div>

      {/* Cursor Accent Color */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">
          {t('terminalFonts.cursorConfig.cursorAccentColor', { defaultValue: 'Cursor Accent Color' })}
        </Label>
        <p id="cursor-color-description" className="text-sm text-muted-foreground">
          {t('terminalFonts.cursorConfig.cursorAccentColorDescription', {
            defaultValue: 'Color of the cursor when visible (affects contrast and visibility)',
          })}
        </p>
        <div className="flex items-center gap-3 max-w-xs">
          {/* Color preview/input */}
          <div className="relative flex items-center gap-2">
            <input
              type="color"
              id="cursor-accent-color"
              value={settings.cursorAccentColor}
              onChange={handleCursorAccentColorChange}
              aria-label={t('terminalFonts.cursorConfig.cursorAccentColor', { defaultValue: 'Cursor Accent Color' })}
              aria-describedby="cursor-color-description"
              className={cn(
                'h-10 w-10 rounded-lg cursor-pointer border-2 border-border',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
                'transition-colors duration-200'
              )}
              title={t('terminalFonts.cursorConfig.pickColor', { defaultValue: 'Click to pick a color' })}
            />
            <div className="flex items-center gap-2 flex-1">
              <code
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-mono',
                  'border border-border bg-card',
                  'text-foreground'
                )}
              >
                {settings.cursorAccentColor.toUpperCase()}
              </code>
              <button
                type="button"
                onClick={() => onSettingChange('cursorAccentColor', '#000000')}
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-medium',
                  'border border-border bg-card hover:bg-accent',
                  'text-foreground transition-colors duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-ring'
                )}
                title={t('terminalFonts.cursorConfig.resetColor', { defaultValue: 'Reset to black' })}
              >
                {t('terminalFonts.cursorConfig.reset', { defaultValue: 'Reset' })}
              </button>
            </div>
          </div>
        </div>
        {/* Color preview box with sample cursor */}
        <div className="flex items-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground">
            {t('terminalFonts.cursorConfig.preview', { defaultValue: 'Preview:' })}
          </span>
          <div
            className={cn(
              'w-16 h-6 rounded-md border border-border',
              'relative overflow-hidden',
              'bg-card'
            )}
          >
            {/* Sample cursor showing the accent color */}
            {settings.cursorStyle === 'block' && (
              <div
                className="absolute top-0 left-0 w-3 h-full"
                style={{ backgroundColor: settings.cursorAccentColor }}
              />
            )}
            {settings.cursorStyle === 'underline' && (
              <div
                className="absolute bottom-0 left-0 w-3 h-1"
                style={{ backgroundColor: settings.cursorAccentColor }}
              />
            )}
            {settings.cursorStyle === 'bar' && (
              <div
                className="absolute top-0 left-1 w-0.5 h-full"
                style={{ backgroundColor: settings.cursorAccentColor }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
