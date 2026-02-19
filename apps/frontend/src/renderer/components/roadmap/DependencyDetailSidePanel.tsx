import React, { useEffect, useRef } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { RoadmapFeature } from '../../../shared/types/roadmap';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { ROADMAP_PRIORITY_LABELS, ROADMAP_STATUS_LABELS } from '../../../shared/constants/roadmap';
import { useTranslation } from 'react-i18next';

interface DependencyDetailSidePanelProps {
  feature: RoadmapFeature | null;
  features?: RoadmapFeature[];
  isOpen?: boolean;
  onClose: () => void;
  onGoToFeature?: (featureId: string) => void;
  onConvertToSpec?: (featureId: string) => void;
}

export function DependencyDetailSidePanel({
  feature,
  features = [],
  isOpen = true,
  onClose,
  onGoToFeature,
  onConvertToSpec
}: DependencyDetailSidePanelProps) {
  const { t } = useTranslation(['roadmap', 'common']);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Helper to resolve feature ID to title
  const getFeatureTitle = (id: string) => {
    return features.find(f => f.id === id)?.title || id;
  };

  // Handle ESC key to close panel
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousActiveElementRef.current = document.activeElement as HTMLElement;

      // Focus the panel when it opens
      if (panelRef.current) {
        // Focus the first focusable element (close button)
        const closeBtn = panelRef.current.querySelector('button') as HTMLElement;
        closeBtn?.focus();
      }

      // Disable body scroll
      document.body.style.overflow = 'hidden';
    } else {
      // Restore focus to previous element when panel closes
      previousActiveElementRef.current?.focus();

      // Re-enable body scroll
      document.body.style.overflow = '';
    }

    // Cleanup: re-enable body scroll when component unmounts
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Trap focus within panel when open
  useEffect(() => {
    // Capture the panel element at effect setup to avoid stale references
    const panelEl = panelRef.current;
    if (!isOpen || !panelEl) return;

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = panelEl.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  if (!feature) return null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        className={`
          fixed top-0 right-0 h-full w-[400px] bg-background border-l z-50
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 id="panel-title" className="text-xl font-semibold line-clamp-2">{feature.title}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0"
            aria-label={t('roadmap:dependencyDetailPanel.closePanel')}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-6">
          {/* Description */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              {t('roadmap:dependencyDetailPanel.description')}
            </h3>
            <p className="text-sm leading-relaxed">{feature.description}</p>
          </div>

          {/* Metadata */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {t('roadmap:dependencyDetailPanel.details')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-muted-foreground">
                  {t('roadmap:dependencyDetailPanel.priority')}
                </span>
                <div className="mt-1">
                  <Badge variant={feature.priority === 'must' ? 'destructive' : 'secondary'}>
                    {ROADMAP_PRIORITY_LABELS[feature.priority] || feature.priority}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  {t('roadmap:dependencyDetailPanel.complexity')}
                </span>
                <div className="mt-1">
                  <Badge variant="outline">{feature.complexity}</Badge>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  {t('roadmap:dependencyDetailPanel.impact')}
                </span>
                <div className="mt-1">
                  <Badge variant="outline">{feature.impact}</Badge>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  {t('roadmap:dependencyDetailPanel.status')}
                </span>
                <div className="mt-1">
                  <Badge variant="secondary">
                    {ROADMAP_STATUS_LABELS[feature.status] || feature.status}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Dependencies Info */}
          {feature.dependencies && feature.dependencies.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {t('roadmap:dependencyDetailPanel.dependenciesCount', { count: feature.dependencies.length })}
              </h3>
              <ul className="space-y-1">
                {feature.dependencies.map(depId => (
                  <li key={depId} className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{getFeatureTitle(depId)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reverse Dependencies Info */}
          {feature.reverseDependencies && feature.reverseDependencies.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {t('roadmap:dependencyDetailPanel.requiredByCount', { count: feature.reverseDependencies.length })}
              </h3>
              <ul className="space-y-1">
                {feature.reverseDependencies.map(depId => (
                  <li key={depId} className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{getFeatureTitle(depId)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ScrollArea>

        {/* Footer Actions */}
        <div className="p-6 border-t space-y-2">
          {feature.linkedSpecId ? (
            <Button
              className="w-full justify-start"
              variant="default"
              onClick={() => onGoToFeature?.(feature.linkedSpecId!)}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              {t('roadmap:dependencyDetailPanel.goToTask')}
            </Button>
          ) : (
            <Button
              className="w-full justify-start"
              variant="default"
              onClick={() => onConvertToSpec?.(feature.id)}
            >
              {t('roadmap:dependencyDetailPanel.convertToSpec')}
            </Button>
          )}
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => {
              onGoToFeature?.(feature.id);
              onClose();
            }}
          >
            {t('roadmap:dependencyDetailPanel.viewInRoadmap')}
          </Button>
        </div>
      </div>
    </>
  );
}
