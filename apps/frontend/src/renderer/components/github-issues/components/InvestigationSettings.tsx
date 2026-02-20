/**
 * InvestigationSettings — subsection within the GitHub settings page.
 *
 * Core investigation settings:
 *  1. Auto-create tasks (toggle, default off)
 *  2. Auto-start tasks (toggle, default off)
 *  3. Pipeline mode (dropdown: Full / Skip to planning / Minimal)
 *  4. Phase 1 execution mode (dropdown: Sequential / Parallel)
 *  5. Auto-post to GitHub (toggle, default off)
 *  6. Auto-close issues (toggle, default off)
 *  7. Max parallel investigations (number 1-10, default 3)
 *  8. Label include filter (multi-select dropdown)
 *  9. Label exclude filter (multi-select dropdown)
 * 10. Fast investigations (toggle, default off)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Loader2, Plus, X, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Separator } from '../../ui/separator';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../ui/select';
import { useInvestigationStore } from '../../../stores/github/investigation-store';
import type {
  InvestigationSettings as InvestigationSettingsType,
  InvestigationPhase1ExecutionMode,
  InvestigationPipelineMode,
  InvestigationLabelKey,
  InvestigationLabelCustomization,
} from '@shared/types';
import { LabelCustomizationEditor } from './LabelCustomizationEditor';
import type { LabelRow } from './LabelCustomizationEditor';

const DEFAULT_SETTINGS: InvestigationSettingsType = {
  autoCreateTasks: false,
  autoStartTasks: false,
  pipelineMode: 'full',
  phase1ExecutionMode: 'sequential',
  autoPostToGitHub: false,
  autoCloseIssues: false,
  maxParallelInvestigations: 3,
  labelIncludeFilter: [],
  labelExcludeFilter: [],
  fastInvestigations: false,
};

const INVESTIGATION_LABEL_KEYS: InvestigationLabelKey[] = [
  'investigating', 'findings_ready', 'task_created', 'building', 'done',
];

const DEFAULT_INVESTIGATION_CUSTOMIZATION: InvestigationLabelCustomization = {
  prefix: 'auto-claude:',
  labels: {
    investigating: { suffix: 'investigating', color: '1d76db', description: 'Auto-Claude is investigating this issue' },
    findings_ready: { suffix: 'findings-ready', color: '0e8a16', description: 'Investigation complete, findings available' },
    task_created: { suffix: 'task-created', color: '5319e7', description: 'Kanban task created from investigation' },
    building: { suffix: 'building', color: 'd93f0b', description: 'Task is being built by the pipeline' },
    done: { suffix: 'done', color: '0e8a16', description: 'Investigation complete, issue resolved' },
  },
};

function resolveInvestigationCustomization(
  custom?: InvestigationLabelCustomization,
): InvestigationLabelCustomization {
  if (!custom) return DEFAULT_INVESTIGATION_CUSTOMIZATION;
  const labels = {} as Record<InvestigationLabelKey, { suffix: string; color: string; description: string }>;
  for (const key of INVESTIGATION_LABEL_KEYS) {
    labels[key] = {
      ...DEFAULT_INVESTIGATION_CUSTOMIZATION.labels[key],
      ...(custom.labels?.[key] ?? {}),
    };
  }
  return { prefix: custom.prefix || DEFAULT_INVESTIGATION_CUSTOMIZATION.prefix, labels };
}

/**
 * Returns white or dark text color for readable contrast against a hex background.
 */
function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = Number.parseInt(hex.substring(0, 2), 16);
  const g = Number.parseInt(hex.substring(2, 4), 16);
  const b = Number.parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#24292f' : '#ffffff';
}

interface InvestigationSettingsProps {
  projectId: string;
}

export function InvestigationSettings({ projectId }: InvestigationSettingsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const storeSettings = useInvestigationStore((s) => s.getSettings(projectId));
  const setStoreSettings = useInvestigationStore((s) => s.setSettings);
  const [settings, setSettings] = useState<InvestigationSettingsType>(
    storeSettings ?? DEFAULT_SETTINGS,
  );
  const [isLoading, setIsLoading] = useState(false);

  // Repo labels fetched from GitHub
  const [repoLabels, setRepoLabels] = useState<Array<{ name: string; color: string }>>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);

  // Fetch investigation settings from backend on mount
  // This ensures settings are loaded from disk even if store is empty (e.g., after app reload)
  useEffect(() => {
    if (!projectId) return;
    window.electronAPI?.github?.getInvestigationSettings?.(projectId).then((res) => {
      if (res?.success && res.data) {
        setStoreSettings(projectId, res.data);
      }
    }).catch(() => { /* non-critical */ });
  }, [projectId, setStoreSettings]);

  // Fetch repo labels on mount
  useEffect(() => {
    if (!projectId) return;
    setLabelsLoading(true);
    window.electronAPI.github.getRepoLabels(projectId)
      .then((res) => {
        if (res.success && res.data) setRepoLabels(res.data);
      })
      .catch(() => { /* silently handle */ })
      .finally(() => setLabelsLoading(false));
  }, [projectId]);

  // Sync local state when store settings change
  useEffect(() => {
    if (storeSettings) {
      setSettings(storeSettings);
    }
  }, [storeSettings]);

  // Persist to store + backend whenever local settings change
  const persist = useCallback(
    (updated: InvestigationSettingsType) => {
      setSettings(updated);
      setStoreSettings(projectId, updated);
      // Save to backend if API available
      if (window.electronAPI?.github?.saveInvestigationSettings) {
        setIsLoading(true);
        window.electronAPI.github
          .saveInvestigationSettings(projectId, updated)
          .catch((error) => {
            console.error('[InvestigationSettings] Failed to save settings:', error);
          })
          .finally(() => setIsLoading(false));
      }
    },
    [projectId, setStoreSettings],
  );

  const updateSetting = <K extends keyof InvestigationSettingsType>(
    key: K,
    value: InvestigationSettingsType[K],
  ) => {
    persist({ ...settings, [key]: value });
  };

  const addLabelFilter = (type: 'include' | 'exclude', label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = type === 'include' ? 'labelIncludeFilter' : 'labelExcludeFilter';
    if (settings[key].includes(trimmed)) return;
    persist({ ...settings, [key]: [...settings[key], trimmed] });
  };

  const removeLabelFilter = (type: 'include' | 'exclude', label: string) => {
    const key = type === 'include' ? 'labelIncludeFilter' : 'labelExcludeFilter';
    persist({ ...settings, [key]: settings[key].filter((l) => l !== label) });
  };

  return (
    <section className="space-y-4" aria-label={t('settings:investigationSettings.title', 'AI Investigation')}>
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-info" />
        <h4 className="text-sm font-medium text-foreground">
          {t('settings:investigationSettings.title', 'AI Investigation')}
        </h4>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('settings:investigationSettings.description', 'Configure how AI investigations create tasks and interact with GitHub.')}
      </p>

      <Separator />

      {/* 1. Auto-create tasks */}
      <SettingToggle
        label={t('settings:investigationSettings.autoCreateTasks', 'Auto-create tasks')}
        description={t(
          'settings:investigationSettings.autoCreateTasksDescription',
          'Automatically create kanban tasks from investigation results',
        )}
        checked={settings.autoCreateTasks}
        onCheckedChange={(v) => updateSetting('autoCreateTasks', v)}
      />

      {/* 2. Auto-start tasks */}
      <SettingToggle
        label={t('settings:investigationSettings.autoStartTasks', 'Auto-start tasks')}
        description={t(
          'settings:investigationSettings.autoStartTasksDescription',
          'Auto-start build pipeline when tasks are created',
        )}
        checked={settings.autoStartTasks}
        onCheckedChange={(v) => updateSetting('autoStartTasks', v)}
      />

      {/* 3. Pipeline mode */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">
            {t('settings:investigationSettings.pipelineMode', 'Pipeline mode')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings:investigationSettings.pipelineModeDescription',
              'Pipeline mode for investigation-created tasks',
            )}
          </p>
        </div>
        <Select
          value={settings.pipelineMode}
          onValueChange={(v) => updateSetting('pipelineMode', v as InvestigationPipelineMode)}
        >
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">
              {t('settings:investigationSettings.pipelineFull', 'Full')}
            </SelectItem>
            <SelectItem value="skip_to_planning">
              {t('settings:investigationSettings.pipelineSkipToPlanning', 'Skip to planning')}
            </SelectItem>
            <SelectItem value="minimal">
              {t('settings:investigationSettings.pipelineMinimal', 'Minimal')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 4. Phase 1 execution mode */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">
            {t('settings:investigationSettings.phase1ExecutionMode', 'Phase 1 execution mode')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings:investigationSettings.phase1ExecutionModeDescription',
              'Choose between faster parallel execution and more stable sequential analysis for root cause + reproduction.',
            )}
          </p>
        </div>
        <Select
          value={settings.phase1ExecutionMode ?? 'sequential'}
          onValueChange={(v) => updateSetting('phase1ExecutionMode', v as InvestigationPhase1ExecutionMode)}
        >
          <SelectTrigger className="w-[220px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sequential">
              {t('settings:investigationSettings.phase1ExecutionSequential', 'Sequential (stable, recommended)')}
            </SelectItem>
            <SelectItem value="parallel">
              {t('settings:investigationSettings.phase1ExecutionParallel', 'Parallel (faster)')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* 5. Auto-post to GitHub */}
      <SettingToggle
        label={t('settings:investigationSettings.autoPostToGitHub', 'Auto-post to GitHub')}
        description={t(
          'settings:investigationSettings.autoPostToGitHubDescription',
          'Automatically post investigation results to GitHub',
        )}
        checked={settings.autoPostToGitHub}
        onCheckedChange={(v) => updateSetting('autoPostToGitHub', v)}
      />

      {/* 6. Auto-close issues */}
      <SettingToggle
        label={t('settings:investigationSettings.autoCloseIssues', 'Auto-close issues')}
        description={t(
          'settings:investigationSettings.autoCloseIssuesDescription',
          'Close GitHub issues when linked task completes',
        )}
        checked={settings.autoCloseIssues}
        onCheckedChange={(v) => updateSetting('autoCloseIssues', v)}
      />

      <Separator />

      {/* 7. Max parallel investigations */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">
            {t('settings:investigationSettings.maxParallel', 'Max parallel investigations')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings:investigationSettings.maxParallelDescription',
              'Maximum concurrent investigations (1-10)',
            )}
          </p>
        </div>
        <Input
          type="number"
          min={1}
          max={10}
          value={settings.maxParallelInvestigations}
          onChange={(e) => {
            const val = Math.min(10, Math.max(1, Number.parseInt(e.target.value, 10) || 1));
            updateSetting('maxParallelInvestigations', val);
          }}
          className="w-20 h-8 text-xs text-center"
        />
      </div>

      <Separator />

      {/* 8. Fast mode investigations */}
      <SettingToggle
        label={t('settings:investigationSettings.fastInvestigations', 'Fast mode investigations')}
        description={t(
          'settings:investigationSettings.fastInvestigationsDescription',
          'Use Opus 4.6 Fast Mode (2.5x faster, higher cost)',
        )}
        checked={settings.fastInvestigations ?? false}
        onCheckedChange={(v) => updateSetting('fastInvestigations', v)}
      />

      <Separator />

      {/* 9. Label include filter */}
      <LabelFilterDropdown
        title={t('settings:investigationSettings.labelIncludeFilter', 'Label include filter')}
        description={t(
          'settings:investigationSettings.labelIncludeFilterDescription',
          'Only auto-create tasks for issues with these labels',
        )}
        selectedLabels={settings.labelIncludeFilter}
        repoLabels={repoLabels}
        isLoading={labelsLoading}
        onAdd={(label) => addLabelFilter('include', label)}
        onRemove={(label) => removeLabelFilter('include', label)}
      />

      {/* 10. Label exclude filter */}
      <LabelFilterDropdown
        title={t('settings:investigationSettings.labelExcludeFilter', 'Label exclude filter')}
        description={t(
          'settings:investigationSettings.labelExcludeFilterDescription',
          'Never auto-create tasks for issues with these labels',
        )}
        selectedLabels={settings.labelExcludeFilter}
        repoLabels={repoLabels}
        isLoading={labelsLoading}
        onAdd={(label) => addLabelFilter('exclude', label)}
        onRemove={(label) => removeLabelFilter('exclude', label)}
      />

      <Separator />

      {/* 11. Investigation label customization */}
      <InvestigationLabelSection
        customization={settings.labelCustomization}
        onCustomizationChange={(lc) => persist({ ...settings, labelCustomization: lc })}
      />
    </section>
  );
}

// ---- Internal sub-components ----

interface InvestigationLabelSectionProps {
  customization?: InvestigationLabelCustomization;
  onCustomizationChange: (customization: InvestigationLabelCustomization | undefined) => void;
}

function InvestigationLabelSection({ customization, onCustomizationChange }: InvestigationLabelSectionProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [expanded, setExpanded] = useState(false);

  const resolved = resolveInvestigationCustomization(customization);

  const labelRows: LabelRow[] = INVESTIGATION_LABEL_KEYS.map((key) => ({
    key,
    displayName: t(`settings:investigationSettings.labelCustomization.states.${key}`, key),
    suffix: resolved.labels[key].suffix,
    color: resolved.labels[key].color,
    description: resolved.labels[key].description,
  }));

  const handlePrefixChange = useCallback(
    (prefix: string) => {
      onCustomizationChange({ ...resolved, prefix });
    },
    [resolved, onCustomizationChange],
  );

  const handleLabelChange = useCallback(
    (key: string, field: 'suffix' | 'color' | 'description', value: string) => {
      const updated = {
        ...resolved,
        labels: {
          ...resolved.labels,
          [key]: { ...resolved.labels[key as InvestigationLabelKey], [field]: value },
        },
      };
      onCustomizationChange(updated);
    },
    [resolved, onCustomizationChange],
  );

  const handleReset = useCallback(() => {
    onCustomizationChange(undefined);
  }, [onCustomizationChange]);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {t('settings:investigationSettings.labelCustomization.title', 'Investigation Labels')}
      </button>

      {expanded && (
        <div className="mt-2 pl-4 border-l-2 border-border">
          <p className="text-xs text-muted-foreground mb-3">
            {t(
              'settings:investigationSettings.labelCustomization.description',
              'Customize investigation lifecycle label names, colors, and descriptions',
            )}
          </p>
          <LabelCustomizationEditor
            prefix={resolved.prefix}
            onPrefixChange={handlePrefixChange}
            labels={labelRows}
            onLabelChange={handleLabelChange}
            onReset={handleReset}
            i18nPrefix="settings:investigationSettings.labelCustomization"
          />
        </div>
      )}
    </div>
  );
}

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SettingToggle({ label, description, checked, onCheckedChange }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="font-normal text-foreground">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface LabelFilterDropdownProps {
  title: string;
  description: string;
  selectedLabels: string[];
  repoLabels: Array<{ name: string; color: string }>;
  isLoading: boolean;
  onAdd: (label: string) => void;
  onRemove: (label: string) => void;
}

function LabelFilterDropdown({
  title,
  description,
  selectedLabels,
  repoLabels,
  isLoading,
  onAdd,
  onRemove,
}: LabelFilterDropdownProps) {
  const { t } = useTranslation('common');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredLabels = repoLabels.filter((label) =>
    label.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label className="font-normal text-foreground">{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {/* Selected label chips */}
      <div className="flex flex-wrap gap-1.5">
        {selectedLabels.map((label) => {
          const repoLabel = repoLabels.find((rl) => rl.name === label);
          const bgColor = repoLabel ? `#${repoLabel.color}` : undefined;
          const textColor = repoLabel ? getContrastTextColor(repoLabel.color) : undefined;
          return (
            <Badge
              key={label}
              variant="outline"
              className="gap-1 text-xs border-transparent"
              style={bgColor ? {
                backgroundColor: bgColor,
                borderColor: bgColor,
                color: textColor,
              } : undefined}
            >
              {label}
              <button
                type="button"
                className="ml-0.5 opacity-70 hover:opacity-100"
                onClick={() => onRemove(label)}
                aria-label={t('common:labels.removeNamed', { name: label })}
                style={textColor ? { color: textColor } : undefined}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      {/* Add label button + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => { setDropdownOpen((prev) => !prev); setSearch(''); }}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          {t('labels.add')}
        </Button>

        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-64 border border-border rounded-md bg-popover shadow-md p-1 max-h-48 overflow-y-auto">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('labels.filter')}
              className="w-full px-2 py-1 text-xs border-b border-border bg-transparent focus:outline-none"
              aria-label={t('common:labels.filter')}
            />
            <div role="listbox" aria-label={t('common:labels.available')}>
              {filteredLabels.map((label) => {
                const isSelected = selectedLabels.includes(label.name);
                return (
                  <button
                    key={label.name}
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent rounded-sm text-left"
                    onClick={() => {
                      if (isSelected) {
                        onRemove(label.name);
                      } else {
                        onAdd(label.name);
                      }
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: `#${label.color}` }}
                    />
                    <span className="flex-1">{label.name}</span>
                    {isSelected && <Check className="h-3 w-3 text-primary" />}
                  </button>
                );
              })}
              {filteredLabels.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t('labels.noMatch')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
