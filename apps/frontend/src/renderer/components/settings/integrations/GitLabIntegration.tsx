import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, KeyRound, Loader2, CheckCircle2, AlertCircle, User, Lock, Globe, ChevronDown, GitBranch, Server, Terminal, ExternalLink } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Button } from '../../ui/button';
import { PasswordInput } from '../../project-settings/PasswordInput';
import type { ProjectEnvConfig, GitLabSyncStatus, ProjectSettings } from '../../../../shared/types';

// Debug logging
const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[GitLabIntegration] ${message}`, data);
    } else {
      console.warn(`[GitLabIntegration] ${message}`);
    }
  }
}

interface GitLabProject {
  pathWithNamespace: string;
  description: string | null;
  visibility: string;
}

interface GitLabIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showGitLabToken: boolean;
  setShowGitLabToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitLabConnectionStatus: GitLabSyncStatus | null;
  isCheckingGitLab: boolean;
  projectPath?: string;
  // Project settings for mainBranch (used by kanban tasks and terminal worktrees)
  settings?: ProjectSettings;
  setSettings?: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}

/**
 * GitLab integration settings component.
 * Manages GitLab token (manual or OAuth), project configuration, and connection status.
 * Supports both GitLab.com and self-hosted instances.
 */
export function GitLabIntegration({
  envConfig,
  updateEnvConfig,
  showGitLabToken: _showGitLabToken,
  setShowGitLabToken: _setShowGitLabToken,
  gitLabConnectionStatus,
  isCheckingGitLab,
  projectPath,
  settings,
  setSettings
}: GitLabIntegrationProps) {
  const { t } = useTranslation('gitlab');
  const [authMode, setAuthMode] = useState<'manual' | 'oauth' | 'oauth-success'>('manual');
  const [oauthUsername, setOauthUsername] = useState<string | null>(null);
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Branch selection state
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // glab CLI detection state
  const [glabInstalled, setGlabInstalled] = useState<boolean | null>(null);
  const [glabVersion, setGlabVersion] = useState<string | null>(null);
  const [isCheckingGlab, setIsCheckingGlab] = useState(false);
  const [isInstallingGlab, setIsInstallingGlab] = useState(false);
  const [glabInstallSuccess, setGlabInstallSuccess] = useState(false);

  debugLog('Render - authMode:', authMode);
  debugLog('Render - projectPath:', projectPath);
  debugLog('Render - envConfig:', envConfig ? { gitlabEnabled: envConfig.gitlabEnabled, hasToken: !!envConfig.gitlabToken, defaultBranch: envConfig.defaultBranch } : null);

  // Fetch projects when entering oauth-success mode
  useEffect(() => {
    if (authMode === 'oauth-success') {
      fetchUserProjects();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode]);

  // Check glab CLI on mount
  useEffect(() => {
    const checkGlab = async () => {
      setIsCheckingGlab(true);
      try {
        const result = await window.electronAPI.checkGitLabCli();
        debugLog('checkGitLabCli result:', result);
        if (result.success && result.data) {
          setGlabInstalled(result.data.installed);
          setGlabVersion(result.data.version || null);
        } else {
          setGlabInstalled(false);
        }
      } catch (error) {
        debugLog('Error checking glab CLI:', error);
        setGlabInstalled(false);
      } finally {
        setIsCheckingGlab(false);
      }
    };
    checkGlab();
  }, []);

  // Fetch branches when GitLab is enabled and project path is available
  useEffect(() => {
    debugLog(`useEffect[branches] - gitlabEnabled: ${envConfig?.gitlabEnabled}, projectPath: ${projectPath}`);
    if (envConfig?.gitlabEnabled && projectPath) {
      debugLog('useEffect[branches] - Triggering fetchBranches');
      fetchBranches();
    } else {
      debugLog('useEffect[branches] - Skipping fetchBranches (conditions not met)');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig?.gitlabEnabled, projectPath]);

  /**
   * Handler for branch selection changes.
   * Updates BOTH project.settings.mainBranch (for Electron app) and envConfig.defaultBranch (for CLI backward compatibility).
   */
  const handleBranchChange = (branch: string) => {
    debugLog('handleBranchChange: Updating branch to:', branch);

    // Update project settings (primary source for Electron app)
    if (setSettings) {
      setSettings(prev => ({ ...prev, mainBranch: branch }));
      debugLog('handleBranchChange: Updated settings.mainBranch');
    }

    // Also update envConfig for CLI backward compatibility
    updateEnvConfig({ defaultBranch: branch });
    debugLog('handleBranchChange: Updated envConfig.defaultBranch');
  };

  const fetchBranches = async () => {
    if (!projectPath) {
      debugLog('fetchBranches: No projectPath, skipping');
      return;
    }

    debugLog('fetchBranches: Starting with projectPath:', projectPath);
    setIsLoadingBranches(true);
    setBranchesError(null);

    try {
      debugLog('fetchBranches: Calling getGitBranches...');
      const result = await window.electronAPI.getGitBranches(projectPath);
      debugLog('fetchBranches: getGitBranches result:', { success: result.success, dataType: typeof result.data, dataLength: Array.isArray(result.data) ? result.data.length : 'N/A', error: result.error });

      if (result.success && result.data) {
        setBranches(result.data);
        debugLog('fetchBranches: Loaded branches:', result.data.length);

        // Auto-detect default branch if not set in project settings
        // Priority: settings.mainBranch > envConfig.defaultBranch > auto-detect
        if (!settings?.mainBranch && !envConfig?.defaultBranch) {
          debugLog('fetchBranches: No branch set, auto-detecting...');
          const detectResult = await window.electronAPI.detectMainBranch(projectPath);
          debugLog('fetchBranches: detectMainBranch result:', detectResult);
          if (detectResult.success && detectResult.data) {
            debugLog('fetchBranches: Auto-detected default branch:', detectResult.data);
            handleBranchChange(detectResult.data);
          }
        }
      } else {
        debugLog('fetchBranches: Failed -', result.error || 'No data returned');
        setBranchesError(result.error || 'Failed to load branches');
      }
    } catch (err) {
      debugLog('fetchBranches: Exception:', err);
      setBranchesError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const fetchUserProjects = async () => {
    debugLog('Fetching user projects...');
    setIsLoadingProjects(true);
    setProjectsError(null);

    try {
      const hostname = envConfig?.gitlabInstanceUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const result = await window.electronAPI.listGitLabUserProjects(hostname);
      debugLog('listGitLabUserProjects result:', result);

      if (result.success && result.data?.projects) {
        setProjects(result.data.projects);
        debugLog('Loaded projects:', result.data.projects.length);
      } else {
        setProjectsError(result.error || 'Failed to load projects');
      }
    } catch (err) {
      debugLog('Error fetching projects:', err);
      setProjectsError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setIsLoadingProjects(false);
    }
  };

  if (!envConfig) {
    debugLog('No envConfig, returning null');
    return null;
  }

  const handleOAuthSuccess = async () => {
    debugLog('handleOAuthSuccess called');

    try {
      const hostname = envConfig?.gitlabInstanceUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const tokenResult = await window.electronAPI.getGitLabToken(hostname);
      if (tokenResult.success && tokenResult.data?.token) {
        updateEnvConfig({ gitlabToken: tokenResult.data.token });
      }

      const userResult = await window.electronAPI.getGitLabUser(hostname);
      if (userResult.success && userResult.data?.username) {
        setOauthUsername(userResult.data.username);
      }

      setAuthMode('oauth-success');
    } catch (err) {
      debugLog('Error in OAuth success:', err);
    }
  };

  const handleStartOAuth = async () => {
    const hostname = envConfig?.gitlabInstanceUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const result = await window.electronAPI.startGitLabAuth(hostname);

    if (result.success) {
      // Poll for auth completion
      const checkAuth = async () => {
        const authResult = await window.electronAPI.checkGitLabAuth(hostname);
        if (authResult.success && authResult.data?.authenticated) {
          handleOAuthSuccess();
        } else {
          // Retry after delay
          setTimeout(checkAuth, 2000);
        }
      };
      setTimeout(checkAuth, 3000);
    }
  };

  const handleSwitchToManual = () => {
    setAuthMode('manual');
    setOauthUsername(null);
  };

  const handleSwitchToOAuth = () => {
    setAuthMode('oauth');
    handleStartOAuth();
  };

  const handleSelectProject = (projectPath: string) => {
    debugLog('Selected project:', projectPath);
    updateEnvConfig({ gitlabProject: projectPath });
  };

  const handleInstallGlab = async () => {
    setIsInstallingGlab(true);
    setGlabInstallSuccess(false);
    try {
      const result = await window.electronAPI.installGitLabCli();
      debugLog('installGitLabCli result:', result);
      if (result.success) {
        setGlabInstallSuccess(true);
        // Re-check after 5 seconds to give user time to complete installation
        setTimeout(async () => {
          await handleRefreshGlab();
          setIsInstallingGlab(false);
        }, 5000);
      } else {
        setIsInstallingGlab(false);
      }
    } catch (error) {
      debugLog('Error installing glab:', error);
      setIsInstallingGlab(false);
    }
  };

  const handleRefreshGlab = async () => {
    setIsCheckingGlab(true);
    setGlabInstallSuccess(false);
    try {
      const result = await window.electronAPI.checkGitLabCli();
      debugLog('checkGitLabCli refresh result:', result);
      if (result.success && result.data) {
        setGlabInstalled(result.data.installed);
        setGlabVersion(result.data.version || null);
      } else {
        setGlabInstalled(false);
      }
    } catch (error) {
      debugLog('Error refreshing glab status:', error);
      setGlabInstalled(false);
    } finally {
      setIsCheckingGlab(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enableIssues')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.enableIssuesDescription')}
          </p>
        </div>
        <Switch
          checked={envConfig.gitlabEnabled}
          onCheckedChange={(checked) => updateEnvConfig({ gitlabEnabled: checked })}
        />
      </div>

      {envConfig.gitlabEnabled && (
        <>
          {/* Instance URL */}
          <InstanceUrlInput
            value={envConfig.gitlabInstanceUrl || 'https://gitlab.com'}
            onChange={(value) => updateEnvConfig({ gitlabInstanceUrl: value })}
          />

          {/* OAuth Success State */}
          {authMode === 'oauth-success' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">{t('settings.connectedVia')}</p>
                      {oauthUsername && (
                        <p className="text-xs text-success/80 flex items-center gap-1 mt-0.5">
                          <User className="h-3 w-3" />
                          {t('settings.authenticatedAs')} {oauthUsername}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSwitchToManual}
                    className="text-xs"
                  >
                    {t('settings.useDifferentToken')}
                  </Button>
                </div>
              </div>

              {/* Project Dropdown */}
              <ProjectDropdown
                projects={projects}
                selectedProject={envConfig.gitlabProject || ''}
                isLoading={isLoadingProjects}
                error={projectsError}
                onSelect={handleSelectProject}
                onRefresh={fetchUserProjects}
                onManualEntry={() => setAuthMode('manual')}
              />
            </div>
          )}

          {/* OAuth Flow */}
          {authMode === 'oauth' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">{t('settings.authentication')}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSwitchToManual}
                >
                  {t('settings.useManualToken')}
                </Button>
              </div>
              <div className="rounded-lg border border-info/30 bg-info/10 p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-info animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('settings.authenticating')}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.browserWindow')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Manual Token Entry */}
          {authMode === 'manual' && (
            <>
              {/* glab CLI Required Card */}
              {glabInstalled === false && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{t('settings.cli.required')}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('settings.cli.notInstalled')}
                        </p>
                      </div>
                      {glabInstallSuccess ? (
                        <div className="rounded-md border border-success/30 bg-success/10 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-success" />
                              <p className="text-xs text-success">{t('settings.cli.installSuccess')}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleRefreshGlab}
                              disabled={isCheckingGlab}
                              className="h-7 gap-1.5"
                            >
                              <RefreshCw className={`h-3 w-3 ${isCheckingGlab ? 'animate-spin' : ''}`} />
                              {t('settings.cli.refresh')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleInstallGlab}
                            disabled={isInstallingGlab}
                            className="gap-2"
                          >
                            {isInstallingGlab ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {t('settings.cli.installing')}
                              </>
                            ) : (
                              <>
                                <Terminal className="h-3 w-3" />
                                {t('settings.cli.installButton')}
                              </>
                            )}
                          </Button>
                          <a
                            href="https://gitlab.com/gitlab-org/cli#installation"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-info hover:underline flex items-center gap-1"
                          >
                            {t('settings.cli.learnMore')}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* glab CLI Installed Success */}
              {glabInstalled === true && glabVersion && (
                <div className="rounded-lg border border-success/30 bg-success/10 p-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <p className="text-xs text-success">
                      {t('settings.cli.installed')} <span className="font-mono">{glabVersion}</span>
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">{t('settings.personalAccessToken')}</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSwitchToOAuth}
                    disabled={glabInstalled === false || isCheckingGlab}
                    className="gap-2"
                  >
                    {isCheckingGlab ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <KeyRound className="h-3 w-3" />
                    )}
                    {t('settings.useOAuth')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settings.tokenScope')} <code className="px-1 bg-muted rounded">{t('settings.scopeApi')}</code> {t('settings.scopeFrom')}{' '}
                  <a
                    href={`${envConfig.gitlabInstanceUrl || 'https://gitlab.com'}/-/user_settings/personal_access_tokens`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info hover:underline"
                  >
                    {t('settings.gitlabSettings')}
                  </a>
                </p>
                <PasswordInput
                  value={envConfig.gitlabToken || ''}
                  onChange={(value) => updateEnvConfig({ gitlabToken: value })}
                  placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                />
              </div>

              <ProjectInput
                value={envConfig.gitlabProject || ''}
                onChange={(value) => updateEnvConfig({ gitlabProject: value })}
              />
            </>
          )}

          {envConfig.gitlabToken && envConfig.gitlabProject && (
            <ConnectionStatus
              isChecking={isCheckingGitLab}
              connectionStatus={gitLabConnectionStatus}
            />
          )}

          {gitLabConnectionStatus?.connected && <IssuesAvailableInfo />}

          <Separator />

          {/* Default Branch Selector */}
          {projectPath && (
            <BranchSelector
              branches={branches}
              selectedBranch={settings?.mainBranch || envConfig.defaultBranch || ''}
              isLoading={isLoadingBranches}
              error={branchesError}
              onSelect={handleBranchChange}
              onRefresh={fetchBranches}
            />
          )}

          <Separator />

          <AutoSyncToggle
            enabled={envConfig.gitlabAutoSync || false}
            onToggle={(checked) => updateEnvConfig({ gitlabAutoSync: checked })}
          />
        </>
      )}
    </div>
  );
}

interface InstanceUrlInputProps {
  value: string;
  onChange: (value: string) => void;
}

function InstanceUrlInput({ value, onChange }: InstanceUrlInputProps) {
  const { t } = useTranslation('gitlab');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium text-foreground">{t('settings.instance')}</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('settings.instanceDescription')}
      </p>
      <Input
        placeholder="https://gitlab.com"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ProjectDropdownProps {
  projects: GitLabProject[];
  selectedProject: string;
  isLoading: boolean;
  error: string | null;
  onSelect: (projectPath: string) => void;
  onRefresh: () => void;
  onManualEntry: () => void;
}

function ProjectDropdown({
  projects,
  selectedProject,
  isLoading,
  error,
  onSelect,
  onRefresh,
  onManualEntry
}: ProjectDropdownProps) {
  const { t } = useTranslation('gitlab');
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filteredProjects = projects.filter(project =>
    project.pathWithNamespace.toLowerCase().includes(filter.toLowerCase()) ||
    (project.description?.toLowerCase().includes(filter.toLowerCase()))
  );

  const selectedProjectData = projects.find(p => p.pathWithNamespace === selectedProject);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-foreground">{t('settings.project')}</Label>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-7 px-2"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onManualEntry}
            className="h-7 text-xs"
          >
            {t('settings.enterManually')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings.loadingProjects')}
            </span>
          ) : selectedProject ? (
            <span className="flex items-center gap-2">
              {selectedProjectData?.visibility === 'private' ? (
                <Lock className="h-3 w-3 text-muted-foreground" />
              ) : (
                <Globe className="h-3 w-3 text-muted-foreground" />
              )}
              {selectedProject}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('settings.selectProject')}</span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && !isLoading && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-hidden">
            <div className="p-2 border-b border-border">
              <Input
                placeholder={t('settings.searchProjects')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            <div className="max-h-48 overflow-y-auto">
              {filteredProjects.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {filter ? t('settings.noMatchingProjects') : t('settings.noProjectsFound')}
                </div>
              ) : (
                filteredProjects.map((project) => (
                  <button
                    key={project.pathWithNamespace}
                    type="button"
                    onClick={() => {
                      onSelect(project.pathWithNamespace);
                      setIsOpen(false);
                      setFilter('');
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-accent flex items-start gap-2 ${
                      project.pathWithNamespace === selectedProject ? 'bg-accent' : ''
                    }`}
                  >
                    {project.visibility === 'private' ? (
                      <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{project.pathWithNamespace}</p>
                      {project.description && (
                        <p className="text-xs text-muted-foreground truncate">{project.description}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {selectedProject && (
        <p className="text-xs text-muted-foreground">
          {t('settings.selected')}: <code className="px-1 bg-muted rounded">{selectedProject}</code>
        </p>
      )}
    </div>
  );
}

interface ProjectInputProps {
  value: string;
  onChange: (value: string) => void;
}

function ProjectInput({ value, onChange }: ProjectInputProps) {
  const { t } = useTranslation('gitlab');

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{t('settings.project')}</Label>
      <p className="text-xs text-muted-foreground">
        {t('settings.projectFormat')} <code className="px-1 bg-muted rounded">group/project</code> {t('settings.projectFormatExample')}
      </p>
      <Input
        placeholder="group/project"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: GitLabSyncStatus | null;
}

function ConnectionStatus({ isChecking, connectionStatus }: ConnectionStatusProps) {
  const { t } = useTranslation('gitlab');

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{t('settings.connectionStatus')}</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? t('settings.checking') :
              connectionStatus?.connected
                ? `${t('settings.connectedTo')} ${connectionStatus.projectPathWithNamespace}`
                : connectionStatus?.error || t('settings.notConnected')}
          </p>
          {connectionStatus?.connected && connectionStatus.projectDescription && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              {connectionStatus.projectDescription}
            </p>
          )}
        </div>
        {isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : connectionStatus?.connected ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
      </div>
    </div>
  );
}

function IssuesAvailableInfo() {
  const { t } = useTranslation('gitlab');

  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-3">
        <svg className="h-5 w-5 text-info mt-0.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t('settings.issuesAvailable')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('settings.issuesAvailableDescription')}
          </p>
        </div>
      </div>
    </div>
  );
}

interface AutoSyncToggleProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

function AutoSyncToggle({ enabled, onToggle }: AutoSyncToggleProps) {
  const { t } = useTranslation('gitlab');

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-info" />
          <Label className="font-normal text-foreground">{t('settings.autoSyncOnLoad')}</Label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          {t('settings.autoSyncDescription')}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

interface BranchSelectorProps {
  branches: string[];
  selectedBranch: string;
  isLoading: boolean;
  error: string | null;
  onSelect: (branch: string) => void;
  onRefresh: () => void;
}

function BranchSelector({
  branches,
  selectedBranch,
  isLoading,
  error,
  onSelect,
  onRefresh
}: BranchSelectorProps) {
  const { t } = useTranslation('gitlab');
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filteredBranches = branches.filter(branch =>
    branch.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-info" />
            <Label className="text-sm font-medium text-foreground">{t('settings.defaultBranch')}</Label>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            {t('settings.defaultBranchDescription')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-7 px-2"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive pl-6">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      <div className="relative pl-6">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings.loadingBranches')}
            </span>
          ) : selectedBranch ? (
            <span className="flex items-center gap-2">
              <GitBranch className="h-3 w-3 text-muted-foreground" />
              {selectedBranch}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('settings.autoDetect')}</span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && !isLoading && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-hidden">
            <div className="p-2 border-b border-border">
              <Input
                placeholder={t('settings.searchBranches')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onSelect('');
                setIsOpen(false);
                setFilter('');
              }}
              className={`w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 ${
                !selectedBranch ? 'bg-accent' : ''
              }`}
            >
              <span className="text-sm text-muted-foreground italic">{t('settings.autoDetect')}</span>
            </button>

            <div className="max-h-40 overflow-y-auto border-t border-border">
              {filteredBranches.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {filter ? t('settings.noMatchingBranches') : t('settings.noBranchesFound')}
                </div>
              ) : (
                filteredBranches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    onClick={() => {
                      onSelect(branch);
                      setIsOpen(false);
                      setFilter('');
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 ${
                      branch === selectedBranch ? 'bg-accent' : ''
                    }`}
                  >
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm">{branch}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {selectedBranch && (
        <p className="text-xs text-muted-foreground pl-6">
          {t('settings.branchFromNote')} <code className="px-1 bg-muted rounded">{selectedBranch}</code>
        </p>
      )}
    </div>
  );
}
