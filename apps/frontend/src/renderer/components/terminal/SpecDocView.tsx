/**
 * SpecDocView: Read-only markdown document viewer for spec files.
 *
 * Loads a file from the spec directory via IPC and displays it in a
 * scrollable area with a copy-to-clipboard button. Used in the bottom
 * panel terminal for the "Spec" and "Prompt" tabs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, FileQuestion, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';

interface SpecDocViewProps {
  taskId: string;
  fileName: string;
  title: string;
}

export function SpecDocView({ taskId, fileName, title }: SpecDocViewProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cacheRef = useRef<Record<string, string | null>>({});

  const loadContent = useCallback(async (bypassCache = false) => {
    // Check cache first (unless bypassing)
    const cacheKey = `${taskId}:${fileName}`;
    if (!bypassCache && cacheRef.current[cacheKey] !== undefined) {
      setContent(cacheRef.current[cacheKey]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.readSpecFile(taskId, fileName);
      if (result.success) {
        const data = result.data ?? null;
        cacheRef.current[cacheKey] = data;
        setContent(data);
      } else {
        setContent(null);
        setError(result.error || t('terminal:bottomPanel.loadFailed', { defaultValue: 'Failed to load file' }));
      }
    } catch (err) {
      console.error(`[SpecDocView] Failed to load ${fileName}:`, err);
      setContent(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId, fileName, t]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // SWEEP-39: Invalidate cache when taskId or fileName changes so stale
  // data from a previous task/file doesn't persist. The cache is keyed by
  // taskId:fileName, but clearing it on prop change ensures a fresh fetch
  // when switching between tasks or files.
  useEffect(() => {
    return () => {
      cacheRef.current = {};
    };
  }, [taskId, fileName]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[SpecDocView] Copy failed:', err);
    }
  }, [content]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('terminal:bottomPanel.loading', { defaultValue: 'Loading...' })}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <AlertCircle className="h-8 w-8 text-destructive opacity-70" />
        <span className="text-sm text-destructive">
          {t('terminal:bottomPanel.loadError', {
            defaultValue: 'Failed to load document'
          })}
        </span>
        <span className="text-xs text-muted-foreground max-w-xs text-center">{error}</span>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 gap-1.5"
          onClick={() => loadContent(true)}
        >
          <RefreshCw className="h-3 w-3" />
          {t('common:actions.retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <FileQuestion className="h-8 w-8 opacity-50" />
        <span className="text-sm">
          {t('terminal:bottomPanel.noFile', {
            title,
            defaultValue: `No ${title} available yet`
          })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-end px-3 py-1 border-b border-border bg-muted/30 gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => loadContent(true)}
          aria-label={t('common:actions.refresh', { defaultValue: 'Refresh' })}
        >
          <RefreshCw className="h-3 w-3" />
          {t('common:actions.refresh', { defaultValue: 'Refresh' })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t('common:actions.copied', { defaultValue: 'Copied' })}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t('common:actions.copy', { defaultValue: 'Copy' })}
            </>
          )}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <pre className={cn(
          "p-4 text-sm font-mono whitespace-pre-wrap break-words",
          "text-foreground leading-relaxed"
        )}>
          {content}
        </pre>
      </ScrollArea>
    </div>
  );
}
