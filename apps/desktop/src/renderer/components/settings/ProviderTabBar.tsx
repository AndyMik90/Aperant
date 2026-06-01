import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import type { BuiltinProvider } from '@shared/types/provider-account';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';

const MAX_VISIBLE_TABS = 3;

interface ProviderTabBarProps {
  providers: BuiltinProvider[];
  activeProvider: BuiltinProvider | null;
  onProviderChange: (provider: BuiltinProvider) => void;
  showCrossProvider?: boolean;
  isCrossProviderActive?: boolean;
  onCrossProviderClick?: () => void;
  crossProviderDisabled?: boolean;
  needsSetup?: (provider: BuiltinProvider) => boolean;
}

function getProviderDisplayName(provider: BuiltinProvider): string {
  const info = PROVIDER_REGISTRY.find((p) => p.id === provider);
  return info?.name ?? provider;
}

export function ProviderTabBar({
  providers,
  activeProvider,
  onProviderChange,
  showCrossProvider,
  isCrossProviderActive,
  onCrossProviderClick,
  crossProviderDisabled,
  needsSetup,
}: ProviderTabBarProps) {
  const { t } = useTranslation('settings');

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('agentProfile.providerTabs.noProviders')}
      </p>
    );
  }

  const visibleProviders = providers.slice(0, MAX_VISIBLE_TABS);
  const overflowProviders = providers.slice(MAX_VISIBLE_TABS);
  const hasOverflow = overflowProviders.length > 0;
  const isActiveInOverflow =
    hasOverflow && activeProvider !== null && overflowProviders.includes(activeProvider);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visibleProviders.map((provider) => {
        const isActive = provider === activeProvider;
        const showSetupDot = needsSetup?.(provider) ?? false;
        return (
          <button
            key={provider}
            type="button"
            onClick={() => onProviderChange(provider)}
            className={cn(
              'relative px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {getProviderDisplayName(provider)}
            {showSetupDot && (
              <span className="absolute -top-0.5 -end-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
            )}
          </button>
        );
      })}

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-full transition-colors flex items-center gap-1',
                isActiveInOverflow
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {isActiveInOverflow && activeProvider !== null
                ? getProviderDisplayName(activeProvider)
                : t('agentProfile.providerTabs.moreProviders')}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {overflowProviders.map((provider) => (
              <DropdownMenuItem
                key={provider}
                onClick={() => onProviderChange(provider)}
                className={cn(
                  'relative',
                  provider === activeProvider && 'bg-accent text-accent-foreground'
                )}
              >
                {getProviderDisplayName(provider)}
                {needsSetup?.(provider) && (
                  <span className="ms-2 inline-flex h-2 w-2 rounded-full bg-red-500 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {showCrossProvider && (
        crossProviderDisabled ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'inline-flex px-3 py-1.5 text-sm font-medium rounded-full',
                    'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                  )}
                >
                  {t('agentProfile.providerTabs.crossProvider')}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{t('agentProfile.providerTabs.crossProviderDisabledTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <button
            type="button"
            onClick={onCrossProviderClick}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
              isCrossProviderActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {t('agentProfile.providerTabs.crossProvider')}
          </button>
        )
      )}
    </div>
  );
}
