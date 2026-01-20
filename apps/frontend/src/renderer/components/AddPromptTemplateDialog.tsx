/**
 * AddPromptTemplateDialog - Dialog for creating custom AI task split prompt templates
 *
 * This allows users to create their own prompt templates for AI task splitting.
 * Users can specify a title and a custom prompt template.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { PromptTemplate } from '../../shared/types';

interface AddPromptTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplateCreated: (template: Omit<PromptTemplate, 'id'>) => void;
  editingTemplate?: PromptTemplate;
}

export function AddPromptTemplateDialog({
  open,
  onOpenChange,
  onTemplateCreated,
  editingTemplate
}: AddPromptTemplateDialogProps) {
  const { t } = useTranslation(['tasks']);
  const [title, setTitle] = useState(editingTemplate?.title || '');
  const [prompt, setPrompt] = useState(editingTemplate?.prompt || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleClose = () => {
    setTitle('');
    setPrompt('');
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      return;
    }

    if (!prompt.trim()) {
      return;
    }

    setIsSaving(true);

    try {
      await onTemplateCreated({
        title: title.trim(),
        prompt: prompt.trim(),
        isCustom: true
      });
      setTitle('');
      setPrompt('');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {editingTemplate
              ? t('tasks:aiSplitter.promptTemplate.editTemplate')
              : t('tasks:aiSplitter.promptTemplate.createTemplate')
            }
          </DialogTitle>
          <DialogDescription>
            {editingTemplate
              ? t('tasks:aiSplitter.promptTemplate.helpText')
              : t('tasks:aiSplitter.promptTemplate.helpText')
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-title">
              {t('tasks:aiSplitter.promptTemplate.templateTitle')}
            </Label>
            <Input
              id="template-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks:aiSplitter.promptTemplate.templateTitlePlaceholder')}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-prompt">
              {t('tasks:aiSplitter.promptTemplate.templatePrompt')}
            </Label>
            <Textarea
              id="template-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('tasks:aiSplitter.promptTemplate.templatePromptPlaceholder')}
              className="min-h-[200px] resize-y font-mono text-sm"
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {t('tasks:aiSplitter.promptTemplate.templatePromptPlaceholder')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
          >
            {t('common:buttons.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !prompt.trim()}
            className="gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common:buttons.saving')}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {editingTemplate
                  ? t('tasks:aiSplitter.promptTemplate.updateTemplate')
                  : t('tasks:aiSplitter.promptTemplate.createTemplate')
                }
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
