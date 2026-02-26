import { lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';

function MarkdownFallback() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-muted rounded w-3/4" />
      <div className="h-4 bg-muted rounded w-1/2" />
      <div className="h-4 bg-muted rounded w-5/6" />
    </div>
  );
}

interface LazyMarkdownProps {
  children: string;
  components?: Components;
  className?: string;
}

const LazyMarkdownInner = lazy(() =>
  Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]).then(([ReactMarkdownMod, remarkGfmMod]) => ({
    default: function MarkdownRenderer(props: LazyMarkdownProps) {
      const content = (
        <ReactMarkdownMod.default remarkPlugins={[remarkGfmMod.default]} components={props.components}>
          {props.children}
        </ReactMarkdownMod.default>
      );
      if (props.className) {
        return <div className={props.className}>{content}</div>;
      }
      return content;
    }
  }))
);

export function LazyMarkdown({ children, components, className }: LazyMarkdownProps) {
  return (
    <Suspense fallback={<MarkdownFallback />}>
      <LazyMarkdownInner components={components} className={className}>
        {children}
      </LazyMarkdownInner>
    </Suspense>
  );
}
