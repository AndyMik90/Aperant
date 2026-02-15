/**
 * ScrollArea - Custom scrollbar container
 *
 * @see https://ui.shadcn.com/docs/components/scroll-area
 */

import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../../lib/utils';

/* -- Components ----------------------------------------------------------- */

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    onViewportRef?: (element: HTMLDivElement | null) => void;
  }
>(({ className, children, viewportClassName, onViewportRef, ...props }, ref) => {
  const viewportRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      onViewportRef?.(element);
    },
    [onViewportRef]
  );

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden group/scroll', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-all duration-300 opacity-0 group-hover/scroll:opacity-100 hover:opacity-100',
      orientation === 'vertical' && 'h-full w-1 hover:w-1.5 border-l border-l-transparent p-px',
      orientation === 'horizontal' && 'h-1 hover:h-1.5 flex-col border-t border-t-transparent p-px',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border/60 hover:bg-border transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

/* -- Exports -------------------------------------------------------------- */

export { ScrollArea, ScrollBar };
