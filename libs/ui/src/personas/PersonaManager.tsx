/**
 * PersonaManager — Full CRUD management panel for agent personas.
 *
 * Combines PersonaList with an inline editor form for creating/editing personas.
 * Pure prop-driven component with no direct store or i18n dependencies.
 */
import * as React from 'react';
import type { AgentProfile } from '@auto-claude/types';
import { PersonaList } from './PersonaList';
import { cn } from '../utils';

export interface PersonaFormData {
  name: string;
  description: string;
  model: string;
  thinkingLevel: string;
  icon?: string;
}

export interface PersonaManagerProps {
  personas: AgentProfile[];
  activePersonaId?: string;
  onCreate: (data: PersonaFormData) => void;
  onUpdate: (id: string, data: PersonaFormData) => void;
  onDelete: (id: string) => void;
  onSelect?: (id: string) => void;
  isLoading?: boolean;
  maxPersonas?: number;
}

const MODEL_OPTIONS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
] as const;

const THINKING_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

function PersonaManager({
  personas,
  activePersonaId,
  onCreate,
  onUpdate,
  onDelete,
  onSelect,
  isLoading = false,
  maxPersonas,
}: PersonaManagerProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [formData, setFormData] = React.useState<PersonaFormData>({
    name: '',
    description: '',
    model: 'sonnet',
    thinkingLevel: 'medium',
  });

  const atLimit = maxPersonas !== undefined && personas.length >= maxPersonas;

  const handleStartCreate = () => {
    setEditingId(null);
    setFormData({ name: '', description: '', model: 'sonnet', thinkingLevel: 'medium' });
    setIsCreating(true);
  };

  const handleStartEdit = (id: string) => {
    const persona = personas.find((p) => p.id === id);
    if (!persona) return;
    setIsCreating(false);
    setEditingId(id);
    setFormData({
      name: persona.name,
      description: persona.description,
      model: persona.model,
      thinkingLevel: persona.thinkingLevel,
      icon: persona.icon,
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    if (isCreating) {
      onCreate(formData);
    } else if (editingId) {
      onUpdate(editingId, formData);
    }
    handleCancel();
  };

  const renderForm = () => (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <h4 className="text-sm font-medium">
        {isCreating ? 'Create Persona' : 'Edit Persona'}
      </h4>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="persona-name">
          Name
        </label>
        <input
          id="persona-name"
          type="text"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          value={formData.name}
          onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
          placeholder="Persona name"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="persona-desc">
          Description
        </label>
        <input
          id="persona-desc"
          type="text"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          value={formData.description}
          onChange={(e) => setFormData((d) => ({ ...d, description: e.target.value }))}
          placeholder="Brief description"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="persona-model">
            Model
          </label>
          <select
            id="persona-model"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            value={formData.model}
            onChange={(e) => setFormData((d) => ({ ...d, model: e.target.value }))}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="persona-thinking">
            Thinking Level
          </label>
          <select
            id="persona-thinking"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            value={formData.thinkingLevel}
            onChange={(e) => setFormData((d) => ({ ...d, thinkingLevel: e.target.value }))}
          >
            {THINKING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isCreating ? 'Create' : 'Save'}
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Personas</h3>
        {!isCreating && !editingId && (
          <button
            type="button"
            className={cn(
              'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
              atLimit
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-primary/90',
            )}
            onClick={handleStartCreate}
            disabled={atLimit}
            title={atLimit ? `Maximum of ${maxPersonas} personas reached` : undefined}
          >
            New Persona
          </button>
        )}
      </div>

      {/* Inline editor form */}
      {(isCreating || editingId) && renderForm()}

      {/* Persona list */}
      <PersonaList
        personas={personas}
        isLoading={isLoading}
        onEdit={handleStartEdit}
        onDelete={onDelete}
        onSelect={onSelect}
        activePersonaId={activePersonaId}
        emptyStateMessage="No personas configured. Create one to get started."
      />
    </div>
  );
}

export { PersonaManager };
