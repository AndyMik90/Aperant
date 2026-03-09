import { Database } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { MemoryConfigPanel, type MemoryPanelConfig } from '../shared/MemoryConfigPanel';
import type { ProjectEnvConfig, ProjectSettings } from '../../../shared/types';

interface MemoryBackendSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  envConfig: ProjectEnvConfig;
  settings: ProjectSettings;
  onUpdateConfig: (updates: Partial<ProjectEnvConfig>) => void;
  onUpdateSettings: (updates: Partial<ProjectSettings>) => void;
}

/**
 * Memory Backend Section in project settings.
 * Uses the shared MemoryConfigPanel for embedding configuration.
 * Keeps Database Name/Path fields that are project-specific.
 */
export function MemoryBackendSection({
  isExpanded,
  onToggle,
  envConfig,
  onUpdateConfig,
  onUpdateSettings,
}: MemoryBackendSectionProps) {
  const pc = envConfig.memoryProviderConfig;

  // Map ProjectEnvConfig → MemoryPanelConfig
  const panelConfig: MemoryPanelConfig = {
    enabled: envConfig.memoryEnabled,
    embeddingProvider: pc?.embeddingProvider || 'openai',
    openaiApiKey: envConfig.openaiKeyIsGlobal ? '' : (envConfig.openaiApiKey || ''),
    openaiEmbeddingModel: pc?.openaiEmbeddingModel || '',
    azureOpenaiApiKey: pc?.azureOpenaiApiKey || '',
    azureOpenaiBaseUrl: pc?.azureOpenaiBaseUrl || '',
    azureOpenaiEmbeddingDeployment: pc?.azureOpenaiEmbeddingDeployment || '',
    voyageApiKey: pc?.voyageApiKey || '',
    voyageEmbeddingModel: pc?.voyageEmbeddingModel || '',
    googleApiKey: pc?.googleApiKey || '',
    googleEmbeddingModel: pc?.googleEmbeddingModel || '',
    ollamaBaseUrl: pc?.ollamaBaseUrl || 'http://localhost:11434',
    ollamaEmbeddingModel: pc?.ollamaEmbeddingModel || '',
    ollamaEmbeddingDim: pc?.ollamaEmbeddingDim || 0,
  };

  const handlePanelChange = (updates: Partial<MemoryPanelConfig>) => {
    // Handle enabled toggle specially — also update project settings
    if ('enabled' in updates) {
      onUpdateConfig({ memoryEnabled: updates.enabled });
      onUpdateSettings({ memoryBackend: updates.enabled ? 'memory' : 'file' });
    }

    // Handle OpenAI key via top-level envConfig field
    if ('openaiApiKey' in updates) {
      onUpdateConfig({ openaiApiKey: updates.openaiApiKey || undefined });
    }

    // All other provider fields go into memoryProviderConfig
    const providerKeys: (keyof MemoryPanelConfig)[] = [
      'embeddingProvider',
      'openaiEmbeddingModel',
      'azureOpenaiApiKey',
      'azureOpenaiBaseUrl',
      'azureOpenaiEmbeddingDeployment',
      'voyageApiKey',
      'voyageEmbeddingModel',
      'googleApiKey',
      'googleEmbeddingModel',
      'ollamaBaseUrl',
      'ollamaEmbeddingModel',
      'ollamaEmbeddingDim',
    ];

    const providerUpdates: Record<string, unknown> = {};
    for (const key of providerKeys) {
      if (key in updates) {
        // Map panel key names to MemoryProviderConfig key names
        const mapped = key === 'embeddingProvider' ? 'embeddingProvider' : key;
        providerUpdates[mapped] = updates[key as keyof MemoryPanelConfig];
      }
    }

    if (Object.keys(providerUpdates).length > 0) {
      onUpdateConfig({
        memoryProviderConfig: {
          ...envConfig.memoryProviderConfig,
          ...providerUpdates,
        } as ProjectEnvConfig['memoryProviderConfig'],
      });
    }
  };

  const badge = (
    <span
      className={`px-2 py-0.5 text-xs rounded-full ${
        envConfig.memoryEnabled
          ? 'bg-success/10 text-success'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {envConfig.memoryEnabled ? 'Enabled' : 'Disabled'}
    </span>
  );

  return (
    <CollapsibleSection
      title="Memory"
      icon={<Database className="h-4 w-4" />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      badge={badge}
    >
      <MemoryConfigPanel
        config={panelConfig}
        onChange={handlePanelChange}
      />

      {/* Database Settings — project-specific, always visible when enabled */}
      {envConfig.memoryEnabled && (
        <>
          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Database Name</Label>
            <p className="text-xs text-muted-foreground">
              Name for the memory database (stored in ~/.auto-claude/memories/)
            </p>
            <Input
              placeholder="auto_claude_memory"
              value={envConfig.memoryDatabase || ''}
              onChange={(e) => onUpdateConfig({ memoryDatabase: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Database Path (Optional)</Label>
            <p className="text-xs text-muted-foreground">
              Custom storage location. Default: ~/.auto-claude/memories/
            </p>
            <Input
              placeholder="~/.auto-claude/memories"
              value={envConfig.memoryDbPath || ''}
              onChange={(e) => onUpdateConfig({ memoryDbPath: e.target.value || undefined })}
            />
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
