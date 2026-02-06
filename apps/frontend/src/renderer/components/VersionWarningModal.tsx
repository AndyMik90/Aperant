import { useTranslation } from 'react-i18next';
import { AlertTriangle, Settings, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';

interface VersionWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

/**
 * One-time modal shown for version 2.7.5 to notify users they need to re-authenticate.
 * Only shown once per user - dismissal is persisted in app settings.
 */
export function VersionWarningModal({ isOpen, onClose, onOpenSettings }: VersionWarningModalProps) {
  const { t } = useTranslation('dialogs');

  const handleGoToSettings = () => {
    onClose();
    onOpenSettings?.();
  };

  const handleDismiss = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" hideCloseButton>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {t('versionWarning.title')}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t('versionWarning.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-foreground">
            {t('versionWarning.description')}
          </p>

          <div className="rounded-md bg-muted p-4">
            <p className="text-sm font-medium mb-3">
              {t('versionWarning.instructions')}
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">1</span>
                {t('versionWarning.step1')}
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">2</span>
                {t('versionWarning.step2')}
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">3</span>
                {t('versionWarning.step3')}
              </li>
            </ol>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleDismiss} className="sm:mr-auto">
            {t('versionWarning.gotIt')}
          </Button>
          <Button onClick={handleGoToSettings} className="gap-2">
            <Settings className="h-4 w-4" />
            {t('versionWarning.goToSettings')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
