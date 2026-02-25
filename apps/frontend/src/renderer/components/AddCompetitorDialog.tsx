/**
 * AddCompetitorDialog - Dialog for adding manual competitors to the roadmap analysis
 *
 * Allows users to add known competitors with name, URL, description, and relevance.
 * Follows the same dialog pattern as AddFeatureDialog for consistency.
 *
 * Features:
 * - Form validation (name and URL required, URL format check)
 * - Auto-prepends https:// if protocol is missing
 * - Adds competitor to roadmap store and persists via IPC
 *
 * @example
 * ```tsx
 * <AddCompetitorDialog
 *   open={isAddDialogOpen}
 *   onOpenChange={setIsAddDialogOpen}
 *   onCompetitorAdded={(id) => console.log('Competitor added:', id)}
 *   projectId={projectId}
 * />
 * ```
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { useRoadmapStore } from '../stores/roadmap-store';
import type { CompetitorRelevance } from '../../shared/types';

/**
 * Props for the AddCompetitorDialog component
 */
interface AddCompetitorDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional callback when competitor is successfully added, receives the new competitor ID */
  onCompetitorAdded?: (competitorId: string) => void;
  /** Project ID for IPC save */
  projectId: string;
}

// Relevance options (keys for translation)
const RELEVANCE_OPTIONS = [
  { value: 'high', labelKey: 'addCompetitor.highRelevance' },
  { value: 'medium', labelKey: 'addCompetitor.mediumRelevance' },
  { value: 'low', labelKey: 'addCompetitor.lowRelevance' }
] as const;

/**
 * Basic URL validation - checks for a reasonable URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL by prepending https:// if no protocol is present
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function AddCompetitorDialog({
  open,
  onOpenChange,
  onCompetitorAdded,
  projectId
}: AddCompetitorDialogProps) {
  const { t } = useTranslation('dialogs');

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [relevance, setRelevance] = useState<CompetitorRelevance>('medium');

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store actions
  const addCompetitor = useRoadmapStore((state) => state.addCompetitor);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setName('');
      setUrl('');
      setDescription('');
      setRelevance('medium');
      setError(null);
    }
  }, [open]);

  const handleSave = async () => {
    // Validate required fields
    if (!name.trim()) {
      setError(t('addCompetitor.nameRequired'));
      return;
    }
    if (!url.trim()) {
      setError(t('addCompetitor.urlRequired'));
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    if (!isValidUrl(normalizedUrl)) {
      setError(t('addCompetitor.invalidUrl'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Capture pre-add state for complete rollback
      const previousAnalysis = useRoadmapStore.getState().competitorAnalysis;

      // Add competitor to store
      const newCompetitorId = addCompetitor({
        name: name.trim(),
        url: normalizedUrl,
        description: description.trim(),
        relevance
      });

      // Persist to file via IPC
      const competitorAnalysis = useRoadmapStore.getState().competitorAnalysis;
      if (competitorAnalysis) {
        const result = await window.electronAPI.saveCompetitorAnalysis(projectId, competitorAnalysis);
        if (!result.success) {
          // Rollback store state since save failed
          useRoadmapStore.getState().setCompetitorAnalysis(previousAnalysis);
          throw new Error(result.error || t('addCompetitor.failedToAdd'));
        }
      }

      // Success - close dialog and notify parent
      onOpenChange(false);
      onCompetitorAdded?.(newCompetitorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addCompetitor.failedToAdd'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) {
      onOpenChange(false);
    }
  };

  // Form validation
  const isValid = name.trim().length > 0 && url.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('addCompetitor.title')}</DialogTitle>
          <DialogDescription>
            {t('addCompetitor.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Name (Required) */}
          <div className="space-y-2">
            <Label htmlFor="add-competitor-name" className="text-sm font-medium text-foreground">
              {t('addCompetitor.competitorName')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="add-competitor-name"
              placeholder={t('addCompetitor.competitorNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSaving}
              aria-required="true"
            />
          </div>

          {/* URL (Required) */}
          <div className="space-y-2">
            <Label htmlFor="add-competitor-url" className="text-sm font-medium text-foreground">
              {t('addCompetitor.competitorUrl')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="add-competitor-url"
              placeholder={t('addCompetitor.competitorUrlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isSaving}
              aria-required="true"
            />
          </div>

          {/* Description (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="add-competitor-description" className="text-sm font-medium text-foreground">
              {t('addCompetitor.competitorDescription')} <span className="text-muted-foreground font-normal">({t('addCompetitor.optional')})</span>
            </Label>
            <Textarea
              id="add-competitor-description"
              placeholder={t('addCompetitor.competitorDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isSaving}
            />
          </div>

          {/* Relevance (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="add-competitor-relevance" className="text-sm font-medium text-foreground">
              {t('addCompetitor.relevance')}
            </Label>
            <Select
              value={relevance}
              onValueChange={(value) => setRelevance(value as CompetitorRelevance)}
              disabled={isSaving}
            >
              <SelectTrigger id="add-competitor-relevance">
                <SelectValue placeholder={t('addCompetitor.selectRelevance')} />
              </SelectTrigger>
              <SelectContent>
                {RELEVANCE_OPTIONS.map(({ value, labelKey }) => (
                  <SelectItem key={value} value={value}>
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            {t('addCompetitor.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !isValid}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('addCompetitor.adding')}
              </>
            ) : (
              t('addCompetitor.addCompetitor')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
