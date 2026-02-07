/**
 * Skeleton - Placeholder loading animation
 *
 * @see https://ui.shadcn.com/docs/components/skeleton
 */

import { cn } from '../../lib/utils';

/* -- Components ----------------------------------------------------------- */

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/* -- Exports -------------------------------------------------------------- */

export { Skeleton };
