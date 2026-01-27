import { Github, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import type { EmptyStateProps, NotConnectedStateProps } from '../types';

export function EmptyState({ searchQuery, icon: Icon = Github, message }: EmptyStateProps) {
  const { t } = useTranslation('github');
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        {searchQuery ? t('empty.noMatch') : message}
      </p>
    </div>
  );
}

export function NotConnectedState({ error, onOpenSettings }: NotConnectedStateProps) {
  const { t } = useTranslation('github');
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Github className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {t('notConnected.title')}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {error || t('notConnected.description')}
      </p>
      {onOpenSettings && (
        <Button onClick={onOpenSettings} variant="outline">
          <Settings2 className="h-4 w-4 mr-2" />
          {t('notConnected.openSettings')}
        </Button>
      )}
    </div>
  );
}
