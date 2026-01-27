import { useState } from 'react';
import { Loader2, GitPullRequest } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog';

interface CreateMergeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultSourceBranch?: string;
  defaultTargetBranch?: string;
  onSuccess?: (mrIid: number) => void;
}

export function CreateMergeRequestDialog({
  open,
  onOpenChange,
  projectId,
  defaultSourceBranch = '',
  defaultTargetBranch = 'main',
  onSuccess
}: CreateMergeRequestDialogProps) {
  const { t } = useTranslation(['gitlab', 'common']);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceBranch, setSourceBranch] = useState(defaultSourceBranch);
  const [targetBranch, setTargetBranch] = useState(defaultTargetBranch);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim() || !sourceBranch.trim() || !targetBranch.trim()) {
      setError(t('gitlab:createMR.validation.requiredFields'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const result = await window.electronAPI.createGitLabMergeRequest(projectId, {
        sourceBranch: sourceBranch.trim(),
        targetBranch: targetBranch.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
      });

      if (result.success && result.data) {
        onSuccess?.(result.data.iid);
        onOpenChange(false);
        // Reset form
        setTitle('');
        setDescription('');
        setSourceBranch(defaultSourceBranch);
        setTargetBranch(defaultTargetBranch);
      } else {
        setError(result.error || t('gitlab:createMR.errors.createFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitlab:createMR.errors.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5" />
            {t('gitlab:createMR.title')}
          </DialogTitle>
          <DialogDescription>
            {t('gitlab:createMR.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t('gitlab:createMR.fields.title')}</Label>
            <Input
              id="title"
              placeholder={t('gitlab:createMR.placeholders.title')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="source">{t('gitlab:createMR.fields.sourceBranch')}</Label>
              <Input
                id="source"
                placeholder={t('gitlab:createMR.placeholders.sourceBranch')}
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target">{t('gitlab:createMR.fields.targetBranch')}</Label>
              <Input
                id="target"
                placeholder={t('gitlab:createMR.placeholders.targetBranch')}
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('gitlab:createMR.fields.description')}</Label>
            <Textarea
              id="description"
              placeholder={t('gitlab:createMR.placeholders.description')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('gitlab:createMR.creating')}
              </>
            ) : (
              t('gitlab:createMR.submit')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
