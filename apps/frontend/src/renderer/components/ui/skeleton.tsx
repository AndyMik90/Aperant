import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
}

/**
 * UX-3: Loading skeleton component for smooth perceived performance.
 * Replaces spinners with animated placeholder shapes.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-muted/60',
        className
      )}
    />
  );
}

/**
 * Skeleton for text lines
 */
export function SkeletonText({ className, lines = 1 }: SkeletonProps & { lines?: number }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for circular avatars/icons
 */
export function SkeletonCircle({ className, size = 'md' }: SkeletonProps & { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-14 w-14'
  };

  return (
    <Skeleton className={cn('rounded-full', sizeClasses[size], className)} />
  );
}

/**
 * Skeleton for buttons
 */
export function SkeletonButton({ className }: SkeletonProps) {
  return (
    <Skeleton className={cn('h-9 w-24 rounded-md', className)} />
  );
}
