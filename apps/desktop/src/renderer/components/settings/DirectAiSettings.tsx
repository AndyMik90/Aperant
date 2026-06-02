import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsSection } from './SettingsSection';
import { DEFAULT_APP_SETTINGS } from '../../../shared/constants';
import type { AppSettings, DirectAiConnectionSettings, DirectAiProvider } from '../../../shared/types';

interface DirectAiSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

// Default block used when settings have no directAiConnection yet (e.g. migrated configs)
const DEFAULT_DIRECT_AI = DEFAULT_APP_SETTINGS.directAiConnection as DirectAiConnectionSettings;

/**
 * Direct AI Connection settings section.
 *
 * Configures the free, no-API-key web transports (DeepSeek primary, ChatGPT for
 * research/assist). When enabled with a captured DeepSeek token, this routes
 * every AI feature (planner, coder, QA, and all utility runners) through the
 * 'direct' Vercel AI SDK provider. Without a token it safely falls back to the
 * configured paid/OAuth provider.
 */
export function DirectAiSettings({ settings, onSettingsChange }: DirectAiSettingsProps) {
  const { t } = useTranslation('settings');
  const [showToken, setShowToken] = useState(false);

  // Current config, falling back to defaults so sibling fields are never dropped.
  const current: DirectAiConnectionSettings = settings.directAiConnection ?? DEFAULT_DIRECT_AI;

  // Deep-merge a partial update into directAiConnection without losing sibling fields.
  const update = (change: Partial<DirectAiConnectionSettings>) => {
    onSettingsChange({
      ...settings,
      directAiConnection: { ...current, ...change },
    });
  };

  const updateDeepseek = (change: Partial<DirectAiConnectionSettings['deepseek']>) => {
    update({ deepseek: { ...current.deepseek, ...change } });
  };

  const updateChatgpt = (change: Partial<DirectAiConnectionSettings['chatgpt']>) => {
    update({ chatgpt: { ...current.chatgpt, ...change } });
  };

  return (
    <SettingsSection
      title={t('directAiConnection.title')}
      description={t('directAiConnection.description')}
    >
      <div className="space-y-6">
        {/* Master enable toggle */}
        <div className="flex items-center justify-between max-w-md">
          <div className="space-y-1">
            <Label htmlFor="directAiEnabled" className="text-sm font-medium text-foreground">
              {t('directAiConnection.enable.label')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('directAiConnection.enable.description')}
            </p>
          </div>
          <Switch
            id="directAiEnabled"
            checked={current.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
        </div>

        {/* Primary provider selector */}
        <div className="space-y-3">
          <div className="flex items-center justify-between max-w-md">
            <div className="space-y-1">
              <Label htmlFor="directAiPrimaryProvider" className="text-sm font-medium text-foreground">
                {t('directAiConnection.primaryProvider.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('directAiConnection.primaryProvider.description')}
              </p>
            </div>
            <Select
              value={current.primaryProvider}
              onValueChange={(value) => update({ primaryProvider: value as DirectAiProvider })}
            >
              <SelectTrigger id="directAiPrimaryProvider" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek">
                  {t('directAiConnection.primaryProvider.deepseek')}
                </SelectItem>
                <SelectItem value="chatgpt">
                  {t('directAiConnection.primaryProvider.chatgpt')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* DeepSeek subsection */}
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="directAiDeepseekEnabled" className="text-sm font-medium text-foreground">
                {t('directAiConnection.deepseek.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('directAiConnection.deepseek.description')}
              </p>
            </div>
            <Switch
              id="directAiDeepseekEnabled"
              checked={current.deepseek.enabled}
              onCheckedChange={(checked) => updateDeepseek({ enabled: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="directAiDeepseekToken" className="text-sm font-medium text-foreground">
              {t('directAiConnection.deepseek.tokenLabel')}
            </Label>
            <div className="relative max-w-lg">
              <Input
                id="directAiDeepseekToken"
                type={showToken ? 'text' : 'password'}
                placeholder={t('directAiConnection.deepseek.tokenPlaceholder')}
                value={current.deepseek.userToken}
                onChange={(e) => updateDeepseek({ userToken: e.target.value })}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((prev) => !prev)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={
                  showToken
                    ? t('directAiConnection.deepseek.hideToken')
                    : t('directAiConnection.deepseek.showToken')
                }
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('directAiConnection.deepseek.tokenHelper')}
            </p>
          </div>
        </div>

        {/* ChatGPT subsection */}
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="directAiChatgptEnabled" className="text-sm font-medium text-foreground">
                {t('directAiConnection.chatgpt.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('directAiConnection.chatgpt.description')}
              </p>
            </div>
            <Switch
              id="directAiChatgptEnabled"
              checked={current.chatgpt.enabled}
              onCheckedChange={(checked) => updateChatgpt({ enabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="directAiChatgptSessionReady" className="text-sm font-medium text-foreground">
                {t('directAiConnection.chatgpt.sessionReadyLabel')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('directAiConnection.chatgpt.sessionReadyHelper')}
              </p>
            </div>
            <Switch
              id="directAiChatgptSessionReady"
              checked={current.chatgpt.sessionReady}
              onCheckedChange={(checked) => updateChatgpt({ sessionReady: checked })}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
