import { Key, ExternalLink, Loader2, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from './CollapsibleSection';
import { StatusBadge } from './StatusBadge';
import { PasswordInput } from './PasswordInput';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import type { ProjectEnvConfig } from '../../../shared/types';

interface ClaudeAuthSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  envConfig: ProjectEnvConfig | null;
  isLoadingEnv: boolean;
  envError: string | null;
  isCheckingAuth: boolean;
  authStatus: 'checking' | 'authenticated' | 'not_authenticated' | 'error';
  onClaudeSetup: () => void;
  onUpdateConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

export function ClaudeAuthSection({
  isExpanded,
  onToggle,
  envConfig,
  isLoadingEnv,
  envError,
  isCheckingAuth,
  authStatus,
  onClaudeSetup,
  onUpdateConfig,
}: ClaudeAuthSectionProps) {
  const { t } = useTranslation('settings');
  const badge = authStatus === 'authenticated' ? (
    <StatusBadge status="success" label={t('projectSettings.claudeAuth.connected')} />
  ) : authStatus === 'not_authenticated' ? (
    <StatusBadge status="warning" label={t('projectSettings.claudeAuth.notConnected')} />
  ) : null;

  return (
    <CollapsibleSection
      title={t('projectSettings.claudeAuth.title')}
      icon={<Key className="h-4 w-4" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={badge}
    >
      {isLoadingEnv ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('projectSettings.claudeAuth.loadingConfiguration')}
        </div>
      ) : envConfig ? (
        <>
          {/* Claude CLI Status */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{t('projectSettings.claudeAuth.claudeCli')}</p>
                <p className="text-xs text-muted-foreground">
                  {isCheckingAuth ? t('projectSettings.claudeAuth.checking') :
                    authStatus === 'authenticated' ? t('projectSettings.claudeAuth.authenticatedOAuth') :
                    authStatus === 'not_authenticated' ? t('projectSettings.claudeAuth.notAuthenticated') :
                    t('projectSettings.claudeAuth.statusUnknown')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onClaudeSetup}
                disabled={isCheckingAuth}
              >
                {isCheckingAuth ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {authStatus === 'authenticated' ? t('projectSettings.claudeAuth.reAuthenticate') : t('projectSettings.claudeAuth.setupOAuth')}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Manual OAuth Token */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground">
                {t('projectSettings.claudeAuth.oauthToken')} {envConfig.claudeTokenIsGlobal ? t('projectSettings.claudeAuth.override') : ''}
              </Label>
              {envConfig.claudeTokenIsGlobal && (
                <span className="flex items-center gap-1 text-xs text-info">
                  <Globe className="h-3 w-3" />
                  {t('projectSettings.claudeAuth.usingGlobalToken')}
                </span>
              )}
            </div>
            {envConfig.claudeTokenIsGlobal ? (
              <p className="text-xs text-muted-foreground">
                {t('projectSettings.claudeAuth.usingTokenFromApp')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('projectSettings.claudeAuth.pasteTokenFrom')} <code className="px-1 bg-muted rounded">{t('projectSettings.claudeAuth.pasteTokenHint')}</code>
              </p>
            )}
            <PasswordInput
              value={envConfig.claudeTokenIsGlobal ? '' : (envConfig.claudeOAuthToken || '')}
              onChange={(value) => onUpdateConfig({
                claudeOAuthToken: value || undefined,
              })}
              placeholder={envConfig.claudeTokenIsGlobal ? t('projectSettings.claudeAuth.enterToOverride') : t('projectSettings.claudeAuth.placeholder')}
            />
          </div>
        </>
      ) : envError ? (
        <p className="text-sm text-destructive">{envError}</p>
      ) : null}
    </CollapsibleSection>
  );
}
