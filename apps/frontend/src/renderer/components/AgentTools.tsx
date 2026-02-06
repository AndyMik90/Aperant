/**
 * Agent Tools Overview
 *
 * Displays MCP server and tool configuration for each agent phase.
 * Helps users understand what tools are available during different execution phases.
 * Now shows per-project MCP configuration with toggles to enable/disable servers.
 */

import {
  Server,
  Wrench,
  Brain,
  Code,
  Search,
  FileCheck,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Monitor,
  Globe,
  ClipboardList,
  ListChecks,
  Info,
  AlertCircle,
  Plus,
  X,
  RotateCcw,
  Pencil,
  Trash2,
  Terminal,
  Loader2,
  RefreshCw,
  Lock
} from 'lucide-react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { useSettingsStore } from '../stores/settings-store';
import { useProjectStore } from '../stores/project-store';
import type { ProjectEnvConfig, AgentMcpOverride, CustomMcpServer, McpHealthCheckResult, } from '../../shared/types';
import { CustomMcpDialog } from './CustomMcpDialog';
import { useTranslation } from 'react-i18next';
import {
  AVAILABLE_MODELS,
  THINKING_LEVELS,
} from '../../shared/constants/models';
import {
  useResolvedAgentSettings,
  resolveAgentSettings as resolveAgentModelConfig,
  type AgentSettingsSource,
} from '../hooks';
import type { ModelTypeShort, ThinkingLevel } from '../../shared/types/settings';

// Agent configuration data - mirrors AGENT_CONFIGS from backend
// Model and thinking are now dynamically read from user settings
interface AgentConfig {
  label: string;
  description: string;
  category: string;
  tools: string[];
  mcp_servers: string[];
  mcp_optional?: string[];
  // Maps to settings source - either a phase or a feature
  settingsSource: AgentSettingsSource;
}

// Helper to get model label from short name
function getModelLabel(modelShort: ModelTypeShort): string {
  const model = AVAILABLE_MODELS.find(m => m.value === modelShort);
  return model?.label.replace('Claude ', '') || modelShort;
}

// Helper to get thinking label from level
function getThinkingLabel(level: ThinkingLevel): string {
  const thinking = THINKING_LEVELS.find(t => t.value === level);
  return thinking?.label || level;
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // Spec Creation Phases - all use 'spec' phase settings
  spec_gatherer: {
    label: 'Spec Gatherer',
    description: 'Collects initial requirements from user',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_researcher: {
    label: 'Spec Researcher',
    description: 'Validates external integrations and APIs',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7'],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_writer: {
    label: 'Spec Writer',
    description: 'Creates the spec.md document',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_critic: {
    label: 'Spec Critic',
    description: 'Self-critique using deep analysis',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_discovery: {
    label: 'Spec Discovery',
    description: 'Initial project discovery and analysis',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_context: {
    label: 'Spec Context',
    description: 'Builds context from existing codebase',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },
  spec_validation: {
    label: 'Spec Validation',
    description: 'Validates spec completeness and quality',
    category: 'spec',
    tools: ['Read', 'Glob', 'Grep'],
    mcp_servers: [],
    settingsSource: { type: 'phase', phase: 'spec' },
  },

  // Build Phases
  planner: {
    label: 'Planner',
    description: 'Creates implementation plan with subtasks',
    category: 'build',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7', 'graphiti-memory', 'auto-claude'],
    mcp_optional: ['linear'],
    settingsSource: { type: 'phase', phase: 'planning' },
  },
  coder: {
    label: 'Coder',
    description: 'Implements individual subtasks',
    category: 'build',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7', 'graphiti-memory', 'auto-claude'],
    mcp_optional: ['linear'],
    settingsSource: { type: 'phase', phase: 'coding' },
  },

  // QA Phases
  qa_reviewer: {
    label: 'QA Reviewer',
    description: 'Validates acceptance criteria. Uses Electron or Puppeteer based on project type.',
    category: 'qa',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7', 'graphiti-memory', 'auto-claude'],
    mcp_optional: ['linear', 'electron', 'puppeteer'],
    settingsSource: { type: 'phase', phase: 'qa' },
  },
  qa_fixer: {
    label: 'QA Fixer',
    description: 'Fixes QA-reported issues. Uses Electron or Puppeteer based on project type.',
    category: 'qa',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7', 'graphiti-memory', 'auto-claude'],
    mcp_optional: ['linear', 'electron', 'puppeteer'],
    settingsSource: { type: 'phase', phase: 'qa' },
  },

  // Utility Phases - use feature settings
  pr_reviewer: {
    label: 'PR Reviewer',
    description: 'Reviews GitHub pull requests',
    category: 'utility',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7'],
    settingsSource: { type: 'feature', feature: 'githubPrs' },
  },
  commit_message: {
    label: 'Commit Message',
    description: 'Generates commit messages',
    category: 'utility',
    tools: [],
    mcp_servers: [],
    settingsSource: { type: 'feature', feature: 'utility' },
  },
  merge_resolver: {
    label: 'Merge Resolver',
    description: 'Resolves merge conflicts',
    category: 'utility',
    tools: [],
    mcp_servers: [],
    settingsSource: { type: 'feature', feature: 'utility' },
  },
  insights: {
    label: 'Insights',
    description: 'Extracts code insights',
    category: 'utility',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: [],
    settingsSource: { type: 'feature', feature: 'insights' },
  },
  analysis: {
    label: 'Analysis',
    description: 'Codebase analysis with context lookup',
    category: 'utility',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7'],
    // Analysis uses same as insights
    settingsSource: { type: 'feature', feature: 'insights' },
  },
  batch_analysis: {
    label: 'Batch Analysis',
    description: 'Batch processing of issues or items',
    category: 'utility',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: [],
    // Batch uses same as GitHub Issues
    settingsSource: { type: 'feature', feature: 'githubIssues' },
  },

  // Ideation & Roadmap - use feature settings
  ideation: {
    label: 'Ideation',
    description: 'Generates feature ideas',
    category: 'ideation',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: [],
    settingsSource: { type: 'feature', feature: 'ideation' },
  },
  roadmap_discovery: {
    label: 'Roadmap Discovery',
    description: 'Discovers roadmap items',
    category: 'ideation',
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    mcp_servers: ['context7'],
    settingsSource: { type: 'feature', feature: 'roadmap' },
  },
  pr_template_filler: {
    label: 'PR Template Filler',
    description: 'Generates AI-powered PR descriptions from templates',
    category: 'utility',
    tools: ['Read', 'Glob', 'Grep'],
    mcp_servers: [],
    settingsSource: { type: 'feature', feature: 'utility' },
  },
};

// MCP Server descriptions - accurate per backend models.py
const MCP_SERVERS: Record<string, { name: string; description: string; icon: React.ElementType; tools?: string[] }> = {
  context7: {
    name: 'Context7',
    description: 'Documentation lookup for libraries and frameworks via @upstash/context7-mcp',
    icon: Search,
    tools: ['mcp__context7__resolve-library-id', 'mcp__context7__query-docs'],
  },
  'graphiti-memory': {
    name: 'Graphiti Memory',
    description: 'Knowledge graph for cross-session context. Requires GRAPHITI_MCP_URL env var.',
    icon: Brain,
    tools: [
      'mcp__graphiti-memory__search_nodes',
      'mcp__graphiti-memory__search_facts',
      'mcp__graphiti-memory__add_episode',
      'mcp__graphiti-memory__get_episodes',
      'mcp__graphiti-memory__get_entity_edge',
    ],
  },
  'auto-claude': {
    name: 'Auto-Claude Tools',
    description: 'Build progress tracking, session context, discoveries & gotchas recording',
    icon: ListChecks,
    tools: [
      'mcp__auto-claude__update_subtask_status',
      'mcp__auto-claude__get_build_progress',
      'mcp__auto-claude__record_discovery',
      'mcp__auto-claude__record_gotcha',
      'mcp__auto-claude__get_session_context',
      'mcp__auto-claude__update_qa_status',
    ],
  },
  linear: {
    name: 'Linear',
    description: 'Project management via Linear API. Requires LINEAR_API_KEY env var.',
    icon: ClipboardList,
    tools: [
      'mcp__linear-server__list_teams',
      'mcp__linear-server__list_projects',
      'mcp__linear-server__list_issues',
      'mcp__linear-server__create_issue',
      'mcp__linear-server__update_issue',
      // ... and more
    ],
  },
  electron: {
    name: 'Electron MCP',
    description: 'Desktop app automation via Chrome DevTools Protocol. Requires ELECTRON_MCP_ENABLED=true.',
    icon: Monitor,
    tools: [
      'mcp__electron__get_electron_window_info',
      'mcp__electron__take_screenshot',
      'mcp__electron__send_command_to_electron',
      'mcp__electron__read_electron_logs',
    ],
  },
  puppeteer: {
    name: 'Puppeteer MCP',
    description: 'Web browser automation for non-Electron web frontends.',
    icon: Globe,
    tools: [
      'mcp__puppeteer__puppeteer_connect_active_tab',
      'mcp__puppeteer__puppeteer_navigate',
      'mcp__puppeteer__puppeteer_screenshot',
      'mcp__puppeteer__puppeteer_click',
      'mcp__puppeteer__puppeteer_fill',
      'mcp__puppeteer__puppeteer_select',
      'mcp__puppeteer__puppeteer_hover',
      'mcp__puppeteer__puppeteer_evaluate',
    ],
  },
};

// All available MCP servers that can be added to agents
const ALL_MCP_SERVERS = [
  'context7',
  'graphiti-memory',
  'linear',
  'electron',
  'puppeteer',
  'auto-claude'
] as const;

// Category metadata - neutral styling per design.json
const CATEGORIES = {
  spec: { label: 'Spec Creation', icon: FileCheck },
  build: { label: 'Build', icon: Code },
  qa: { label: 'QA', icon: CheckCircle2 },
  utility: { label: 'Utility', icon: Wrench },
  ideation: { label: 'Ideation', icon: Lightbulb },
};

interface AgentCardProps {
  id: string;
  config: typeof AGENT_CONFIGS[keyof typeof AGENT_CONFIGS];
  modelLabel: string;
  thinkingLabel: string;
  overrides: AgentMcpOverride | undefined;
  mcpServerStates: ProjectEnvConfig['mcpServers'];
  customServers: CustomMcpServer[];
  onAddMcp: (agentId: string, mcpId: string) => void;
  onRemoveMcp: (agentId: string, mcpId: string) => void;
}

function AgentCard({ id, config, modelLabel, thinkingLabel, overrides, mcpServerStates, customServers, onAddMcp, onRemoveMcp }: AgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { t } = useTranslation(['settings']);
  const category = CATEGORIES[config.category as keyof typeof CATEGORIES];
  const CategoryIcon = category.icon;

  // Build combined MCP server info including custom servers
  const allMcpServers = useMemo(() => {
    const servers = { ...MCP_SERVERS };
    for (const custom of customServers) {
      servers[custom.id] = {
        name: custom.name,
        description: custom.description || (custom.type === 'command' ? `${custom.command} ${custom.args?.join(' ') || ''}` : custom.url || ''),
        icon: custom.type === 'command' ? Terminal : Globe,
      };
    }
    return servers;
  }, [customServers]);

  // Calculate effective MCPs: defaults + adds - removes, then filter by project-level MCP states
  const effectiveMcps = useMemo(() => {
    const defaultMcps = [...config.mcp_servers, ...(config.mcp_optional || [])];
    const added = overrides?.add || [];
    const removed = overrides?.remove || [];
    const combinedMcps = [...new Set([...defaultMcps, ...added])].filter(mcp => !removed.includes(mcp));

    // Filter out MCPs that are disabled at project level (custom servers are always enabled)
    return combinedMcps.filter(mcp => {
      if (!mcpServerStates) return true; // No project config, show all
      // Custom servers are always available if they exist
      if (customServers.some(s => s.id === mcp)) return true;
      switch (mcp) {
        case 'context7': return mcpServerStates.context7Enabled !== false;
        case 'graphiti-memory': return mcpServerStates.graphitiEnabled !== false;
        case 'linear': return mcpServerStates.linearMcpEnabled !== false;
        case 'electron': return mcpServerStates.electronEnabled !== false;
        case 'puppeteer': return mcpServerStates.puppeteerEnabled !== false;
        default: return true;
      }
    });
  }, [config, overrides, mcpServerStates, customServers]);

  // Check if an MCP is a custom addition (not in defaults)
  const isCustomAdd = (mcpId: string) => {
    const defaults = [...config.mcp_servers, ...(config.mcp_optional || [])];
    return !defaults.includes(mcpId) && (overrides?.add || []).includes(mcpId);
  };

  // Get removed MCPs (from defaults)
  const removedMcps = useMemo(() => {
    const defaults = [...config.mcp_servers, ...(config.mcp_optional || [])];
    return defaults.filter(mcp => (overrides?.remove || []).includes(mcp));
  }, [config, overrides]);

  // Get MCPs that can be added (not already in effective list) - includes custom servers
  const customServerIds = customServers.map(s => s.id);
  const allAvailableMcpIds = [...ALL_MCP_SERVERS, ...customServerIds];
  const availableMcps = allAvailableMcpIds.filter(
    mcp => !effectiveMcps.includes(mcp) && !removedMcps.includes(mcp) && mcp !== 'auto-claude'
  );

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header - clickable to expand */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="p-2 rounded-lg bg-muted">
          <CategoryIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm text-foreground">{config.label}</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
              {modelLabel}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
              {thinkingLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{config.description}</p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-xs">
            {effectiveMcps.length} MCP
          </span>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border p-4 space-y-4 bg-muted/30">
          {/* MCP Servers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                MCP Servers
              </h4>
              {availableMcps.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowAddDialog(true); }}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {t('mcp.addServer')}
                </button>
              )}
            </div>
            {effectiveMcps.length > 0 || removedMcps.length > 0 ? (
              <div className="space-y-2">
                {/* Active MCPs */}
                {effectiveMcps.map((server) => {
                  const serverInfo = allMcpServers[server];
                  const ServerIcon = serverInfo?.icon || Server;
                  const isAdded = isCustomAdd(server);
                  const canRemove = server !== 'auto-claude';

                  return (
                    <div key={server} className="flex items-center justify-between group">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <ServerIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{serverInfo?.name || server}</span>
                        {isAdded && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                            {t('mcp.added')}
                          </span>
                        )}
                      </div>
                      {canRemove && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveMcp(id, server); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                          title={t('mcp.remove')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Removed MCPs (grayed out with restore option) */}
                {removedMcps.map((server) => {
                  const serverInfo = allMcpServers[server];
                  const ServerIcon = serverInfo?.icon || Server;

                  return (
                    <div key={server} className="flex items-center justify-between group opacity-50">
                      <div className="flex items-center gap-2 text-sm line-through">
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                        <ServerIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{serverInfo?.name || server}</span>
                        <span className="text-[10px] text-muted-foreground no-underline">
                          ({t('mcp.removed')})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onAddMcp(id, server); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition-all"
                        title={t('mcp.restore')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('mcp.noMcpServers')}</p>
            )}
          </div>

          {/* Tools */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Available Tools
            </h4>
            {config.tools.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {config.tools.map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-1 bg-muted rounded text-xs font-mono"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Text-only (no tools)</p>
            )}
          </div>
        </div>
      )}

      {/* Add MCP Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('mcp.addMcpTo', { agent: config.label })}</DialogTitle>
            <DialogDescription>{t('mcp.addMcpDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {availableMcps.length > 0 ? (
              availableMcps.map((mcpId) => {
                const server = allMcpServers[mcpId];
                const ServerIcon = server?.icon || Server;
                return (
                  <button
                    type="button"
                    key={mcpId}
                    onClick={() => { onAddMcp(id, mcpId); setShowAddDialog(false); }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <ServerIcon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-sm">{server?.name || mcpId}</div>
                      <div className="text-xs text-muted-foreground">{server?.description}</div>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('mcp.allMcpsAdded')}
              </p>
            )}
            {/* Also show removed MCPs that can be restored */}
            {removedMcps.length > 0 && (
              <>
                <div className="border-t border-border my-2 pt-2">
                  <p className="text-xs text-muted-foreground mb-2">{t('mcp.restore')}:</p>
                </div>
                {removedMcps.map((mcpId) => {
                  const server = allMcpServers[mcpId];
                  const ServerIcon = server?.icon || Server;
                  return (
                    <button
                      type="button"
                      key={mcpId}
                      onClick={() => { onAddMcp(id, mcpId); setShowAddDialog(false); }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left opacity-60"
                    >
                      <ServerIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-sm">{server?.name || mcpId}</div>
                        <div className="text-xs text-muted-foreground">{server?.description}</div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AgentTools() {
  const { t } = useTranslation(['settings']);
  const settings = useSettingsStore((state) => state.settings);
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['spec', 'build', 'qa'])
  );
  const [envConfig, setEnvConfig] = useState<ProjectEnvConfig | null>(null);
  const [, setIsLoading] = useState(false);

  // Custom MCP server dialog state
  const [showCustomMcpDialog, setShowCustomMcpDialog] = useState(false);
  const [editingCustomServer, setEditingCustomServer] = useState<CustomMcpServer | null>(null);

  // Health status tracking for custom servers
  const [serverHealthStatus, setServerHealthStatus] = useState<Record<string, McpHealthCheckResult>>({});
  const [testingServers, setTestingServers] = useState<Set<string>>(new Set());

  // Load project env config when project changes
  useEffect(() => {
    if (selectedProjectId && selectedProject?.autoBuildPath) {
      setIsLoading(true);
      window.electronAPI.getProjectEnv(selectedProjectId)
        .then((result) => {
          if (result.success && result.data) {
            setEnvConfig(result.data);
          } else {
            setEnvConfig(null);
          }
        })
        .catch(() => {
          setEnvConfig(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setEnvConfig(null);
    }
  }, [selectedProjectId, selectedProject?.autoBuildPath]);

  // Update MCP server toggle
  const updateMcpServer = useCallback(async (
    key: keyof NonNullable<ProjectEnvConfig['mcpServers']>,
    value: boolean
  ) => {
    if (!selectedProjectId || !envConfig) return;

    const newMcpServers = {
      ...envConfig.mcpServers,
      [key]: value,
    };

    // Optimistic update
    setEnvConfig((prev) => prev ? { ...prev, mcpServers: newMcpServers } : null);

    // Save to backend
    try {
      await window.electronAPI.updateProjectEnv(selectedProjectId, {
        mcpServers: newMcpServers,
      });
    } catch (error) {
      // Revert on error
      console.error('Failed to update MCP config:', error);
      setEnvConfig((prev) => prev ? { ...prev, mcpServers: envConfig.mcpServers } : null);
    }
  }, [selectedProjectId, envConfig]);

  // Handle adding an MCP to an agent
  const handleAddMcp = useCallback(async (agentId: string, mcpId: string) => {
    if (!selectedProjectId || !envConfig) return;

    const currentOverrides = envConfig.agentMcpOverrides || {};
    const agentOverride = currentOverrides[agentId] || {};

    // If it's in the remove list, take it out (restore)
    // Otherwise, add it to the add list
    let newOverride: AgentMcpOverride;
    if (agentOverride.remove?.includes(mcpId)) {
      newOverride = {
        ...agentOverride,
        remove: agentOverride.remove.filter(m => m !== mcpId),
      };
    } else {
      newOverride = {
        ...agentOverride,
        add: [...(agentOverride.add || []), mcpId].filter((v, i, a) => a.indexOf(v) === i),
      };
    }

    // Clean up empty arrays
    if (newOverride.add?.length === 0) delete newOverride.add;
    if (newOverride.remove?.length === 0) delete newOverride.remove;

    const newOverrides = { ...currentOverrides };
    if (Object.keys(newOverride).length === 0) {
      delete newOverrides[agentId];
    } else {
      newOverrides[agentId] = newOverride;
    }

    // Optimistic update
    setEnvConfig((prev) => prev ? { ...prev, agentMcpOverrides: newOverrides } : null);

    // Save to backend
    try {
      await window.electronAPI.updateProjectEnv(selectedProjectId, {
        agentMcpOverrides: newOverrides,
      });
    } catch (error) {
      console.error('Failed to update agent MCP config:', error);
      setEnvConfig((prev) => prev ? { ...prev, agentMcpOverrides: currentOverrides } : null);
    }
  }, [selectedProjectId, envConfig]);

  // Handle removing an MCP from an agent
  const handleRemoveMcp = useCallback(async (agentId: string, mcpId: string) => {
    if (!selectedProjectId || !envConfig) return;

    const agentConfig = AGENT_CONFIGS[agentId];
    const defaults = [...(agentConfig?.mcp_servers || []), ...(agentConfig?.mcp_optional || [])];
    const isDefault = defaults.includes(mcpId);

    const currentOverrides = envConfig.agentMcpOverrides || {};
    const agentOverride = currentOverrides[agentId] || {};

    let newOverride: AgentMcpOverride;
    if (isDefault) {
      // It's a default MCP - add to remove list
      newOverride = {
        ...agentOverride,
        remove: [...(agentOverride.remove || []), mcpId].filter((v, i, a) => a.indexOf(v) === i),
      };
    } else {
      // It's a custom addition - remove from add list
      newOverride = {
        ...agentOverride,
        add: (agentOverride.add || []).filter(m => m !== mcpId),
      };
    }

    // Clean up empty arrays
    if (newOverride.add?.length === 0) delete newOverride.add;
    if (newOverride.remove?.length === 0) delete newOverride.remove;

    const newOverrides = { ...currentOverrides };
    if (Object.keys(newOverride).length === 0) {
      delete newOverrides[agentId];
    } else {
      newOverrides[agentId] = newOverride;
    }

    // Optimistic update
    setEnvConfig((prev) => prev ? { ...prev, agentMcpOverrides: newOverrides } : null);

    // Save to backend
    try {
      await window.electronAPI.updateProjectEnv(selectedProjectId, {
        agentMcpOverrides: newOverrides,
      });
    } catch (error) {
      console.error('Failed to update agent MCP config:', error);
      setEnvConfig((prev) => prev ? { ...prev, agentMcpOverrides: currentOverrides } : null);
    }
  }, [selectedProjectId, envConfig]);

  // Handle saving a custom MCP server
  const handleSaveCustomServer = useCallback(async (server: CustomMcpServer) => {
    if (!selectedProjectId || !envConfig) return;

    const currentServers = envConfig.customMcpServers || [];
    const existingIndex = currentServers.findIndex(s => s.id === server.id);

    let newServers: CustomMcpServer[];
    if (existingIndex >= 0) {
      // Update existing
      newServers = [...currentServers];
      newServers[existingIndex] = server;
    } else {
      // Add new
      newServers = [...currentServers, server];
    }

    // Optimistic update
    setEnvConfig((prev) => prev ? { ...prev, customMcpServers: newServers } : null);

    // Save to backend
    try {
      await window.electronAPI.updateProjectEnv(selectedProjectId, {
        customMcpServers: newServers,
      });
    } catch (error) {
      console.error('Failed to save custom MCP server:', error);
      setEnvConfig((prev) => prev ? { ...prev, customMcpServers: currentServers } : null);
    }
  }, [selectedProjectId, envConfig]);

  // Handle deleting a custom MCP server
  const handleDeleteCustomServer = useCallback(async (serverId: string) => {
    if (!selectedProjectId || !envConfig) return;

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

    // Optimistic update
    setEnvConfig((prev) => prev ? {
      ...prev,
      customMcpServers: newServers,
      agentMcpOverrides: newOverrides,
    } : null);

    // Save to backend
    try {
      await window.electronAPI.updateProjectEnv(selectedProjectId, {
        customMcpServers: newServers,
        agentMcpOverrides: newOverrides,
      });
    } catch (error) {
      console.error('Failed to delete custom MCP server:', error);
      setEnvConfig((prev) => prev ? { ...prev, customMcpServers: currentServers, agentMcpOverrides: currentOverrides } : null);
    }
  }, [selectedProjectId, envConfig]);

  // Check health of all custom MCP servers
  const checkAllServersHealth = useCallback(async () => {
    const servers = envConfig?.customMcpServers || [];
    if (servers.length === 0) return;

    for (const server of servers) {
      // Set checking status
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
      } catch (_error) {
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

  // Test a single server connection (full test)
  const handleTestConnection = useCallback(async (server: CustomMcpServer) => {
    setTestingServers(prev => new Set(prev).add(server.id));

    try {
      const result = await window.electronAPI.testMcpConnection(server);
      if (result.success && result.data) {
        // Update health status based on test result
        setServerHealthStatus(prev => ({
          ...prev,
          [server.id]: {
            serverId: server.id,
            status: result.data?.success ? 'healthy' : 'unhealthy',
            message: result.data?.message,
            responseTime: result.data?.responseTime,
            checkedAt: new Date().toISOString(),
          }
        }));
      }
    } catch (_error) {
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

  // Resolve agent settings using the centralized utility
  // Resolution order: custom overrides -> selected profile's config -> global defaults
  const { phaseModels, phaseThinking, featureModels, featureThinking } = useResolvedAgentSettings(settings);

  // Get MCP server states for display
  const mcpServers = envConfig?.mcpServers || {};

  // Count enabled MCP servers
  const enabledCount = [
    mcpServers.context7Enabled !== false,
    mcpServers.graphitiEnabled && envConfig?.graphitiProviderConfig,
    mcpServers.linearMcpEnabled !== false && envConfig?.linearEnabled,
    mcpServers.electronEnabled,
    mcpServers.puppeteerEnabled,
    true, // auto-claude always enabled
  ].filter(Boolean).length;

  // Resolve model and thinking for an agent based on its settings source
  const getAgentModelConfig = useMemo(() => {
    return (config: AgentConfig): { model: ModelTypeShort; thinking: ThinkingLevel } => {
      return resolveAgentModelConfig(config.settingsSource, { phaseModels, phaseThinking, featureModels, featureThinking });
    };
  }, [phaseModels, phaseThinking, featureModels, featureThinking]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group agents by category
  const agentsByCategory = Object.entries(AGENT_CONFIGS).reduce(
    (acc, [id, config]) => {
      const category = config.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({ id, config });
      return acc;
    },
    {} as Record<string, Array<{ id: string; config: typeof AGENT_CONFIGS[keyof typeof AGENT_CONFIGS] }>>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border p-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Server className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">MCP Server Overview</h1>
              {selectedProject && (
                <span className="text-sm text-muted-foreground">
                  for {selectedProject.name}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedProject
                ? t('settings:mcp.description')
                : t('settings:mcp.descriptionNoProject')}
            </p>
          </div>
          {envConfig && (
            <div className="text-right">
              <span className="text-sm text-muted-foreground">{t('settings:mcp.serversEnabled', { count: enabledCount })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* No project selected message */}
          {!selectedProject && (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">{t('settings:mcp.noProjectSelected')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings:mcp.noProjectSelectedDescription')}
              </p>
            </div>
          )}

          {/* Project not initialized message */}
          {selectedProject && !selectedProject.autoBuildPath && (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <Info className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h2 className="text-sm font-medium text-foreground mb-1">{t('settings:mcp.projectNotInitialized')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings:mcp.projectNotInitializedDescription')}
              </p>
            </div>
          )}

          {/* MCP Server Configuration */}
          {envConfig && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">{t('settings:mcp.configuration')}</h2>
                <span className="text-xs text-muted-foreground">
                  {t('settings:mcp.configurationHint')}
                </span>
              </div>

              <div className="space-y-4">
                {/* Context7 */}
                <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm font-medium">{t('settings:mcp.servers.context7.name')}</span>
                      <p className="text-xs text-muted-foreground">{t('settings:mcp.servers.context7.description')}</p>
                    </div>
                  </div>
                  <Switch
                    checked={mcpServers.context7Enabled !== false}
                    onCheckedChange={(checked) => updateMcpServer('context7Enabled', checked)}
                  />
                </div>

                {/* Graphiti Memory */}
                <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <Brain className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm font-medium">{t('settings:mcp.servers.graphiti.name')}</span>
                      <p className="text-xs text-muted-foreground">
                        {envConfig.graphitiProviderConfig
                          ? t('settings:mcp.servers.graphiti.description')
                          : t('settings:mcp.servers.graphiti.notConfigured')}
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
                <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm font-medium">{t('settings:mcp.servers.linear.name')}</span>
                      <p className="text-xs text-muted-foreground">
                        {envConfig.linearEnabled
                          ? t('settings:mcp.servers.linear.description')
                          : t('settings:mcp.servers.linear.notConfigured')}
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
                      {t('settings:mcp.browserAutomation')}
                    </span>
                  </div>

                  {/* Electron */}
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <div className="flex items-center gap-3">
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="text-sm font-medium">{t('settings:mcp.servers.electron.name')}</span>
                        <p className="text-xs text-muted-foreground">{t('settings:mcp.servers.electron.description')}</p>
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
                        <span className="text-sm font-medium">{t('settings:mcp.servers.puppeteer.name')}</span>
                        <p className="text-xs text-muted-foreground">{t('settings:mcp.servers.puppeteer.description')}</p>
                      </div>
                    </div>
                    <Switch
                      checked={mcpServers.puppeteerEnabled === true}
                      onCheckedChange={(checked) => updateMcpServer('puppeteerEnabled', checked)}
                    />
                  </div>
                </div>

                {/* Auto-Claude (always enabled) */}
                <div className="flex items-center justify-between py-2 border-t border-border opacity-60">
                  <div className="flex items-center gap-3">
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="text-sm font-medium">{t('settings:mcp.servers.autoClaude.name')}</span>
                      <p className="text-xs text-muted-foreground">{t('settings:mcp.servers.autoClaude.description')} ({t('settings:mcp.alwaysEnabled')})</p>
                    </div>
                  </div>
                  <Switch checked={true} disabled />
                </div>

                {/* Custom MCP Servers Section */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        {t('settings:mcp.customServers')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEditingCustomServer(null); setShowCustomMcpDialog(true); }}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      {t('settings:mcp.addCustomServer')}
                    </button>
                  </div>

                  {(envConfig.customMcpServers?.length ?? 0) > 0 ? (
                    <div className="space-y-2">
                      {envConfig.customMcpServers?.map((server) => {
                        const health = serverHealthStatus[server.id];
                        const isTesting = testingServers.has(server.id);
                        const isChecking = health?.status === 'checking';

                        // Status indicator component
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
                              {/* Status indicator */}
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
                              {/* Test button - always visible */}
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
                              {/* Edit/Delete - show on hover */}
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
                      {t('settings:mcp.noCustomServers')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Agent Categories */}
          {Object.entries(CATEGORIES).map(([categoryId, category]) => {
            const agents = agentsByCategory[categoryId] || [];
            if (agents.length === 0) return null;

            const isExpanded = expandedCategories.has(categoryId);
            const CategoryIcon = category.icon;

            return (
              <div key={categoryId} className="space-y-3">
                {/* Category Header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(categoryId)}
                  className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">
                    {category.label}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    ({agents.length} agents)
                  </span>
                </button>

                {/* Agent Cards */}
                {isExpanded && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pl-6">
                    {agents.map(({ id, config }) => {
                      const { model, thinking } = getAgentModelConfig(config);
                      return (
                        <AgentCard
                          key={id}
                          id={id}
                          config={config}
                          modelLabel={getModelLabel(model)}
                          thinkingLabel={getThinkingLabel(thinking)}
                          overrides={envConfig?.agentMcpOverrides?.[id]}
                          mcpServerStates={envConfig?.mcpServers}
                          customServers={envConfig?.customMcpServers || []}
                          onAddMcp={handleAddMcp}
                          onRemoveMcp={handleRemoveMcp}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

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
