import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import appIcon from '@/assets/app-icon-32.png';

export function AppBranding() {
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center px-3 select-none shrink-0">
      <Badge variant="secondary" className="gap-1.5 px-2 py-1 font-normal">
        <img src={appIcon} alt="" className="h-4 w-4" draggable={false} />
        {t('appTitle')}
      </Badge>
    </div>
  );
}
