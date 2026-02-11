/**
 * SpecList — Renders a list of specs with loading and empty states.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */
import * as React from 'react';
import type { Task, TaskMetadata } from '@auto-claude/types';
import { SpecCard } from './SpecCard';
import { cn } from '../utils';

export interface SpecListProps {
  specs: Task[];
  isLoading?: boolean;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onView?: (id: string) => void;
  emptyStateMessage?: string;
  filter?: Partial<TaskMetadata>;
  sortBy?: string;
  // Future phase optional fields
  // feedbackLinks?: ... (Phase 5)
  // onViewFeedback?: ... (Phase 5)
  // sharedWithTeam?: ... (Phase 6)
  // teamContext?: ... (Phase 6)
}

/** Apply metadata filter to specs */
function applyFilter(specs: Task[], filter?: Partial<TaskMetadata>): Task[] {
  if (!filter) return specs;
  return specs.filter((spec) => {
    const meta = spec.metadata;
    if (!meta) return false;
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && meta[key as keyof TaskMetadata] !== value) {
        return false;
      }
    }
    return true;
  });
}

/** Sort specs by a given field */
function applySortBy(specs: Task[], sortBy?: string): Task[] {
  if (!sortBy) return specs;
  return [...specs].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title);
      case 'status':
        return a.status.localeCompare(b.status);
      case 'createdAt':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'updatedAt':
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });
}

function SpecList({
  specs,
  isLoading = false,
  onCreate,
  onEdit,
  onDelete,
  onView,
  emptyStateMessage = 'No specs found.',
  filter,
  sortBy,
}: SpecListProps) {
  const filtered = applySortBy(applyFilter(specs, filter), sortBy);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>
        {onCreate && (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={onCreate}
          >
            Create Spec
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {filtered.map((spec) => (
        <SpecCard
          key={spec.id}
          spec={spec}
          onEdit={onEdit}
          onDelete={onDelete}
          onView={onView}
        />
      ))}
    </div>
  );
}

export { SpecList };
