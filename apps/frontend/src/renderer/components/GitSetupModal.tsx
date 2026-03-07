import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Terminal, CheckCircle2, AlertCircle, Loader2, FolderGit2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import type { Project, GitStatus } from '../../shared/types';

interface GitSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  gitStatus: GitStatus | null;
  onGitInitialized: () => void;
  onSkip?: () => void;
}

export function GitSetupModal({
  open,
  onOpenChange,
  project,
  gitStatus,
  onGitInitialized,
  onSkip
}: GitSetupModalProps) {
  const { t } = useTranslation('dialogs');
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'info' | 'initializing' | 'success'>('info');

  const needsGitInit = gitStatus && !gitStatus.isGitRepo;
  const _needsCommit = gitStatus?.isGitRepo && !gitStatus.hasCommits;

  const handleInitializeGit = async () => {
    if (!project) return;

    setIsInitializing(true);
    setError(null);
    setStep('initializing');

    try {
      // Call the backend to initialize git
      const result = await window.electronAPI.initializeGit(project.path);

      if (result.success) {
        setStep('success');
        // Wait a moment to show success, then trigger callback
        setTimeout(() => {
          onGitInitialized();
          onOpenChange(false);
          setStep('info');
        }, 1500);
      } else {
        setError(result.error || 'Failed to initialize git');
        setStep('info');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize git');
      setStep('info');
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSkip = () => {
    onSkip?.();
    onOpenChange(false);
  };

  const renderInfoStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FolderGit2 className="h-5 w-5 text-primary" />
          {t('gitSetup.title')}
        </DialogTitle>
        <DialogDescription>
          {t('gitSetup.description')}
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {/* Status indicator */}
        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-sm">
                {needsGitInit
                  ? t('gitSetup.notGitRepo')
                  : t('gitSetup.noCommits')}
              </p>
              <p className="text-sm text-muted-foreground">
                {needsGitInit
                  ? t('gitSetup.needsInit')
                  : t('gitSetup.needsCommit')}
              </p>
            </div>
          </div>
        </div>

        {/* What will happen */}
        <div className="rounded-lg border border-border p-4">
          <p className="font-medium text-sm mb-3">{t('gitSetup.willSetup')}</p>
          <ul className="space-y-2">
            {needsGitInit && (
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <GitBranch className="h-4 w-4 text-primary" />
                {t('gitSetup.initRepo')}
              </li>
            )}
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {t('gitSetup.createCommit')}
            </li>
          </ul>
        </div>

        {/* Manual instructions for advanced users */}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('gitSetup.manual')}
          </summary>
          <div className="mt-3 rounded-lg bg-muted/50 p-3 font-mono text-xs space-y-1">
            <p className="text-muted-foreground">Open a terminal in your project folder and run:</p>
            {needsGitInit && <p>git init</p>}
            <p>git add .</p>
            <p>git commit -m "Initial commit"</p>
          </div>
        </details>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleSkip}>
          Skip for now
        </Button>
        <Button onClick={handleInitializeGit} disabled={isInitializing}>
          <GitBranch className="mr-2 h-4 w-4" />
          Initialize Git
        </Button>
      </DialogFooter>
    </>
  );

  const renderInitializingStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          {t('gitSetup.settingUp')}
        </DialogTitle>
      </DialogHeader>

      <div className="py-8 flex flex-col items-center justify-center">
        <div className="space-y-3 text-center">
          <Terminal className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            {t('gitSetup.initializingRepo')}
          </p>
        </div>
      </div>
    </>
  );

  const renderSuccessStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          {t('gitSetup.success')}
        </DialogTitle>
      </DialogHeader>

      <div className="py-8 flex flex-col items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('gitSetup.readyToUse')}
          </p>
        </div>
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'info' && renderInfoStep()}
        {step === 'initializing' && renderInitializingStep()}
        {step === 'success' && renderSuccessStep()}
      </DialogContent>
    </Dialog>
  );
}
