import { useState, useEffect, useCallback } from 'react';
import { Database, Globe, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';
import { InfrastructureStatus } from './InfrastructureStatus';
import { PasswordInput } from './PasswordInput';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import { Button } from '../ui/button';
import type { ProjectEnvConfig, ProjectSettings, InfrastructureStatus as InfrastructureStatusType } from '../../../shared/types';

interface OllamaEmbeddingModel {
  name: string;
  embedding_dim: number | null;
  description: string;
  size_gb: number;
}

interface MemoryBackendSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  envConfig: ProjectEnvConfig;
  settings: ProjectSettings;
  onUpdateConfig: (updates: Partial<ProjectEnvConfig>) => void;
  onUpdateSettings: (updates: Partial<ProjectSettings>) => void;
  infrastructureStatus: InfrastructureStatusType | null;
  isCheckingInfrastructure: boolean;
}

/**
 * Memory Backend Section Component
 * Configures Graphiti memory using LadybugDB (embedded database - no Docker required)
 */
export function MemoryBackendSection({
  isExpanded,
  onToggle,
  envConfig,
  settings,
  onUpdateConfig,
  onUpdateSettings,
  infrastructureStatus,
  isCheckingInfrastructure,
}: MemoryBackendSectionProps) {
  // Ollama model detection state
  const [ollamaModels, setOllamaModels] = useState<OllamaEmbeddingModel[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'connected' | 'disconnected'>('idle');
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const embeddingProvider = envConfig.graphitiProviderConfig?.embeddingProvider || 'openai';
  const ollamaBaseUrl = envConfig.graphitiProviderConfig?.ollamaBaseUrl || 'http://localhost:11434';

  // Detect Ollama embedding models
  const detectOllamaModels = useCallback(async () => {
    if (!envConfig.graphitiEnabled || embeddingProvider !== 'ollama') return;

    setOllamaStatus('checking');
    setOllamaError(null);

    try {
      // Check Ollama status first
      const statusResult = await window.electronAPI.checkOllamaStatus(ollamaBaseUrl);
      if (!statusResult.success || !statusResult.data?.running) {
        setOllamaStatus('disconnected');
        setOllamaError(statusResult.data?.message || 'Ollama is not running');
        return;
      }

      // Get embedding models
      const modelsResult = await window.electronAPI.listOllamaEmbeddingModels(ollamaBaseUrl);
      if (!modelsResult.success) {
        setOllamaStatus('connected');
        setOllamaError(modelsResult.error || 'Failed to list models');
        return;
      }

      setOllamaModels(modelsResult.data?.embedding_models || []);
      setOllamaStatus('connected');
    } catch (err) {
      setOllamaStatus('disconnected');
      setOllamaError(err instanceof Error ? err.message : 'Failed to detect Ollama models');
    }
  }, [envConfig.graphitiEnabled, embeddingProvider, ollamaBaseUrl]);

  // Auto-detect when Ollama is selected
  useEffect(() => {
    if (embeddingProvider === 'ollama' && envConfig.graphitiEnabled) {
      detectOllamaModels();
    }
  }, [embeddingProvider, envConfig.graphitiEnabled, detectOllamaModels]);

  const badge = (
    <span className={`px-2 py-0.5 text-xs rounded-full ${
      envConfig.graphitiEnabled
        ? 'bg-success/10 text-success'
        : 'bg-muted text-muted-foreground'
    }`}>
      {envConfig.graphitiEnabled ? 'Enabled' : 'Disabled'}
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
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">Enable Memory</Label>
          <p className="text-xs text-muted-foreground">
            Persistent cross-session memory using embedded graph database
          </p>
        </div>
        <Switch
          checked={envConfig.graphitiEnabled}
          onCheckedChange={(checked) => {
            onUpdateConfig({ graphitiEnabled: checked });
            // Also update project settings to match
            onUpdateSettings({ memoryBackend: checked ? 'graphiti' : 'file' });
          }}
        />
      </div>

      {!envConfig.graphitiEnabled && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Using file-based memory. Session insights are stored locally in JSON files.
            Enable Memory for persistent cross-session context with semantic search.
          </p>
        </div>
      )}

      {envConfig.graphitiEnabled && (
        <>
          {/* Infrastructure Status - LadybugDB check */}
          <InfrastructureStatus
            infrastructureStatus={infrastructureStatus}
            isCheckingInfrastructure={isCheckingInfrastructure}
          />

          {/* Graphiti MCP Server Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal text-foreground">Enable Agent Memory Access</Label>
              <p className="text-xs text-muted-foreground">
                Allow agents to search and add to the knowledge graph via MCP
              </p>
            </div>
            <Switch
              checked={settings.graphitiMcpEnabled}
              onCheckedChange={(checked) =>
                onUpdateSettings({ graphitiMcpEnabled: checked })
              }
            />
          </div>

          {settings.graphitiMcpEnabled && (
            <div className="space-y-2 ml-6">
              <Label className="text-sm font-medium text-foreground">Graphiti MCP Server URL</Label>
              <p className="text-xs text-muted-foreground">
                URL of the Graphiti MCP server
              </p>
              <Input
                placeholder="http://localhost:8000/mcp/"
                value={settings.graphitiMcpUrl || ''}
                onChange={(e) => onUpdateSettings({ graphitiMcpUrl: e.target.value || undefined })}
              />
            </div>
          )}

          <Separator />

          {/* Embedding Provider Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Embedding Provider</Label>
            <p className="text-xs text-muted-foreground">
              Provider for semantic search (optional - keyword search works without)
            </p>
            <Select
              value={embeddingProvider}
              onValueChange={(value) => onUpdateConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: value as 'openai' | 'voyage' | 'azure_openai' | 'ollama' | 'google',
                }
              })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select embedding provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ollama">Ollama (Local - Free)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="voyage">Voyage AI</SelectItem>
                <SelectItem value="google">Google AI</SelectItem>
                <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Provider-specific credential fields */}
          {/* OpenAI */}
          {embeddingProvider === 'openai' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">
                  OpenAI API Key {envConfig.openaiKeyIsGlobal ? '(Override)' : ''}
                </Label>
                {envConfig.openaiKeyIsGlobal && (
                  <span className="flex items-center gap-1 text-xs text-info">
                    <Globe className="h-3 w-3" />
                    Using global key
                  </span>
                )}
              </div>
              {envConfig.openaiKeyIsGlobal ? (
                <p className="text-xs text-muted-foreground">
                  Using key from App Settings. Enter a project-specific key below to override.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Required for OpenAI embeddings
                </p>
              )}
              <PasswordInput
                value={envConfig.openaiKeyIsGlobal ? '' : (envConfig.openaiApiKey || '')}
                onChange={(value) => onUpdateConfig({ openaiApiKey: value || undefined })}
                placeholder={envConfig.openaiKeyIsGlobal ? 'Enter to override global key...' : 'sk-xxxxxxxx'}
              />
            </div>
          )}

          {/* Voyage AI */}
          {embeddingProvider === 'voyage' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Voyage AI API Key</Label>
              <p className="text-xs text-muted-foreground">
                Required for Voyage AI embeddings
              </p>
              <PasswordInput
                value={envConfig.graphitiProviderConfig?.voyageApiKey || ''}
                onChange={(value) => onUpdateConfig({
                  graphitiProviderConfig: {
                    ...envConfig.graphitiProviderConfig,
                    embeddingProvider: 'voyage',
                    voyageApiKey: value || undefined,
                  }
                })}
                placeholder="pa-xxxxxxxx"
              />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Embedding Model</Label>
                <Input
                  placeholder="voyage-3"
                  value={envConfig.graphitiProviderConfig?.voyageEmbeddingModel || ''}
                  onChange={(e) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'voyage',
                      voyageEmbeddingModel: e.target.value || undefined,
                    }
                  })}
                />
              </div>
            </div>
          )}

          {/* Google AI */}
          {embeddingProvider === 'google' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Google AI API Key</Label>
              <p className="text-xs text-muted-foreground">
                Required for Google AI embeddings
              </p>
              <PasswordInput
                value={envConfig.graphitiProviderConfig?.googleApiKey || ''}
                onChange={(value) => onUpdateConfig({
                  graphitiProviderConfig: {
                    ...envConfig.graphitiProviderConfig,
                    embeddingProvider: 'google',
                    googleApiKey: value || undefined,
                  }
                })}
                placeholder="AIzaSy..."
              />
            </div>
          )}

          {/* Azure OpenAI */}
          {embeddingProvider === 'azure_openai' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium text-foreground">Azure OpenAI Configuration</Label>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">API Key</Label>
                <PasswordInput
                  value={envConfig.graphitiProviderConfig?.azureOpenaiApiKey || ''}
                  onChange={(value) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'azure_openai',
                      azureOpenaiApiKey: value || undefined,
                    }
                  })}
                  placeholder="Azure API Key"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Base URL</Label>
                <Input
                  placeholder="https://your-resource.openai.azure.com"
                  value={envConfig.graphitiProviderConfig?.azureOpenaiBaseUrl || ''}
                  onChange={(e) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'azure_openai',
                      azureOpenaiBaseUrl: e.target.value || undefined,
                    }
                  })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Embedding Deployment Name</Label>
                <Input
                  placeholder="text-embedding-ada-002"
                  value={envConfig.graphitiProviderConfig?.azureOpenaiEmbeddingDeployment || ''}
                  onChange={(e) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'azure_openai',
                      azureOpenaiEmbeddingDeployment: e.target.value || undefined,
                    }
                  })}
                />
              </div>
            </div>
          )}

          {/* Ollama (Local) */}
          {embeddingProvider === 'ollama' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">Ollama Configuration</Label>
                <div className="flex items-center gap-2">
                  {ollamaStatus === 'checking' && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </span>
                  )}
                  {ollamaStatus === 'connected' && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  )}
                  {ollamaStatus === 'disconnected' && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      Not running
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={detectOllamaModels}
                    disabled={ollamaStatus === 'checking'}
                    className="h-6 px-2"
                  >
                    <RefreshCw className={`h-3 w-3 ${ollamaStatus === 'checking' ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Base URL</Label>
                <Input
                  placeholder="http://localhost:11434"
                  value={envConfig.graphitiProviderConfig?.ollamaBaseUrl || ''}
                  onChange={(e) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'ollama',
                      ollamaBaseUrl: e.target.value || undefined,
                    }
                  })}
                />
              </div>

              {ollamaError && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {ollamaError}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Embedding Model</Label>
                {ollamaModels.length > 0 ? (
                  <Select
                    value={envConfig.graphitiProviderConfig?.ollamaEmbeddingModel || ''}
                    onValueChange={(value) => {
                      const model = ollamaModels.find(m => m.name === value);
                      onUpdateConfig({
                        graphitiProviderConfig: {
                          ...envConfig.graphitiProviderConfig,
                          embeddingProvider: 'ollama',
                          ollamaEmbeddingModel: value,
                          ollamaEmbeddingDim: model?.embedding_dim || undefined,
                        }
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select embedding model" />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaModels.map((model) => (
                        <SelectItem key={model.name} value={model.name}>
                          <div className="flex items-center gap-2">
                            <span>{model.name}</span>
                            {model.embedding_dim && (
                              <span className="text-xs text-muted-foreground">
                                ({model.embedding_dim}d)
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="nomic-embed-text"
                    value={envConfig.graphitiProviderConfig?.ollamaEmbeddingModel || ''}
                    onChange={(e) => onUpdateConfig({
                      graphitiProviderConfig: {
                        ...envConfig.graphitiProviderConfig,
                        embeddingProvider: 'ollama',
                        ollamaEmbeddingModel: e.target.value || undefined,
                      }
                    })}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Recommended: qwen3-embedding:4b (balanced), :8b (quality), :0.6b (fast)
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Embedding Dimension</Label>
                <Input
                  type="number"
                  placeholder="768"
                  value={envConfig.graphitiProviderConfig?.ollamaEmbeddingDim || ''}
                  onChange={(e) => onUpdateConfig({
                    graphitiProviderConfig: {
                      ...envConfig.graphitiProviderConfig,
                      embeddingProvider: 'ollama',
                      ollamaEmbeddingDim: parseInt(e.target.value, 10) || undefined,
                    }
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  Required for Ollama embeddings (e.g., 768 for nomic-embed-text)
                </p>
              </div>
            </div>
          )}

          {/* Database Settings */}
          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Database Name</Label>
            <p className="text-xs text-muted-foreground">
              Name for the memory database (stored in ~/.auto-claude/memories/)
            </p>
            <Input
              placeholder="auto_claude_memory"
              value={envConfig.graphitiDatabase || ''}
              onChange={(e) => onUpdateConfig({ graphitiDatabase: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Database Path (Optional)</Label>
            <p className="text-xs text-muted-foreground">
              Custom storage location. Default: ~/.auto-claude/memories/
            </p>
            <Input
              placeholder="~/.auto-claude/memories"
              value={envConfig.graphitiDbPath || ''}
              onChange={(e) => onUpdateConfig({ graphitiDbPath: e.target.value || undefined })}
            />
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
