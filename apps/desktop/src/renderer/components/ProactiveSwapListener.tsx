/**
 * Proactive Swap Listener - Listens for and displays proactive swap notifications
 *
 * When a proactive account swap occurs (before hitting rate limits),
 * this component shows a brief notification to inform the user.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';
import { Button } from './ui/button';

interface SwapNotification {
  fromProfile: string;
  toProfile: string;
  reason: string;
  timestamp: Date;
}

export function ProactiveSwapListener() {
  const { t } = useTranslation('common');
  const [notification, setNotification] = useState<SwapNotification | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onProactiveSwapNotification((data) => {
      const notif: SwapNotification = {
        fromProfile: data.fromProfile.name,
        toProfile: data.toProfile.name,
        reason: data.reason,
        timestamp: new Date()
      };

      setNotification(notif);
      setIsVisible(true);

      // Auto-hide after 5 seconds
      setTimeout(() => {
        setIsVisible(false);
      }, 5000);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (!notification || !isVisible) {
    return null;
  }

  return (
    <div className="fixed top-4 end-4 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="bg-card border border-border shadow-lg rounded-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <RefreshCw className="h-4 w-4 text-primary" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('notification.accountSwitched')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('notification.swapFrom')} <strong>{notification.fromProfile}</strong> {t('notification.swapTo')}{' '}
              <strong>{notification.toProfile}</strong>
              <br />
              <span className="text-[10px]">
                {t('notification.swapReason', { reason: notification.reason })}
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={handleDismiss}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
