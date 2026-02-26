export function MarkdownFallback({ lines = 3 }: { lines?: number }) {
  const widths = ['w-3/4', 'w-1/2', 'w-5/6'];
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`h-4 bg-muted rounded ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}
