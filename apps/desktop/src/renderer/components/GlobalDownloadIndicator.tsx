import { useState } from 'react';
import { Download, X, ChevronDown, ChevronUp, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDownloadStore } from '../stores/download-store';
import { cn } from '../lib/utils';

/**
 * GlobalDownloadIndicator Component
 *
 * A floating indicator that shows active Ollama model downloads.
 * Appears in the bottom-right corner when downloads are in progress.
 * Can be expanded to show details or minimized to just show count.
 */
export function GlobalDownloadIndicator() {
  const { t } = useTranslation('common');
  const downloads = useDownloadStore((state) => state.downloads);
  const clearDownload = useDownloadStore((state) => state.clearDownload);
  const [isExpanded, setIsExpanded] = useState(true);

  const allDownloads = Object.values(downloads);
  const activeDownloads = allDownloads.filter(
    (d) => d.status === 'starting' || d.status === 'downloading'
  );
  const completedDownloads = allDownloads.filter((d) => d.status === 'completed');
  const failedDownloads = allDownloads.filter((d) => d.status === 'failed');

  // Don't render if no downloads
  if (allDownloads.length === 0) {
    return null;
  }

  const hasActive = activeDownloads.length > 0;

  return (
    <div className="fixed bottom-4 end-4 z-50 max-w-sm">
      <div className="rounded-lg border border-border bg-card shadow-lg overflow-hidden">
        {/* Header */}
        <button
          type="button"
          className={cn(
            'flex items-center justify-between px-3 py-2 cursor-pointer w-full text-start',
            hasActive ? 'bg-primary/10' : 'bg-muted/50'
          )}
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-label={t('downloads.toggleExpand')}
        >
          <div className="flex items-center gap-2">
            {hasActive ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : completedDownloads.length > 0 && failedDownloads.length === 0 ? (
              <Check className="h-4 w-4 text-success" />
            ) : failedDownloads.length > 0 ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Download className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {hasActive
                ? t('downloads.downloading', { count: activeDownloads.length })
                : completedDownloads.length > 0
                  ? t('downloads.complete', { count: completedDownloads.length })
                  : t('downloads.failed', { count: failedDownloads.length })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!hasActive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Clear all completed/failed downloads
                  allDownloads.forEach((d) => {
                    if (d.status === 'completed' || d.status === 'failed') {
                      clearDownload(d.modelName);
                    }
                  });
                }}
                className="p-1 hover:bg-muted rounded"
                aria-label={t('downloads.clearAll')}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Download list (expanded) */}
        {isExpanded && (
          <div className="divide-y divide-border">
            {allDownloads.map((download) => (
              <div key={download.modelName} className="px-3 py-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate max-w-[200px]">
                    {download.modelName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {download.status === 'completed' && (
                      <span className="text-xs text-success flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        {t('downloads.done')}
                      </span>
                    )}
                    {download.status === 'failed' && (
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {t('downloads.failedLabel')}
                      </span>
                    )}
                    {(download.status === 'starting' || download.status === 'downloading') && (
                      <span className="text-xs text-muted-foreground">
                        {download.percentage > 0 ? `${Math.round(download.percentage)}%` : t('downloads.starting')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar for active downloads */}
                {(download.status === 'starting' || download.status === 'downloading') && (
                  <>
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      {download.percentage > 0 ? (
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${download.percentage}%` }}
                        />
                      ) : (
                        <div className="h-full w-1/4 rounded-full bg-primary animate-indeterminate" />
                      )}
                    </div>
                    {(download.speed || download.timeRemaining) && (
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{download.speed || ''}</span>
                        <span className="text-primary">{download.timeRemaining || ''}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Error message for failed downloads */}
                {download.status === 'failed' && download.error && (
                  <p className="text-[10px] text-destructive/80 truncate">{download.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
