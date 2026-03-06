import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, RefreshCw, KeyRound, Loader2, CheckCircle2, AlertCircle, User, Lock, Globe, ChevronDown, GitBranch, Download, FolderGit2 } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Button } from '../../ui/button';
import { Combobox } from '../../ui/combobox';
import { GitHubOAuthFlow } from '../../project-settings/GitHubOAuthFlow';
import { PasswordInput } from '../../project-settings/PasswordInput';
import { buildBranchOptions } from '../../../lib/branch-utils';
import { cn } from '../../../lib/utils';
import type { ProjectEnvConfig, GitHubSyncStatus, ProjectSettings, GitBranchDetail } from '../../../../shared/types';

// Debug logging
const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[GitHubIntegration] ${message}`, data);
    } else {
      console.warn(`[GitHubIntegration] ${message}`);
    }
  }
}

interface GitHubRepo {
  fullName: string;
  description: string | null;
  isPrivate: boolean;
}

interface GitHubIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showGitHubToken: boolean;
  setShowGitHubToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitHubConnectionStatus: GitHubSyncStatus | null;
  isCheckingGitHub: boolean;
  projectPath?: string; // Project path for fetching git branches
  projectType?: 'project' | 'customer'; // Project type for customer-specific UI
  projectName?: string; // Project name for display
  projectId?: string; // Project ID for store lookups
  // Project settings for mainBranch (used by kanban tasks and terminal worktrees)
  settings?: ProjectSettings;
  setSettings?: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}

/**
 * GitHub integration settings component.
 * Manages GitHub token (manual or OAuth), repository configuration, and connection status.
 */
export function GitHubIntegration({
  envConfig,
  updateEnvConfig,
  showGitHubToken: _showGitHubToken,
  setShowGitHubToken: _setShowGitHubToken,
  gitHubConnectionStatus,
  isCheckingGitHub,
  projectPath,
  projectType,
  projectName,
  projectId,
  settings,
  setSettings
}: GitHubIntegrationProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [authMode, setAuthMode] = useState<'manual' | 'oauth' | 'oauth-success'>('manual');
  const [oauthUsername, setOauthUsername] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  // Branch selection state - now uses GitBranchDetail for local/remote distinction
  const [branches, setBranches] = useState<GitBranchDetail[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // Customer clone repos state
  const [customerRepos, setCustomerRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingCustomerRepos, setIsLoadingCustomerRepos] = useState(false);
  const [customerReposError, setCustomerReposError] = useState<string | null>(null);
  const [cloneStatuses, setCloneStatuses] = useState<Record<string, 'idle' | 'cloning' | 'done' | 'error'>>({});
  const [cloneErrors, setCloneErrors] = useState<Record<string, string>>({});
  const [customerRepoSearch, setCustomerRepoSearch] = useState('');

  // Get child projects (repos cloned into customer folder)
  const allProjects = useProjectStore((state) => state.projects);
  const customerChildProjects = useMemo(() => {
    if (projectType !== 'customer' || !projectPath) return [];
    // Normalize path separators for cross-platform comparison (Windows uses backslashes)
    const normalize = (p: string) => p.replace(/\\/g, '/');
    const normalizedCustomerPath = normalize(projectPath);
    return allProjects.filter(p => p.id !== projectId && normalize(p.path).startsWith(normalizedCustomerPath + '/'));
  }, [projectType, projectPath, projectId, allProjects]);

  debugLog('Render - authMode:', authMode);
  debugLog('Render - projectPath:', projectPath);
  debugLog('Render - envConfig:', envConfig ? { githubEnabled: envConfig.githubEnabled, hasToken: !!envConfig.githubToken, defaultBranch: envConfig.defaultBranch } : null);

  // Fetch repos when entering oauth-success mode
  useEffect(() => {
    if (authMode === 'oauth-success') {
      fetchUserRepos();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode]);

  // Fetch branches when GitHub is enabled and project path is available
  useEffect(() => {
    debugLog(`useEffect[branches] - githubEnabled: ${envConfig?.githubEnabled}, projectPath: ${projectPath}`);
    if (envConfig?.githubEnabled && projectPath) {
      debugLog('useEffect[branches] - Triggering fetchBranches');
      fetchBranches();
    } else {
      debugLog('useEffect[branches] - Skipping fetchBranches (conditions not met)');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig?.githubEnabled, projectPath]);

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
      debugLog('fetchBranches: Calling getGitBranchesWithInfo...');
      const result = await window.electronAPI.getGitBranchesWithInfo(projectPath);
      debugLog('fetchBranches: getGitBranchesWithInfo result:', { success: result.success, dataType: typeof result.data, dataLength: Array.isArray(result.data) ? result.data.length : 'N/A', error: result.error });

      // result.data is the GitBranchDetail[] array
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
        setBranchesError(result.error || t('github.failedToLoadBranches'));
      }
    } catch (err) {
      debugLog('fetchBranches: Exception:', err);
      setBranchesError(err instanceof Error ? err.message : t('github.failedToLoadBranches'));
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const fetchUserRepos = async () => {
    debugLog('Fetching user repositories...');
    setIsLoadingRepos(true);
    setReposError(null);

    try {
      const result = await window.electronAPI.listGitHubUserRepos();
      debugLog('listGitHubUserRepos result:', result);

      if (result.success && result.data?.repos) {
        setRepos(result.data.repos);
        debugLog('Loaded repos:', result.data.repos.length);
      } else {
        setReposError(result.error || t('github.failedToLoadRepositories'));
      }
    } catch (err) {
      debugLog('Error fetching repos:', err);
      setReposError(err instanceof Error ? err.message : t('github.failedToLoadRepositories'));
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Build branch options for Combobox using shared utility
  // Must be called before early return to satisfy React hooks rules
  const branchOptions = useMemo(() => {
    return buildBranchOptions(branches, {
      t,
      includeAutoDetect: {
        value: '',
        label: t('settings:integrations.github.defaultBranch.autoDetect'),
      },
    });
  }, [branches, t]);

  if (!envConfig) {
    debugLog('No envConfig, returning null');
    return null;
  }

  const handleOAuthSuccess = (token: string, username?: string) => {
    debugLog('handleOAuthSuccess called with token length:', token.length);
    debugLog('OAuth username:', username);

    // Update the token and auth method
    updateEnvConfig({ githubToken: token, githubAuthMethod: 'oauth' });

    // Show success state with username
    setOauthUsername(username || null);
    setAuthMode('oauth-success');
  };

  const handleSwitchToManual = () => {
    setAuthMode('manual');
    setOauthUsername(null);
  };

  const handleSwitchToOAuth = () => {
    setAuthMode('oauth');
  };

  const handleSelectRepo = (repoFullName: string) => {
    debugLog('Selected repo:', repoFullName);
    updateEnvConfig({ githubRepo: repoFullName });
  };

  // Customer-specific: load repos for cloning
  const loadCustomerRepos = async () => {
    setIsLoadingCustomerRepos(true);
    setCustomerReposError(null);
    try {
      const result = await window.electronAPI.listGitHubUserRepos();
      if (result.success && result.data) {
        setCustomerRepos(result.data.repos);
      } else {
        setCustomerReposError(result.error || t('github.failedToLoadRepositories'));
      }
    } catch (err) {
      setCustomerReposError(err instanceof Error ? err.message : t('github.failedToLoadRepositories'));
    } finally {
      setIsLoadingCustomerRepos(false);
    }
  };

  // Customer-specific: clone a repo into the customer folder
  const handleCloneRepo = async (repo: GitHubRepo) => {
    if (!projectPath) return;
    setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'cloning' }));
    setCloneErrors(prev => {
      const next = { ...prev };
      delete next[repo.fullName];
      return next;
    });

    try {
      const result = await window.electronAPI.cloneGitHubRepo(repo.fullName, projectPath);
      if (!result.success || !result.data) {
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
        setCloneErrors(prev => ({ ...prev, [repo.fullName]: result.error || t('github.cloneFailed') }));
        return;
      }

      // Register cloned repo as a project — only mark as done if registration succeeds
      const addResult = await window.electronAPI.addProject(result.data.path);
      if (addResult?.success && addResult?.data) {
        const store = useProjectStore.getState();
        store.addProject(addResult.data);
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'done' }));
      } else {
        setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
        setCloneErrors(prev => ({ ...prev, [repo.fullName]: addResult?.error || t('github.failedToRegisterProject') }));
      }
    } catch (err) {
      setCloneStatuses(prev => ({ ...prev, [repo.fullName]: 'error' }));
      setCloneErrors(prev => ({
        ...prev,
        [repo.fullName]: err instanceof Error ? err.message : t('github.cloneFailed')
      }));
    }
  };

  const filteredCustomerRepos = customerRepos.filter(repo =>
    repo.fullName.toLowerCase().includes(customerRepoSearch.toLowerCase()) ||
    (repo.description?.toLowerCase().includes(customerRepoSearch.toLowerCase()))
  );

  // Selected branch for Combobox value
  const selectedBranch = settings?.mainBranch || envConfig?.defaultBranch || '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('github.enableIssues')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('github.enableIssuesDescription')}
          </p>
        </div>
        <Switch
          checked={envConfig.githubEnabled}
          onCheckedChange={(checked) => updateEnvConfig({ githubEnabled: checked })}
        />
      </div>

      {envConfig.githubEnabled && (
        <>
          {/* OAuth Success State */}
          {authMode === 'oauth-success' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    <div>
                      <p className="text-sm font-medium text-success">{t('github.connectedViaCLI')}</p>
                      {oauthUsername && (
                        <p className="text-xs text-success/80 flex items-center gap-1 mt-0.5">
                          <User className="h-3 w-3" />
                          {t('github.authenticatedAs', { username: oauthUsername })}
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
                    {t('github.useDifferentToken')}
                  </Button>
                </div>
              </div>

              {/* Repository Dropdown */}
              <RepositoryDropdown
                repos={repos}
                selectedRepo={envConfig.githubRepo || ''}
                isLoading={isLoadingRepos}
                error={reposError}
                onSelect={handleSelectRepo}
                onRefresh={fetchUserRepos}
                onManualEntry={() => setAuthMode('manual')}
              />
            </div>
          )}

          {/* OAuth Flow */}
          {authMode === 'oauth' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">{t('github.authentication')}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSwitchToManual}
                >
                  {t('github.useManualToken')}
                </Button>
              </div>
              <GitHubOAuthFlow
                onSuccess={handleOAuthSuccess}
                onCancel={handleSwitchToManual}
              />
            </div>
          )}

          {/* Manual Token Entry */}
          {authMode === 'manual' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">{t('github.personalAccessToken')}</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSwitchToOAuth}
                    className="gap-2"
                  >
                    <KeyRound className="h-3 w-3" />
                    {t('github.useOAuthInstead')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('github.tokenInstructions')} <code className="px-1 bg-muted rounded">repo</code> {t('github.tokenScopeFrom')}{' '}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=Auto-Build-UI"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info hover:underline"
                  >
                    {t('github.githubSettings')}
                  </a>
                </p>
                <PasswordInput
                  value={envConfig.githubToken || ''}
                  onChange={(value) => updateEnvConfig({ githubToken: value })}
                  placeholder="ghp_xxxxxxxx or github_pat_xxxxxxxx"
                />
              </div>

              <RepositoryInput
                value={envConfig.githubRepo || ''}
                onChange={(value) => updateEnvConfig({ githubRepo: value })}
              />
            </>
          )}

          {/* Customer-specific: Clone Repositories */}
          {projectType === 'customer' && envConfig.githubToken && (
            <>
              <Separator />

              {/* Already cloned repos */}
              {customerChildProjects.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FolderGit2 className="h-4 w-4" />
                    {t('github.clonedRepositories')}
                  </Label>
                  <div className="space-y-1.5">
                    {customerChildProjects.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
                      >
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        <span className="truncate font-medium">{child.name}</span>
                        <span className="text-xs text-muted-foreground truncate ml-auto">{child.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Clone new repos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    {t('github.cloneRepositories')}
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadCustomerRepos}
                    disabled={isLoadingCustomerRepos}
                  >
                    {isLoadingCustomerRepos ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {customerRepos.length > 0 ? t('github.refresh') : t('github.loadRepos')}
                  </Button>
                </div>

                {customerReposError && (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {customerReposError}
                  </div>
                )}

                {customerRepos.length > 0 && (
                  <>
                    {/* Search */}
                    <Input
                      type="text"
                      value={customerRepoSearch}
                      onChange={(e) => setCustomerRepoSearch(e.target.value)}
                      placeholder={t('github.searchRepos')}
                      className="h-8 text-xs"
                    />

                    {/* Repo list */}
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                      {filteredCustomerRepos.map((repo) => {
                        const status = cloneStatuses[repo.fullName] || 'idle';
                        const alreadyCloned = customerChildProjects.some(
                          p => p.name === repo.fullName.split('/').pop()
                        );
                        const cloneError = cloneErrors[repo.fullName];

                        return (
                          <div
                            key={repo.fullName}
                            className={cn(
                              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                              status === 'done' || alreadyCloned
                                ? 'border-green-500/30 bg-green-500/5'
                                : 'border-border'
                            )}
                          >
                            <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium truncate">{repo.fullName}</span>
                                {repo.isPrivate ? (
                                  <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                                ) : (
                                  <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                                )}
                              </div>
                              {repo.description && (
                                <p className="text-xs text-muted-foreground truncate">{repo.description}</p>
                              )}
                              {cloneError && (
                                <p className="text-xs text-destructive">{cloneError}</p>
                              )}
                            </div>

                            <div className="shrink-0">
                              {alreadyCloned || status === 'done' ? (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {t('github.cloned')}
                                </span>
                              ) : status === 'cloning' ? (
                                <Button variant="outline" size="sm" disabled className="h-7 text-xs">
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  {t('github.cloning')}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCloneRepo(repo)}
                                  className="h-7 text-xs"
                                >
                                  <Download className="mr-1 h-3 w-3" />
                                  {t('github.clone')}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Regular project: repo connection + branch + auto-sync */}
          {projectType !== 'customer' && (
            <>
              {envConfig.githubToken && envConfig.githubRepo && (
                <ConnectionStatus
                  isChecking={isCheckingGitHub}
                  connectionStatus={gitHubConnectionStatus}
                />
              )}

              {gitHubConnectionStatus?.connected && <IssuesAvailableInfo />}

              <Separator />

              {/* Default Branch Selector */}
              {projectPath && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-info" />
                        <Label className="text-sm font-medium text-foreground">
                          {t('settings:integrations.github.defaultBranch.label')}
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        {t('settings:integrations.github.defaultBranch.description')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchBranches}
                      disabled={isLoadingBranches}
                      className="h-7 px-2"
                    >
                      <RefreshCw className={`h-3 w-3 ${isLoadingBranches ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>

                  {branchesError && (
                    <div className="flex items-center gap-2 text-xs text-destructive pl-6">
                      <AlertCircle className="h-3 w-3" />
                      {branchesError}
                    </div>
                  )}

                  <div className="pl-6">
                    <Combobox
                      options={branchOptions}
                      value={selectedBranch}
                      onValueChange={handleBranchChange}
                      placeholder={t('settings:integrations.github.defaultBranch.autoDetect')}
                      searchPlaceholder={t('settings:integrations.github.defaultBranch.searchPlaceholder')}
                      emptyMessage={t('settings:integrations.github.defaultBranch.noBranchesFound')}
                      disabled={isLoadingBranches}
                      className="w-full"
                    />
                  </div>

                  {selectedBranch && (
                    <p className="text-xs text-muted-foreground pl-6">
                      {t('settings:integrations.github.defaultBranch.selectedBranchHelp', { branch: selectedBranch })}
                    </p>
                  )}
                </div>
              )}

              <Separator />

              <AutoSyncToggle
                enabled={envConfig.githubAutoSync || false}
                onToggle={(checked) => updateEnvConfig({ githubAutoSync: checked })}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

interface RepositoryDropdownProps {
  repos: GitHubRepo[];
  selectedRepo: string;
  isLoading: boolean;
  error: string | null;
  onSelect: (repoFullName: string) => void;
  onRefresh: () => void;
  onManualEntry: () => void;
}

function RepositoryDropdown({
  repos,
  selectedRepo,
  isLoading,
  error,
  onSelect,
  onRefresh,
  onManualEntry
}: RepositoryDropdownProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filteredRepos = repos.filter(repo =>
    repo.fullName.toLowerCase().includes(filter.toLowerCase()) ||
    (repo.description?.toLowerCase().includes(filter.toLowerCase()))
  );

  const selectedRepoData = repos.find(r => r.fullName === selectedRepo);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-foreground">{t('github.repository')}</Label>
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
            {t('github.enterManually')}
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
              {t('github.loadingRepositories')}
            </span>
          ) : selectedRepo ? (
            <span className="flex items-center gap-2">
              {selectedRepoData?.isPrivate ? (
                <Lock className="h-3 w-3 text-muted-foreground" />
              ) : (
                <Globe className="h-3 w-3 text-muted-foreground" />
              )}
              {selectedRepo}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('github.selectRepository')}</span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && !isLoading && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-hidden">
            {/* Search filter */}
            <div className="p-2 border-b border-border">
              <Input
                placeholder={t('github.searchRepos')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            {/* Repository list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredRepos.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {filter ? t('github.noMatchingRepositories') : t('github.noRepositoriesFound')}
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    type="button"
                    onClick={() => {
                      onSelect(repo.fullName);
                      setIsOpen(false);
                      setFilter('');
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-accent flex items-start gap-2 ${
                      repo.fullName === selectedRepo ? 'bg-accent' : ''
                    }`}
                  >
                    {repo.isPrivate ? (
                      <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{repo.fullName}</p>
                      {repo.description && (
                        <p className="text-xs text-muted-foreground truncate">{repo.description}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {selectedRepo && (
        <p className="text-xs text-muted-foreground">
          {t('github.selected')}: <code className="px-1 bg-muted rounded">{selectedRepo}</code>
        </p>
      )}
    </div>
  );
}

interface RepositoryInputProps {
  value: string;
  onChange: (value: string) => void;
}

function RepositoryInput({ value, onChange }: RepositoryInputProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{t('github.repository')}</Label>
      <p className="text-xs text-muted-foreground">
        {t('github.repositoryFormat')}
      </p>
      <Input
        placeholder="owner/repository"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: GitHubSyncStatus | null;
}

function ConnectionStatus({ isChecking, connectionStatus }: ConnectionStatusProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{t('github.connectionStatus')}</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? t('github.checking') :
              connectionStatus?.connected
                ? t('github.connectedTo', { repo: connectionStatus.repoFullName })
                : connectionStatus?.error || t('github.notConnected')}
          </p>
          {connectionStatus?.connected && connectionStatus.repoDescription && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              {connectionStatus.repoDescription}
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
  const { t } = useTranslation('settings');
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-3">
        <Github className="h-5 w-5 text-info mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t('github.issuesAvailable')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('github.issuesAvailableDescription')}
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
  const { t } = useTranslation('settings');
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-info" />
          <Label className="font-normal text-foreground">{t('github.autoSyncOnLoad')}</Label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          {t('github.autoSyncDescription')}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}
