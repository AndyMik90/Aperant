import { ReactNode, useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  icon: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  isExpanded,
  onToggle,
  badge,
  children,
}: CollapsibleSectionProps) {
  const contentId = useId();

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
          {title}
          {badge}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <div id={contentId} className="space-y-4 ps-6 pt-2">
          {children}
        </div>
      )}
    </section>
  );
}
