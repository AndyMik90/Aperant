import { useState, useEffect, useCallback } from 'react';
import { Code, Terminal, Loader2, Check, RefreshCw, Info } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Input } from '../ui/input';
import { useSettingsStore } from '../../stores/settings-store';
import type { SupportedIDE, SupportedTerminal } from '../../../shared/types';
import { useTranslation } from 'react-i18next';

interface DevToolsStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface DetectedTool {
  id: string;
  name: string;
  path: string;
  installed: boolean;
}

interface DetectedTools {
  ides: DetectedTool[];
  terminals: DetectedTool[];
}

// IDE display names - alphabetically sorted for easy scanning
const IDE_NAMES: Partial<Record<SupportedIDE, string>> = {
  androidstudio: 'Android Studio',
  clion: 'CLion',
  cursor: 'Cursor',
  emacs: 'Emacs',
  goland: 'GoLand',
  intellij: 'IntelliJ IDEA',
  neovim: 'Neovim',
  nova: 'Nova',
  phpstorm: 'PhpStorm',
  pycharm: 'PyCharm',
  rider: 'Rider',
  rubymine: 'RubyMine',
  sublime: 'Sublime Text',
  vim: 'Vim',
  vscode: 'Visual Studio Code',
  vscodium: 'VSCodium',
  webstorm: 'WebStorm',
  windsurf: 'Windsurf',
  xcode: 'Xcode',
  zed: 'Zed',
  custom: 'Custom...'  // Always last
};

// Terminal display names - alphabetically sorted
const TERMINAL_NAMES: Partial<Record<SupportedTerminal, string>> = {
  alacritty: 'Alacritty',
  ghostty: 'Ghostty',
  gnometerminal: 'GNOME Terminal',
  hyper: 'Hyper',
  iterm2: 'iTerm2',
  kitty: 'Kitty',
  konsole: 'Konsole',
  powershell: 'PowerShell',
  system: 'System Terminal',
  tabby: 'Tabby',
  terminal: 'Terminal.app',
  terminator: 'Terminator',
  tilix: 'Tilix',
  tmux: 'tmux',
  warp: 'Warp',
  wezterm: 'WezTerm',
  windowsterminal: 'Windows Terminal',
  zellij: 'Zellij',
  custom: 'Custom...'  // Always last
};

/**
 * Developer Tools configuration step for the onboarding wizard.
 *
 * Detects installed IDEs and terminals, allows the user to select
 * their preferred tools for opening worktrees.
 */
export function DevToolsStep({ onNext, onBack }: DevToolsStepProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const { settings, updateSettings } = useSettingsStore();
  const [preferredIDE, setPreferredIDE] = useState<SupportedIDE>(settings.preferredIDE || 'vscode');
  const [preferredTerminal, setPreferredTerminal] = useState<SupportedTerminal>(settings.preferredTerminal || 'system');
  const [customIDEPath, setCustomIDEPath] = useState(settings.customIDEPath || '');
  const [customTerminalPath, setCustomTerminalPath] = useState(settings.customTerminalPath || '');

  const [detectedTools, setDetectedTools] = useState<DetectedTools | null>(null);
  const [isDetecting, setIsDetecting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect installed tools on mount
  const detectTools = useCallback(async () => {
    setIsDetecting(true);
    try {
      // Check if the API is available (may not be in dev mode or if preload failed)
      if (!window.electronAPI?.worktreeDetectTools) {
        console.warn('[DevToolsStep] Detection API not available, using fallback');
        setIsDetecting(false);
        return;
      }

      const result = await window.electronAPI.worktreeDetectTools();
      if (result.success && result.data) {
        setDetectedTools(result.data as DetectedTools);

        // Auto-select the first detected IDE if none is configured
        if (!settings.preferredIDE && result.data.ides.length > 0) {
          setPreferredIDE(result.data.ides[0].id as SupportedIDE);
        }
      }
    } catch (err) {
      console.error('Failed to detect tools:', err);
    } finally {
      setIsDetecting(false);
    }
  }, [settings.preferredIDE]);

  useEffect(() => {
    detectTools();
  }, [detectTools]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const settingsToSave = {
        preferredIDE,
        preferredTerminal,
        customIDEPath: preferredIDE === 'custom' ? customIDEPath : undefined,
        customTerminalPath: preferredTerminal === 'custom' ? customTerminalPath : undefined
      };

      const result = await window.electronAPI.saveSettings(settingsToSave);

      if (result?.success) {
        updateSettings(settingsToSave);
        onNext();
      } else {
        setError(result?.error || 'Failed to save settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  // Build IDE options with detection status
  const ideOptions: Array<{ value: SupportedIDE; label: string; detected: boolean }> = [];

  // Add detected IDEs first
  if (detectedTools) {
    for (const tool of detectedTools.ides) {
      ideOptions.push({
        value: tool.id as SupportedIDE,
        label: tool.name,
        detected: true
      });
    }
  }

  // Add remaining IDEs that weren't detected
  const detectedIDEIds = new Set(detectedTools?.ides.map(t => t.id) || []);
  for (const [id, name] of Object.entries(IDE_NAMES)) {
    if (id !== 'custom' && !detectedIDEIds.has(id)) {
      ideOptions.push({
        value: id as SupportedIDE,
        label: name,
        detected: false
      });
    }
  }

  // Add custom option last
  ideOptions.push({ value: 'custom', label: 'Custom...', detected: false });

  // Build Terminal options with detection status
  const terminalOptions: Array<{ value: SupportedTerminal; label: string; detected: boolean }> = [];

  // Always add system terminal first
  terminalOptions.push({
    value: 'system',
    label: TERMINAL_NAMES.system || 'System Terminal',
    detected: true
  });

  // Add detected terminals
  if (detectedTools) {
    for (const tool of detectedTools.terminals) {
      if (tool.id !== 'system') {
        terminalOptions.push({
          value: tool.id as SupportedTerminal,
          label: tool.name,
          detected: true
        });
      }
    }
  }

  // Add remaining terminals that weren't detected
  const detectedTerminalIds = new Set(detectedTools?.terminals.map(t => t.id) || []);
  detectedTerminalIds.add('system');
  for (const [id, name] of Object.entries(TERMINAL_NAMES)) {
    if (id !== 'custom' && !detectedTerminalIds.has(id)) {
      terminalOptions.push({
        value: id as SupportedTerminal,
        label: name,
        detected: false
      });
    }
  }

  // Add custom option last
  terminalOptions.push({ value: 'custom', label: 'Custom...', detected: false });

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Code className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {t('onboarding:devtools.title')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('onboarding:devtools.description')}
          </p>
        </div>

        {/* Loading state */}
        {isDetecting && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">{t('onboarding:devtools.detecting')}</span>
          </div>
        )}

        {/* Main content */}
        {!isDetecting && (
          <div className="space-y-6">
            {/* Error banner */}
            {error && (
              <Card className="border border-destructive/30 bg-destructive/10">
                <CardContent className="p-4">
                  <p className="text-sm text-destructive">{error}</p>
                </CardContent>
              </Card>
            )}

            {/* Info card */}
            <Card className="border border-info/30 bg-info/10">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      {t('onboarding:devtools.whyConfigure')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('onboarding:devtools.whyConfigureDescription')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detect Again Button */}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={detectTools}
                disabled={isDetecting}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('onboarding:devtools.detectAgain')}
              </Button>
            </div>

            {/* IDE Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Code className="h-4 w-4" />
                {t('onboarding:devtools.ide.label')}
              </Label>
              <Select
                value={preferredIDE}
                onValueChange={(value: SupportedIDE) => setPreferredIDE(value)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('onboarding:devtools.ide.label')} />
                </SelectTrigger>
                <SelectContent>
                  {ideOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <span>{option.label}</span>
                        {option.detected && (
                          <Check className="h-3 w-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('onboarding:devtools.ide.description')}
              </p>

              {/* Custom IDE Path */}
              {preferredIDE === 'custom' && (
                <div className="mt-3">
                  <Label htmlFor="custom-ide-path" className="text-xs text-muted-foreground">
                    {t('onboarding:devtools.ide.customPath')}
                  </Label>
                  <Input
                    id="custom-ide-path"
                    value={customIDEPath}
                    onChange={(e) => setCustomIDEPath(e.target.value)}
                    placeholder="/path/to/your/ide"
                    className="mt-1"
                    disabled={isSaving}
                  />
                </div>
              )}
            </div>

            {/* Terminal Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                {t('onboarding:devtools.terminal.label')}
              </Label>
              <Select
                value={preferredTerminal}
                onValueChange={(value: SupportedTerminal) => setPreferredTerminal(value)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('onboarding:devtools.terminal.label')} />
                </SelectTrigger>
                <SelectContent>
                  {terminalOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <span>{option.label}</span>
                        {option.detected && (
                          <Check className="h-3 w-3 text-green-500" />
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('onboarding:devtools.terminal.description')}
              </p>

              {/* Custom Terminal Path */}
              {preferredTerminal === 'custom' && (
                <div className="mt-3">
                  <Label htmlFor="custom-terminal-path" className="text-xs text-muted-foreground">
                    {t('onboarding:devtools.terminal.customPath')}
                  </Label>
                  <Input
                    id="custom-terminal-path"
                    value={customTerminalPath}
                    onChange={(e) => setCustomTerminalPath(e.target.value)}
                    placeholder="/path/to/your/terminal"
                    className="mt-1"
                    disabled={isSaving}
                  />
                </div>
              )}
            </div>

            {/* Detection Summary */}
            {detectedTools && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <p className="font-medium mb-1">{t('onboarding:devtools.detectedSummary')}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {detectedTools.ides.map((ide) => (
                    <li key={ide.id}>{ide.name}</li>
                  ))}
                  {detectedTools.terminals.filter(t => t.id !== 'system').map((term) => (
                    <li key={term.id}>{term.name}</li>
                  ))}
                  {detectedTools.ides.length === 0 && detectedTools.terminals.filter(t => t.id !== 'system').length === 0 && (
                    <li>{t('onboarding:devtools.noToolsDetected')}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center mt-10 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('common:buttons.back')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isDetecting || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('onboarding:memory.saving')}
              </>
            ) : (
              t('onboarding:devtools.saveAndContinue')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
