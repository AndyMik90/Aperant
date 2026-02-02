import { useTranslation } from 'react-i18next';

interface StatusBadgeProps {
  status: 'success' | 'warning' | 'info';
  label?: string;
  labelKey?: string;
  namespace?: string;
}

export function StatusBadge({
  status,
  label,
  labelKey,
  namespace = 'common'
}: StatusBadgeProps) {
  const { t } = useTranslation([namespace, 'common']);

  const displayLabel = label || (labelKey ? t(`${namespace}:${labelKey}`) : '');

  const colors = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded-full ${colors[status]}`}>
      {displayLabel}
    </span>
  );
}
