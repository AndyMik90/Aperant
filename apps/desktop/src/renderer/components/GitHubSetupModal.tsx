import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Github,
  GitBranch,
  Cpu,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Plus,
  Link,
  Lock,
  Globe,
  Building,
  User
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { GitHubOAuthFlow } from './project-settings/GitHubOAuthFlow';
import { ProviderAccountsList } from './settings/ProviderAccountsList';
import { useSettingsStore } from '../stores/settings-store';
import type { Project, ProjectSettings } from '../../shared/types';

interface GitHubSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onComplete: (settings: { githubToken: string; githubRepo: string; mainBranch: string; githubAuthMethod?: 'oauth' | 'pat' }) => void;
  onSkip?: () => void;
}

type SetupStep = 'github-auth' | 'claude-auth' | 'repo-confirm' | 'repo' | 'branch' | 'complete';

/**
 * Setup Modal - Required setup flow after Auto Claude initialization
 *
 * Flow:
 * 1. Authenticate with GitHub (via gh CLI OAuth) - for repo operations
 * 2. Authenticate with Claude (via claude CLI OAuth) - for AI features
 * 3. Detect/confirm repository
 * 4. Select base branch for tasks (with recommended default)
 */
export function GitHubSetupModal({
  open,
  onOpenChange,
  project,
  onComplete,
  onSkip
}: GitHubSetupModalProps) {
  const { t } = useTranslation('dialogs');
  const { getProviderAccounts, loadProviderAccounts } = useSettingsStore();
  const [step, setStep] = useState<SetupStep>('github-auth');
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [recommendedBranch, setRecommendedBranch] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isLoadingRepo, setIsLoadingRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repo setup state (for when no remote is detected)
  const [repoAction, setRepoAction] = useState<'create' | 'link' | null>(null);
  const [newRepoName, setNewRepoName] = useState('');
  const [isPrivateRepo, setIsPrivateRepo] = useState(true);
  const [existingRepoName, setExistingRepoName] = useState('');
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);

  // Organization selection state
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Array<{ login: string; avatarUrl?: string }>>([]);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);

  // Reset state and check existing auth when modal opens
  useEffect(() => {
    if (open) {
      // Reset all state first
      setGithubToken(null);
      setGithubRepo(null);
      setDetectedRepo(null);
      setBranches([]);
      setSelectedBranch(null);
      setRecommendedBranch(null);
      setError(null);
      // Reset repo setup state
      setRepoAction(null);
      setNewRepoName(project.name.replace(/[^A-Za-z0-9_.-]/g, '-'));
      setIsPrivateRepo(true);
      setExistingRepoName('');
      setIsCreatingRepo(false);
      // Reset organization state
      setGithubUsername(null);
      setOrganizations([]);
      setSelectedOwner(null);
      setIsLoadingOrgs(false);

      // Check for existing authentication and skip to appropriate step
      const checkExistingAuth = async () => {
        try {
          // Check for existing GitHub token
          const ghTokenResult = await window.electronAPI.getGitHubToken();
          const hasGitHubAuth = ghTokenResult.success && ghTokenResult.data?.token;

          // Check for existing AI provider accounts
          await loadProviderAccounts();
          const accounts = getProviderAccounts();
          const hasAIAuth = accounts.length > 0;

          // Determine starting step based on existing auth
          if (hasGitHubAuth && hasAIAuth) {
            // Both authenticated, go directly to repo detection
            setGithubToken(ghTokenResult.data!.token);
            setStep('repo'); // Temporary, detectRepository will update
            await detectRepository();
          } else if (hasGitHubAuth) {
            // Only GitHub authenticated, go to AI provider auth
            setGithubToken(ghTokenResult.data!.token);
            setStep('claude-auth');
          } else {
            // No auth, start from beginning
            setStep('github-auth');
          }
        } catch (err) {
          console.error('Failed to check existing auth:', err);
          // On error, start from beginning
          setStep('github-auth');
        }
      };

      checkExistingAuth();
    }
  }, [open]);

  // Load user info and organizations
  const loadUserAndOrgs = async () => {
    setIsLoadingOrgs(true);
    try {
      // Get current user
      const userResult = await window.electronAPI.getGitHubUser();
      if (userResult.success && userResult.data) {
        setGithubUsername(userResult.data.username);
        setSelectedOwner(userResult.data.username); // Default to personal account
      }

      // Get organizations
      const orgsResult = await window.electronAPI.listGitHubOrgs();
      if (orgsResult.success && orgsResult.data) {
        setOrganizations(orgsResult.data.orgs);
      }
    } catch (err) {
      console.error('Failed to load user/orgs:', err);
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  // Detect repository from git remote when auth succeeds
  const detectRepository = async () => {
    setIsLoadingRepo(true);
    setError(null);

    try {
      // Try to detect repo from git remote
      const result = await window.electronAPI.detectGitHubRepo(project.path);
      if (result.success && result.data) {
        setDetectedRepo(result.data);
        setGithubRepo(result.data);
        // Go to confirmation step instead of directly to branch
        setStep('repo-confirm');
      } else {
        // No remote detected, load orgs and show repo setup step
        await loadUserAndOrgs();
        setStep('repo');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect repository');
      await loadUserAndOrgs();
      setStep('repo');
    } finally {
      setIsLoadingRepo(false);
    }
  };

  // Load branches from GitHub
  const loadBranches = async (repo: string) => {
    setIsLoadingBranches(true);
    setError(null);

    try {
      // Get branches from GitHub API
      const result = await window.electronAPI.getGitHubBranches(repo, githubToken!);
      if (result.success && result.data) {
        setBranches(result.data);

        // Detect recommended branch (main > master > develop > first)
        const recommended = detectRecommendedBranch(result.data);
        setRecommendedBranch(recommended);
        setSelectedBranch(recommended);
      } else {
        setError(result.error || 'Failed to load branches');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  // Detect recommended branch from list
  const detectRecommendedBranch = (branchList: string[]): string | null => {
    const priorities = ['main', 'master', 'develop', 'dev'];
    for (const priority of priorities) {
      if (branchList.includes(priority)) {
        return priority;
      }
    }
    return branchList[0] || null;
  };

  // Handle GitHub OAuth success
  const handleGitHubAuthSuccess = async (token: string) => {
    setGithubToken(token);

    // Check if user already has AI provider accounts configured
    try {
      await loadProviderAccounts();
      const accounts = getProviderAccounts();
      if (accounts.length > 0) {
        // Already has provider accounts, skip AI auth and go directly to repo detection
        await detectRepository();
        return;
      }
    } catch (err) {
      console.error('Failed to check provider accounts:', err);
      // On error, fall through to show AI auth step
    }

    // No provider accounts, show AI auth step
    setStep('claude-auth');
  };

  // Handle AI provider auth continue — called when user has added at least one provider account
  const handleAIAuthContinue = async () => {
    await detectRepository();
  };

  // Handle creating a new GitHub repository
  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      setError('Please enter a repository name');
      return;
    }

    if (!selectedOwner) {
      setError('Please select an owner for the repository');
      return;
    }

    setIsCreatingRepo(true);
    setError(null);

    try {
      const result = await window.electronAPI.createGitHubRepo(newRepoName.trim(), {
        isPrivate: isPrivateRepo,
        projectPath: project.path,
        owner: selectedOwner !== githubUsername ? selectedOwner : undefined // Only pass owner if it's an org
      });

      if (result.success && result.data) {
        // Repo created and remote added automatically by gh CLI
        setGithubRepo(result.data.fullName);
        setDetectedRepo(result.data.fullName);
        setStep('branch');
        await loadBranches(result.data.fullName);
      } else {
        setError(result.error || 'Failed to create repository');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repository');
    } finally {
      setIsCreatingRepo(false);
    }
  };

  // Handle confirming the detected repository
  const handleConfirmRepo = async () => {
    if (detectedRepo) {
      setStep('branch');
      await loadBranches(detectedRepo);
    }
  };

  // Handle changing the repository (go to repo setup)
  const handleChangeRepo = async () => {
    await loadUserAndOrgs();
    setStep('repo');
  };

  // Handle linking to an existing GitHub repository
  const handleLinkRepo = async () => {
    if (!existingRepoName.trim()) {
      setError('Please enter a repository name (owner/repo format)');
      return;
    }

    // Validate format
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(existingRepoName.trim())) {
      setError('Invalid format. Use owner/repo (e.g., username/my-project)');
      return;
    }

    setIsCreatingRepo(true);
    setError(null);

    try {
      const result = await window.electronAPI.addGitRemote(project.path, existingRepoName.trim());

      if (result.success) {
        setGithubRepo(existingRepoName.trim());
        setDetectedRepo(existingRepoName.trim());
        setStep('branch');
        await loadBranches(existingRepoName.trim());
      } else {
        setError(result.error || 'Failed to add remote');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add remote');
    } finally {
      setIsCreatingRepo(false);
    }
  };

  // Handle branch selection complete
  const handleComplete = () => {
    if (githubToken && githubRepo && selectedBranch) {
      onComplete({
        githubToken,
        githubRepo,
        mainBranch: selectedBranch,
        githubAuthMethod: 'oauth' // Setup modal always uses OAuth flow
      });
    }
  };

  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case 'github-auth':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                {t('githubSetup.connectTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('githubSetup.connectDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <GitHubOAuthFlow
                onSuccess={handleGitHubAuthSuccess}
                onCancel={onSkip}
              />
            </div>
          </>
        );

      case 'claude-auth':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                {t('githubSetup.aiProviderTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('githubSetup.aiProviderDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <ProviderAccountsList />

              {getProviderAccounts().length > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 p-3">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  <p className="text-sm text-success">
                    {t('githubSetup.aiProviderReady')}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              {onSkip && (
                <Button variant="ghost" onClick={onSkip} size="sm">
                  {t('githubSetup.skipForNow')}
                </Button>
              )}
              <Button
                onClick={handleAIAuthContinue}
                disabled={getProviderAccounts().length === 0}
              >
                <ChevronRight className="mr-2 h-4 w-4" />
                {t('githubSetup.continue')}
              </Button>
            </DialogFooter>
          </>
        );

      case 'repo-confirm':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                Confirm Repository
              </DialogTitle>
              <DialogDescription>
                We detected a GitHub repository for this project. Please confirm or change it.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                  <div>
                    <p className="font-medium">Repository Detected</p>
                    <p className="text-sm text-muted-foreground font-mono">
                      {detectedRepo}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('githubSetup.repoDescription')}
              </p>

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleChangeRepo}>
                Use Different Repository
              </Button>
              <Button onClick={handleConfirmRepo}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirm & Continue
              </Button>
            </DialogFooter>
          </>
        );

      case 'repo':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                Connect to GitHub
              </DialogTitle>
              <DialogDescription>
                Your project needs a GitHub repository. Create a new one or link to an existing repository.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              {/* Action selection */}
              {!repoAction && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setRepoAction('create')}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-colors"
                    aria-label={t('githubSetup.createRepoAriaLabel')}
                  >
                    <Plus className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm font-medium">Create New Repo</span>
                    <span className="text-xs text-muted-foreground text-center">
                      Create a new repository on GitHub
                    </span>
                  </button>
                  <button
                    onClick={() => setRepoAction('link')}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-colors"
                    aria-label={t('githubSetup.linkRepoAriaLabel')}
                  >
                    <Link className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm font-medium">Link Existing</span>
                    <span className="text-xs text-muted-foreground text-center">
                      Connect to an existing repository
                    </span>
                  </button>
                </div>
              )}

              {/* Create new repo form */}
              {repoAction === 'create' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <button
                      onClick={() => setRepoAction(null)}
                      className="text-primary hover:underline"
                      aria-label={t('githubSetup.goBackAriaLabel')}
                    >
                      ← Back
                    </button>
                    <span>Create a new repository</span>
                  </div>

                  {/* Owner selection */}
                  <div className="space-y-2">
                    <Label>Owner</Label>
                    {isLoadingOrgs ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading accounts...
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('common:accessibility.repositoryOwnerAriaLabel')}>
                        {/* Personal account */}
                        {githubUsername && (
                          <button
                            onClick={() => setSelectedOwner(githubUsername)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                              selectedOwner === githubUsername
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-muted hover:border-primary/50'
                            }`}
                            disabled={isCreatingRepo}
                            role="radio"
                            aria-checked={selectedOwner === githubUsername}
                            aria-label={t('githubSetup.selectOwnerAriaLabel', { owner: githubUsername })}
                          >
                            <User className="h-4 w-4" />
                            <span className="text-sm">{githubUsername}</span>
                          </button>
                        )}
                        {/* Organizations */}
                        {organizations.map((org) => (
                          <button
                            key={org.login}
                            onClick={() => setSelectedOwner(org.login)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                              selectedOwner === org.login
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-muted hover:border-primary/50'
                            }`}
                            disabled={isCreatingRepo}
                            role="radio"
                            aria-checked={selectedOwner === org.login}
                            aria-label={t('githubSetup.selectOrgAriaLabel', { org: org.login })}
                          >
                            <Building className="h-4 w-4" />
                            <span className="text-sm">{org.login}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {organizations.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Select your personal account or an organization
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="repo-name">Repository Name</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {selectedOwner || '...'} /
                      </span>
                      <Input
                        id="repo-name"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        placeholder="my-project"
                        disabled={isCreatingRepo}
                        className="flex-1"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Visibility</Label>
                    <div className="flex gap-2" role="radiogroup" aria-label={t('common:accessibility.repositoryVisibilityAriaLabel')}>
                      <button
                        onClick={() => setIsPrivateRepo(true)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                          isPrivateRepo
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-muted hover:border-primary/50'
                        }`}
                        disabled={isCreatingRepo}
                        role="radio"
                        aria-checked={isPrivateRepo}
                        aria-label={t('githubSetup.selectVisibilityAriaLabel', { visibility: 'private' })}
                      >
                        <Lock className="h-4 w-4" />
                        <span className="text-sm">Private</span>
                      </button>
                      <button
                        onClick={() => setIsPrivateRepo(false)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                          !isPrivateRepo
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-muted hover:border-primary/50'
                        }`}
                        disabled={isCreatingRepo}
                        role="radio"
                        aria-checked={!isPrivateRepo}
                        aria-label={t('githubSetup.selectVisibilityAriaLabel', { visibility: 'public' })}
                      >
                        <Globe className="h-4 w-4" />
                        <span className="text-sm">Public</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Link existing repo form */}
              {repoAction === 'link' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <button
                      onClick={() => setRepoAction(null)}
                      className="text-primary hover:underline"
                      aria-label={t('githubSetup.goBackAriaLabel')}
                    >
                      ← Back
                    </button>
                    <span>Link to existing repository</span>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="existing-repo">Repository</Label>
                    <Input
                      id="existing-repo"
                      value={existingRepoName}
                      onChange={(e) => setExistingRepoName(e.target.value)}
                      placeholder="username/repository"
                      disabled={isCreatingRepo}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the full repository path (e.g., octocat/hello-world)
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              {onSkip && (
                <Button variant="outline" onClick={onSkip} disabled={isCreatingRepo}>
                  Skip for now
                </Button>
              )}
              {repoAction === 'create' && (
                <Button onClick={handleCreateRepo} disabled={isCreatingRepo || !newRepoName.trim()}>
                  {isCreatingRepo ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Repository
                    </>
                  )}
                </Button>
              )}
              {repoAction === 'link' && (
                <Button onClick={handleLinkRepo} disabled={isCreatingRepo || !existingRepoName.trim()}>
                  {isCreatingRepo ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Linking...
                    </>
                  ) : (
                    <>
                      <Link className="mr-2 h-4 w-4" />
                      Link Repository
                    </>
                  )}
                </Button>
              )}
              {!repoAction && (
                <Button variant="outline" onClick={detectRepository} disabled={isLoadingRepo}>
                  {isLoadingRepo ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    'Retry Detection'
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        );

      case 'branch':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Select Base Branch
              </DialogTitle>
              <DialogDescription>
                Choose which branch Aperant should use as the base for creating task branches.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              {/* Show detected repo */}
              {detectedRepo && (
                <div className="flex items-center gap-2 text-sm">
                  <Github className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Repository:</span>
                  <code className="px-2 py-0.5 bg-muted rounded font-mono text-xs">
                    {detectedRepo}
                  </code>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                </div>
              )}

              {/* Branch selector */}
              <div className="space-y-2">
                <Label>Base Branch</Label>
                <Select
                  value={selectedBranch || ''}
                  onValueChange={setSelectedBranch}
                  disabled={isLoadingBranches || branches.length === 0}
                >
                  <SelectTrigger>
                    {isLoadingBranches ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Loading branches...</span>
                      </div>
                    ) : (
                      <SelectValue placeholder="Select a branch" />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        <div className="flex items-center gap-2">
                          <span>{branch}</span>
                          {branch === recommendedBranch && (
                            <span className="flex items-center gap-1 text-xs text-success">
                              <Sparkles className="h-3 w-3" />
                              Recommended
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  All tasks will be created from branches like{' '}
                  <code className="px-1 bg-muted rounded">auto-claude/task-name</code>
                  {selectedBranch && (
                    <> based on <code className="px-1 bg-muted rounded">{selectedBranch}</code></>
                  )}
                </p>
              </div>

              {/* Info about branch selection */}
              <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-info mt-0.5" />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Why select a branch?</p>
                    <p className="mt-1">
                      Aperant creates isolated workspaces for each task. Selecting the right base branch ensures
                      your tasks start with the latest code from your main development line.
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              {onSkip && (
                <Button variant="outline" onClick={onSkip}>
                  Skip for now
                </Button>
              )}
              <Button
                onClick={handleComplete}
                disabled={!selectedBranch || isLoadingBranches}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete Setup
              </Button>
            </DialogFooter>
          </>
        );

      case 'complete':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Setup Complete
              </DialogTitle>
            </DialogHeader>

            <div className="py-8 flex flex-col items-center justify-center">
              <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Aperant is ready to use! You can now create tasks that will be
                automatically based on <code className="px-1 bg-muted rounded">{selectedBranch}</code>.
              </p>
            </div>
          </>
        );
    }
  };

  // Progress indicator
  const renderProgress = () => {
    const steps: { label: string }[] = [
      { label: 'Authenticate' },
      { label: 'Configure' },
    ];

    // Don't show progress on complete step
    if (step === 'complete') return null;

    // Map steps to progress indices
    // Auth steps (github-auth, claude-auth, repo) = 0
    // Config steps (branch) = 1
    const currentIndex =
      step === 'github-auth' ? 0 :
      step === 'claude-auth' ? 0 :
      step === 'repo' ? 0 :
      1;

    return (
      <div className="flex items-center justify-center gap-2 mb-4">
        {steps.map((s, index) => (
          <div key={index} className="flex items-center">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                index < currentIndex
                  ? 'bg-success text-success-foreground'
                  : index === currentIndex
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {index < currentIndex ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </div>
            <span className={`ml-2 text-xs ${
              index === currentIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
            }`}>
              {s.label}
            </span>
            {index < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 mx-2 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'claude-auth' ? 'sm:max-w-2xl' : 'sm:max-w-md'}>
        {renderProgress()}
        {renderStepContent()}
      </DialogContent>
    </Dialog>
  );
}
