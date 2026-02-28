import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, FolderPlus, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useProjectStore } from '../stores/project-store';
import type { Project } from '../../shared/types';

interface AddCustomerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerAdded?: (project: Project) => void;
}

type Step = 'choose' | 'create';

export function AddCustomerModal({ open, onOpenChange, onCustomerAdded }: AddCustomerModalProps) {
  const { t } = useTranslation('dialogs');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [customerName, setCustomerName] = useState('');
  const [location, setLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setStep('choose');
      setCustomerName('');
      setLocation('');
      setIsCreating(false);
    }
  }, [open]);

  const registerAndInitCustomer = async (path: string) => {
    // Call IPC directly so we can set type: 'customer' BEFORE selectProject
    // (addProject auto-selects, which triggers Sidebar git check before type is set)
    const result = await window.electronAPI.addProject(path);
    if (!result.success || !result.data) return;

    const store = useProjectStore.getState();
    const project = { ...result.data, type: 'customer' as const };

    // Add with type already set, then select — Sidebar will see type: 'customer' and skip git check
    store.addProject(project);
    store.selectProject(project.id);
    store.openProjectTab(project.id);

    // Create .auto-claude/ folder so the customer has an .env for GitHub token.
    // We use createProjectFolder instead of initializeProject because the full
    // initializer requires git (which customer folders don't have).
    if (!project.autoBuildPath) {
      try {
        await window.electronAPI.createProjectFolder(path, '.auto-claude', false);
        store.updateProject(project.id, { autoBuildPath: '.auto-claude' });
      } catch {
        // Non-fatal — user can configure later
      }
    }

    // Read updated project from store (has autoBuildPath set)
    const updatedProject = store.projects.find(p => p.id === project.id) || project;
    onCustomerAdded?.(updatedProject);
    onOpenChange(false);
  };

  const handleOpenExisting = async () => {
    try {
      const path = await window.electronAPI.selectDirectory();
      if (path) {
        await registerAndInitCustomer(path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addCustomer.failedToOpen'));
    }
  };

  const handleBrowseLocation = async () => {
    try {
      const path = await window.electronAPI.selectDirectory();
      if (path) {
        setLocation(path);
      }
    } catch {
      // User cancelled
    }
  };

  const handleCreateFolder = async () => {
    if (!customerName.trim()) {
      setError(t('addCustomer.nameRequired'));
      return;
    }
    if (!location) {
      setError(t('addCustomer.locationRequired'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const result = await window.electronAPI.createProjectFolder(
        location,
        customerName.trim(),
        false // No git init for customer folders
      );
      if (!result.success || !result.data) {
        setError(result.error || t('addCustomer.failedToCreate'));
        return;
      }
      await registerAndInitCustomer(result.data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addCustomer.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const folderPreview = customerName.trim() && location
    ? `${location}/${customerName.trim()}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addCustomer.title')}</DialogTitle>
          <DialogDescription>
            {step === 'choose'
              ? t('addCustomer.description')
              : t('addCustomer.createNewSubtitle')}
          </DialogDescription>
        </DialogHeader>

        {step === 'choose' && (
          <div className="py-4 space-y-3">
            {/* Create New Folder */}
            <button
              type="button"
              onClick={() => setStep('create')}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-xl border border-border',
                'bg-card hover:bg-accent hover:border-accent transition-all duration-200',
                'text-left group'
              )}
              aria-label={t('addCustomer.createNewAriaLabel')}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <FolderPlus className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground">{t('addCustomer.createNew')}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('addCustomer.createNewDescription')}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>

            {/* Open Existing Folder */}
            <button
              type="button"
              onClick={handleOpenExisting}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-xl border border-border',
                'bg-card hover:bg-accent hover:border-accent transition-all duration-200',
                'text-left group'
              )}
              aria-label={t('addCustomer.openExistingAriaLabel')}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground">{t('addCustomer.openExisting')}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('addCustomer.openExistingDescription')}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </div>
        )}

        {step === 'create' && (
          <div className="py-4 space-y-4">
            {/* Customer Name */}
            <div className="space-y-2">
              <label htmlFor="customer-name" className="text-sm font-medium text-foreground">
                {t('addCustomer.customerName')}
              </label>
              <input
                id="customer-name"
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setError(null);
                }}
                placeholder={t('addCustomer.customerNamePlaceholder')}
                className={cn(
                  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                )}
                autoFocus
              />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t('addCustomer.location')}
              </span>
              <div className="flex gap-2">
                <div className={cn(
                  'flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'text-muted-foreground truncate'
                )}>
                  {location || t('addCustomer.locationPlaceholder')}
                </div>
                <Button variant="outline" size="sm" onClick={handleBrowseLocation}>
                  {t('addCustomer.browse')}
                </Button>
              </div>
            </div>

            {/* Folder preview */}
            {folderPreview && (
              <div className="text-xs text-muted-foreground">
                {t('addCustomer.willCreate')} <code className="bg-muted px-1 py-0.5 rounded">{folderPreview}</code>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setStep('choose'); setError(null); }}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('addCustomer.back')}
              </Button>
              <Button onClick={handleCreateFolder} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t('addCustomer.creating')}
                  </>
                ) : (
                  t('addCustomer.createCustomer')
                )}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 mt-2" role="alert">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
