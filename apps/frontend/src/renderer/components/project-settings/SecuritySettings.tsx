import { useState, useEffect } from 'react';
import {
  Database,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Globe
} from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Separator } from '../ui/separator';
import { OllamaModelSelector } from '../onboarding/OllamaModelSelector';
import type { ProjectEnvConfig, ProjectSettings as ProjectSettingsType, GraphitiEmbeddingProvider } from '../../../shared/types';

interface SecuritySettingsProps {
  envConfig: ProjectEnvConfig | null;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;

  // Password visibility
  showOpenAIKey: boolean;
  setShowOpenAIKey: React.Dispatch<React.SetStateAction<boolean>>;

  // Collapsible section
  expanded: boolean;
  onToggle: () => void;
}

export function SecuritySettings({
  envConfig,
  settings,
  setSettings,
  updateEnvConfig,
  showOpenAIKey,
  setShowOpenAIKey,
  expanded,
  onToggle
}: SecuritySettingsProps) {
  // Password visibility for multiple providers
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({
    openai: showOpenAIKey,
    voyage: false,
    google: false,
    azure: false
  });

  // Sync parent's showOpenAIKey prop to local state
  useEffect(() => {
    setShowApiKey(prev => ({ ...prev, openai: showOpenAIKey }));
  }, [showOpenAIKey]);

  const embeddingProvider = envConfig?.graphitiProviderConfig?.embeddingProvider || 'ollama';

  // Toggle API key visibility
  const toggleShowApiKey = (key: string) => {
    const newValue = !showApiKey[key];
    setShowApiKey(prev => ({ ...prev, [key]: newValue }));
    // Sync with parent for OpenAI
    if (key === 'openai') {
      setShowOpenAIKey(newValue);
    }
  };

  // Handle Ollama model selection
  const handleOllamaModelSelect = (modelName: string, dim: number) => {
    updateEnvConfig({
      graphitiProviderConfig: {
        ...envConfig?.graphitiProviderConfig,
        embeddingProvider: 'ollama',
        ollamaEmbeddingModel: modelName,
        ollamaEmbeddingDim: dim,
      }
    });
  };

  if (!envConfig) return null;

  // Render provider-specific configuration fields
  const renderProviderFields = () => {
    // OpenAI
    if (embeddingProvider === 'openai') {
      return (
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
          <div className="relative">
            <Input
              type={showApiKey['openai'] ? 'text' : 'password'}
              placeholder={envConfig.openaiKeyIsGlobal ? 'Enter to override global key...' : 'sk-xxxxxxxx'}
              value={envConfig.openaiKeyIsGlobal ? '' : (envConfig.openaiApiKey || '')}
              onChange={(e) => updateEnvConfig({ openaiApiKey: e.target.value || undefined })}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('openai')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['openai'] ? 'Hide OpenAI API key' : 'Show OpenAI API key'}
            >
              {showApiKey['openai'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your key from{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              OpenAI
            </a>
          </p>
        </div>
      );
    }

    // Voyage AI
    if (embeddingProvider === 'voyage') {
      return (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Voyage AI API Key</Label>
          <p className="text-xs text-muted-foreground">
            Required for Voyage AI embeddings
          </p>
          <div className="relative">
            <Input
              type={showApiKey['voyage'] ? 'text' : 'password'}
              value={envConfig.graphitiProviderConfig?.voyageApiKey || ''}
              onChange={(e) => updateEnvConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: 'voyage',
                  voyageApiKey: e.target.value || undefined,
                }
              })}
              placeholder="pa-xxxxxxxx"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('voyage')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['voyage'] ? 'Hide Voyage AI API key' : 'Show Voyage AI API key'}
            >
              {showApiKey['voyage'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your key from{' '}
            <a href="https://dash.voyageai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              Voyage AI
            </a>
          </p>
          <div className="space-y-1 mt-3">
            <Label className="text-xs text-muted-foreground">Embedding Model (optional)</Label>
            <Input
              placeholder="voyage-3"
              value={envConfig.graphitiProviderConfig?.voyageEmbeddingModel || ''}
              onChange={(e) => updateEnvConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: 'voyage',
                  voyageEmbeddingModel: e.target.value || undefined,
                }
              })}
            />
          </div>
        </div>
      );
    }

    // Google AI
    if (embeddingProvider === 'google') {
      return (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Google AI API Key</Label>
          <p className="text-xs text-muted-foreground">
            Required for Google AI embeddings
          </p>
          <div className="relative">
            <Input
              type={showApiKey['google'] ? 'text' : 'password'}
              value={envConfig.graphitiProviderConfig?.googleApiKey || ''}
              onChange={(e) => updateEnvConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: 'google',
                  googleApiKey: e.target.value || undefined,
                }
              })}
              placeholder="AIzaSy..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => toggleShowApiKey('google')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey['google'] ? 'Hide Google API key' : 'Show Google API key'}
            >
              {showApiKey['google'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get your key from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              Google AI Studio
            </a>
          </p>
        </div>
      );
    }

    // Azure OpenAI
    if (embeddingProvider === 'azure_openai') {
      return (
        <div className="space-y-3 p-3 rounded-md bg-muted/50">
          <Label className="text-sm font-medium text-foreground">Azure OpenAI Configuration</Label>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">API Key</Label>
            <div className="relative">
              <Input
                type={showApiKey['azure'] ? 'text' : 'password'}
                value={envConfig.graphitiProviderConfig?.azureOpenaiApiKey || ''}
                onChange={(e) => updateEnvConfig({
                  graphitiProviderConfig: {
                    ...envConfig.graphitiProviderConfig,
                    embeddingProvider: 'azure_openai',
                    azureOpenaiApiKey: e.target.value || undefined,
                  }
                })}
                placeholder="Azure API Key"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey('azure')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showApiKey['azure'] ? 'Hide Azure OpenAI API key' : 'Show Azure OpenAI API key'}
              >
                {showApiKey['azure'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Base URL</Label>
            <Input
              placeholder="https://your-resource.openai.azure.com"
              value={envConfig.graphitiProviderConfig?.azureOpenaiBaseUrl || ''}
              onChange={(e) => updateEnvConfig({
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
              onChange={(e) => updateEnvConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: 'azure_openai',
                  azureOpenaiEmbeddingDeployment: e.target.value || undefined,
                }
              })}
            />
          </div>
        </div>
      );
    }

    // Ollama (Local) - uses OllamaModelSelector component
    if (embeddingProvider === 'ollama') {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Base URL</Label>
            <Input
              placeholder="http://localhost:11434"
              value={envConfig.graphitiProviderConfig?.ollamaBaseUrl || 'http://localhost:11434'}
              onChange={(e) => updateEnvConfig({
                graphitiProviderConfig: {
                  ...envConfig.graphitiProviderConfig,
                  embeddingProvider: 'ollama',
                  ollamaBaseUrl: e.target.value,
                }
              })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Select Embedding Model</Label>
            <OllamaModelSelector
              selectedModel={envConfig.graphitiProviderConfig?.ollamaEmbeddingModel || ''}
              baseUrl={envConfig.graphitiProviderConfig?.ollamaBaseUrl}
              onModelSelect={handleOllamaModelSelect}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <section className="space-y-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          Memory
          <span className={`px-2 py-0.5 text-xs rounded-full ${
            envConfig.graphitiEnabled
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground'
          }`}>
            {envConfig.graphitiEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 pl-6 pt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal text-foreground">Enable Memory</Label>
              <p className="text-xs text-muted-foreground">
                Persistent cross-session memory using LadybugDB (embedded database)
              </p>
            </div>
            <Switch
              checked={envConfig.graphitiEnabled}
              onCheckedChange={(checked) => {
                updateEnvConfig({ graphitiEnabled: checked });
                setSettings({ ...settings, memoryBackend: checked ? 'graphiti' : 'file' });
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
                    setSettings({ ...settings, graphitiMcpEnabled: checked })
                  }
                />
              </div>

              {settings.graphitiMcpEnabled && (
                <div className="space-y-2 ml-6">
                  <Label className="text-sm font-medium text-foreground">Graphiti MCP Server URL</Label>
                  <p className="text-xs text-muted-foreground">
                    URL of the Graphiti MCP server for agent memory access
                  </p>
                  <Input
                    placeholder="http://localhost:8000/mcp/"
                    value={settings.graphitiMcpUrl || ''}
                    onChange={(e) => setSettings({ ...settings, graphitiMcpUrl: e.target.value || undefined })}
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
                  onValueChange={(value: GraphitiEmbeddingProvider) => {
                    updateEnvConfig({
                      graphitiProviderConfig: {
                        ...envConfig.graphitiProviderConfig,
                        embeddingProvider: value,
                      }
                    });
                  }}
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

              {/* Provider-specific fields */}
              {renderProviderFields()}

              <Separator />

              {/* Database Settings */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">Database Name</Label>
                <p className="text-xs text-muted-foreground">
                  Stored in ~/.auto-claude/memories/
                </p>
                <Input
                  placeholder="auto_claude_memory"
                  value={envConfig.graphitiDatabase || ''}
                  onChange={(e) => updateEnvConfig({ graphitiDatabase: e.target.value })}
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
                  onChange={(e) => updateEnvConfig({ graphitiDbPath: e.target.value || undefined })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
