/**
 * MCP Server Configuration Settings
 *
 * Allows users to enable/disable MCP servers and manage custom servers.
 * This replaces the standalone Agent Tools page (PROP-3).
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Server,
  Brain,
  Search,
  Monitor,
  Globe,
  ClipboardList,
  ListChecks,
  Terminal,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Circle,
  AlertCircle,
  Lock,
  Info
} from 'lucide-react';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { CustomMcpDialog } from '../../CustomMcpDialog';
import type { ProjectEnvConfig, CustomMcpServer, McpHealthCheckResult } from '../../../../shared/types';

interface McpIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

export function McpIntegration({ envConfig, updateEnvConfig }: McpIntegrationProps) {
  const { t } = useTranslation(['settings']);

  // Custom MCP server dialog state
  const [showCustomMcpDialog, setShowCustomMcpDialog] = useState(false);
  const [editingCustomServer, setEditingCustomServer] = useState<CustomMcpServer | null>(null);

  // Health status tracking for custom servers
  const [serverHealthStatus, setServerHealthStatus] = useState<Record<string, McpHealthCheckResult>>({});
  const [testingServers, setTestingServers] = useState<Set<string>>(new Set());

  const mcpServers = envConfig?.mcpServers || {};

  // Update MCP server toggle
  const updateMcpServer = useCallback((
    key: keyof NonNullable<ProjectEnvConfig['mcpServers']>,
    value: boolean
  ) => {
    if (!envConfig) return;

    updateEnvConfig({
      mcpServers: {
        ...envConfig.mcpServers,
        [key]: value,
      },
    });
  }, [envConfig, updateEnvConfig]);

  // Handle saving a custom MCP server
  const handleSaveCustomServer = useCallback((server: CustomMcpServer) => {
    if (!envConfig) return;

    const currentServers = envConfig.customMcpServers || [];
    const existingIndex = currentServers.findIndex(s => s.id === server.id);

    let newServers: CustomMcpServer[];
    if (existingIndex >= 0) {
      newServers = [...currentServers];
      newServers[existingIndex] = server;
    } else {
      newServers = [...currentServers, server];
    }

    updateEnvConfig({ customMcpServers: newServers });
  }, [envConfig, updateEnvConfig]);

  // Handle deleting a custom MCP server
  const handleDeleteCustomServer = useCallback((serverId: string) => {
    if (!envConfig) return;

    const currentServers = envConfig.customMcpServers || [];
    const newServers = currentServers.filter(s => s.id !== serverId);

    // Also remove from any agent overrides that reference it
    const currentOverrides = envConfig.agentMcpOverrides || {};
    const newOverrides = { ...currentOverrides };
    for (const agentId of Object.keys(newOverrides)) {
      const override = newOverrides[agentId];
      if (override.add?.includes(serverId)) {
        newOverrides[agentId] = {
          ...override,
          add: override.add.filter(m => m !== serverId),
        };
        if (newOverrides[agentId].add?.length === 0) {
          delete newOverrides[agentId].add;
        }
        if (Object.keys(newOverrides[agentId]).length === 0) {
          delete newOverrides[agentId];
        }
      }
    }

    updateEnvConfig({
      customMcpServers: newServers,
      agentMcpOverrides: newOverrides,
    });
  }, [envConfig, updateEnvConfig]);

  // Check health of all custom MCP servers
  const checkAllServersHealth = useCallback(async () => {
    const servers = envConfig?.customMcpServers || [];
    if (servers.length === 0) return;

    for (const server of servers) {
      setServerHealthStatus(prev => ({
        ...prev,
        [server.id]: {
          serverId: server.id,
          status: 'checking',
          checkedAt: new Date().toISOString(),
        }
      }));

      try {
        const result = await window.electronAPI.checkMcpHealth(server);
        if (result.success && result.data) {
          setServerHealthStatus(prev => ({
            ...prev,
            [server.id]: result.data!,
          }));
        }
      } catch {
        setServerHealthStatus(prev => ({
          ...prev,
          [server.id]: {
            serverId: server.id,
            status: 'unknown',
            message: 'Health check failed',
            checkedAt: new Date().toISOString(),
          }
        }));
      }
    }
  }, [envConfig?.customMcpServers]);

  // Check health when custom servers change
  useEffect(() => {
    if (envConfig?.customMcpServers && envConfig.customMcpServers.length > 0) {
      checkAllServersHealth();
    }
  }, [envConfig?.customMcpServers, checkAllServersHealth]);

  // Test a single server connection
  const handleTestConnection = useCallback(async (server: CustomMcpServer) => {
    setTestingServers(prev => new Set(prev).add(server.id));

    try {
      const result = await window.electronAPI.testMcpConnection(server);
      if (result.success && result.data) {
        setServerHealthStatus(prev => ({
          ...prev,
          [server.id]: {
            serverId: server.id,
            status: result.data!.success ? 'healthy' : 'unhealthy',
            message: result.data!.message,
            responseTime: result.data!.responseTime,
            checkedAt: new Date().toISOString(),
          }
        }));
      }
    } catch {
      setServerHealthStatus(prev => ({
        ...prev,
        [server.id]: {
          serverId: server.id,
          status: 'unhealthy',
          message: 'Connection test failed',
          checkedAt: new Date().toISOString(),
        }
      }));
    } finally {
      setTestingServers(prev => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  }, []);

  if (!envConfig) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <Info className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-sm font-medium text-foreground mb-1">{t('mcp.projectNotInitialized')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('mcp.projectNotInitializedDescription')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Built-in MCP Servers */}
      <div className="space-y-4">
        {/* Context7 */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div className="flex items-center gap-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t('mcp.servers.context7.name')}</span>
              <p className="text-xs text-muted-foreground">{t('mcp.servers.context7.description')}</p>
            </div>
          </div>
          <Switch
            checked={mcpServers.context7Enabled !== false}
            onCheckedChange={(checked) => updateMcpServer('context7Enabled', checked)}
          />
        </div>

        {/* Graphiti Memory */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div className="flex items-center gap-3">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t('mcp.servers.graphiti.name')}</span>
              <p className="text-xs text-muted-foreground">
                {envConfig.graphitiProviderConfig
                  ? t('mcp.servers.graphiti.description')
                  : t('mcp.servers.graphiti.notConfigured')}
              </p>
            </div>
          </div>
          <Switch
            checked={mcpServers.graphitiEnabled !== false && !!envConfig.graphitiProviderConfig}
            onCheckedChange={(checked) => updateMcpServer('graphitiEnabled', checked)}
            disabled={!envConfig.graphitiProviderConfig}
          />
        </div>

        {/* Linear */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t('mcp.servers.linear.name')}</span>
              <p className="text-xs text-muted-foreground">
                {envConfig.linearEnabled
                  ? t('mcp.servers.linear.description')
                  : t('mcp.servers.linear.notConfigured')}
              </p>
            </div>
          </div>
          <Switch
            checked={mcpServers.linearMcpEnabled !== false && envConfig.linearEnabled}
            onCheckedChange={(checked) => updateMcpServer('linearMcpEnabled', checked)}
            disabled={!envConfig.linearEnabled}
          />
        </div>

        {/* Browser Automation Section */}
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {t('mcp.browserAutomation')}
            </span>
          </div>

          {/* Electron */}
          <div className="flex items-center justify-between py-2 border-b border-border">
            <div className="flex items-center gap-3">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium">{t('mcp.servers.electron.name')}</span>
                <p className="text-xs text-muted-foreground">{t('mcp.servers.electron.description')}</p>
              </div>
            </div>
            <Switch
              checked={mcpServers.electronEnabled === true}
              onCheckedChange={(checked) => updateMcpServer('electronEnabled', checked)}
            />
          </div>

          {/* Puppeteer */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium">{t('mcp.servers.puppeteer.name')}</span>
                <p className="text-xs text-muted-foreground">{t('mcp.servers.puppeteer.description')}</p>
              </div>
            </div>
            <Switch
              checked={mcpServers.puppeteerEnabled === true}
              onCheckedChange={(checked) => updateMcpServer('puppeteerEnabled', checked)}
            />
          </div>
        </div>

        {/* Jerry (always enabled) */}
        <div className="flex items-center justify-between py-2 border-t border-border opacity-60">
          <div className="flex items-center gap-3">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t('mcp.servers.autoClaude.name')}</span>
              <p className="text-xs text-muted-foreground">{t('mcp.servers.autoClaude.description')} ({t('mcp.alwaysEnabled')})</p>
            </div>
          </div>
          <Switch checked={true} disabled />
        </div>
      </div>

      {/* Custom MCP Servers Section */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t('mcp.customServers')}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setEditingCustomServer(null); setShowCustomMcpDialog(true); }}
            className="gap-1"
          >
            <Plus className="h-3 w-3" />
            {t('mcp.addCustomServer')}
          </Button>
        </div>

        {(envConfig.customMcpServers?.length ?? 0) > 0 ? (
          <div className="space-y-2">
            {envConfig.customMcpServers?.map((server) => {
              const health = serverHealthStatus[server.id];
              const isTesting = testingServers.has(server.id);
              const isChecking = health?.status === 'checking';

              const StatusIndicator = () => {
                if (isTesting || isChecking) {
                  return <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />;
                }
                switch (health?.status) {
                  case 'healthy':
                    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
                  case 'needs_auth':
                    return <Lock className="h-3.5 w-3.5 text-amber-500" />;
                  case 'unhealthy':
                    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
                  default:
                    return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
                }
              };

              return (
                <div
                  key={server.id}
                  className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg group"
                >
                  <div className="flex items-center gap-3">
                    <StatusIndicator />
                    {server.type === 'command' ? (
                      <Terminal className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{server.name}</span>
                        {health?.responseTime && (
                          <span className="text-[10px] text-muted-foreground">
                            {health.responseTime}ms
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {health?.message || (server.type === 'command'
                          ? `${server.command} ${server.args?.join(' ') || ''}`
                          : server.url)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTestConnection(server)}
                      disabled={isTesting}
                      className="h-7 px-2 text-xs"
                      title="Test Connection"
                    >
                      {isTesting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      <span className="ml-1">Test</span>
                    </Button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => { setEditingCustomServer(server); setShowCustomMcpDialog(true); }}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomServer(server.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-3">
            {t('mcp.noCustomServers')}
          </p>
        )}
      </div>

      {/* Info about agent tool access */}
      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="h-3 w-3 inline-block mr-1" />
        {t('mcp.agentToolInfo')}
      </div>

      {/* Custom MCP Server Dialog */}
      <CustomMcpDialog
        open={showCustomMcpDialog}
        onOpenChange={setShowCustomMcpDialog}
        server={editingCustomServer}
        existingIds={(envConfig?.customMcpServers || []).map(s => s.id)}
        onSave={handleSaveCustomServer}
      />
    </div>
  );
}
