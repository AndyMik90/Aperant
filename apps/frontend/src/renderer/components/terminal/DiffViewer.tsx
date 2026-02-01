/**
 * DiffViewer - Side-by-side diff display for Edit tool blocks
 *
 * Shows file edits with syntax highlighting and side-by-side comparison
 * similar to VS Code Claude extension.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface DiffViewerProps {
  filename: string;
  oldContent: string;
  newContent: string;
  language?: string;
}

export function DiffViewer({ filename, oldContent, newContent, language }: DiffViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(newContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Simple line-by-line diff
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Calculate diff (simple algorithm - shows all old and all new)
  const maxLines = Math.max(oldLines.length, newLines.length);

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden bg-background">
      {/* Header with filename */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-green-600 dark:text-green-400">Edit</span>
          <span className="text-xs font-mono text-muted-foreground">{filename}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={handleCopy}
          title="Copy new content"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Side-by-side diff view */}
      <div className="grid grid-cols-2 divide-x divide-border">
        {/* Old content (left) */}
        <div className="overflow-x-auto">
          <div className="px-3 py-1 bg-red-500/10 border-b border-border">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Before</span>
          </div>
          <pre className="text-xs font-mono p-3 bg-background/50">
            {oldLines.map((line, i) => (
              <div
                key={`old-${i}`}
                className={cn(
                  "min-h-[1.25rem]",
                  line.trim() && "bg-red-500/10 text-red-900 dark:text-red-100"
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>

        {/* New content (right) */}
        <div className="overflow-x-auto">
          <div className="px-3 py-1 bg-green-500/10 border-b border-border">
            <span className="text-xs font-medium text-green-600 dark:text-green-400">After</span>
          </div>
          <pre className="text-xs font-mono p-3 bg-background/50">
            {newLines.map((line, i) => (
              <div
                key={`new-${i}`}
                className={cn(
                  "min-h-[1.25rem]",
                  line.trim() && "bg-green-500/10 text-green-900 dark:text-green-100"
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
