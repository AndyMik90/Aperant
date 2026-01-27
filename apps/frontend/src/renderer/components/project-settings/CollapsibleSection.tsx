import { ReactNode, useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CollapsibleSectionProps {
  title?: string;
  titleKey?: string;
  icon: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  namespace?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  titleKey,
  icon,
  isExpanded,
  onToggle,
  badge,
  namespace = 'common',
  children,
}: CollapsibleSectionProps) {
  const { t } = useTranslation([namespace, 'common']);
  const contentId = useId();

  const displayTitle = title || (titleKey ? t(`${namespace}:${titleKey}`) : '');

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
        aria-expanded={isExpanded}
        aria-controls={contentId}
      >
        <div className="flex items-center gap-2">
          {icon}
          {displayTitle}
          {badge}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <div id={contentId} className="space-y-4 pl-6 pt-2">
          {children}
        </div>
      )}
    </section>
  );
}
