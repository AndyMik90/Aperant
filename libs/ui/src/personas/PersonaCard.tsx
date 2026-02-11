/**
 * PersonaCard — Displays a single agent persona/profile with model and thinking info.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */
import * as React from 'react';
import type { AgentProfile } from '@auto-claude/types';
import { cn } from '../utils';

const MODEL_BADGE_COLORS: Record<string, string> = {
  opus: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'opus-1m': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'opus-4.5': 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  sonnet: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  haiku: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

const MODEL_LABELS: Record<string, string> = {
  opus: 'Opus',
  'opus-1m': 'Opus 1M',
  'opus-4.5': 'Opus 4.5',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

const THINKING_INDICATORS: Record<string, { label: string; bars: number }> = {
  low: { label: 'Low', bars: 1 },
  medium: { label: 'Medium', bars: 2 },
  high: { label: 'High', bars: 3 },
};

export interface PersonaCardProps {
  persona: AgentProfile;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSelect?: (id: string) => void;
  isActive?: boolean;
  compact?: boolean;
}

function PersonaCard({
  persona,
  onEdit,
  onDelete,
  onSelect,
  isActive = false,
  compact = false,
}: PersonaCardProps) {
  const thinking = THINKING_INDICATORS[persona.thinkingLevel] ?? THINKING_INDICATORS.medium;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card text-card-foreground shadow-sm transition-colors',
        isActive ? 'border-primary ring-1 ring-primary/30' : 'border-border',
        onSelect && 'cursor-pointer hover:border-primary/50',
        compact ? 'p-3' : 'p-4',
      )}
      onClick={() => onSelect?.(persona.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(persona.id);
        }
      }}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      {/* Header: name + active indicator */}
      <div className="flex items-start justify-between gap-2">
        <h3 className={cn('font-medium leading-tight', compact ? 'text-sm' : 'text-base')}>
          {persona.name}
        </h3>
        {isActive && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Active
          </span>
        )}
      </div>

      {/* Description */}
      {persona.description && !compact && (
        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{persona.description}</p>
      )}

      {/* Model badge + thinking level */}
      <div className={cn('flex flex-wrap items-center gap-2', compact ? 'mt-2' : 'mt-3')}>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            MODEL_BADGE_COLORS[persona.model] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {MODEL_LABELS[persona.model] ?? persona.model}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-flex gap-0.5">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'inline-block h-2.5 w-1 rounded-sm',
                  i <= thinking.bars ? 'bg-foreground/60' : 'bg-muted',
                )}
              />
            ))}
          </span>
          {thinking.label}
        </span>
      </div>

      {/* Actions */}
      {(onEdit || onDelete) && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
          {onEdit && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(persona.id);
              }}
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="text-xs text-destructive hover:text-destructive/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(persona.id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { PersonaCard };
