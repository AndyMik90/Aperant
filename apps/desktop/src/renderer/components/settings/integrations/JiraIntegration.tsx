import { useTranslation } from 'react-i18next';
import { Server, Key, FolderKanban, Mail, AlertCircle } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { PasswordInput } from '../../project-settings/PasswordInput';
import type { ProjectEnvConfig } from '../../../../shared/types';

interface JiraIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

/** Inline validation error display */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-destructive mt-1">
      <AlertCircle className="h-3 w-3" />
      {message}
    </p>
  );
}

function validateUrl(url: string): string | undefined {
  if (!url) return 'Required';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Must use https:// or http://';
    }
  } catch {
    return 'Invalid URL format';
  }
  return undefined;
}

function validateEmail(email: string): string | undefined {
  if (!email) return 'Required';
  if (!email.includes('@')) return 'Invalid email format';
  return undefined;
}

function validateToken(token: string): string | undefined {
  if (!token) return 'Required';
  if (token.length < 8) return 'Token seems too short';
  return undefined;
}

/**
 * JIRA integration settings component.
 * Shows validation errors inline on each field when JIRA is enabled.
 */
export function JiraIntegration({
  envConfig,
  updateEnvConfig,
}: JiraIntegrationProps) {
  const { t } = useTranslation('settings');

  if (!envConfig) {
    return null;
  }

  const isEnabled = envConfig.jiraEnabled || false;
  const host = envConfig.jiraHost || '';
  const email = envConfig.jiraEmail || '';
  const token = envConfig.jiraToken || '';
  const projectKey = envConfig.jiraProjectKey || '';

  // Only show validation when enabled and fields have been touched (non-empty or enabled)
  const showValidation = isEnabled;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('jira.enableIntegration')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('jira.enableIntegrationDescription')}
          </p>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => updateEnvConfig({ jiraEnabled: checked })}
        />
      </div>

      {isEnabled && (
        <>
          {/* Host URL */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium text-foreground">{t('jira.hostUrl')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('jira.hostUrlDescription')}
            </p>
            <Input
              placeholder="https://your-domain.atlassian.net"
              value={host}
              onChange={(e) => updateEnvConfig({ jiraHost: e.target.value })}
              className={showValidation && validateUrl(host) ? 'border-destructive' : ''}
            />
            {showValidation && <FieldError message={validateUrl(host)} />}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium text-foreground">{t('jira.email')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('jira.emailDescription')}
            </p>
            <Input
              placeholder="you@example.com"
              value={email}
              onChange={(e) => updateEnvConfig({ jiraEmail: e.target.value })}
              className={showValidation && validateEmail(email) ? 'border-destructive' : ''}
            />
            {showValidation && <FieldError message={validateEmail(email)} />}
          </div>

          {/* API Token */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium text-foreground">{t('jira.apiToken')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('jira.apiTokenDescription')}{' '}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                {t('jira.atlassianSettings')}
              </a>
            </p>
            <PasswordInput
              value={token}
              onChange={(value) => updateEnvConfig({ jiraToken: value })}
              placeholder="ATATT3xFfGF0..."
            />
            {showValidation && <FieldError message={validateToken(token)} />}
          </div>

          {/* Default Project Key */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium text-foreground">{t('jira.projectKey')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('jira.projectKeyDescription')}
            </p>
            <Input
              placeholder="PROJ"
              value={projectKey}
              onChange={(e) => updateEnvConfig({ jiraProjectKey: e.target.value.toUpperCase() })}
            />
          </div>

          {/* Validation summary when required fields are missing */}
          {showValidation && (validateUrl(host) || validateEmail(email) || validateToken(token)) && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Fill in the required fields above to complete JIRA configuration</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
