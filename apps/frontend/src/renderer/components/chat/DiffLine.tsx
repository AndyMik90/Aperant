/**
 * DiffLine - Renders a single diff line with proper background colors.
 * Matches Claude Code terminal style.
 */

import { cn } from '../../lib/utils';

interface DiffLineProps {
  line: string;
  type: 'add' | 'remove' | 'context';
  lineNumber?: number;
}

export function DiffLine({ line, type, lineNumber }: DiffLineProps) {
  const bgClass = type === 'add'
    ? 'bg-green-500/25 border-l-2 border-green-500/50'
    : type === 'remove'
      ? 'bg-red-500/25 border-l-2 border-red-500/50'
      : '';
  const textClass = type === 'add'
    ? 'text-green-300'
    : type === 'remove'
      ? 'text-red-300'
      : 'text-muted-foreground';
  const prefix = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';

  return (
    <div className={cn("flex", bgClass)}>
      {lineNumber !== undefined && (
        <span className="text-muted-foreground/50 w-8 text-right pr-2 select-none flex-shrink-0">
          {lineNumber}
        </span>
      )}
      <span className={cn("flex-1", textClass)}>
        <span className="select-none">{prefix} </span>
        {line || ' '}
      </span>
    </div>
  );
}
