import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Import,
  Radio,
  Github,
  RefreshCw,
  GitBranch
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import type { ProjectEnvConfig, LinearSyncStatus, GitHubSyncStatus, Project, ProjectSettings as ProjectSettingsType } from '../../../shared/types';

interface IntegrationSettingsProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;

  // Project settings for main branch
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;

  // Linear state
  showLinearKey: boolean;
  setShowLinearKey: React.Dispatch<React.SetStateAction<boolean>>;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  linearExpanded: boolean;
  onLinearToggle: () => void;
  onOpenLinearImport: () => void;

  // GitHub state
  showGitHubToken: boolean;
  setShowGitHubToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitHubConnectionStatus: GitHubSyncStatus | null;
  isCheckingGitHub: boolean;
  githubExpanded: boolean;
  onGitHubToggle: () => void;
}

export function IntegrationSettings({
  envConfig,
  updateEnvConfig,
  project,
  settings,
  setSettings,
  showLinearKey,
  setShowLinearKey,
  linearConnectionStatus,
  isCheckingLinear,
  linearExpanded,
  onLinearToggle,
  onOpenLinearImport,
  showGitHubToken,
  setShowGitHubToken,
  gitHubConnectionStatus,
  isCheckingGitHub,
  githubExpanded,
  onGitHubToggle
}: IntegrationSettingsProps) {
  // Branch selection state
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  // Track whether initial branch detection has been done to prevent double-execution
  const hasDetectedMainBranch = useRef(false);
  // Track mainBranch in a ref to avoid stale closure issues in loadBranches callback
  const mainBranchRef = useRef(settings.mainBranch);

  // Keep mainBranchRef in sync with settings.mainBranch
  useEffect(() => {
    mainBranchRef.current = settings.mainBranch;
  }, [settings.mainBranch]);

  // Reset detection flag when project OR GitHub repo changes
  // This allows auto-detection to run for a new repo within the same project
  useEffect(() => {
    hasDetectedMainBranch.current = false;
  }, []);

  // Load branches function wrapped in useCallback
  // Note: We use refs for mainBranch check and detection tracking to avoid stale closures
  const loadBranches = useCallback(async () => {
    setIsLoadingBranches(true);
    try {
      const result = await window.electronAPI.getGitBranches(project.path);
      if (result.success && result.data) {
        setBranches(result.data);
        // Auto-detect main branch if not set and not already detected
        // Use mainBranchRef to avoid stale closure issues
        if (!mainBranchRef.current && !hasDetectedMainBranch.current) {
          hasDetectedMainBranch.current = true;
          const detectResult = await window.electronAPI.detectMainBranch(project.path);
          // Re-check mainBranchRef after await - user may have selected a branch during detection
          if (detectResult.success && detectResult.data !== null && detectResult.data !== undefined && !mainBranchRef.current) {
            const detectedBranch = detectResult.data;
            setSettings(prev => ({ ...prev, mainBranch: detectedBranch }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      setIsLoadingBranches(false);
    }
    // settings.mainBranch not in deps - we use mainBranchRef to avoid stale closures
    // hasDetectedMainBranch ref tracks whether detection has run this session
  }, [project.path, setSettings]);

  // Load branches when GitHub section expands or GitHub connection changes
  useEffect(() => {
    // Only load branches when:
    // 1. GitHub section is expanded
    // 2. Project path exists
    // 3. GitHub is enabled with repo configured
    if (!githubExpanded || !project.path) return;
    if (!envConfig?.githubEnabled || !envConfig?.githubRepo) return;

    // Only load branches when we have a successful connection
    if (gitHubConnectionStatus?.connected) {
      loadBranches();
    }
  }, [githubExpanded, project.path, envConfig?.githubEnabled, envConfig?.githubRepo, gitHubConnectionStatus?.connected, loadBranches]);

  if (!envConfig) return null;

  return (
    <>
      {/* Linear Integration Section */}
      <section className="space-y-3">
        <button
          onClick={onLinearToggle}
          className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Linear Integration
            {envConfig.linearEnabled && (
              <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">
                Enabled
              </span>
            )}
          </div>
          {linearExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {linearExpanded && (
          <div className="space-y-4 pl-6 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">Enable Linear Sync</Label>
                <p className="text-xs text-muted-foreground">
                  Create and update Linear issues automatically
                </p>
              </div>
              <Switch
                checked={envConfig.linearEnabled}
                onCheckedChange={(checked) => updateEnvConfig({ linearEnabled: checked })}
              />
            </div>

            {envConfig.linearEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">API Key</Label>
                  <p className="text-xs text-muted-foreground">
                    Get your API key from{' '}
                    <a
                      href="https://linear.app/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline"
                    >
                      Linear Settings
                    </a>
                  </p>
                  <div className="relative">
                    <Input
                      type={showLinearKey ? 'text' : 'password'}
                      placeholder="lin_api_xxxxxxxx"
                      value={envConfig.linearApiKey || ''}
                      onChange={(e) => updateEnvConfig({ linearApiKey: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLinearKey(!showLinearKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showLinearKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Connection Status */}
                {envConfig.linearApiKey && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Connection Status</p>
                        <p className="text-xs text-muted-foreground">
                          {isCheckingLinear ? 'Checking...' :
                            linearConnectionStatus?.connected
                              ? `Connected${linearConnectionStatus.teamName ? ` to ${linearConnectionStatus.teamName}` : ''}`
                              : linearConnectionStatus?.error || 'Not connected'}
                        </p>
                        {linearConnectionStatus?.connected && linearConnectionStatus.issueCount !== undefined && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {linearConnectionStatus.issueCount}+ tasks available to import
                          </p>
                        )}
                      </div>
                      {isCheckingLinear ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : linearConnectionStatus?.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                  </div>
                )}

                {/* Import Existing Tasks Button */}
                {linearConnectionStatus?.connected && (
                  <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                    <div className="flex items-start gap-3">
                      <Import className="h-5 w-5 text-info mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">Import Existing Tasks</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Select which Linear issues to import into AutoBuild as tasks.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={onOpenLinearImport}
                        >
                          <Import className="h-4 w-4 mr-2" />
                          Import Tasks from Linear
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Real-time Sync Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Radio className="h-4 w-4 text-info" />
                      <Label className="font-normal text-foreground">Real-time Sync</Label>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Automatically import new tasks created in Linear
                    </p>
                  </div>
                  <Switch
                    checked={envConfig.linearRealtimeSync || false}
                    onCheckedChange={(checked) => updateEnvConfig({ linearRealtimeSync: checked })}
                  />
                </div>

                {envConfig.linearRealtimeSync && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 ml-6">
                    <p className="text-xs text-warning">
                      When enabled, new Linear issues will be automatically imported into AutoBuild.
                      Make sure to configure your team/project filters below to control which issues are imported.
                    </p>
                  </div>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Team ID (Optional)</Label>
                    <Input
                      placeholder="Auto-detected"
                      value={envConfig.linearTeamId || ''}
                      onChange={(e) => updateEnvConfig({ linearTeamId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Project ID (Optional)</Label>
                    <Input
                      placeholder="Auto-created"
                      value={envConfig.linearProjectId || ''}
                      onChange={(e) => updateEnvConfig({ linearProjectId: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* GitHub Integration Section */}
      <section className="space-y-3">
        <button
          onClick={onGitHubToggle}
          className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
        >
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub Integration
            {envConfig.githubEnabled && (
              <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">
                Enabled
              </span>
            )}
          </div>
          {githubExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {githubExpanded && (
          <div className="space-y-4 pl-6 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">Enable GitHub Issues</Label>
                <p className="text-xs text-muted-foreground">
                  Sync issues from GitHub and create tasks automatically
                </p>
              </div>
              <Switch
                checked={envConfig.githubEnabled}
                onCheckedChange={(checked) => updateEnvConfig({ githubEnabled: checked })}
              />
            </div>

            {envConfig.githubEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Personal Access Token</Label>
                  <p className="text-xs text-muted-foreground">
                    Create a token with <code className="px-1 bg-muted rounded">repo</code> scope from{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=Auto-Build-UI"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline"
                    >
                      GitHub Settings
                    </a>
                  </p>
                  <div className="relative">
                    <Input
                      type={showGitHubToken ? 'text' : 'password'}
                      placeholder="ghp_xxxxxxxx or github_pat_xxxxxxxx"
                      value={envConfig.githubToken || ''}
                      onChange={(e) => updateEnvConfig({ githubToken: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGitHubToken(!showGitHubToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showGitHubToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Repository</Label>
                  <p className="text-xs text-muted-foreground">
                    Format: <code className="px-1 bg-muted rounded">owner/repo</code> (e.g., facebook/react)
                  </p>
                  <Input
                    placeholder="owner/repository"
                    value={envConfig.githubRepo || ''}
                    onChange={(e) => updateEnvConfig({ githubRepo: e.target.value })}
                  />
                </div>

                {/* Connection Status */}
                {envConfig.githubToken && envConfig.githubRepo && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Connection Status</p>
                        <p className="text-xs text-muted-foreground">
                          {isCheckingGitHub ? 'Checking...' :
                            gitHubConnectionStatus?.connected
                              ? `Connected to ${gitHubConnectionStatus.repoFullName}`
                              : gitHubConnectionStatus?.error || 'Not connected'}
                        </p>
                        {gitHubConnectionStatus?.connected && gitHubConnectionStatus.repoDescription && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {gitHubConnectionStatus.repoDescription}
                          </p>
                        )}
                      </div>
                      {isCheckingGitHub ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : gitHubConnectionStatus?.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                  </div>
                )}

                {/* Info about accessing issues */}
                {gitHubConnectionStatus?.connected && (
                  <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                    <div className="flex items-start gap-3">
                      <Github className="h-5 w-5 text-info mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">Issues Available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Access GitHub Issues from the sidebar to view, investigate, and create tasks from issues.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Auto-sync Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-info" />
                      <Label className="font-normal text-foreground">Auto-Sync on Load</Label>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Automatically fetch issues when the project loads
                    </p>
                  </div>
                  <Switch
                    checked={envConfig.githubAutoSync || false}
                    onCheckedChange={(checked) => updateEnvConfig({ githubAutoSync: checked })}
                  />
                </div>

                <Separator />

                {/* Main Branch Selection */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-info" />
                    <Label className="text-sm font-medium text-foreground">Main Branch</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The base branch for creating task worktrees. All new tasks will branch from here.
                  </p>
                  <Select
                    value={settings.mainBranch || ''}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, mainBranch: value }))}
                    disabled={isLoadingBranches || branches.length === 0}
                  >
                    <SelectTrigger>
                      {isLoadingBranches ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Loading branches...</span>
                        </div>
                      ) : (
                        <SelectValue placeholder="Select main branch" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {settings.mainBranch && (
                    <p className="text-xs text-muted-foreground">
                      Tasks will be created on branches like <code className="px-1 bg-muted rounded">auto-claude/task-name</code> from <code className="px-1 bg-muted rounded">{settings.mainBranch}</code>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
