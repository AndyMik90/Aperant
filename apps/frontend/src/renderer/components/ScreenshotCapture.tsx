/**
 * ScreenshotCapture - Modal for capturing screenshots
 *
 * Displays available screens and windows in a grid, allowing users to
 * select a source and capture a screenshot.
 *
 * Features:
 * - Grid layout with thumbnail previews
 * - Visual selection with hover effects and checkmarks
 * - High-resolution capture support (handles retina displays)
 * - Loading states and error handling
 * - Refresh button to reload available sources
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, Monitor, Frame, AlertCircle, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import type { ScreenshotSource } from '../../shared/types/screenshot';

interface ScreenshotCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (imageData: string) => void; // base64 encoded PNG
}

/**
 * Get the appropriate paste keyboard shortcut based on platform
 */
const getPasteShortcut = (): string => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return isMac ? 'Cmd+V' : 'Ctrl+V';
};

export function ScreenshotCapture({ open, onOpenChange, onCapture }: ScreenshotCaptureProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [sources, setSources] = useState<ScreenshotSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);

  /**
   * Fetch available screenshot sources
   */
  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsDevMode(false);
    setSelectedSource(null);
    try {
      const result = await window.electronAPI.getSources();

      // Check if running in dev mode (screenshot capture unavailable)
      if (result.devMode) {
        setIsDevMode(true);
        return;
      }

      if (result.success && result.data) {
        setSources(result.data);
      } else {
        setError(result.error || t('tasks:screenshot.errors.getSources'));
      }
    } catch (err) {
      console.error('Failed to fetch screenshot sources:', err);
      setError(err instanceof Error ? err.message : t('tasks:screenshot.errors.fetchSources'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // Fetch sources when dialog opens
  useEffect(() => {
    if (open) {
      fetchSources();
    }
  }, [open, fetchSources]);

  /**
   * Handle capture button click
   */
  const handleCapture = async () => {
    if (!selectedSource) return;

    setIsCapturing(true);
    setError(null);
    try {
      const result = await window.electronAPI.capture({ sourceId: selectedSource });
      if (result.success && result.data) {
        onCapture(result.data);
        onOpenChange(false);
        setSelectedSource(null);
      } else {
        setError(result.error || t('tasks:screenshot.errors.capture'));
      }
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
      setError(err instanceof Error ? err.message : t('tasks:screenshot.errors.captureFailed'));
    } finally {
      setIsCapturing(false);
    }
  };

  /**
   * Determine if a source is a screen or window based on name
   */
  const isScreenSource = (source: ScreenshotSource): boolean => {
    return source.name.toLowerCase().includes('screen') ||
           source.name.toLowerCase().includes('display') ||
           source.name.match(/^\d+:/) !== null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('tasks:screenshot.title')}</DialogTitle>
          <DialogDescription>
            {t('tasks:screenshot.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Dev Mode Info State */}
          {isDevMode && (
            <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-4">
              <Info className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t('tasks:screenshot.devMode.title')}
                </p>
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  {t('tasks:screenshot.devMode.description')}
                </p>
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  {t('tasks:screenshot.devMode.hint', { shortcut: getPasteShortcut() })}
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !isDevMode && (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg mb-4">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-destructive">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSources}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {/* Loading State */}
          {isLoading && sources.length === 0 && !isDevMode && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Sources Grid */}
          {!isLoading && !isDevMode && sources.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-1">
              {sources.map((source) => {
                const isSelected = selectedSource === source.id;
                const isScreen = isScreenSource(source);

                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSource(source.id)}
                    className={`
                      relative group rounded-lg border-2 overflow-hidden
                      transition-all duration-200
                      ${isSelected
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/50 hover:ring-2 hover:ring-primary/10'
                      }
                    `}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video bg-muted relative">
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt={source.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {isScreen ? (
                            <Monitor className="h-12 w-12 text-muted-foreground" />
                          ) : (
                            <Frame className="h-12 w-12 text-muted-foreground" />
                          )}
                        </div>
                      )}

                      {/* Selection Indicator */}
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
                            <svg
                              className="w-6 h-6 text-primary-foreground"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}

                      {/* Type Icon */}
                      <div className="absolute top-2 left-2">
                        <div className={`
                          p-1.5 rounded-md
                          ${isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background/80 text-foreground backdrop-blur-sm'
                          }
                        `}>
                          {isScreen ? (
                            <Monitor className="h-4 w-4" />
                          ) : (
                            <Frame className="h-4 w-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Source Name */}
                    <div className="p-2 bg-background/95 backdrop-blur-sm">
                      <p className="text-sm font-medium truncate text-foreground">
                        {source.name}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !isDevMode && sources.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground max-w-sm">
                {t('tasks:screenshot.noSources')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSources}
                className="mt-4"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {t('common:buttons.retry')}
              </Button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCapturing}
          >
            {t('common:buttons.cancel')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchSources}
              disabled={isLoading || isCapturing || isDevMode}
              title={t('common:buttons.refresh')}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              onClick={handleCapture}
              disabled={!selectedSource || isCapturing || isDevMode}
            >
              {isCapturing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('tasks:screenshot.capturing')}
                </>
              ) : (
                t('tasks:screenshot.capture')
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
