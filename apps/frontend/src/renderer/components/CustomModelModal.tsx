import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { AVAILABLE_MODELS, CLAUDE_THINKING_LEVELS } from '../../shared/constants';
import type { InsightsModelConfig } from '../../shared/types';
import type { ModelType, ThinkingLevel } from '../../shared/types';

interface CustomModelModalProps {
  currentConfig?: InsightsModelConfig;
  onSave: (config: InsightsModelConfig) => void;
  onClose: () => void;
  open?: boolean;
}

export function CustomModelModal({ currentConfig, onSave, onClose, open = true }: CustomModelModalProps) {
  const { t } = useTranslation('dialogs');
  const [model, setModel] = useState<ModelType>(
    currentConfig?.model || 'sonnet'
  );
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    currentConfig?.thinkingLevel || 'medium'
  );

  // Sync internal state when modal opens or config changes
  useEffect(() => {
    if (open) {
      setModel(currentConfig?.model || 'sonnet');
      setThinkingLevel(currentConfig?.thinkingLevel || 'medium');
    }
  }, [open, currentConfig]);

  const handleSave = () => {
    onSave({
      profileId: 'custom',
      model,
      thinkingLevel
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('customModel.title')}</DialogTitle>
          <DialogDescription>
            {t('customModel.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="model-select">{t('customModel.model')}</Label>
            <Select value={model} onValueChange={(v) => setModel(v as ModelType)}>
              <SelectTrigger id="model-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="thinking-select">{t('customModel.thinkingLevel')}</Label>
            <Select value={thinkingLevel} onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}>
              <SelectTrigger id="thinking-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_THINKING_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{level.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {level.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('customModel.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('customModel.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
