import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Info, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AVAILABLE_MODELS, THINKING_LEVELS } from '../../../shared/constants';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { SettingsSection } from './SettingsSection';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import type { PhaseModelConfig, PhaseThinkingConfig, ModelTypeShort, ThinkingLevel } from '../../../shared/types/settings';

// Backend defaults from phase_config.py COMPLEXITY_PHASE_CONFIG
const DEFAULT_COMPLEXITY_MODELS = {
  SIMPLE: { planning: 'opus', coding: 'haiku', qa: 'skip' as const },
  MEDIUM: { planning: 'opus', coding: 'sonnet', qa: 'haiku' },
  COMPLEX: { planning: 'opus', coding: 'sonnet', qa: 'sonnet' }
} as const;

const DEFAULT_COMPLEXITY_THINKING = {
  SIMPLE: { planning: 'low', coding: 'none', qa: 'none' },
  MEDIUM: { planning: 'medium', coding: 'low', qa: 'low' },
  COMPLEX: { planning: 'high', coding: 'medium', qa: 'medium' }
} as const;

type ComplexityLevel = 'SIMPLE' | 'MEDIUM' | 'COMPLEX';
type Phase = 'planning' | 'coding' | 'qa';

interface PhaseConfig {
  model: ModelTypeShort | 'skip';
  thinking: ThinkingLevel;
}

/**
 * Complexity Routing Settings Component
 * Allows users to customize which models run for different task complexities
 */
export function ComplexityRoutingSettings() {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((state) => state.settings);

  // Local state for each complexity level
  // Note: QA phase can be 'skip' for SIMPLE tasks
  type ComplexityModels = Omit<PhaseModelConfig, 'qa'> & { qa?: ModelTypeShort | 'skip' };
  const [simpleModels, setSimpleModels] = useState<Partial<ComplexityModels>>({});
  const [simpleThinking, setSimpleThinking] = useState<Partial<PhaseThinkingConfig>>({});
  const [mediumModels, setMediumModels] = useState<Partial<ComplexityModels>>({});
  const [mediumThinking, setMediumThinking] = useState<Partial<PhaseThinkingConfig>>({});
  const [complexModels, setComplexModels] = useState<Partial<ComplexityModels>>({});
  const [complexThinking, setComplexThinking] = useState<Partial<PhaseThinkingConfig>>({});

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const customModels = settings.customComplexityModels || {};
    const customThinking = settings.customComplexityThinking || {};

    // Load SIMPLE (with defaults)
    setSimpleModels(customModels.SIMPLE || DEFAULT_COMPLEXITY_MODELS.SIMPLE);
    setSimpleThinking(customThinking.SIMPLE || DEFAULT_COMPLEXITY_THINKING.SIMPLE);

    // Load MEDIUM (with defaults)
    setMediumModels(customModels.MEDIUM || DEFAULT_COMPLEXITY_MODELS.MEDIUM);
    setMediumThinking(customThinking.MEDIUM || DEFAULT_COMPLEXITY_THINKING.MEDIUM);

    // Load COMPLEX (with defaults)
    setComplexModels(customModels.COMPLEX || DEFAULT_COMPLEXITY_MODELS.COMPLEX);
    setComplexThinking(customThinking.COMPLEX || DEFAULT_COMPLEXITY_THINKING.COMPLEX);
  }, [settings.customComplexityModels, settings.customComplexityThinking]);

  // Check if current settings differ from defaults
  const isCustomized = useMemo(() => {
    return Boolean(settings.customComplexityModels || settings.customComplexityThinking);
  }, [settings.customComplexityModels, settings.customComplexityThinking]);

  const handleModelChange = (complexity: ComplexityLevel, phase: Phase, model: ModelTypeShort | 'skip') => {
    setHasChanges(true);
    if (complexity === 'SIMPLE') {
      setSimpleModels(prev => ({ ...prev, [phase]: model }));
    } else if (complexity === 'MEDIUM') {
      setMediumModels(prev => ({ ...prev, [phase]: model }));
    } else {
      setComplexModels(prev => ({ ...prev, [phase]: model }));
    }
  };

  const handleThinkingChange = (complexity: ComplexityLevel, phase: Phase, thinking: ThinkingLevel) => {
    setHasChanges(true);
    if (complexity === 'SIMPLE') {
      setSimpleThinking(prev => ({ ...prev, [phase]: thinking }));
    } else if (complexity === 'MEDIUM') {
      setMediumThinking(prev => ({ ...prev, [phase]: thinking }));
    } else {
      setComplexThinking(prev => ({ ...prev, [phase]: thinking }));
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveSettings({
        customComplexityModels: {
          SIMPLE: simpleModels as any,
          MEDIUM: mediumModels as any,
          COMPLEX: complexModels as any
        },
        customComplexityThinking: {
          SIMPLE: simpleThinking as PhaseThinkingConfig,
          MEDIUM: mediumThinking as PhaseThinkingConfig,
          COMPLEX: complexThinking as PhaseThinkingConfig
        }
      });
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setSimpleModels(DEFAULT_COMPLEXITY_MODELS.SIMPLE);
    setSimpleThinking(DEFAULT_COMPLEXITY_THINKING.SIMPLE);
    setMediumModels(DEFAULT_COMPLEXITY_MODELS.MEDIUM);
    setMediumThinking(DEFAULT_COMPLEXITY_THINKING.MEDIUM);
    setComplexModels(DEFAULT_COMPLEXITY_MODELS.COMPLEX);
    setComplexThinking(DEFAULT_COMPLEXITY_THINKING.COMPLEX);

    setIsSaving(true);
    try {
      await saveSettings({
        customComplexityModels: undefined,
        customComplexityThinking: undefined
      });
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const renderPhaseSelector = (
    complexity: ComplexityLevel,
    phase: Phase,
    currentModel: ModelTypeShort | 'skip',
    currentThinking: ThinkingLevel,
    allowSkip = false
  ) => {
    const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

    return (
      <div className="grid grid-cols-[120px_1fr_1fr] gap-4 items-center py-2">
        <Label className="text-sm font-medium">{phaseLabel}</Label>

        <Select
          value={currentModel}
          onValueChange={(value) => handleModelChange(complexity, phase, value as ModelTypeShort | 'skip')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowSkip && <SelectItem value="skip">Skip {phaseLabel}</SelectItem>}
            {AVAILABLE_MODELS.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={currentThinking}
          onValueChange={(value) => handleThinkingChange(complexity, phase, value as ThinkingLevel)}
          disabled={currentModel === 'skip'}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                {level.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <SettingsSection
      title="Complexity-Based Routing"
      description="Customize which models run for different task complexities when using the Adaptive profile"
    >
      <div className="space-y-6">
        {/* Info Alert */}
        <div className="rounded-lg bg-muted/50 p-3 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            These settings only apply when you create tasks with the <strong>"Adaptive (Recommended)"</strong> profile.
            Tasks are automatically classified as SIMPLE, MEDIUM, or COMPLEX, and use the models you configure here.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCustomized && (
              <span className="text-sm text-muted-foreground">
                Using custom routing
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToDefaults}
              disabled={!isCustomized || isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              size="sm"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* Tabs for each complexity level */}
        <Tabs defaultValue="SIMPLE" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="SIMPLE" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              SIMPLE
            </TabsTrigger>
            <TabsTrigger value="MEDIUM" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              MEDIUM
            </TabsTrigger>
            <TabsTrigger value="COMPLEX" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              COMPLEX
            </TabsTrigger>
          </TabsList>

          <TabsContent value="SIMPLE" className="space-y-4 mt-6">
            <div className="text-sm text-muted-foreground mb-4">
              <p><strong>SIMPLE tasks:</strong> Single-file changes, typo fixes, minor tweaks</p>
              <p className="mt-1"><strong>Cost:</strong> ~$5-8 per task</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="grid grid-cols-[120px_1fr_1fr] gap-4 text-sm font-medium text-muted-foreground mb-2">
                <div>Phase</div>
                <div>Model</div>
                <div>Thinking Level</div>
              </div>
              {renderPhaseSelector('SIMPLE', 'planning', simpleModels.planning || 'opus', simpleThinking.planning || 'low')}
              {renderPhaseSelector('SIMPLE', 'coding', simpleModels.coding || 'haiku', simpleThinking.coding || 'none')}
              {renderPhaseSelector('SIMPLE', 'qa', simpleModels.qa || 'skip', simpleThinking.qa || 'none', true)}
            </div>
          </TabsContent>

          <TabsContent value="MEDIUM" className="space-y-4 mt-6">
            <div className="text-sm text-muted-foreground mb-4">
              <p><strong>MEDIUM tasks:</strong> Multi-file changes, new features, standard CRUD operations</p>
              <p className="mt-1"><strong>Cost:</strong> ~$20-30 per task</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="grid grid-cols-[120px_1fr_1fr] gap-4 text-sm font-medium text-muted-foreground mb-2">
                <div>Phase</div>
                <div>Model</div>
                <div>Thinking Level</div>
              </div>
              {renderPhaseSelector('MEDIUM', 'planning', mediumModels.planning || 'opus', mediumThinking.planning || 'medium')}
              {renderPhaseSelector('MEDIUM', 'coding', mediumModels.coding || 'sonnet', mediumThinking.coding || 'low')}
              {renderPhaseSelector('MEDIUM', 'qa', mediumModels.qa || 'haiku', mediumThinking.qa || 'low')}
            </div>
          </TabsContent>

          <TabsContent value="COMPLEX" className="space-y-4 mt-6">
            <div className="text-sm text-muted-foreground mb-4">
              <p><strong>COMPLEX tasks:</strong> Cross-system changes, integrations, high-risk modifications</p>
              <p className="mt-1"><strong>Cost:</strong> ~$35-45 per task</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="grid grid-cols-[120px_1fr_1fr] gap-4 text-sm font-medium text-muted-foreground mb-2">
                <div>Phase</div>
                <div>Model</div>
                <div>Thinking Level</div>
              </div>
              {renderPhaseSelector('COMPLEX', 'planning', complexModels.planning || 'opus', complexThinking.planning || 'high')}
              {renderPhaseSelector('COMPLEX', 'coding', complexModels.coding || 'sonnet', complexThinking.coding || 'medium')}
              {renderPhaseSelector('COMPLEX', 'qa', complexModels.qa || 'sonnet', complexThinking.qa || 'medium')}
            </div>
          </TabsContent>
        </Tabs>

        {/* Cost Estimate */}
        <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
          <h4 className="font-medium text-sm mb-2">Estimated Monthly Savings</h4>
          <p className="text-sm text-muted-foreground">
            With adaptive routing (20 tasks/month): <strong className="text-foreground">40-55% cost reduction</strong> compared to All-Opus
            <br />
            Average task cost: ~$22-31 (vs $46-72 with All-Opus)
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
