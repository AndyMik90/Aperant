import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui/tooltip';
import type { SyncStatusBadgeProps } from '../types';

export function SyncStatusBadge({ lastSyncEvent }: SyncStatusBadgeProps) {
  const { t } = useTranslation('common');

  if (!lastSyncEvent) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center">
              <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('linear.neverSynced', 'Never synced')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (lastSyncEvent.success) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {t('linear.syncSuccess', 'Synced to Linear')}: {lastSyncEvent.toStatus}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {t('linear.syncFailed', 'Sync failed')}: {lastSyncEvent.error || t('linear.unknownError', 'Unknown error')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
