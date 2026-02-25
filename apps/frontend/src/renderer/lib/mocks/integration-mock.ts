/**
 * Mock implementation for environment configuration and integration operations
 */

export const integrationMock = {
  // Environment Configuration Operations
  getProjectEnv: async () => ({
    success: true,
    data: {
      claudeAuthStatus: 'not_configured' as const,
      linearEnabled: false,
      githubEnabled: false,
      gitlabEnabled: false,
      graphitiEnabled: false,
      enableFancyUi: true
    }
  }),

  updateProjectEnv: async () => ({
    success: true
  }),

  // Auto-Build Source Environment Operations
  getSourceEnv: async () => ({
    success: true,
    data: {
      hasClaudeToken: true,
      envExists: true,
      sourcePath: '/mock/auto-claude'
    }
  }),

  updateSourceEnv: async () => ({
    success: true
  }),

  checkSourceToken: async () => ({
    success: true,
    data: {
      hasToken: true,
      sourcePath: '/mock/auto-claude'
    }
  }),

  // Claude Authentication
  checkClaudeAuth: async () => ({
    success: true,
    data: {
      success: false,
      authenticated: false,
      error: 'Not available in browser mock'
    }
  }),

  invokeClaudeSetup: async () => ({
    success: true,
    data: {
      success: false,
      authenticated: false,
      error: 'Not available in browser mock'
    }
  }),

  // Linear Integration Operations
  getLinearTeams: async () => ({
    success: true,
    data: []
  }),

  getLinearProjects: async () => ({
    success: true,
    data: []
  }),

  getLinearIssues: async () => ({
    success: true,
    data: []
  }),

  importLinearIssues: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  checkLinearConnection: async () => ({
    success: true,
    data: {
      connected: false,
      error: 'Not available in browser mock'
    }
  }),

  // GitHub Integration Operations
  getGitHubRepositories: async () => ({
    success: true,
    data: []
  }),

  getGitHubIssues: async () => ({
    success: true,
    data: { issues: [], hasMore: false }
  }),

  getGitHubIssue: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  checkGitHubConnection: async () => ({
    success: true,
    data: {
      connected: false,
      error: 'Not available in browser mock'
    }
  }),

  investigateGitHubIssue: () => {
    console.warn('[Browser Mock] investigateGitHubIssue called');
  },

  getIssueComments: async () => ({
    success: true,
    data: []
  }),

  importGitHubIssues: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  createGitHubRelease: async () => ({
    success: true,
    data: {
      url: 'https://github.com/example/repo/releases/tag/v1.0.0'
    }
  }),

  onGitHubInvestigationProgress: () => () => {},
  onGitHubInvestigationComplete: () => () => {},
  onGitHubInvestigationError: () => () => {},

  // GitHub OAuth Operations (gh CLI)
  checkGitHubCli: async () => ({
    success: true,
    data: {
      installed: false,
      version: undefined
    }
  }),

  checkGitHubAuth: async () => ({
    success: true,
    data: {
      authenticated: false,
      username: undefined
    }
  }),

  startGitHubAuth: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitHubToken: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitHubUser: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitHubUserRepos: async () => ({
    success: true,
    data: {
      repos: [
        { fullName: 'user/example-repo', description: 'An example repository', isPrivate: false },
        { fullName: 'user/private-repo', description: 'A private repository', isPrivate: true }
      ]
    }
  }),

  detectGitHubRepo: async () => ({
    success: true,
    data: 'user/example-repo'
  }),

  getGitHubBranches: async () => ({
    success: true,
    data: ['main', 'develop', 'feature/example']
  }),

  createGitHubRepo: async (_repoName: string, _options: { description?: string; isPrivate?: boolean; projectPath: string; owner?: string }) => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  addGitRemote: async (_projectPath: string, _repoFullName: string) => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitHubOrgs: async () => ({
    success: true,
    data: {
      orgs: [
        { login: 'example-org', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
        { login: 'another-org', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }
      ]
    }
  }),

  // GitLab Integration Operations
  getGitLabProjects: async () => ({
    success: true,
    data: []
  }),

  getGitLabIssues: async () => ({
    success: true,
    data: []
  }),

  getGitLabIssue: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitLabIssueNotes: async () => ({
    success: true,
    data: []
  }),

  checkGitLabConnection: async () => ({
    success: true,
    data: {
      connected: false,
      error: 'Not available in browser mock'
    }
  }),

  investigateGitLabIssue: () => {
    console.warn('[Browser Mock] investigateGitLabIssue called');
  },

  importGitLabIssues: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  createGitLabRelease: async () => ({
    success: true,
    data: {
      url: 'https://gitlab.com/example/repo/-/releases/v1.0.0'
    }
  }),

  // GitLab Merge Request Operations
  getGitLabMergeRequests: async () => ({
    success: true,
    data: []
  }),

  getGitLabMergeRequest: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  createGitLabMergeRequest: async (_projectId: string, _options: {
    title: string;
    description?: string;
    sourceBranch: string;
    targetBranch: string;
    labels?: string[];
    assigneeIds?: number[];
    removeSourceBranch?: boolean;
    squash?: boolean;
  }) => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  updateGitLabMergeRequest: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  // GitLab MR Review Operations (AI-powered)
  getGitLabMRReview: async () => null,
  runGitLabMRReview: () => {},
  runGitLabMRFollowupReview: () => {},
  postGitLabMRReview: async () => false,
  postGitLabMRNote: async () => false,
  mergeGitLabMR: async () => false,
  assignGitLabMR: async () => false,
  approveGitLabMR: async () => false,
  cancelGitLabMRReview: async () => false,
  checkGitLabMRNewCommits: async () => ({ hasNewCommits: false }),

  // GitLab MR Review Event Listeners
  onGitLabMRReviewProgress: () => () => {},
  onGitLabMRReviewComplete: () => () => {},
  onGitLabMRReviewError: () => () => {},

  // GitLab OAuth Operations (glab CLI)
  checkGitLabCli: async () => ({
    success: true,
    data: {
      installed: false,
      version: undefined
    }
  }),

  installGitLabCli: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  checkGitLabAuth: async () => ({
    success: true,
    data: {
      authenticated: false,
      username: undefined
    }
  }),

  startGitLabAuth: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitLabToken: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getGitLabUser: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitLabUserProjects: async () => ({
    success: true,
    data: {
      projects: [
        { pathWithNamespace: 'user/example-project', description: 'An example project', visibility: 'public' },
        { pathWithNamespace: 'user/private-project', description: 'A private project', visibility: 'private' }
      ]
    }
  }),

  detectGitLabProject: async () => ({
    success: true,
    data: { project: 'user/example-project', instanceUrl: 'https://gitlab.com' }
  }),

  getGitLabBranches: async () => ({
    success: true,
    data: ['main', 'develop', 'feature/example']
  }),

  createGitLabProject: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  addGitLabRemote: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  listGitLabGroups: async () => ({
    success: true,
    data: {
      groups: [
        { id: 1, name: 'Example Group', path: 'example-group', fullPath: 'example-group', description: 'An example group' },
        { id: 2, name: 'Another Group', path: 'another-group', fullPath: 'another-group', description: 'Another group' }
      ]
    }
  }),

  // GitLab Event Listeners
  onGitLabInvestigationProgress: () => () => {},
  onGitLabInvestigationComplete: () => () => {},
  onGitLabInvestigationError: () => () => {},

  // OAuth device code event listener (for streaming device code during auth)
  onGitHubAuthDeviceCode: () => () => {}
};
