import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Sun, Moon, Monitor, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { COLOR_THEMES } from '../../../shared/constants';
import { useSettingsStore } from '../../stores/settings-store';
import {
  parseTweakcnCSSWithSections,
  saveCustomTheme,
  deleteCustomTheme,
  getAllCustomThemeDefinitions,
  listCustomThemes,
} from '../../lib/theme-utils';
import type { ColorTheme, ColorThemeDefinition, AppSettings } from '../../../shared/types';

interface ThemeSelectorProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * Theme selector component displaying a grid of theme cards with preview swatches
 * and a 3-option mode toggle (Light/Dark/System)
 *
 * Theme changes are applied immediately for live preview, while other settings
 * require saving to take effect.
 */
export function ThemeSelector({ settings, onSettingsChange }: ThemeSelectorProps) {
  const { t } = useTranslation('settings');
  const updateStoreSettings = useSettingsStore((state) => state.updateSettings);

  const currentColorTheme = settings.colorTheme || 'default';
  const currentMode = settings.theme;
  const isDark = currentMode === 'dark' ||
    (currentMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Custom theme state
  const [customThemeDefs, setCustomThemeDefs] = useState<ColorThemeDefinition[]>(() =>
    getAllCustomThemeDefinitions()
  );
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetName, setDeleteTargetName] = useState<string | null>(null);
  const [themeName, setThemeName] = useState('');
  const [themeCSS, setThemeCSS] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const refreshCustomThemes = useCallback(() => {
    setCustomThemeDefs(getAllCustomThemeDefinitions());
  }, []);

  const handleColorThemeChange = (themeId: ColorTheme) => {
    // Update local draft state
    onSettingsChange({ ...settings, colorTheme: themeId });
    // Apply immediately to store for live preview (triggers App.tsx useEffect)
    updateStoreSettings({ colorTheme: themeId });
  };

  const handleModeChange = (mode: 'light' | 'dark' | 'system') => {
    // Update local draft state
    onSettingsChange({ ...settings, theme: mode });
    // Apply immediately to store for live preview (triggers App.tsx useEffect)
    updateStoreSettings({ theme: mode });
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'light':
        return <Sun className="h-4 w-4" />;
      case 'dark':
        return <Moon className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  const handleSaveCustomTheme = () => {
    // Validate name
    const trimmedName = themeName.trim();
    if (!trimmedName) {
      setValidationError(t('theme.customTheme.validationNameRequired'));
      return;
    }

    // Check for duplicate names (built-in + existing custom)
    const builtinNames = COLOR_THEMES.map((t) => t.name.toLowerCase());
    const existingCustomNames = listCustomThemes().map((n) => n.toLowerCase());
    if (builtinNames.includes(trimmedName.toLowerCase()) || existingCustomNames.includes(trimmedName.toLowerCase())) {
      setValidationError(t('theme.customTheme.validationNameDuplicate'));
      return;
    }

    // Validate CSS
    const trimmedCSS = themeCSS.trim();
    if (!trimmedCSS) {
      setValidationError(t('theme.customTheme.validationCSSEmpty'));
      return;
    }

    const { lightVariables, darkVariables } = parseTweakcnCSSWithSections(trimmedCSS);
    const totalVars = Object.keys(lightVariables).length + Object.keys(darkVariables).length;
    if (totalVars === 0) {
      setValidationError(t('theme.customTheme.validationCSSInvalid'));
      return;
    }

    // Extract font variables from light vars
    const fonts: { sans?: string; serif?: string; mono?: string } = {};
    if (lightVariables['font-sans']) {
      fonts.sans = lightVariables['font-sans'];
    }
    if (lightVariables['font-serif']) {
      fonts.serif = lightVariables['font-serif'];
    }
    if (lightVariables['font-mono']) {
      fonts.mono = lightVariables['font-mono'];
    }

    // Save theme
    saveCustomTheme(
      trimmedName,
      lightVariables,
      Object.keys(fonts).length > 0 ? fonts : undefined,
      Object.keys(darkVariables).length > 0 ? darkVariables : undefined
    );

    // Refresh and select
    refreshCustomThemes();
    const customId = `custom:${trimmedName}` as ColorTheme;
    handleColorThemeChange(customId);

    // Close dialog and reset
    setIsAddDialogOpen(false);
    setThemeName('');
    setThemeCSS('');
    setValidationError(null);
  };

  const handleDeleteCustomTheme = () => {
    if (!deleteTargetName) return;

    deleteCustomTheme(deleteTargetName);
    refreshCustomThemes();

    // If the deleted theme was active, reset to default
    if (currentColorTheme === `custom:${deleteTargetName}`) {
      handleColorThemeChange('default');
    }

    setIsDeleteDialogOpen(false);
    setDeleteTargetName(null);
  };

  const handleOpenDeleteDialog = (themeName: string) => {
    setDeleteTargetName(themeName);
    setIsDeleteDialogOpen(true);
  };

  // Combine built-in and custom themes
  const allThemes = [...COLOR_THEMES, ...customThemeDefs];

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">Appearance Mode</Label>
        <p className="text-sm text-muted-foreground">Choose light, dark, or system preference</p>
        <div className="grid grid-cols-3 gap-3 max-w-md pt-1">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                currentMode === mode
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-accent/50'
              )}
            >
              {getModeIcon(mode)}
              <span className="text-sm font-medium capitalize">{mode}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Theme Grid */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">Color Theme</Label>
        <p className="text-sm text-muted-foreground">Select a color palette for the interface</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
          {allThemes.map((theme) => {
            const isSelected = currentColorTheme === theme.id;
            const bgColor = isDark ? theme.previewColors.darkBg : theme.previewColors.bg;
            const accentColor = isDark
              ? (theme.previewColors.darkAccent || theme.previewColors.accent)
              : theme.previewColors.accent;

            return (
              <button
                key={theme.id}
                onClick={() => handleColorThemeChange(theme.id)}
                className={cn(
                  'group relative flex flex-col p-4 rounded-lg border-2 text-left transition-all',
                  'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/50 hover:bg-accent/30'
                )}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}

                {/* Delete button for custom themes */}
                {theme.isCustom && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const customName = theme.id.startsWith('custom:')
                        ? theme.id.slice('custom:'.length)
                        : theme.name;
                      handleOpenDeleteDialog(customName);
                    }}
                    className={cn(
                      'absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center',
                      'bg-destructive/10 hover:bg-destructive/20 text-destructive',
                      'opacity-0 group-hover:opacity-100 transition-opacity',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected && 'right-9'
                    )}
                    title={t('theme.customTheme.deleteTitle')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                {/* Preview swatches */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex -space-x-1.5">
                    <div
                      className="w-6 h-6 rounded-full border-2 border-background shadow-sm"
                      style={{ backgroundColor: bgColor }}
                      title="Background color"
                    />
                    <div
                      className="w-6 h-6 rounded-full border-2 border-background shadow-sm"
                      style={{ backgroundColor: accentColor }}
                      title="Accent color"
                    />
                  </div>
                </div>

                {/* Theme info */}
                <div className="space-y-1">
                  <p className="font-medium text-sm text-foreground">{theme.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{theme.description}</p>
                </div>
              </button>
            );
          })}

          {/* Add Custom Theme card */}
          <button
            onClick={() => setIsAddDialogOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed transition-all min-h-[120px]',
              'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'border-border hover:border-primary/50 hover:bg-accent/30'
            )}
          >
            <Plus className="w-6 h-6 text-muted-foreground mb-2" />
            <p className="font-medium text-sm text-muted-foreground">
              {t('theme.customTheme.addButton')}
            </p>
          </button>
        </div>
      </div>

      {/* Add Custom Theme Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          setThemeName('');
          setThemeCSS('');
          setValidationError(null);
        }
      }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('theme.customTheme.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('theme.customTheme.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Instructions */}
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p>- {t('theme.customTheme.instructionsMustInclude')}</p>
              <p>- {t('theme.customTheme.instructionsDarkMode')}</p>
              <p>- {t('theme.customTheme.instructionsVariables')}</p>
              <p>- {t('theme.customTheme.instructionsFormats')}</p>
            </div>

            {/* Theme Name */}
            <div className="space-y-2">
              <Label htmlFor="theme-name">{t('theme.customTheme.nameLabel')}</Label>
              <Input
                id="theme-name"
                value={themeName}
                onChange={(e) => {
                  setThemeName(e.target.value);
                  setValidationError(null);
                }}
                placeholder={t('theme.customTheme.namePlaceholder')}
              />
            </div>

            {/* CSS Variables */}
            <div className="space-y-2">
              <Label htmlFor="theme-css">{t('theme.customTheme.cssLabel')}</Label>
              <Textarea
                id="theme-css"
                value={themeCSS}
                onChange={(e) => {
                  setThemeCSS(e.target.value);
                  setValidationError(null);
                }}
                placeholder={`:root {\n  --background: #ffffff;\n  --foreground: #0a0a0a;\n  --primary: #171717;\n}`}
                className="font-mono text-xs"
                rows={10}
              />
            </div>

            {/* Validation error */}
            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              {t('theme.customTheme.cancel')}
            </Button>
            <Button onClick={handleSaveCustomTheme}>
              {t('theme.customTheme.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        setIsDeleteDialogOpen(open);
        if (!open) setDeleteTargetName(null);
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('theme.customTheme.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTargetName
                ? `"${deleteTargetName}"`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              {t('theme.customTheme.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteCustomTheme}>
              {t('theme.customTheme.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
