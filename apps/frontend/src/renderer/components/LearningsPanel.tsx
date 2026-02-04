/**
 * LearningsPanel - SUG-23: Persistent Learning Memory
 *
 * Component to view and manage project learnings.
 * Can be used in Settings or Discovery Hub.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Trash2, RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { cn } from '../lib/utils';
import { useLearningsStore, LEARNING_CATEGORY_LABELS, type Learning, type LearningCategory } from '../stores/learnings-store';
import { useProjectStore } from '../stores/project-store';

// Category colors for badges
const CATEGORY_COLORS: Record<LearningCategory, string> = {
  error_handling: 'bg-red-500/10 text-red-500 border-red-500/30',
  code_style: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  architecture: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
  testing: 'bg-green-500/10 text-green-500 border-green-500/30',
  performance: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  security: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  ui_ux: 'bg-pink-500/10 text-pink-500 border-pink-500/30',
  documentation: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30',
  general: 'bg-muted text-muted-foreground border-border'
};

interface LearningItemProps {
  learning: Learning;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function LearningItem({ learning, onDelete, isDeleting }: LearningItemProps) {
  const { t } = useTranslation(['common']);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-3 bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex-1 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Badge
              variant="outline"
              className={cn('text-xs', CATEGORY_COLORS[learning.category])}
            >
              {LEARNING_CATEGORY_LABELS[learning.category]}
            </Badge>
            <span className="text-xs text-muted-foreground">{learning.date}</span>
          </div>
          <p className={cn(
            'mt-1 text-sm',
            !isExpanded && 'line-clamp-2'
          )}>
            {learning.learning}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(learning.id)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <div className="text-xs">
            <span className="text-muted-foreground">{t('common:task')}:</span>{' '}
            <span className="font-medium">{learning.taskTitle}</span>
          </div>
          {learning.context && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('common:context')}:</span>{' '}
              <span>{learning.context}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LearningsPanel() {
  const { t } = useTranslation(['common', 'settings']);
  const selectedProject = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.selectedProjectId)
  );
  const {
    learnings,
    isLoading,
    error,
    loadLearnings,
    removeLearning,
    projectPath
  } = useLearningsStore();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load learnings when project changes
  useEffect(() => {
    if (selectedProject?.path && selectedProject.path !== projectPath) {
      loadLearnings(selectedProject.path);
    }
  }, [selectedProject?.path, projectPath, loadLearnings]);

  const handleRefresh = () => {
    if (selectedProject?.path) {
      loadLearnings(selectedProject.path);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;

    setDeletingId(confirmDeleteId);
    await removeLearning(confirmDeleteId);
    setDeletingId(null);
    setConfirmDeleteId(null);
  };

  if (!selectedProject) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{t('common:noProjectSelected')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{t('settings:learnings.title', 'Project Learnings')}</h3>
          <Badge variant="outline" className="text-xs">
            {learnings.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">
        {t('settings:learnings.description', 'Learnings captured from task feedback are automatically injected into future planning and coding prompts.')}
      </p>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && learnings.length === 0 && (
        <div className="text-center py-8 border rounded-lg bg-muted/50">
          <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">
            {t('settings:learnings.empty', 'No learnings recorded yet.')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('settings:learnings.emptyHint', 'Save feedback as learnings during task review to build up project knowledge.')}
          </p>
        </div>
      )}

      {/* Learnings list */}
      {!isLoading && learnings.length > 0 && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {learnings.map((learning) => (
            <LearningItem
              key={learning.id}
              learning={learning}
              onDelete={handleDelete}
              isDeleting={deletingId === learning.id}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings:learnings.deleteTitle', 'Delete Learning?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:learnings.deleteDescription', 'This learning will be removed from the project. This action cannot be undone.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
