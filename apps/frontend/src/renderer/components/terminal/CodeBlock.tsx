/**
 * CodeBlock - Enhanced code block display with copy functionality
 *
 * Displays code with optional filename header and copy button.
 * Future: Add syntax highlighting with prism or similar.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

export function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden bg-background/80">
      {/* Header with filename/language and copy button */}
      {(filename || language) && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-xs font-mono text-muted-foreground">
            {filename || language || 'code'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={handleCopy}
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      )}

      {/* Code content */}
      <div className="relative">
        {!filename && !language && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-6 px-2 z-10"
            onClick={handleCopy}
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        )}
        <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed">
          <code className="text-foreground/90">{code}</code>
        </pre>
      </div>
    </div>
  );
}
