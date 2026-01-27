import { CheckCircle2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import {
  getIdeationTypeLabels,
  getIdeationTypeDescriptions,
  IDEATION_TYPE_COLORS
} from '../../../shared/constants';
import type { IdeationType, IdeationConfig } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationDialogsProps {
  showConfigDialog: boolean;
  showAddMoreDialog: boolean;
  config: IdeationConfig;
  typesToAdd: IdeationType[];
  availableTypesToAdd: IdeationType[];
  onToggleIdeationType: (type: IdeationType) => void;
  onToggleTypeToAdd: (type: IdeationType) => void;
  onSetConfig: (config: Partial<IdeationConfig>) => void;
  onCloseConfigDialog: () => void;
  onCloseAddMoreDialog: () => void;
  onConfirmAddMore: () => void;
}

export function IdeationDialogs({
  showConfigDialog,
  showAddMoreDialog,
  config,
  typesToAdd,
  availableTypesToAdd,
  onToggleIdeationType,
  onToggleTypeToAdd,
  onSetConfig,
  onCloseConfigDialog,
  onCloseAddMoreDialog,
  onConfirmAddMore
}: IdeationDialogsProps) {
  const { t } = useTranslation(['common', 'ideation']);
  const typeLabels = getIdeationTypeLabels(t);
  const typeDescriptions = getIdeationTypeDescriptions(t);
  return (
    <>
      {/* Configuration Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={onCloseConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideation:dialogs.configuration.title')}</DialogTitle>
            <DialogDescription>
              {t('ideation:dialogs.configuration.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-96 overflow-y-auto">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t('ideation:dialogs.configuration.ideationTypes')}</h4>
              {ALL_IDEATION_TYPES.map((type) => (
                <div
                  key={type}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md ${IDEATION_TYPE_COLORS[type]}`}>
                      <TypeIcon type={type} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{typeLabels[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {typeDescriptions[type]}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={config.enabledTypes.includes(type)}
                    onCheckedChange={() => onToggleIdeationType(type)}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t('ideation:dialogs.configuration.contextSources')}</h4>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('ideation:dialogs.configuration.includeRoadmapContext')}</span>
                <Switch
                  checked={config.includeRoadmapContext}
                  onCheckedChange={(checked) => onSetConfig({ includeRoadmapContext: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('ideation:dialogs.configuration.includeKanbanContext')}</span>
                <Switch
                  checked={config.includeKanbanContext}
                  onCheckedChange={(checked) => onSetConfig({ includeKanbanContext: checked })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseConfigDialog}>
              {t('common:buttons.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add More Ideas Dialog */}
      <Dialog open={showAddMoreDialog} onOpenChange={onCloseAddMoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideation:dialogs.addMore.title')}</DialogTitle>
            <DialogDescription>
              {t('ideation:dialogs.addMore.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3 max-h-96 overflow-y-auto">
            {availableTypesToAdd.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-success" />
                <p>{t('ideation:dialogs.addMore.allGenerated')}</p>
                <p className="text-sm mt-1">{t('ideation:dialogs.addMore.useRegenerate')}</p>
              </div>
            ) : (
              availableTypesToAdd.map((type) => (
                <div
                  key={type}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    typesToAdd.includes(type)
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-muted/50 hover:bg-muted'
                  }`}
                  onClick={() => onToggleTypeToAdd(type)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md ${IDEATION_TYPE_COLORS[type]}`}>
                      <TypeIcon type={type} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{typeLabels[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {typeDescriptions[type]}
                      </div>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    typesToAdd.includes(type)
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  }`}>
                    {typesToAdd.includes(type) && (
                      <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {typesToAdd.length > 0 && t('ideation:dialogs.addMore.selected', { count: typesToAdd.length })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCloseAddMoreDialog}>
                {t('common:buttons.cancel')}
              </Button>
              <Button
                onClick={onConfirmAddMore}
                disabled={typesToAdd.length === 0}
              >
                <Plus className="h-4 w-4 mr-1" />
                {typesToAdd.length > 0 
                  ? t('ideation:dialogs.addMore.generate', { count: typesToAdd.length })
                  : t('ideation:dialogs.addMore.generateOne')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
