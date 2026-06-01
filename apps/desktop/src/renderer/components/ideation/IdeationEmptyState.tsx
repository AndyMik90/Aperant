import { Lightbulb, Settings2, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Switch } from '../ui/switch';
import {
  IDEATION_TYPE_LABELS
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
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Ideas Yet</h2>
        <p className="text-muted-foreground mb-6">
          Generate AI-powered feature ideas based on your project's context,
          existing patterns, and target audience.
        </p>

        {/* Configuration Preview */}
        <div className="mb-6 p-4 bg-muted/50 rounded-lg text-start">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Enabled Ideation Types</span>
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
                  <span className="text-sm">{IDEATION_TYPE_LABELS[type]}</span>
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
          <Sparkles className="h-4 w-4 me-2" />
          Generate Ideas
        </Button>

        {/* Show warning if no provider is configured */}
        {hasToken === false && !isCheckingToken && (
          <p className="mt-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 inline-block me-1 text-warning" />
            No AI provider configured. Add a provider account in Settings to generate ideas.
          </p>
        )}
      </Card>
    </div>
  );
}
