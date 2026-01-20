/**
 * PromptTemplateSelector - Component for selecting AI task split prompt templates
 *
 * This allows users to select a prompt template for AI task splitting.
 * Users can also create, edit, and delete custom templates.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Sparkles, Pencil, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { cn } from '../lib/utils';
import { useSettingsStore } from '../stores/settings-store';
import { DEFAULT_PROMPT_TEMPLATES, type PromptTemplate } from '../../shared/types';
import { AddPromptTemplateDialog } from './AddPromptTemplateDialog';

interface PromptTemplateSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PromptTemplateSelector({ value, onChange, disabled }: PromptTemplateSelectorProps) {
  const { t } = useTranslation(['tasks']);
  const [isOpen, setIsOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | undefined>(undefined);

  // Get all templates (default + custom from settings)
  const settings = useSettingsStore();
  const customTemplates = settings.settings.promptTemplates || [];
  const allTemplates: PromptTemplate[] = [
    ...DEFAULT_PROMPT_TEMPLATES,
    ...customTemplates
  ];

  // Default to 'default' if no value is selected
  const selectedId = value || 'default';
  const selectedTemplate = allTemplates.find(t => t.id === selectedId) || DEFAULT_PROMPT_TEMPLATES[0];

  // Check if selected template is custom
  const isCustomTemplate = selectedTemplate.isCustom;

  const handleSelectTemplate = (templateId: string) => {
    onChange(templateId);
    settings.setSelectedPromptTemplate(templateId);
    setIsOpen(false);
  };

  const handleCreateTemplate = async (template: Omit<PromptTemplate, 'id'>) => {
    if (editingTemplate) {
      // Update existing template
      await settings.updatePromptTemplate({
        ...template,
        id: editingTemplate.id
      });
    } else {
      // Create new template
      await settings.addPromptTemplate(template);
    }
    setEditingTemplate(undefined);
    setIsDialogOpen(false);
    setIsOpen(false);
  };

  const handleEditTemplate = () => {
    setEditingTemplate(selectedTemplate);
    setIsDialogOpen(true);
  };

  const handleDeleteTemplate = async () => {
    if (selectedTemplate.isCustom) {
      await settings.deletePromptTemplate(selectedTemplate.id);
    }
  };

  const handleDialogClose = () => {
    setEditingTemplate(undefined);
    setIsDialogOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="prompt-template" className="text-sm">
          {t('tasks:aiSplitter.promptTemplate.label')}
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              id="prompt-template"
              variant="outline"
              role="combobox"
              aria-expanded={isOpen}
              disabled={disabled}
              className="flex-1 justify-between"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span>{selectedTemplate.title}</span>
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[350px] p-0">
            <div className="max-h-[300px] overflow-y-auto">
              {allTemplates.map((template) => (
                <button
                  key={template.id}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
                    selectedId === template.id && 'bg-accent'
                  )}
                  onClick={() => handleSelectTemplate(template.id)}
                >
                  <span className="font-medium">{template.title}</span>
                  {template.isCustom && (
                    <span className="text-xs text-muted-foreground">Custom</span>
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {isCustomTemplate && (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={handleEditTemplate}
              disabled={disabled}
              aria-label={t('tasks:aiSplitter.promptTemplate.editTemplateAriaLabel')}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleDeleteTemplate}
              disabled={disabled}
              aria-label={t('tasks:aiSplitter.promptTemplate.deleteTemplateAriaLabel')}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsDialogOpen(true)}
          disabled={disabled}
          aria-label={t('tasks:aiSplitter.promptTemplate.addNewAriaLabel')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('tasks:aiSplitter.promptTemplate.helpText')}
      </p>

      <AddPromptTemplateDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        onTemplateCreated={handleCreateTemplate}
        editingTemplate={editingTemplate}
      />
    </div>
  );
}

/**
 * Get the prompt template by ID
 */
export function getPromptTemplate(templateId: string | undefined, settings: PromptTemplate[]): string {
  const allTemplates: PromptTemplate[] = [
    ...DEFAULT_PROMPT_TEMPLATES,
    ...settings
  ];

  const template = allTemplates.find(t => t.id === templateId) || DEFAULT_PROMPT_TEMPLATES[0];
  return template.prompt;
}
