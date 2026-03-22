import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Progress } from '../../ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog';

interface JiraInvestigationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueKey: string;
  issueSummary: string;
  projectId: string;
}

type InvestigationPhase = 'idle' | 'fetching' | 'creating_task' | 'complete' | 'error';

export function JiraInvestigationDialog({
  open,
  onOpenChange,
  issueKey,
  issueSummary,
  projectId
}: JiraInvestigationDialogProps) {
  const { t } = useTranslation('jira');
  const [phase, setPhase] = useState<InvestigationPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setProgress(0);
      setMessage('');
      setError('');
    }
  }, [open]);

  // Listen for backend investigation events
  useEffect(() => {
    if (!open || phase === 'idle') return;

    const removeProgress = window.electronAPI.onJiraInvestigationProgress(
      (projId, status) => {
        if (projId !== projectId) return;
        setProgress(status.progress);
        setMessage(status.message);
        if (status.phase === 'complete') {
          setPhase('complete');
        } else {
          setPhase(status.phase as InvestigationPhase);
        }
      }
    );

    const removeComplete = window.electronAPI.onJiraInvestigationComplete(
      (projId, _result) => {
        if (projId !== projectId) return;
        setPhase('complete');
        setProgress(100);
        setMessage(t('investigation.taskCreated'));
      }
    );

    const removeError = window.electronAPI.onJiraInvestigationError(
      (projId, err) => {
        if (projId !== projectId) return;
        setPhase('error');
        setError(err);
      }
    );

    return () => {
      removeProgress();
      removeComplete();
      removeError();
    };
  }, [open, phase, projectId, t]);

  const handleStartInvestigation = useCallback(() => {
    setPhase('fetching');
    setProgress(10);
    setMessage(t('investigation.fetchingDetails'));
    // Fire and forget - backend sends progress events
    window.electronAPI.investigateJiraIssue(projectId, issueKey);
  }, [projectId, issueKey, t]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-info" />
            {t('investigation.title')}
          </DialogTitle>
          <DialogDescription>
            <span>{issueKey}: {issueSummary}</span>
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('investigation.description')}
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-medium mb-2">{t('investigation.willInclude')}</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- {t('investigation.includeTitle')}</li>
                <li>- {t('investigation.includeLink')}</li>
                <li>- {t('investigation.includeLabels')}</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{message}</span>
                <span className="text-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {phase === 'error' && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {phase === 'complete' && (
              <div className="rounded-lg bg-success/10 border border-success/30 p-3 flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t('investigation.taskCreated')}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'idle' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('investigation.cancel')}
              </Button>
              <Button onClick={handleStartInvestigation}>
                <Sparkles className="h-4 w-4 mr-2" />
                {t('detail.createTask')}
              </Button>
            </>
          )}
          {phase !== 'idle' && phase !== 'complete' && phase !== 'error' && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t('investigation.creating')}
            </Button>
          )}
          {phase === 'error' && (
            <Button variant="outline" onClick={handleClose}>
              {t('investigation.close')}
            </Button>
          )}
          {phase === 'complete' && (
            <Button onClick={handleClose}>
              {t('investigation.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
