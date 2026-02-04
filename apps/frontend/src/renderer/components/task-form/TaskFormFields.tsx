/**
 * TaskFormFields - Shared form fields component for task create/edit
 *
 * Bundles the common form fields used in both TaskCreationWizard and TaskEditDialog:
 * - Description (required, with image paste/drop support)
 * - Title (optional)
 * - Agent profile selector
 * - Classification fields (collapsible)
 * - Image thumbnails
 * - Review requirement checkbox
 */
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Image as ImageIcon, X } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { AgentProfileSelector } from '../AgentProfileSelector';
import { ClassificationFields } from './ClassificationFields';
import { useImageUpload, type FileReferenceData } from './useImageUpload';
import { cn } from '../../lib/utils';
import type {
  TaskCategory,
  TaskPriority,
  TaskComplexity,
  TaskImpact,
  ImageAttachment,
  ModelType,
  ThinkingLevel
} from '../../../shared/types';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../../shared/types/settings';

interface TaskFormFieldsProps {
  // Description field
  description: string;
  onDescriptionChange: (value: string) => void;
  descriptionPlaceholder?: string;
  /** Optional custom content to render inside the description field (e.g., autocomplete popup) */
  descriptionOverlay?: ReactNode;
  /** Optional ref for the description textarea (used for @ mention autocomplete positioning) */
  descriptionRef?: React.RefObject<HTMLTextAreaElement | null>;

  // Title field
  title: string;
  onTitleChange: (value: string) => void;

  // Agent profile
  profileId: string;
  model: ModelType | '';
  thinkingLevel: ThinkingLevel | '';
  phaseModels?: PhaseModelConfig;
  phaseThinking?: PhaseThinkingConfig;
  onProfileChange: (profileId: string, model: ModelType | '', thinkingLevel: ThinkingLevel | '') => void;
  onModelChange: (model: ModelType | '') => void;
  onThinkingLevelChange: (level: ThinkingLevel | '') => void;
  onPhaseModelsChange: (config: PhaseModelConfig | undefined) => void;
  onPhaseThinkingChange: (config: PhaseThinkingConfig | undefined) => void;

  // Classification
  category: TaskCategory | '';
  priority: TaskPriority | '';
  complexity: TaskComplexity | '';
  impact: TaskImpact | '';
  onCategoryChange: (value: TaskCategory | '') => void;
  onPriorityChange: (value: TaskPriority | '') => void;
  onComplexityChange: (value: TaskComplexity | '') => void;
  onImpactChange: (value: TaskImpact | '') => void;
  showClassification: boolean;
  onShowClassificationChange: (show: boolean) => void;

  // Images
  images: ImageAttachment[];
  onImagesChange: (images: ImageAttachment[]) => void;

  // Review requirement
  requireReviewBeforeCoding: boolean;
  onRequireReviewChange: (require: boolean) => void;

  // Ralph Wiggum Mode (aggressive iteration)
  ralphWiggumMode?: boolean;
  onRalphWiggumModeChange?: (enable: boolean) => void;

  // Form state
  disabled?: boolean;
  error?: string | null;
  onError?: (error: string | null) => void;

  // ID prefix for accessibility
  idPrefix?: string;

  /** Optional children to render after description (e.g., @ mention highlight overlay) */
  children?: ReactNode;

  /** Callback when a file reference is dropped (from FileTreeItem drag) */
  onFileReferenceDrop?: (reference: string, data: FileReferenceData) => void;
}

export function TaskFormFields({
  description,
  onDescriptionChange,
  descriptionPlaceholder,
  descriptionOverlay,
  descriptionRef: externalDescriptionRef,
  title,
  onTitleChange,
  profileId,
  model,
  thinkingLevel,
  phaseModels,
  phaseThinking,
  onProfileChange,
  onModelChange,
  onThinkingLevelChange,
  onPhaseModelsChange,
  onPhaseThinkingChange,
  category,
  priority,
  complexity,
  impact,
  onCategoryChange,
  onPriorityChange,
  onComplexityChange,
  onImpactChange,
  showClassification,
  onShowClassificationChange,
  images,
  onImagesChange,
  requireReviewBeforeCoding,
  onRequireReviewChange,
  ralphWiggumMode = false,
  onRalphWiggumModeChange,
  disabled = false,
  error,
  onError,
  idPrefix = '',
  children,
  onFileReferenceDrop
}: TaskFormFieldsProps) {
  const { t } = useTranslation(['tasks', 'common']);
  // Use external ref if provided (for @ mention autocomplete), otherwise use internal ref
  const internalDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = externalDescriptionRef || internalDescriptionRef;
  const prefix = idPrefix ? `${idPrefix}-` : '';

  // Use the shared image upload hook with translated error messages
  const {
    isDragOver,
    pasteSuccess,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage
  } = useImageUpload({
    images,
    onImagesChange,
    disabled,
    onError,
    errorMessages: {
      maxImagesReached: t('tasks:form.errors.maxImagesReached'),
      invalidImageType: t('tasks:form.errors.invalidImageType'),
      processPasteFailed: t('tasks:form.errors.processPasteFailed'),
      processDropFailed: t('tasks:form.errors.processDropFailed')
    },
    onFileReferenceDrop
  });

  return (
    <div className="space-y-6">
      {/* Description (Primary - Required) */}
      <div className="space-y-2">
        <Label htmlFor={`${prefix}description`} className="text-sm font-medium text-foreground">
          {t('tasks:form.description')} <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          {/* Optional overlay (e.g., @ mention highlighting) */}
          {descriptionOverlay}
          <Textarea
            ref={descriptionRef}
            id={`${prefix}description`}
            placeholder={descriptionPlaceholder || t('tasks:form.descriptionPlaceholder')}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            rows={6}
            disabled={disabled}
            aria-required="true"
            aria-describedby={`${prefix}description-help`}
            className={cn(
              'resize-y min-h-[150px] max-h-[400px] relative',
              descriptionOverlay && 'bg-transparent',
              isDragOver && !disabled && 'border-primary bg-primary/5 ring-2 ring-primary/20'
            )}
            style={descriptionOverlay ? { caretColor: 'auto' } : undefined}
          />
        </div>
        <p id={`${prefix}description-help`} className="text-xs text-muted-foreground">
          {t('images.pasteHint', { shortcut: navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V' })}
        </p>

        {/* Image Thumbnails - displayed inline below description */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {images.map((image) => (
              <div
                key={image.id}
                className="relative group rounded-md border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                style={{ width: '72px', height: '72px' }}
                title={image.filename}
              >
                {image.thumbnail ? (
                  <img
                    src={image.thumbnail}
                    alt={image.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                {/* Remove button */}
                {!disabled && (
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 h-5 w-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(image.id);
                    }}
                    aria-label={t('images.removeImageAriaLabel', { filename: image.filename })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Optional children (e.g., @ mention autocomplete) */}
        {children}
      </div>

      {/* Paste Success Indicator */}
      {pasteSuccess && (
        <div className="flex items-center gap-2 text-sm text-success animate-in fade-in slide-in-from-top-1 duration-200">
          <ImageIcon className="h-4 w-4" />
          {t('tasks:form.imageAddedSuccess')}
        </div>
      )}

      {/* Title (Optional) */}
      <div className="space-y-2">
        <Label htmlFor={`${prefix}title`} className="text-sm font-medium text-foreground">
          {t('tasks:form.taskTitle')} <span className="text-muted-foreground font-normal">({t('common:labels.optional')})</span>
        </Label>
        <Input
          id={`${prefix}title`}
          placeholder={t('tasks:form.titlePlaceholder')}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {t('tasks:form.titleHelpText')}
        </p>
      </div>

      {/* Agent Profile Selection */}
      <AgentProfileSelector
        profileId={profileId}
        model={model}
        thinkingLevel={thinkingLevel}
        phaseModels={phaseModels}
        phaseThinking={phaseThinking}
        onProfileChange={onProfileChange}
        onModelChange={onModelChange}
        onThinkingLevelChange={onThinkingLevelChange}
        onPhaseModelsChange={onPhaseModelsChange}
        onPhaseThinkingChange={onPhaseThinkingChange}
        disabled={disabled}
      />

      {/* Classification Toggle */}
      <button
        type="button"
        onClick={() => onShowClassificationChange(!showClassification)}
        className={cn(
          'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors',
          'w-full justify-between py-2 px-3 rounded-md hover:bg-muted/50'
        )}
        disabled={disabled}
        aria-expanded={showClassification}
        aria-controls={`${prefix}classification-section`}
      >
        <span>{t('tasks:form.classificationOptional')}</span>
        {showClassification ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* Classification Fields */}
      {showClassification && (
        <div id={`${prefix}classification-section`}>
          <ClassificationFields
            category={category}
            priority={priority}
            complexity={complexity}
            impact={impact}
            onCategoryChange={onCategoryChange}
            onPriorityChange={onPriorityChange}
            onComplexityChange={onComplexityChange}
            onImpactChange={onImpactChange}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        </div>
      )}

      {/* Review Requirement Toggle */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/30">
        <Checkbox
          id={`${prefix}require-review`}
          checked={requireReviewBeforeCoding}
          onCheckedChange={(checked) => onRequireReviewChange(checked === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <div className="flex-1 space-y-1">
          <Label
            htmlFor={`${prefix}require-review`}
            className="text-sm font-medium text-foreground cursor-pointer"
          >
            {t('tasks:form.requireReviewLabel')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('tasks:form.requireReviewDescription')}
          </p>
        </div>
      </div>

      {/* Ralph Wiggum Mode - Always enabled (SUG-22) */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-primary/30 bg-primary/5">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {t('tasks:form.ralphWiggumModeFixedLabel')}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
              {t('tasks:form.ralphWiggumModeEnabled')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground italic">
            {t('tasks:form.ralphWiggumModeSubtitle')}
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive" role="alert">
          <X className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
