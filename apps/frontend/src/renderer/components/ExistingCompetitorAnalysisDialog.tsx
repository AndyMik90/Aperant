import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, RefreshCw, TrendingUp, CheckCircle, UserPlus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { AddCompetitorDialog } from './AddCompetitorDialog';

interface ExistingCompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseExisting: () => void;
  onRunNew: () => void;
  onSkip: () => void;
  onCompetitorAdded?: (competitorId: string) => void;
  analysisDate?: Date;
  projectId: string;
}

export function ExistingCompetitorAnalysisDialog({
  open,
  onOpenChange,
  onUseExisting,
  onRunNew,
  onSkip,
  onCompetitorAdded,
  analysisDate,
  projectId,
}: ExistingCompetitorAnalysisDialogProps) {
  const { t, i18n } = useTranslation(['dialogs']);
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Reset child dialog state when this dialog reopens
  useEffect(() => {
    if (open) {
      setShowAddDialog(false);
    }
  }, [open]);

  const handleUseExisting = () => {
    onUseExisting();
    onOpenChange(false);
  };

  const handleRunNew = () => {
    onRunNew();
    onOpenChange(false);
  };

  const handleSkip = () => {
    onSkip();
    onOpenChange(false);
  };

  const formatDate = (date?: Date) => {
    if (!date) return t('dialogs:existingCompetitorAnalysis.recently');
    return new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="sm:max-w-[500px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-foreground">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t('dialogs:existingCompetitorAnalysis.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {t('dialogs:existingCompetitorAnalysis.description', { date: formatDate(analysisDate) })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4 space-y-3">
            {/* Option 1: Use existing (recommended) */}
            <button
              type="button"
              onClick={handleUseExisting}
              className="w-full rounded-lg bg-primary/10 border border-primary/30 p-4 text-left hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                    {t('dialogs:existingCompetitorAnalysis.useExistingTitle')}
                    <span className="text-xs text-primary font-normal">{t('dialogs:existingCompetitorAnalysis.recommended')}</span>
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('dialogs:existingCompetitorAnalysis.useExistingDescription')}
                  </p>
                </div>
              </div>
            </button>

            {/* Option 2: Run new analysis */}
            <button
              type="button"
              onClick={handleRunNew}
              className="w-full rounded-lg bg-muted/50 border border-border p-4 text-left hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-3">
                <RefreshCw className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('dialogs:existingCompetitorAnalysis.runNewTitle')}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('dialogs:existingCompetitorAnalysis.runNewDescription')}
                  </p>
                </div>
              </div>
            </button>

            {/* Option 3: Add known competitors */}
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="w-full rounded-lg bg-muted/50 border border-border p-4 text-left hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-3">
                <UserPlus className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('dialogs:competitorAnalysis.addKnownCompetitors')}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('dialogs:competitorAnalysis.addKnownCompetitorsDescription')}
                  </p>
                </div>
              </div>
            </button>

            {/* Option 4: Skip */}
            <button
              type="button"
              onClick={handleSkip}
              className="w-full rounded-lg bg-muted/30 border border-border/50 p-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t('dialogs:existingCompetitorAnalysis.skipTitle')}
                  </h4>
                  <p className="text-xs text-muted-foreground/80 mt-1">
                    {t('dialogs:existingCompetitorAnalysis.skipDescription')}
                  </p>
                </div>
              </div>
            </button>
          </div>

          <AlertDialogFooter className="sm:justify-start">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('dialogs:existingCompetitorAnalysis.cancel')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddCompetitorDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onCompetitorAdded={onCompetitorAdded}
        projectId={projectId}
      />
    </>
  );
}
