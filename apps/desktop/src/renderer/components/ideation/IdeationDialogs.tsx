import { CheckCircle2, Plus } from 'lucide-react';
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
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_DESCRIPTIONS,
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
  return (
    <>
      {/* Configuration Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={onCloseConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ideation Configuration</DialogTitle>
            <DialogDescription>
              Configure which types of ideas to generate
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-96 overflow-y-auto">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Ideation Types</h4>
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
                      <div className="font-medium text-sm">{IDEATION_TYPE_LABELS[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {IDEATION_TYPE_DESCRIPTIONS[type]}
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
              <h4 className="text-sm font-medium">Context Sources</h4>
              <div className="flex items-center justify-between">
                <span className="text-sm">Include Roadmap Context</span>
                <Switch
                  checked={config.includeRoadmapContext}
                  onCheckedChange={(checked) => onSetConfig({ includeRoadmapContext: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Include Kanban Context</span>
                <Switch
                  checked={config.includeKanbanContext}
                  onCheckedChange={(checked) => onSetConfig({ includeKanbanContext: checked })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseConfigDialog}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add More Ideas Dialog */}
      <Dialog open={showAddMoreDialog} onOpenChange={onCloseAddMoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add More Ideas</DialogTitle>
            <DialogDescription>
              Select additional ideation types to generate. Your existing ideas will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3 max-h-96 overflow-y-auto">
            {availableTypesToAdd.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-success" />
                <p>You've already generated all ideation types!</p>
                <p className="text-sm mt-1">Use "Regenerate" to refresh existing ideas.</p>
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
                      <div className="font-medium text-sm">{IDEATION_TYPE_LABELS[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {IDEATION_TYPE_DESCRIPTIONS[type]}
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
              {typesToAdd.length > 0 && `${typesToAdd.length} selected`}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCloseAddMoreDialog}>
                Cancel
              </Button>
              <Button
                onClick={onConfirmAddMore}
                disabled={typesToAdd.length === 0}
              >
                <Plus className="h-4 w-4 me-1" />
                Generate {typesToAdd.length > 0 ? `${typesToAdd.length} Types` : 'Ideas'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
