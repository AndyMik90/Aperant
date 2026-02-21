import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Globe, AlertTriangle, TrendingUp, UserPlus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { AddCompetitorDialog } from './AddCompetitorDialog';

interface CompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
  projectId: string;
}

export function CompetitorAnalysisDialog({
  open,
  onOpenChange,
  onAccept,
  onDecline,
  projectId,
}: CompetitorAnalysisDialogProps) {
  const { t } = useTranslation(['dialogs']);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  // Reset addedCount when dialog reopens
  useEffect(() => {
    if (open) {
      setAddedCount(0);
    }
  }, [open]);

  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
  };

  const handleDecline = () => {
    onDecline();
    onOpenChange(false);
  };

  const handleCompetitorAdded = (_competitorId: string) => {
    setAddedCount((prev) => prev + 1);
  };

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="sm:max-w-[500px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-foreground">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t('dialogs:competitorAnalysis.title', 'Enable Competitor Analysis?')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {t('dialogs:competitorAnalysis.description', 'Enhance your roadmap with insights from competitor products')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4 space-y-4">
            {/* What it does */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
              <h4 className="text-sm font-medium text-foreground mb-2">
                {t('dialogs:competitorAnalysis.whatItDoes', 'What competitor analysis does:')}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <Search className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <span>{t('dialogs:competitorAnalysis.identifiesCompetitors', 'Identifies 3-5 main competitors based on your project type')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Globe className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <span>
                    {t('dialogs:competitorAnalysis.searchesAppStores', 'Searches app stores, forums, and social media for user feedback and pain points')}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <TrendingUp className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <span>
                    {t('dialogs:competitorAnalysis.suggestsFeatures', 'Suggests features that address gaps in competitor products')}
                  </span>
                </li>
              </ul>
            </div>

            {/* Privacy notice */}
            <div className="rounded-lg bg-warning/10 border border-warning/30 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('dialogs:competitorAnalysis.webSearchesTitle', 'Web searches will be performed')}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('dialogs:competitorAnalysis.webSearchesDescription', 'This feature will perform web searches to gather competitor information. Your project name and type will be used in search queries. No code or sensitive data is shared.')}
                  </p>
                </div>
              </div>
            </div>

            {/* Optional info */}
            <p className="text-xs text-muted-foreground">
              {t('dialogs:competitorAnalysis.optionalInfo', 'You can generate a roadmap without competitor analysis if you prefer. The roadmap will still be based on your project structure and best practices.')}
            </p>
          </div>

          {/* Add Known Competitors section */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  {t('dialogs:competitorAnalysis.knowYourCompetitors', 'Already know your competitors?')}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {t('dialogs:competitorAnalysis.addThemDirectly', 'Add them directly to improve analysis accuracy')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5"
                onClick={() => setShowAddDialog(true)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                {t('dialogs:competitorAnalysis.addKnownCompetitors', 'Add Known Competitors')}
                {addedCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    {t('dialogs:competitorAnalysis.competitorsAdded', '{{count}} added', { count: addedCount })}
                  </span>
                )}
              </Button>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDecline}>
              {t('dialogs:competitorAnalysis.skipAnalysis', 'No, Skip Analysis')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleAccept}>
              {t('dialogs:competitorAnalysis.enableAnalysis', 'Yes, Enable Analysis')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddCompetitorDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onCompetitorAdded={handleCompetitorAdded}
        projectId={projectId}
      />
    </>
  );
}
