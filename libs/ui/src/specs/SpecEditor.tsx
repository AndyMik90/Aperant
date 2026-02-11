/**
 * SpecEditor — Form for creating or editing a spec/task.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */
import * as React from 'react';
import { useState, useCallback } from 'react';
import type {
  Task,
  TaskCategory,
  TaskPriority,
  TaskComplexity,
  TaskImpact,
  ModelTypeShort,
} from '@auto-claude/types';
import { cn } from '../utils';

const CATEGORY_OPTIONS: TaskCategory[] = [
  'feature',
  'bug_fix',
  'refactoring',
  'documentation',
  'security',
  'performance',
  'ui_ux',
  'infrastructure',
  'testing',
];
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const COMPLEXITY_OPTIONS: TaskComplexity[] = ['trivial', 'small', 'medium', 'large', 'complex'];
const IMPACT_OPTIONS: TaskImpact[] = ['low', 'medium', 'high', 'critical'];

export interface SpecEditorData {
  title: string;
  description: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  complexity?: TaskComplexity;
  impact?: TaskImpact;
  model?: ModelTypeShort;
}

export interface SpecEditorProps {
  /** Existing spec for editing; undefined for create mode */
  spec?: Task;
  onSave: (data: SpecEditorData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  availableModels?: ModelTypeShort[];
}

const fieldClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const labelClass = 'text-xs font-medium text-muted-foreground';

const selectClass = cn(fieldClass, 'h-9');

function SpecEditor({ spec, onSave, onCancel, isLoading = false, availableModels }: SpecEditorProps) {
  const [title, setTitle] = useState(spec?.title ?? '');
  const [description, setDescription] = useState(spec?.description ?? '');
  const [category, setCategory] = useState<TaskCategory | ''>(spec?.metadata?.category ?? '');
  const [priority, setPriority] = useState<TaskPriority | ''>(spec?.metadata?.priority ?? '');
  const [complexity, setComplexity] = useState<TaskComplexity | ''>(spec?.metadata?.complexity ?? '');
  const [impact, setImpact] = useState<TaskImpact | ''>(spec?.metadata?.impact ?? '');
  const [model, setModel] = useState<ModelTypeShort | ''>(
    (spec?.metadata?.model as ModelTypeShort) ?? '',
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || !description.trim()) return;
      onSave({
        title: title.trim(),
        description: description.trim(),
        category: category || undefined,
        priority: priority || undefined,
        complexity: complexity || undefined,
        impact: impact || undefined,
        model: model || undefined,
      });
    },
    [title, description, category, priority, complexity, impact, model, onSave],
  );

  const isCreate = !spec;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <div className="space-y-1.5">
        <label htmlFor="spec-title" className={labelClass}>
          Title
        </label>
        <input
          id="spec-title"
          type="text"
          className={fieldClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter spec title"
          disabled={isLoading}
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label htmlFor="spec-description" className={labelClass}>
          Description
        </label>
        <textarea
          id="spec-description"
          className={cn(fieldClass, 'min-h-[120px] resize-y')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the task…"
          disabled={isLoading}
          required
        />
      </div>

      {/* Classification grid */}
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Category */}
          <div className="space-y-1.5">
            <label htmlFor="spec-category" className={labelClass}>
              Category
            </label>
            <select
              id="spec-category"
              className={selectClass}
              value={category}
              onChange={(e) => setCategory((e.target.value || '') as TaskCategory | '')}
              disabled={isLoading}
            >
              <option value="">Select category</option>
              {CATEGORY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label htmlFor="spec-priority" className={labelClass}>
              Priority
            </label>
            <select
              id="spec-priority"
              className={selectClass}
              value={priority}
              onChange={(e) => setPriority((e.target.value || '') as TaskPriority | '')}
              disabled={isLoading}
            >
              <option value="">Select priority</option>
              {PRIORITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Complexity */}
          <div className="space-y-1.5">
            <label htmlFor="spec-complexity" className={labelClass}>
              Complexity
            </label>
            <select
              id="spec-complexity"
              className={selectClass}
              value={complexity}
              onChange={(e) => setComplexity((e.target.value || '') as TaskComplexity | '')}
              disabled={isLoading}
            >
              <option value="">Select complexity</option>
              {COMPLEXITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Impact */}
          <div className="space-y-1.5">
            <label htmlFor="spec-impact" className={labelClass}>
              Impact
            </label>
            <select
              id="spec-impact"
              className={selectClass}
              value={impact}
              onChange={(e) => setImpact((e.target.value || '') as TaskImpact | '')}
              disabled={isLoading}
            >
              <option value="">Select impact</option>
              {IMPACT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Model selection */}
      {availableModels && availableModels.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="spec-model" className={labelClass}>
            Model
          </label>
          <select
            id="spec-model"
            className={selectClass}
            value={model}
            onChange={(e) => setModel((e.target.value || '') as ModelTypeShort | '')}
            disabled={isLoading}
          >
            <option value="">Default</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          disabled={isLoading || !title.trim() || !description.trim()}
        >
          {isLoading ? 'Saving…' : isCreate ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export { SpecEditor };
