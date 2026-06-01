import type { ComponentType } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pencil,
  Trash2,
  Clock,
  TrendingUp,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type { ProviderAccount } from '@shared/types/provider-account';

interface ProviderAccountCardProps {
  account: ProviderAccount;
  onEdit: (account: ProviderAccount) => void;
  onDelete: (id: string) => void;
  onReauth?: (account: ProviderAccount) => void;
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(8, key.length - 8))}${key.slice(-4)}`;
}

function UsageBar({ percent, icon: Icon, tooltipKey }: {
  percent: number;
  icon: ComponentType<{ className?: string }>;
  tooltipKey: string;
}) {
  const { t } = useTranslation('settings');
  const colorClass =
    percent >= 95 ? 'bg-red-500' :
    percent >= 91 ? 'bg-orange-500' :
    percent >= 71 ? 'bg-yellow-500' :
    'bg-green-500';
  const textColorClass =
    percent >= 95 ? 'text-red-500' :
    percent >= 91 ? 'text-orange-500' :
    percent >= 71 ? 'text-yellow-500' :
    'text-muted-foreground';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-muted-foreground" />
          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', colorClass)}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <span className={cn('text-[10px] tabular-nums w-7', textColorClass)}>
            {Math.round(percent)}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{t(tooltipKey)}</TooltipContent>
    </Tooltip>
  );
}

export function ProviderAccountCard({ account, onEdit, onDelete, onReauth }: ProviderAccountCardProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [showKey, setShowKey] = useState(false);

  const isOAuth = account.authType === 'oauth';
  const isCodex = isOAuth && account.provider === 'openai';
  const isClaudeCode = isOAuth && account.provider === 'anthropic';
  const isZaiCodingPlan = account.provider === 'zai' && account.billingModel === 'subscription';
  const isSubscription = isCodex || isClaudeCode || isZaiCodingPlan;
  const sessionPercent = account.usage?.sessionUsagePercent ?? 0;
  const weeklyPercent = account.usage?.weeklyUsagePercent ?? 0;
  const hasUsage = (isOAuth || isZaiCodingPlan) && (sessionPercent > 0 || weeklyPercent > 0);

  const authBadgeLabel = isCodex
    ? t('providers.card.codex')
    : isClaudeCode
      ? t('providers.card.claudeCode')
      : isZaiCodingPlan
        ? t('providers.card.zaiCodingPlan')
        : isOAuth
          ? t('providers.card.oauth')
          : account.provider === 'zai'
            ? t('providers.card.zaiUsageBased')
            : t('providers.card.apiKey');

  const identifier = isCodex
    ? (account.email || t('providers.card.codexSubscription'))
    : isClaudeCode
      ? (account.email || t('providers.card.claudeCodeSubscription'))
      : isZaiCodingPlan
        ? (account.email || t('providers.card.zaiCodingPlanSubscription'))
        : isOAuth
          ? (account.email || (account.usage ? t('providers.card.oauthLinked') : t('providers.card.oauthAccount')))
          : account.baseUrl ?? t('providers.card.noEndpoint');

  return (
    <div
      className="rounded-lg border transition-colors p-3 border-border bg-background hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-2">
        {/* Left: name + badges + identifier */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-medium text-foreground truncate">{account.name}</span>

            {/* Auth type badge */}
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
              isSubscription
                ? 'bg-emerald-500/15 text-emerald-500'
                : isOAuth
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground'
            )}>
              {authBadgeLabel}
            </span>

          </div>

          {/* Identifier row */}
          {!isOAuth && account.apiKey ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-mono">
                {showKey ? account.apiKey : maskKey(account.apiKey)}
              </span>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={showKey ? t('providers.card.hideKey') : t('providers.card.showKey')}
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground truncate block">{identifier}</span>
          )}

          {/* Custom models count for openai-compatible */}
          {account.provider === 'openai-compatible' && account.customModels && account.customModels.length > 0 && (
            <span className="text-[10px] text-muted-foreground mt-1 block">
              {t('providers.card.customModels', { count: account.customModels.length })}
            </span>
          )}

          {/* Usage bars for OAuth accounts */}
          {hasUsage && (
            <div className="flex items-center gap-3 mt-2">
              <UsageBar
                percent={sessionPercent}
                icon={Clock}
                tooltipKey="accounts.priority.sessionUsage"
              />
              <UsageBar
                percent={weeklyPercent}
                icon={TrendingUp}
                tooltipKey="accounts.priority.weeklyUsage"
              />
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(account)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label={t('common:accessibility.editAriaLabel')}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('providers.card.edit')}</TooltipContent>
          </Tooltip>
          {isOAuth && onReauth && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onReauth(account)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label={t('common:accessibility.reAuthenticateProfileAriaLabel')}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('providers.card.reauth')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(account.id)}
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                aria-label={t('common:accessibility.deleteAriaLabel')}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('providers.card.delete')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
