/**
 * QuickTaskDialog - Fast task creation with Cmd+K
 *
 * SUG-2: Quick Task (Cmd+K)
 * Opens a minimal dialog for quick task creation.
 * Type a description, press Enter to create and start planning.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Command, Search, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from './ui/dialog';
import { createTask } from '../stores/task-store';
import { useProjectStore } from '../stores/project-store';
import { useSettingsStore } from '../stores/settings-store';
import { cn } from '../lib/utils';

interface QuickTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onTaskCreated?: (taskId: string) => void;
}

export function QuickTaskDialog({
  open,
  onOpenChange,
  projectId,
  onTaskCreated
}: QuickTaskDialogProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get project and settings
  const project = useProjectStore((state) => state.projects.find(p => p.id === projectId));
  const settings = useSettingsStore((state) => state.settings);

  // Focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay to ensure dialog is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDescription('');
      setError(null);
      setIsCreating(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const trimmedDescription = description.trim();
    if (!trimmedDescription || isCreating || !project) return;

    setIsCreating(true);
    setError(null);

    try {
      const result = await createTask({
        projectId,
        description: trimmedDescription,
        title: '', // Auto-generate from description
        baseBranch: project.defaultBranch,
        useWorktree: true,
        ralphWiggumMode: true, // Always enabled (SUG-22)
        profileId: settings.selectedAgentProfile || 'auto',
        model: '',
        thinkingLevel: '',
        phaseModels: undefined,
        phaseThinking: undefined,
      });

      if (result.success && result.task) {
        onOpenChange(false);
        onTaskCreated?.(result.task.id);
      } else {
        setError(result.error || t('wizard.errors.createFailed'));
      }
    } catch (err) {
      console.error('[QuickTaskDialog] Error creating task:', err);
      setError(t('wizard.errors.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }, [description, isCreating, project, projectId, settings.selectedAgentProfile, onOpenChange, onTaskCreated, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  }, [handleSubmit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        {/* Search-style input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {isCreating ? (
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin flex-shrink-0" />
          ) : (
            <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            className={cn(
              'flex-1 bg-transparent border-none outline-none text-sm',
              'placeholder:text-muted-foreground/60',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            placeholder={t('quickTask.placeholder', { defaultValue: "What do you want to build?" })}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCreating}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex px-2 py-1 text-xs bg-muted rounded border border-border text-muted-foreground">
            Enter
          </kbd>
        </div>

        {/* Hint text */}
        <div className="px-4 py-3 bg-muted/30">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('quickTask.hint', { defaultValue: "Describe your task and press Enter. Jerry will start planning immediately." })}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
