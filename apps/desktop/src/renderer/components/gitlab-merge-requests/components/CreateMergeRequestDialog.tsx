import { useState } from 'react';
import { Loader2, GitPullRequest } from 'lucide-react';
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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceBranch, setSourceBranch] = useState(defaultSourceBranch);
  const [targetBranch, setTargetBranch] = useState(defaultTargetBranch);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim() || !sourceBranch.trim() || !targetBranch.trim()) {
      setError('Title, source branch, and target branch are required');
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
        setError(result.error || 'Failed to create merge request');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create merge request');
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
            Create Merge Request
          </DialogTitle>
          <DialogDescription>
            Create a new merge request in GitLab
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Merge request title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="source">Source Branch</Label>
              <Input
                id="source"
                placeholder="feature/my-feature"
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target">Target Branch</Label>
              <Input
                id="target"
                placeholder="main"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe the changes in this merge request..."
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
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Merge Request'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
