import { Card, CardContent } from './ui/card';
import { Skeleton, SkeletonText } from './ui/skeleton';
import { cn } from '../lib/utils';

interface TaskCardSkeletonProps {
  className?: string;
}

/**
 * UX-3: Skeleton loader for TaskCard component.
 * Displays while task data is loading for smoother perceived performance.
 */
export function TaskCardSkeleton({ className }: TaskCardSkeletonProps) {
  return (
    <Card className={cn('w-full overflow-hidden', className)}>
      <CardContent className="p-4">
        {/* Header with category badge and status */}
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-5 w-20" /> {/* Category badge */}
          <Skeleton className="h-5 w-16" /> {/* Status badge */}
        </div>

        {/* Title */}
        <Skeleton className="h-6 w-3/4 mb-2" />

        {/* Description */}
        <SkeletonText lines={2} className="mb-4" />

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between mb-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-2 w-full" />
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-4 w-12" /> {/* Complexity */}
          <Skeleton className="h-4 w-12" /> {/* Priority */}
          <Skeleton className="h-4 w-16" /> {/* Time */}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Multiple skeleton cards for loading states
 */
export function TaskCardSkeletonList({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <TaskCardSkeleton key={i} />
      ))}
    </div>
  );
}
