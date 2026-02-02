import { useTranslation } from 'react-i18next';
import { Map, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { RoadmapEmptyStateProps } from './types';

export function RoadmapEmptyState({ onGenerate }: RoadmapEmptyStateProps) {
  const { t } = useTranslation('roadmap');

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Map className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('emptyState.title')}</h2>
        <p className="text-muted-foreground mb-6">
          {t('emptyState.description')}
        </p>
        <Button onClick={onGenerate} size="lg">
          <Sparkles className="h-4 w-4 mr-2" />
          {t('emptyState.generateButton')}
        </Button>
      </Card>
    </div>
  );
}
