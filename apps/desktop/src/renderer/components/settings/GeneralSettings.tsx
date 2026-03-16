import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { SettingsSection } from './SettingsSection';
import { ProviderAgentTabs } from './ProviderAgentTabs';
import type {
  AppSettings,
  ToolDetectionResult
} from '../../../shared/types';

interface GeneralSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  section: 'agent' | 'paths';
}

/**
 * Helper component to display auto-detected CLI tool information
 */
interface ToolDetectionDisplayProps {
  info: ToolDetectionResult | null;
  isLoading: boolean;
  t: (key: string) => string;
}

function ToolDetectionDisplay({ info, isLoading, t }: ToolDetectionDisplayProps) {
  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground mt-1">
        Detecting...
      </div>
    );
  }

  if (!info || !info.found) {
    return (
      <div className="text-xs text-muted-foreground mt-1">
        {t('general.notDetected')}
      </div>
    );
  }

  const getSourceLabel = (source: ToolDetectionResult['source']): string => {
    const sourceMap: Record<ToolDetectionResult['source'], string> = {
      'user-config': t('general.sourceUserConfig'),
      'venv': t('general.sourceVenv'),
      'homebrew': t('general.sourceHomebrew'),
      'nvm': t('general.sourceNvm'),
      'system-path': t('general.sourceSystemPath'),
      'bundled': t('general.sourceBundled'),
      'fallback': t('general.sourceFallback'),
    };
    return sourceMap[source] || source;
  };

  return (
    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
      <div>
        <span className="font-medium">{t('general.detectedPath')}:</span>{' '}
        <code className="bg-muted px-1 py-0.5 rounded">{info.path}</code>
      </div>
      {info.version && (
        <div>
          <span className="font-medium">{t('general.detectedVersion')}:</span>{' '}
          {info.version}
        </div>
      )}
      <div>
        <span className="font-medium">{t('general.detectedSource')}:</span>{' '}
        {getSourceLabel(info.source)}
      </div>
    </div>
  );
}

/**
 * General settings component for agent configuration and paths
 */
export function GeneralSettings({ settings, onSettingsChange, section }: GeneralSettingsProps) {
  const { t } = useTranslation('settings');
  const [toolsInfo, setToolsInfo] = useState<{
    python: ToolDetectionResult;
    git: ToolDetectionResult;
    gh: ToolDetectionResult;
    glab: ToolDetectionResult;
    claude: ToolDetectionResult;
  } | null>(null);
  const [isLoadingTools, setIsLoadingTools] = useState(false);

  // Fetch CLI tools detection info when component mounts (paths section only)
  useEffect(() => {
    if (section === 'paths') {
      setIsLoadingTools(true);
      window.electronAPI
        .getCliToolsInfo()
        .then((result: { success: boolean; data?: { python: ToolDetectionResult; git: ToolDetectionResult; gh: ToolDetectionResult; glab: ToolDetectionResult; claude: ToolDetectionResult } }) => {
          if (result.success && result.data) {
            setToolsInfo(result.data);
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to fetch CLI tools info:', error);
        })
        .finally(() => {
          setIsLoadingTools(false);
        });
    }
  }, [section]);

  if (section === 'agent') {
    return (
      <div className="space-y-8">
        {/* Provider-tabbed agent settings (profiles, features, model overrides) */}
        <ProviderAgentTabs />

        {/* Other Agent Settings */}
        <SettingsSection
          title={t('general.otherAgentSettings')}
          description={t('general.otherAgentSettingsDescription')}
        >
          <div className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="agentFramework" className="text-sm font-medium text-foreground">{t('general.agentFramework')}</Label>
              <p className="text-sm text-muted-foreground">{t('general.agentFrameworkDescription')}</p>
              <Select
                value={settings.agentFramework}
                onValueChange={(value) => onSettingsChange({ ...settings, agentFramework: value })}
              >
                <SelectTrigger id="agentFramework" className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto-claude">{t('general.agentFrameworkAutoClaude')}</SelectItem>
                  <SelectItem value="jules">{t('general.agentFrameworkJules')}</SelectItem>
                  <SelectItem value="claude-code">{t('general.agentFrameworkClaudeCode')}</SelectItem>
                  <SelectItem value="gemini">{t('general.agentFrameworkGemini')}</SelectItem>
                  <SelectItem value="antigravity">{t('general.agentFrameworkAntigravity')}</SelectItem>
                  <SelectItem value="custom">{t('general.agentFrameworkCustom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Jules-specific settings */}
            {settings.agentFramework === 'jules' && (
              <div className="space-y-3 pl-4 border-l-2 border-muted">
                <p className="text-sm font-medium text-foreground">{t('general.julesSettings')}</p>
                <div className="space-y-2">
                  <Label htmlFor="julesApiKey" className="text-sm font-medium text-foreground">{t('general.julesApiKey')}</Label>
                  <p className="text-sm text-muted-foreground">{t('general.julesApiKeyDescription')}</p>
                  <Input
                    id="julesApiKey"
                    type="password"
                    placeholder={t('general.julesApiKeyPlaceholder')}
                    className="w-full max-w-md"
                    value={settings.julesApiKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, julesApiKey: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="julesDefaultRepo" className="text-sm font-medium text-foreground">{t('general.julesDefaultRepo')}</Label>
                  <p className="text-sm text-muted-foreground">{t('general.julesDefaultRepoDescription')}</p>
                  <Input
                    id="julesDefaultRepo"
                    placeholder={t('general.julesDefaultRepoPlaceholder')}
                    className="w-full max-w-md"
                    value={settings.julesDefaultRepo || ''}
                    onChange={(e) => onSettingsChange({ ...settings, julesDefaultRepo: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between max-w-md">
                  <div className="space-y-1">
                    <Label htmlFor="julesAutoCreatePr" className="text-sm font-medium text-foreground">
                      {t('general.julesAutoCreatePr')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('general.julesAutoCreatePrDescription')}
                    </p>
                  </div>
                  <Switch
                    id="julesAutoCreatePr"
                    checked={settings.julesAutoCreatePr ?? true}
                    onCheckedChange={(checked) => onSettingsChange({ ...settings, julesAutoCreatePr: checked })}
                  />
                </div>
              </div>
            )}

            {/* Custom command settings */}
            {settings.agentFramework === 'custom' && (
              <div className="space-y-3 pl-4 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label htmlFor="customAgentCommand" className="text-sm font-medium text-foreground">{t('general.customAgentCommand')}</Label>
                  <p className="text-sm text-muted-foreground">{t('general.customAgentCommandDescription')}</p>
                  <Input
                    id="customAgentCommand"
                    placeholder={t('general.customAgentCommandPlaceholder')}
                    className="w-full max-w-md"
                    value={settings.customAgentCommand || ''}
                    onChange={(e) => onSettingsChange({ ...settings, customAgentCommand: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="autoNameTerminals" className="text-sm font-medium text-foreground">
                    {t('general.aiTerminalNaming')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('general.aiTerminalNamingDescription')}
                  </p>
                </div>
                <Switch
                  id="autoNameTerminals"
                  checked={settings.autoNameTerminals}
                  onCheckedChange={(checked) => onSettingsChange({ ...settings, autoNameTerminals: checked })}
                />
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>
    );
  }

  // paths section
  return (
    <SettingsSection
      title={t('general.paths')}
      description={t('general.pathsDescription')}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor="pythonPath" className="text-sm font-medium text-foreground">{t('general.pythonPath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.pythonPathDescription')}</p>
          <Input
            id="pythonPath"
            placeholder={t('general.pythonPathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.pythonPath || ''}
            onChange={(e) => onSettingsChange({ ...settings, pythonPath: e.target.value })}
          />
          {!settings.pythonPath && (
            <ToolDetectionDisplay
              info={toolsInfo?.python || null}
              isLoading={isLoadingTools}
              t={t}
            />
          )}
        </div>
        <div className="space-y-3">
          <Label htmlFor="gitPath" className="text-sm font-medium text-foreground">{t('general.gitPath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.gitPathDescription')}</p>
          <Input
            id="gitPath"
            placeholder={t('general.gitPathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.gitPath || ''}
            onChange={(e) => onSettingsChange({ ...settings, gitPath: e.target.value })}
          />
          {!settings.gitPath && (
            <ToolDetectionDisplay
              info={toolsInfo?.git || null}
              isLoading={isLoadingTools}
              t={t}
            />
          )}
        </div>
        <div className="space-y-3">
          <Label htmlFor="githubCLIPath" className="text-sm font-medium text-foreground">{t('general.githubCLIPath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.githubCLIPathDescription')}</p>
          <Input
            id="githubCLIPath"
            placeholder={t('general.githubCLIPathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.githubCLIPath || ''}
            onChange={(e) => onSettingsChange({ ...settings, githubCLIPath: e.target.value })}
          />
          {!settings.githubCLIPath && (
            <ToolDetectionDisplay
              info={toolsInfo?.gh || null}
              isLoading={isLoadingTools}
              t={t}
            />
          )}
        </div>
        <div className="space-y-3">
          <Label htmlFor="gitlabCLIPath" className="text-sm font-medium text-foreground">{t('general.gitlabCLIPath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.gitlabCLIPathDescription')}</p>
          <Input
            id="gitlabCLIPath"
            placeholder={t('general.gitlabCLIPathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.gitlabCLIPath || ''}
            onChange={(e) => onSettingsChange({ ...settings, gitlabCLIPath: e.target.value })}
          />
          {!settings.gitlabCLIPath && (
            <ToolDetectionDisplay
              info={toolsInfo?.glab || null}
              isLoading={isLoadingTools}
              t={t}
            />
          )}
        </div>
        <div className="space-y-3">
          <Label htmlFor="claudePath" className="text-sm font-medium text-foreground">{t('general.claudePath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.claudePathDescription')}</p>
          <Input
            id="claudePath"
            placeholder={t('general.claudePathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.claudePath || ''}
            onChange={(e) => onSettingsChange({ ...settings, claudePath: e.target.value })}
          />
          {!settings.claudePath && (
            <ToolDetectionDisplay
              info={toolsInfo?.claude || null}
              isLoading={isLoadingTools}
              t={t}
            />
          )}
        </div>
        <div className="space-y-3">
          <Label htmlFor="autoBuildPath" className="text-sm font-medium text-foreground">{t('general.autoClaudePath')}</Label>
          <p className="text-sm text-muted-foreground">{t('general.autoClaudePathDescription')}</p>
          <Input
            id="autoBuildPath"
            placeholder={t('general.autoClaudePathPlaceholder')}
            className="w-full max-w-lg"
            value={settings.autoBuildPath || ''}
            onChange={(e) => onSettingsChange({ ...settings, autoBuildPath: e.target.value })}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
