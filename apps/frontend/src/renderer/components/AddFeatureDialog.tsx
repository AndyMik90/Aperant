/**
 * AddFeatureDialog - Dialog for adding new features to the roadmap
 *
 * Allows users to create new roadmap features with title, description,
 * priority, phase, complexity, and impact fields.
 * Follows the same dialog pattern as TaskEditDialog for consistency.
 *
 * Features:
 * - Form validation (title and description required)
 * - Selectable classification fields (priority, phase, complexity, impact)
 * - Adds feature to roadmap store and persists to file
 *
 * @example
 * ```tsx
 * <AddFeatureDialog
 *   phases={roadmap.phases}
 *   open={isAddDialogOpen}
 *   onOpenChange={setIsAddDialogOpen}
 *   onFeatureAdded={(featureId) => console.log('Feature added:', featureId)}
 * />
 * ```
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
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
import {
  ROADMAP_PRIORITY_LABELS
} from '../../shared/constants';
import type {
  RoadmapPhase,
  RoadmapFeaturePriority,
  RoadmapFeatureStatus,
} from '../../shared/types';

/**
 * Props for the AddFeatureDialog component
 */
interface AddFeatureDialogProps {
  /** Available phases to select from */
  phases: RoadmapPhase[];
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional callback when feature is successfully added, receives the new feature ID */
  onFeatureAdded?: (featureId: string) => void;
  /** Optional default phase ID to pre-select */
  defaultPhaseId?: string;
}

// Complexity options (keys for translation)
const COMPLEXITY_OPTIONS = [
  { value: 'low', labelKey: 'addFeature.lowComplexity' },
  { value: 'medium', labelKey: 'addFeature.mediumComplexity' },
  { value: 'high', labelKey: 'addFeature.highComplexity' }
] as const;

// Impact options (keys for translation)
const IMPACT_OPTIONS = [
  { value: 'low', labelKey: 'addFeature.lowImpact' },
  { value: 'medium', labelKey: 'addFeature.mediumImpact' },
  { value: 'high', labelKey: 'addFeature.highImpact' }
] as const;

export function AddFeatureDialog({
  phases,
  open,
  onOpenChange,
  onFeatureAdded,
  defaultPhaseId
}: AddFeatureDialogProps) {
  const { t } = useTranslation('dialogs');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [priority, setPriority] = useState<RoadmapFeaturePriority>('should');
  const [phaseId, setPhaseId] = useState<string>('');
  const [complexity, setComplexity] = useState<'low' | 'medium' | 'high'>('medium');
  const [impact, setImpact] = useState<'low' | 'medium' | 'high'>('medium');

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store actions
  const addFeature = useRoadmapStore((state) => state.addFeature);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setRationale('');
      setPriority('should');
      setPhaseId(defaultPhaseId || (phases.length > 0 ? phases[0].id : ''));
      setComplexity('medium');
      setImpact('medium');
      setError(null);
    }
  }, [open, defaultPhaseId, phases]);

  const handleSave = async () => {
    // Validate required fields
    if (!title.trim()) {
      setError(t('addFeature.titleRequired'));
      return;
    }
    if (!description.trim()) {
      setError(t('addFeature.descriptionRequired'));
      return;
    }
    if (!phaseId) {
      setError(t('addFeature.phaseRequired'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Add feature to store
      const newFeatureId = addFeature({
        title: title.trim(),
        description: description.trim(),
        rationale: rationale.trim() || `User-created feature for ${title.trim()}`,
        priority,
        complexity,
        impact,
        phaseId,
        dependencies: [],
        status: 'under_review' as RoadmapFeatureStatus,
        acceptanceCriteria: [],
        userStories: [],
        source: { provider: 'internal' }
      });

      // Persist to file via IPC
      const roadmap = useRoadmapStore.getState().roadmap;
      if (roadmap) {
        // Get the project ID from the roadmap
        const result = await window.electronAPI.saveRoadmap(roadmap.projectId, roadmap);
        if (!result.success) {
          throw new Error(result.error || 'Failed to save roadmap');
        }
      }

      // Success - close dialog and notify parent
      onOpenChange(false);
      onFeatureAdded?.(newFeatureId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addFeature.failedToAdd'));
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
  const isValid = title.trim().length > 0 && description.trim().length > 0 && phaseId !== '';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('addFeature.title')}</DialogTitle>
          <DialogDescription>
            {t('addFeature.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Title (Required) */}
          <div className="space-y-2">
            <Label htmlFor="add-feature-title" className="text-sm font-medium text-foreground">
              {t('addFeature.featureTitle')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="add-feature-title"
              placeholder={t('addFeature.featureTitlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
              aria-required="true"
            />
          </div>

          {/* Description (Required) */}
          <div className="space-y-2">
            <Label htmlFor="add-feature-description" className="text-sm font-medium text-foreground">
              {t('addFeature.featureDescription')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="add-feature-description"
              placeholder={t('addFeature.featureDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isSaving}
              aria-required="true"
            />
          </div>

          {/* Rationale (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="add-feature-rationale" className="text-sm font-medium text-foreground">
              {t('addFeature.rationale')} <span className="text-muted-foreground font-normal">({t('addFeature.optional')})</span>
            </Label>
            <Textarea
              id="add-feature-rationale"
              placeholder={t('addFeature.rationalePlaceholder')}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              disabled={isSaving}
            />
          </div>

          {/* Classification Fields */}
          <div className="grid grid-cols-2 gap-4">
            {/* Phase */}
            <div className="space-y-2">
              <Label htmlFor="add-feature-phase" className="text-sm font-medium text-foreground">
                {t('addFeature.phase')} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={phaseId}
                onValueChange={setPhaseId}
                disabled={isSaving}
              >
                <SelectTrigger id="add-feature-phase" aria-required="true">
                  <SelectValue placeholder={t('addFeature.selectPhase')} />
                </SelectTrigger>
                <SelectContent>
                  {phases.map((phase) => (
                    <SelectItem key={phase.id} value={phase.id}>
                      {phase.order}. {phase.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="add-feature-priority" className="text-sm font-medium text-foreground">
                {t('addFeature.priority')}
              </Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as RoadmapFeaturePriority)}
                disabled={isSaving}
              >
                <SelectTrigger id="add-feature-priority">
                  <SelectValue placeholder={t('addFeature.selectPriority')} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROADMAP_PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Complexity */}
            <div className="space-y-2">
              <Label htmlFor="add-feature-complexity" className="text-sm font-medium text-foreground">
                {t('addFeature.complexity')}
              </Label>
              <Select
                value={complexity}
                onValueChange={(value) => setComplexity(value as 'low' | 'medium' | 'high')}
                disabled={isSaving}
              >
                <SelectTrigger id="add-feature-complexity">
                  <SelectValue placeholder={t('addFeature.selectComplexity')} />
                </SelectTrigger>
                <SelectContent>
                  {COMPLEXITY_OPTIONS.map(({ value, labelKey }) => (
                    <SelectItem key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Impact */}
            <div className="space-y-2">
              <Label htmlFor="add-feature-impact" className="text-sm font-medium text-foreground">
                {t('addFeature.impact')}
              </Label>
              <Select
                value={impact}
                onValueChange={(value) => setImpact(value as 'low' | 'medium' | 'high')}
                disabled={isSaving}
              >
                <SelectTrigger id="add-feature-impact">
                  <SelectValue placeholder={t('addFeature.selectImpact')} />
                </SelectTrigger>
                <SelectContent>
                  {IMPACT_OPTIONS.map(({ value, labelKey }) => (
                    <SelectItem key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive" role="alert">
              <X className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            {t('addFeature.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !isValid}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('addFeature.adding')}
              </>
            ) : (
              t('addFeature.addFeature')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
