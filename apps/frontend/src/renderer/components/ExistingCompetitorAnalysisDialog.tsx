import { Globe, RefreshCw, TrendingUp, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

interface ExistingCompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseExisting: () => void;
  onRunNew: () => void;
  onSkip: () => void;
  analysisDate?: Date;
}

export function ExistingCompetitorAnalysisDialog({
  open,
  onOpenChange,
  onUseExisting,
  onRunNew,
  onSkip,
  analysisDate,
}: ExistingCompetitorAnalysisDialogProps) {
  const { t } = useTranslation('roadmap');
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
    if (!date) return t('competitorAnalysis.existing.recently');
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <TrendingUp className="h-5 w-5 text-primary" />
            {t('competitorAnalysis.existing.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {t('competitorAnalysis.existing.description', { date: formatDate(analysisDate) })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4 space-y-3">
          {/* Option 1: Use existing (recommended) */}
          <button
            onClick={handleUseExisting}
            className="w-full rounded-lg bg-primary/10 border border-primary/30 p-4 text-left hover:bg-primary/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  {t('competitorAnalysis.existing.useExisting.title')}
                  <span className="text-xs text-primary font-normal">({t('competitorAnalysis.existing.recommended')})</span>
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('competitorAnalysis.existing.useExisting.description')}
                </p>
              </div>
            </div>
          </button>

          {/* Option 2: Run new analysis */}
          <button
            onClick={handleRunNew}
            className="w-full rounded-lg bg-muted/50 border border-border p-4 text-left hover:bg-muted transition-colors"
          >
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-foreground">
                  {t('competitorAnalysis.existing.runNew.title')}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('competitorAnalysis.existing.runNew.description')}
                </p>
              </div>
            </div>
          </button>

          {/* Option 3: Skip */}
          <button
            onClick={handleSkip}
            className="w-full rounded-lg bg-muted/30 border border-border/50 p-4 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t('competitorAnalysis.existing.skip.title')}
                </h4>
                <p className="text-xs text-muted-foreground/80 mt-1">
                  {t('competitorAnalysis.existing.skip.description')}
                </p>
              </div>
            </div>
          </button>
        </div>

        <AlertDialogFooter className="sm:justify-start">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('competitorAnalysis.existing.cancel')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
