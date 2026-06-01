import { useState, useEffect, useCallback } from 'react';
import { Wand2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Progress } from '../../ui/progress';
import type { GitHubIssue } from '../../../../shared/types';
import type { AutoFixConfig, AutoFixProgress, AutoFixQueueItem } from '../../../../preload/api/modules/github-api';

interface AutoFixButtonProps {
  issue: GitHubIssue;
  projectId: string;
  config: AutoFixConfig | null;
  queueItem: AutoFixQueueItem | null;
}

export function AutoFixButton({ issue, projectId, config, queueItem }: AutoFixButtonProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [progress, setProgress] = useState<AutoFixProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // Check if the issue has an auto-fix label
  const hasAutoFixLabel = useCallback(() => {
    if (!config || !config.enabled || !config.labels.length) return false;
    const issueLabels = issue.labels.map(l => l.name.toLowerCase());
    return config.labels.some(label => issueLabels.includes(label.toLowerCase()));
  }, [config, issue.labels]);

  // Listen for progress events
  useEffect(() => {
    const cleanupProgress = window.electronAPI.github.onAutoFixProgress(
      (eventProjectId: string, progressData: AutoFixProgress) => {
        if (eventProjectId === projectId && progressData.issueNumber === issue.number) {
          setProgress(progressData);
          setIsStarting(false);
        }
      }
    );

    const cleanupComplete = window.electronAPI.github.onAutoFixComplete(
      (eventProjectId: string, result: AutoFixQueueItem) => {
        if (eventProjectId === projectId && result.issueNumber === issue.number) {
          setCompleted(true);
          setProgress(null);
          setIsStarting(false);
        }
      }
    );

    const cleanupError = window.electronAPI.github.onAutoFixError(
      (eventProjectId: string, errorData: { issueNumber: number; error: string }) => {
        if (eventProjectId === projectId && errorData.issueNumber === issue.number) {
          setError(errorData.error);
          setProgress(null);
          setIsStarting(false);
        }
      }
    );

    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [projectId, issue.number]);

  // Check if already in queue
  const isInQueue = queueItem && queueItem.status !== 'completed' && queueItem.status !== 'failed';
  const isProcessing = isStarting || progress !== null || isInQueue;

  const handleStartAutoFix = useCallback(() => {
    setIsStarting(true);
    setError(null);
    setCompleted(false);
    window.electronAPI.github.startAutoFix(projectId, issue.number);
  }, [projectId, issue.number]);

  // Don't render if auto-fix is disabled or issue doesn't have the right label
  if (!config?.enabled) {
    return null;
  }

  // Show completed state
  if (completed || queueItem?.status === 'completed') {
    return (
      <div className="flex items-center gap-2 text-success text-sm">
        <CheckCircle2 className="h-4 w-4" />
        <span>Spec created from issue</span>
      </div>
    );
  }

  // Show error state
  if (error || queueItem?.status === 'failed') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error || queueItem?.error || 'Auto-fix failed'}</span>
        </div>
        <Button size="sm" variant="outline" onClick={handleStartAutoFix}>
          <Wand2 className="h-4 w-4 me-2" />
          Retry Auto Fix
        </Button>
      </div>
    );
  }

  // Show progress state
  if (isProcessing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{progress?.message || 'Processing...'}</span>
        </div>
        {progress && (
          <Progress value={progress.progress} className="h-1" />
        )}
      </div>
    );
  }

  // Show button - either highlighted if has auto-fix label, or normal
  return (
    <Button
      size="sm"
      variant={hasAutoFixLabel() ? 'default' : 'outline'}
      onClick={handleStartAutoFix}
    >
      <Wand2 className="h-4 w-4 me-2" />
      Auto Fix
    </Button>
  );
}
