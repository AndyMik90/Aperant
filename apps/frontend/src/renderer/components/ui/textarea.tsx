import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, spellCheck, lang, ...props }, ref) => {
    const { i18n } = useTranslation();

    return (
      <textarea
        spellCheck={spellCheck ?? true}
        lang={lang ?? i18n.language}
        className={cn(
          'flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors duration-200',
          'resize-none',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
