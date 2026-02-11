/**
 * PersonaList — Renders a list of agent personas with loading and empty states.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */
import * as React from 'react';
import type { AgentProfile } from '@auto-claude/types';
import { PersonaCard } from './PersonaCard';

export interface PersonaListProps {
  personas: AgentProfile[];
  isLoading?: boolean;
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSelect?: (id: string) => void;
  activePersonaId?: string;
  emptyStateMessage?: string;
  // Future phase optional fields
  // sharedWithTeam?: ... (Phase 6)
  // teamContext?: ... (Phase 6)
}

function PersonaList({
  personas,
  isLoading = false,
  onCreate,
  onEdit,
  onDelete,
  onSelect,
  activePersonaId,
  emptyStateMessage = 'No personas found.',
}: PersonaListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>
        {onCreate && (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={onCreate}
          >
            Create Persona
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {personas.map((persona) => (
        <PersonaCard
          key={persona.id}
          persona={persona}
          onEdit={onEdit}
          onDelete={onDelete}
          onSelect={onSelect}
          isActive={persona.id === activePersonaId}
        />
      ))}
    </div>
  );
}

export { PersonaList };
