import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface ConnectionStatusProps {
  isChecking: boolean;
  isConnected: boolean;
  title: string;
  successMessage?: string;
  errorMessage?: string;
  additionalInfo?: string;
}

export function ConnectionStatus({
  isChecking,
  isConnected,
  title,
  successMessage,
  errorMessage,
  additionalInfo,
}: ConnectionStatusProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? t('projectSettings.connectionStatus.checking') : isConnected ? successMessage : errorMessage}
          </p>
          {additionalInfo && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              {additionalInfo}
            </p>
          )}
        </div>
        {isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isConnected ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
      </div>
    </div>
  );
}
