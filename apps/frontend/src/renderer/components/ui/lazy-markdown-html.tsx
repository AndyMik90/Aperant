import { lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';
import { MarkdownFallback } from './markdown-fallback';

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
    <Suspense fallback={<MarkdownFallback lines={2} />}>
      <LazyMarkdownHtmlInner components={components} className={className}>
        {children}
      </LazyMarkdownHtmlInner>
    </Suspense>
  );
}
