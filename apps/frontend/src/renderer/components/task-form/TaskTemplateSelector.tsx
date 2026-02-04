/**
 * TaskTemplateSelector - Dropdown for selecting and managing task templates
 *
 * SUG-5: Task Templates
 * Allows users to save task configurations as templates and apply them
 * to new task creation. Includes built-in templates and user-created templates.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, ChevronDown, Plus, Trash2, Settings2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { toast } from '../../hooks/use-toast';
import {
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  createTemplateFromForm,
} from '../../stores/task-store';
import type { TaskTemplate, TaskCategory, TaskPriority, TaskComplexity, TaskImpact, ModelType, ThinkingLevel } from '../../../shared/types';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../../shared/types/settings';

// Built-in templates that are always available
const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: 'built-in-bug-fix',
    name: 'Bug Fix',
    description: 'High priority bug fix with review required',
    category: 'bug_fix',
    priority: 'high',
    complexity: 'small',
    impact: 'medium',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: 'built-in-feature',
    name: 'New Feature',
    description: 'Standard feature with medium complexity',
    category: 'feature',
    priority: 'medium',
    complexity: 'medium',
    impact: 'medium',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: 'built-in-quick-fix',
    name: 'Quick Fix',
    description: 'Trivial fix, no review needed',
    category: 'bug_fix',
    priority: 'low',
    complexity: 'trivial',
    impact: 'low',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: 'built-in-refactor',
    name: 'Refactoring',
    description: 'Code cleanup with low impact',
    category: 'refactoring',
    priority: 'low',
    complexity: 'medium',
    impact: 'low',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
];

interface CurrentFormValues {
  category?: TaskCategory | '';
  priority?: TaskPriority | '';
  complexity?: TaskComplexity | '';
  impact?: TaskImpact | '';
  profileId?: string;
  model?: ModelType | '';
  thinkingLevel?: ThinkingLevel | '';
  phaseModels?: PhaseModelConfig;
  phaseThinking?: PhaseThinkingConfig;
}

interface TaskTemplateSelectorProps {
  /** Callback when a template is applied */
  onApplyTemplate: (template: TaskTemplate) => void;
  /** Current form values for saving as template */
  currentValues: CurrentFormValues;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

export function TaskTemplateSelector({
  onApplyTemplate,
  currentValues,
  disabled = false,
}: TaskTemplateSelectorProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<TaskTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');

  // Load user templates
  const userTemplates = useMemo(() => loadTemplates(), [showSaveDialog, showDeleteConfirm]);

  const handleApplyTemplate = (template: TaskTemplate) => {
    onApplyTemplate(template);
    toast({
      title: t('tasks:templates.templateApplied'),
      description: template.name,
    });
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;

    const template = createTemplateFromForm(templateName.trim(), {
      description: templateDescription.trim() || undefined,
      category: currentValues.category || undefined,
      priority: currentValues.priority || undefined,
      complexity: currentValues.complexity || undefined,
      impact: currentValues.impact || undefined,
      profileId: currentValues.profileId,
      model: currentValues.model || undefined,
      thinkingLevel: currentValues.thinkingLevel || undefined,
      phaseModels: currentValues.phaseModels,
      phaseThinking: currentValues.phaseThinking,
    });

    saveTemplate(template);

    toast({
      title: t('tasks:templates.templateSaved'),
      description: templateName.trim(),
    });

    setTemplateName('');
    setTemplateDescription('');
    setShowSaveDialog(false);
  };

  const handleDeleteTemplate = (template: TaskTemplate) => {
    deleteTemplate(template.id);
    toast({
      title: t('tasks:templates.templateDeleted'),
      description: template.name,
    });
    setShowDeleteConfirm(null);
  };

  // Get translated built-in template names
  const getBuiltInName = (template: TaskTemplate): string => {
    switch (template.id) {
      case 'built-in-bug-fix':
        return t('tasks:templates.builtIn.bugFix');
      case 'built-in-feature':
        return t('tasks:templates.builtIn.feature');
      case 'built-in-quick-fix':
        return t('tasks:templates.builtIn.quickFix');
      case 'built-in-refactor':
        return t('tasks:templates.builtIn.refactor');
      default:
        return template.name;
    }
  };

  const getBuiltInDescription = (template: TaskTemplate): string => {
    switch (template.id) {
      case 'built-in-bug-fix':
        return t('tasks:templates.builtIn.bugFixDesc');
      case 'built-in-feature':
        return t('tasks:templates.builtIn.featureDesc');
      case 'built-in-quick-fix':
        return t('tasks:templates.builtIn.quickFixDesc');
      case 'built-in-refactor':
        return t('tasks:templates.builtIn.refactorDesc');
      default:
        return template.description || '';
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-2"
          >
            <Bookmark className="h-4 w-4" />
            {t('tasks:templates.useTemplate')}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* Built-in templates */}
          <DropdownMenuLabel className="flex items-center gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            {t('tasks:templates.builtInTemplates')}
          </DropdownMenuLabel>
          {BUILT_IN_TEMPLATES.map((template) => (
            <DropdownMenuItem
              key={template.id}
              onClick={() => handleApplyTemplate(template)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <span className="font-medium">{getBuiltInName(template)}</span>
              <span className="text-xs text-muted-foreground">
                {getBuiltInDescription(template)}
              </span>
            </DropdownMenuItem>
          ))}

          {/* User templates */}
          {userTemplates.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2">
                <Bookmark className="h-3.5 w-3.5" />
                {t('tasks:templates.myTemplates')}
              </DropdownMenuLabel>
              {userTemplates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div
                    className="flex-1 flex flex-col items-start gap-0.5 cursor-pointer"
                    onClick={() => handleApplyTemplate(template)}
                  >
                    <span className="font-medium">{template.name}</span>
                    {template.description && (
                      <span className="text-xs text-muted-foreground">
                        {template.description}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-50 hover:opacity-100 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(template);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuItem>
              ))}
            </>
          )}

          {/* Save current as template */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowSaveDialog(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t('tasks:templates.saveAsTemplate')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Template Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tasks:templates.saveAsTemplate')}</DialogTitle>
            <DialogDescription>
              {t('tasks:templates.noTemplatesHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">
                {t('tasks:templates.templateName')}
              </Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t('tasks:templates.templateNamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">
                {t('tasks:templates.templateDescription')}
              </Label>
              <Textarea
                id="template-description"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder={t('tasks:templates.templateDescriptionPlaceholder')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleSaveTemplate} disabled={!templateName.trim()}>
              {t('tasks:templates.createTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('tasks:templates.deleteConfirm', { name: showDeleteConfirm?.name })}
            </DialogTitle>
            <DialogDescription>
              {t('tasks:templates.deleteConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteConfirm && handleDeleteTemplate(showDeleteConfirm)}
            >
              {t('tasks:templates.deleteTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
