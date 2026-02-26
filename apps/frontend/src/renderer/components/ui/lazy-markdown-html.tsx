import { lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';

function MarkdownFallback() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-muted rounded w-3/4" />
      <div className="h-4 bg-muted rounded w-1/2" />
    </div>
  );
}

interface LazyMarkdownHtmlProps {
  children: string;
  components?: Components;
  className?: string;
}

const LazyMarkdownHtmlInner = lazy(() =>
  Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
    import('rehype-raw'),
    import('rehype-sanitize'),
  ]).then(([ReactMarkdownMod, remarkGfmMod, rehypeRawMod, rehypeSanitizeMod]) => ({
    default: function MarkdownHtmlRenderer(props: LazyMarkdownHtmlProps) {
      const content = (
        <ReactMarkdownMod.default
          remarkPlugins={[remarkGfmMod.default]}
          rehypePlugins={[rehypeRawMod.default, rehypeSanitizeMod.default]}
          components={props.components}
        >
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

export function LazyMarkdownHtml({ children, components, className }: LazyMarkdownHtmlProps) {
  return (
    <Suspense fallback={<MarkdownFallback />}>
      <LazyMarkdownHtmlInner components={components} className={className}>
        {children}
      </LazyMarkdownHtmlInner>
    </Suspense>
  );
}
