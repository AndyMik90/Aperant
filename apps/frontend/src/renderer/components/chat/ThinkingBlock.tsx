/**
 * Shared ThinkingBlock - Collapsible thinking content with pulsing indicator.
 *
 * Uses ThinkingExpandContext to toggle all thinking blocks together.
 */

import { createContext, useContext } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Context for coordinating thinking blocks to expand/collapse together */
export const ThinkingExpandContext = createContext<{
  allExpanded: boolean;
  toggleAll: () => void;
}>({ allExpanded: false, toggleAll: () => {} });

interface ThinkingBlockProps {
  content: string;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const { allExpanded, toggleAll } = useContext(ThinkingExpandContext);

  return (
    <div className="py-1.5 font-mono text-xs">
      <div className={cn(
        "rounded-lg border overflow-hidden transition-all",
        allExpanded ? "border-primary/30 bg-primary/5" : "border-border/50 bg-card"
      )}>
        <button
          onClick={toggleAll}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
        >
          {!allExpanded && (
            <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse flex-shrink-0" />
          )}
          <span className="text-muted-foreground italic flex-1 text-left">
            Thinking...
          </span>
          {allExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        {allExpanded && (
          <div className="px-3 py-2 border-t border-primary/20 bg-primary/5">
            <div className="text-[11px] text-muted-foreground/80 italic whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
