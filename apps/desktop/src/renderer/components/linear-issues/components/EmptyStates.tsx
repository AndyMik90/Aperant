import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { Button } from '../../ui/button';
import type { LinearEmptyStateProps, LinearNotConnectedStateProps } from '../types';

export function EmptyState({ searchQuery, icon: Icon, message }: LinearEmptyStateProps) {
  const { t } = useTranslation('common');

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        {Icon ? (
          <Icon className="h-6 w-6 text-muted-foreground" />
        ) : (
          <svg
            className="h-6 w-6 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0ZM12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm-.5 5.25a.75.75 0 0 0-1.5 0v5.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5H11.5V6.25Z" />
          </svg>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {searchQuery
          ? t('linear.noSearchResults', 'No issues match your search')
          : message}
      </p>
    </div>
  );
}

export function NotConnectedState({ error, onOpenSettings }: LinearNotConnectedStateProps) {
  const { t } = useTranslation('common');

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <svg
          className="h-8 w-8 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2.5 12a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0ZM12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm-.5 5.25a.75.75 0 0 0-1.5 0v5.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5H11.5V6.25Z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {t('linear.notConnected', 'Linear Not Connected')}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {error ||
          t(
            'linear.notConnectedDescription',
            'Configure your Linear API key in project settings to sync issues.'
          )}
      </p>
      {onOpenSettings && (
        <Button onClick={onOpenSettings} variant="outline">
          <Settings2 className="h-4 w-4 mr-2" />
          {t('buttons.openSettings', 'Open Settings')}
        </Button>
      )}
    </div>
  );
}
