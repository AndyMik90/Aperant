/**
 * Shared ChatCodeBlock - Syntax highlighted code block with copy button.
 *
 * Uses highlight.js for syntax highlighting with language auto-detection.
 */

import { detectLanguageFromPath, highlightCode } from './highlight';
import { CopyButton } from './CopyButton';

interface ChatCodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

export function ChatCodeBlock({ code, language, filename }: ChatCodeBlockProps) {
  const codeLanguage = filename ? detectLanguageFromPath(filename) : language;
  const highlightedCode = highlightCode(code || '', codeLanguage);

  return (
    <div className="py-1.5 font-mono text-xs">
      <div className="rounded-lg border border-border bg-muted/90 overflow-hidden relative group">
        {/* Header with filename and language label */}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/50">
          {filename ? (
            <span className="text-[11px] text-muted-foreground truncate">{filename}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground/60 italic">code</span>
          )}
          <div className="flex items-center gap-2">
            {codeLanguage && (
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/50">
                {codeLanguage}
              </span>
            )}
            {code && (
              <CopyButton content={code} className="opacity-60 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </div>
        {/* Code content */}
        <div className="bg-[#0d1117]">
          <pre
            className="p-3 font-mono text-[11px] overflow-x-auto max-h-96 overflow-y-auto hljs"
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>
      </div>
    </div>
  );
}
