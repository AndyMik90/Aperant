import { Lightbulb, Settings2, AlertCircle, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Switch } from '../ui/switch';
import {
  getIdeationTypeLabels
} from '../../../shared/constants';
import type { IdeationType, IdeationConfig } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationEmptyStateProps {
  config: IdeationConfig;
  hasToken: boolean | null;
  isCheckingToken: boolean;
  onGenerate: () => void;
  onOpenConfig: () => void;
  onToggleIdeationType: (type: IdeationType) => void;
}

export function IdeationEmptyState({
  config,
  hasToken,
  isCheckingToken,
  onGenerate,
  onOpenConfig,
  onToggleIdeationType
}: IdeationEmptyStateProps) {
  const { t } = useTranslation('ideation');
  const typeLabels = getIdeationTypeLabels(t);
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('emptyState.title')}</h2>
        <p className="text-muted-foreground mb-6">
          {t('emptyState.description')}
        </p>

        {/* Configuration Preview */}
        <div className="mb-6 p-4 bg-muted/50 rounded-lg text-left">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{t('emptyState.enabledTypes')}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenConfig}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {ALL_IDEATION_TYPES.map((type) => (
              <div
                key={type}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <TypeIcon type={type} />
                  <span className="text-sm">{typeLabels[type]}</span>
                </div>
                <Switch
                  checked={config.enabledTypes.includes(type)}
                  onCheckedChange={() => onToggleIdeationType(type)}
                />
              </div>
            ))}
          </div>
        </div>

        <Button onClick={onGenerate} size="lg" disabled={isCheckingToken}>
          <Sparkles className="h-4 w-4 mr-2" />
          {t('emptyState.generateButton')}
        </Button>

        {/* Show warning if token is missing */}
        {hasToken === false && !isCheckingToken && (
          <p className="mt-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 inline-block mr-1 text-warning" />
            {t('emptyState.tokenWarning')}
          </p>
        )}
      </Card>
    </div>
  );
}
