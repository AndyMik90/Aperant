import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WindowControls() {
  const { t } = useTranslation('common');
  const [isMaximized, setIsMaximized] = useState(false);
  const isMacOS = window.platform?.isMacOS;

  useEffect(() => {
    if (isMacOS) return;
    window.electronAPI.windowControls.isMaximized().then(setIsMaximized).catch(() => {});
    const cleanup = window.electronAPI.windowControls.onMaximizeChanged(setIsMaximized);
    return cleanup;
  }, [isMacOS]);

  // macOS uses native traffic lights — no custom controls needed
  if (isMacOS) return null;

  const buttonBase = 'inline-flex items-center justify-center h-8 w-11 transition-colors electron-no-drag';

  return (
    <div className="flex items-center electron-no-drag">
      <button
        type="button"
        className={cn(buttonBase, 'hover:bg-muted/80')}
        onClick={() => window.electronAPI.windowControls.minimize()}
        aria-label={t('windowControls.minimize')}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(buttonBase, 'hover:bg-muted/80')}
        onClick={() => window.electronAPI.windowControls.maximize()}
        aria-label={isMaximized ? t('windowControls.restore') : t('windowControls.maximize')}
      >
        {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className={cn(buttonBase, 'hover:bg-destructive hover:text-destructive-foreground')}
        onClick={() => window.electronAPI.windowControls.close()}
        aria-label={t('windowControls.close')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
