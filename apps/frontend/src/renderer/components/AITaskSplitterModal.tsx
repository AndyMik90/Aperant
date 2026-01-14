/**
 * AITaskSplitterModal - Modal for using AI to split a block of text into multiple tasks
 *
 * This is useful when you have a list of items from clients or a document
 * that you want to split into separate tasks. Paste the text and AI will
 * parse it into individual tasks that you can then review, edit, and create.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles, X, Plus, Trash2, ChevronLeft, Check } from 'lucide-react';
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
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

export interface SplitTask {
  title: string;
  description: string;
}

interface AITaskSplitterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplitComplete: (tasks: SplitTask[]) => void;
  projectId?: string;
}

type Step = 'input' | 'preview';

export function AITaskSplitterModal({
  open,
  onOpenChange,
  onSplitComplete,
  projectId
}: AITaskSplitterModalProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [step, setStep] = useState<Step>('input');
  const [inputText, setInputText] = useState('');
  const [isSplitting, setIsSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitTasks, setSplitTasks] = useState<SplitTask[]>([]);

  const handleSplit = async () => {
    if (!inputText.trim()) {
      setError(t('tasks:aiSplitter.errors.emptyInput'));
      return;
    }

    setIsSplitting(true);
    setError(null);

    try {
      // Call the backend API to split the text
      const result = await window.electronAPI.splitIntoTasks(projectId || '', inputText);

      if (result.success && result.data) {
        setSplitTasks(result.data);
        setStep('preview');
      } else {
        setError(result.error || t('tasks:aiSplitter.errors.splitFailed'));
      }
    } catch (err) {
      console.error('Failed to split tasks:', err);
      setError(t('tasks:aiSplitter.errors.splitFailed'));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleBack = () => {
    setStep('input');
    setError(null);
  };

  const handleCancel = () => {
    handleClose();
  };

  const handleClose = () => {
    setInputText('');
    setSplitTasks([]);
    setError(null);
    setStep('input');
    onOpenChange(false);
  };

  const updateTask = (index: number, field: keyof SplitTask, value: string) => {
    const updated = [...splitTasks];
    updated[index] = { ...updated[index], [field]: value };
    setSplitTasks(updated);
  };

  const removeTask = (index: number) => {
    const updated = splitTasks.filter((_, i) => i !== index);
    setSplitTasks(updated);
  };

  const handleBulkCreate = () => {
    const validTasks = splitTasks.filter(t => t.title.trim() || t.description.trim());
    if (validTasks.length > 0) {
      onSplitComplete(validTasks);
      handleClose();
    }
  };

  const addNewTask = () => {
    setSplitTasks([...splitTasks, { title: '', description: '' }]);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === 'input'
              ? t('tasks:aiSplitter.title')
              : t('tasks:aiSplitter.previewTitle')
            }
          </DialogTitle>
          <DialogDescription>
            {step === 'input'
              ? t('tasks:aiSplitter.description')
              : t('tasks:aiSplitter.previewDescription')
            }
          </DialogDescription>
        </DialogHeader>

        {step === 'input' ? (
          // Step 1: Input text to split
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-input">{t('tasks:aiSplitter.inputLabel')}</Label>
              <Textarea
                id="task-input"
                placeholder={t('tasks:aiSplitter.inputPlaceholder')}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="min-h-[250px] resize-y"
                disabled={isSplitting}
              />
              <p className="text-xs text-muted-foreground">
                {t('tasks:aiSplitter.inputHint')}
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        ) : (
          // Step 2: Preview and edit tasks
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t('tasks:aiSplitter.taskCount', { count: splitTasks.length })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={addNewTask}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {t('common:buttons.add')}
              </Button>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {splitTasks.map((task, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-border bg-card p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="space-y-1">
                          <Label htmlFor={`task-${index}-title`} className="text-xs">
                            {t('tasks:aiSplitter.taskTitle')}
                          </Label>
                          <Input
                            id={`task-${index}-title`}
                            value={task.title}
                            onChange={(e) => updateTask(index, 'title', e.target.value)}
                            placeholder={t('tasks:aiSplitter.titlePlaceholder')}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`task-${index}-desc`} className="text-xs">
                            {t('tasks:aiSplitter.taskDescription')}
                          </Label>
                          <Textarea
                            id={`task-${index}-desc`}
                            value={task.description}
                            onChange={(e) => updateTask(index, 'description', e.target.value)}
                            placeholder={t('tasks:aiSplitter.descriptionPlaceholder')}
                            className="min-h-[80px] resize-y"
                            rows={3}
                          />
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTask(index)}
                        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                {splitTasks.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('tasks:aiSplitter.noTasks')}
                  </div>
                )}
              </div>
            </ScrollArea>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'input' ? (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isSplitting}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                onClick={handleSplit}
                disabled={isSplitting || !inputText.trim()}
                className="gap-2"
              >
                {isSplitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('tasks:aiSplitter.splitting')}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t('tasks:aiSplitter.continueToPreview')}
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleBack}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('common:buttons.back')}
              </Button>
              <Button
                onClick={handleBulkCreate}
                disabled={splitTasks.length === 0}
                className="gap-2"
              >
                <Check className="h-4 w-4" />
                {t('tasks:aiSplitter.bulkCreate', { count: splitTasks.length })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
