import { cn } from '../../lib/utils';

export function MarkdownFallback({ lines = 3 }: { lines?: number }) {
  const widths = ['w-3/4', 'w-1/2', 'w-5/6'];
  const safeLines = Math.max(0, Math.floor(Number(lines) || 0));
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: safeLines }, (_, i) => (
        <div key={`skeleton-${i}`} className={cn('h-4 bg-muted rounded', widths[i % widths.length])} />
      ))}
    </div>
  );
}
