/**
 * IPC Channel names for Electron communication
 * Main process <-> Renderer process communication
 */

export const IPC_CHANNELS = {
  // Project operations
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_LIST: 'project:list',
  PROJECT_UPDATE_SETTINGS: 'project:updateSettings',
  PROJECT_INITIALIZE: 'project:initialize',
  PROJECT_CHECK_VERSION: 'project:checkVersion',

  // Tab state operations (persisted in main process)
  TAB_STATE_GET: 'tabState:get',
  TAB_STATE_SAVE: 'tabState:save',

  // Kanban preferences (per-project column collapse state)
  KANBAN_PREFS_GET: 'kanbanPrefs:get',
  KANBAN_PREFS_SAVE: 'kanbanPrefs:save',

  // Task operations
  TASK_LIST: 'task:list',
  TASK_CREATE: 'task:create',
  TASK_DELETE: 'task:delete',
  TASK_UPDATE: 'task:update',
  TASK_START: 'task:start',
  TASK_STOP: 'task:stop',
  TASK_REVIEW: 'task:review',
  TASK_UPDATE_STATUS: 'task:updateStatus',
  TASK_RECOVER_STUCK: 'task:recoverStuck',
  TASK_CHECK_RUNNING: 'task:checkRunning',
  TASK_RESUME_PAUSED: 'task:resumePaused',  // Resume a rate-limited or auth-paused task
  TASK_LOAD_IMAGE_THUMBNAIL: 'task:loadImageThumbnail',
  TASK_CHECK_WORKTREE_CHANGES: 'task:checkWorktreeChanges',

  // Workspace management (for human review)
  // Per-spec architecture: Each spec has its own worktree at .worktrees/{spec-name}/
  TASK_WORKTREE_STATUS: 'task:worktreeStatus',
  TASK_WORKTREE_DIFF: 'task:worktreeDiff',
  TASK_WORKTREE_MERGE: 'task:worktreeMerge',
  TASK_WORKTREE_MERGE_PREVIEW: 'task:worktreeMergePreview',  // Preview merge conflicts before merging
  TASK_WORKTREE_DISCARD: 'task:worktreeDiscard',
  TASK_WORKTREE_DISCARD_ORPHAN: 'task:worktreeDiscardOrphan',  // Delete orphaned worktree by spec name (no task association)
  TASK_WORKTREE_CREATE_PR: 'task:worktreeCreatePR',
  TASK_WORKTREE_OPEN_IN_IDE: 'task:worktreeOpenInIDE',
  TASK_WORKTREE_OPEN_IN_TERMINAL: 'task:worktreeOpenInTerminal',
  TASK_WORKTREE_DETECT_TOOLS: 'task:worktreeDetectTools',  // Detect installed IDEs/terminals
  TASK_LIST_WORKTREES: 'task:listWorktrees',
  TASK_ARCHIVE: 'task:archive',
  TASK_UNARCHIVE: 'task:unarchive',
  TASK_CLEAR_STAGED_STATE: 'task:clearStagedState',

  // Task events (main -> renderer)
  TASK_PROGRESS: 'task:progress',
  TASK_ERROR: 'task:error',
  TASK_LOG: 'task:log',
  TASK_STATUS_CHANGE: 'task:statusChange',
  TASK_EXECUTION_PROGRESS: 'task:executionProgress',

  // Task phase logs (persistent, collapsible logs by phase)
  TASK_LOGS_GET: 'task:logsGet',           // Load logs from spec dir
  TASK_LOGS_WATCH: 'task:logsWatch',       // Start watching for log changes
  TASK_LOGS_UNWATCH: 'task:logsUnwatch',   // Stop watching for log changes
  TASK_LOGS_CHANGED: 'task:logsChanged',   // Event: logs changed (main -> renderer)
  TASK_LOGS_STREAM: 'task:logsStream',     // Event: streaming log chunk (main -> renderer)
  TASK_MERGE_PROGRESS: 'task:mergeProgress',  // Event: merge progress update (main -> renderer)

  // Terminal operations
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_DESTROY: 'terminal:destroy',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_INVOKE_CLAUDE: 'terminal:invokeClaude',
  TERMINAL_GENERATE_NAME: 'terminal:generateName',
  TERMINAL_SET_TITLE: 'terminal:setTitle',  // Renderer -> Main: user renamed terminal
  TERMINAL_SET_WORKTREE_CONFIG: 'terminal:setWorktreeConfig',  // Renderer -> Main: worktree association changed

  // Terminal session management
  TERMINAL_GET_SESSIONS: 'terminal:getSessions',
  TERMINAL_RESTORE_SESSION: 'terminal:restoreSession',
  TERMINAL_CLEAR_SESSIONS: 'terminal:clearSessions',
  TERMINAL_RESUME_CLAUDE: 'terminal:resumeClaude',
  TERMINAL_ACTIVATE_DEFERRED_RESUME: 'terminal:activateDeferredResume',  // Trigger deferred Claude resume when terminal becomes active
  TERMINAL_GET_SESSION_DATES: 'terminal:getSessionDates',
  TERMINAL_GET_SESSIONS_FOR_DATE: 'terminal:getSessionsForDate',
  TERMINAL_RESTORE_FROM_DATE: 'terminal:restoreFromDate',
  TERMINAL_CHECK_PTY_ALIVE: 'terminal:checkPtyAlive',
  TERMINAL_UPDATE_DISPLAY_ORDERS: 'terminal:updateDisplayOrders',  // Persist terminal display order after drag-drop reorder

  // Terminal worktree operations (isolated development in worktrees)
  TERMINAL_WORKTREE_CREATE: 'terminal:worktreeCreate',
  TERMINAL_WORKTREE_REMOVE: 'terminal:worktreeRemove',
  TERMINAL_WORKTREE_LIST: 'terminal:worktreeList',
  TERMINAL_WORKTREE_LIST_OTHER: 'terminal:worktreeListOther',

  // Terminal events (main -> renderer)
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_TITLE_CHANGE: 'terminal:titleChange',
  TERMINAL_WORKTREE_CONFIG_CHANGE: 'terminal:worktreeConfigChange',  // Worktree config restored/changed (for sync on recovery)
  TERMINAL_CLAUDE_SESSION: 'terminal:claudeSession',  // Claude session ID captured
  TERMINAL_PENDING_RESUME: 'terminal:pendingResume',  // Terminal has pending Claude resume (for deferred activation)
  TERMINAL_RATE_LIMIT: 'terminal:rateLimit',  // Claude Code rate limit detected
  TERMINAL_OAUTH_TOKEN: 'terminal:oauthToken',  // OAuth token captured from setup-token output
  TERMINAL_AUTH_CREATED: 'terminal:authCreated',  // Auth terminal created for OAuth flow
  TERMINAL_OAUTH_CODE_NEEDED: 'terminal:oauthCodeNeeded',  // Request user to paste OAuth code from browser
  TERMINAL_OAUTH_CODE_SUBMIT: 'terminal:oauthCodeSubmit',  // User submitted OAuth code to send to terminal
  TERMINAL_CLAUDE_BUSY: 'terminal:claudeBusy',  // Claude Code busy state (for visual indicator)
  TERMINAL_CLAUDE_EXIT: 'terminal:claudeExit',  // Claude Code exited (returned to shell)
  TERMINAL_ONBOARDING_COMPLETE: 'terminal:onboardingComplete',  // Claude onboarding complete (ready for input after login)
  TERMINAL_PROFILE_CHANGED: 'terminal:profileChanged',  // Profile changed, terminals need refresh (main -> renderer)

  // Claude profile management (multi-account support)
  CLAUDE_PROFILES_GET: 'claude:profilesGet',
  CLAUDE_PROFILE_SAVE: 'claude:profileSave',
  CLAUDE_PROFILE_DELETE: 'claude:profileDelete',
  CLAUDE_PROFILE_RENAME: 'claude:profileRename',
  CLAUDE_PROFILE_SET_ACTIVE: 'claude:profileSetActive',
  CLAUDE_PROFILE_SWITCH: 'claude:profileSwitch',
  CLAUDE_PROFILE_INITIALIZE: 'claude:profileInitialize',
  CLAUDE_PROFILE_SET_TOKEN: 'claude:profileSetToken',  // Set OAuth token for a profile
  CLAUDE_PROFILE_AUTHENTICATE: 'claude:profileAuthenticate',  // Open visible terminal for OAuth login
  CLAUDE_PROFILE_VERIFY_AUTH: 'claude:profileVerifyAuth',  // Check if profile has been authenticated
  CLAUDE_PROFILE_AUTO_SWITCH_SETTINGS: 'claude:autoSwitchSettings',
  CLAUDE_PROFILE_UPDATE_AUTO_SWITCH: 'claude:updateAutoSwitch',
  CLAUDE_PROFILE_FETCH_USAGE: 'claude:fetchUsage',
  CLAUDE_PROFILE_GET_BEST_PROFILE: 'claude:getBestProfile',

  // Account priority order (unified OAuth + API profile ordering)
  ACCOUNT_PRIORITY_GET: 'account:priorityGet',
  ACCOUNT_PRIORITY_SET: 'account:prioritySet',

  // SDK/CLI rate limit event (for non-terminal Claude invocations)
  CLAUDE_SDK_RATE_LIMIT: 'claude:sdkRateLimit',
  // Auth failure event (401 errors requiring re-authentication)
  CLAUDE_AUTH_FAILURE: 'claude:authFailure',
  // Retry a rate-limited operation with a different profile
  CLAUDE_RETRY_WITH_PROFILE: 'claude:retryWithProfile',

  // Usage monitoring (proactive account switching)
  USAGE_UPDATED: 'claude:usageUpdated',  // Event: usage data updated (main -> renderer)
  USAGE_REQUEST: 'claude:usageRequest',  // Request current usage snapshot
  ALL_PROFILES_USAGE_REQUEST: 'claude:allProfilesUsageRequest',  // Request all profiles usage immediately
  ALL_PROFILES_USAGE_UPDATED: 'claude:allProfilesUsageUpdated',  // Event: all profiles usage data (main -> renderer)
  PROACTIVE_SWAP_NOTIFICATION: 'claude:proactiveSwapNotification',  // Event: proactive swap occurred

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_GET_CLI_TOOLS_INFO: 'settings:getCliToolsInfo',
  SETTINGS_CLAUDE_CODE_GET_ONBOARDING_STATUS: 'settings:claudeCode:getOnboardingStatus',  // Check hasCompletedOnboarding from ~/.claude.json

  // API Profile management (custom Anthropic-compatible endpoints)
  PROFILES_GET: 'profiles:get',
  PROFILES_SAVE: 'profiles:save',
  PROFILES_UPDATE: 'profiles:update',
  PROFILES_DELETE: 'profiles:delete',
  PROFILES_SET_ACTIVE: 'profiles:setActive',
  PROFILES_TEST_CONNECTION: 'profiles:test-connection',
  PROFILES_TEST_CONNECTION_CANCEL: 'profiles:test-connection-cancel',
  PROFILES_DISCOVER_MODELS: 'profiles:discover-models',
  PROFILES_DISCOVER_MODELS_CANCEL: 'profiles:discover-models-cancel',

  // Dialogs
  DIALOG_SELECT_DIRECTORY: 'dialog:selectDirectory',
  DIALOG_CREATE_PROJECT_FOLDER: 'dialog:createProjectFolder',
  DIALOG_GET_DEFAULT_PROJECT_LOCATION: 'dialog:getDefaultProjectLocation',

  // App info
  APP_VERSION: 'app:version',

  // Shell operations
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  SHELL_OPEN_TERMINAL: 'shell:openTerminal',

  // Roadmap operations
  ROADMAP_GET: 'roadmap:get',
  ROADMAP_GET_STATUS: 'roadmap:getStatus',
  ROADMAP_SAVE: 'roadmap:save',
  ROADMAP_GENERATE: 'roadmap:generate',
  ROADMAP_GENERATE_WITH_COMPETITOR: 'roadmap:generateWithCompetitor',
  ROADMAP_REFRESH: 'roadmap:refresh',
  ROADMAP_STOP: 'roadmap:stop',
  ROADMAP_UPDATE_FEATURE: 'roadmap:updateFeature',
  ROADMAP_CONVERT_TO_SPEC: 'roadmap:convertToSpec',
  COMPETITOR_ANALYSIS_SAVE: 'roadmap:competitorAnalysisSave',

  // Roadmap events (main -> renderer)
  ROADMAP_PROGRESS: 'roadmap:progress',
  ROADMAP_COMPLETE: 'roadmap:complete',
  ROADMAP_ERROR: 'roadmap:error',
  ROADMAP_STOPPED: 'roadmap:stopped',

  // Roadmap progress persistence (per-project state)
  ROADMAP_PROGRESS_SAVE: 'roadmap:progressSave',
  ROADMAP_PROGRESS_LOAD: 'roadmap:progressLoad',
  ROADMAP_PROGRESS_CLEAR: 'roadmap:progressClear',

  // Context operations
  CONTEXT_GET: 'context:get',
  CONTEXT_REFRESH_INDEX: 'context:refreshIndex',
  CONTEXT_MEMORY_STATUS: 'context:memoryStatus',
  CONTEXT_SEARCH_MEMORIES: 'context:searchMemories',
  CONTEXT_GET_MEMORIES: 'context:getMemories',

  // Environment configuration
  ENV_GET: 'env:get',
  ENV_UPDATE: 'env:update',
  ENV_CHECK_CLAUDE_AUTH: 'env:checkClaudeAuth',
  ENV_INVOKE_CLAUDE_SETUP: 'env:invokeClaudeSetup',

  // Ideation operations
  IDEATION_GET: 'ideation:get',
  IDEATION_GENERATE: 'ideation:generate',
  IDEATION_REFRESH: 'ideation:refresh',
  IDEATION_STOP: 'ideation:stop',
  IDEATION_UPDATE_IDEA: 'ideation:updateIdea',
  IDEATION_CONVERT_TO_TASK: 'ideation:convertToTask',
  IDEATION_DISMISS: 'ideation:dismiss',
  IDEATION_DISMISS_ALL: 'ideation:dismissAll',
  IDEATION_ARCHIVE: 'ideation:archive',
  IDEATION_DELETE: 'ideation:delete',
  IDEATION_DELETE_MULTIPLE: 'ideation:deleteMultiple',

  // Ideation events (main -> renderer)
  IDEATION_PROGRESS: 'ideation:progress',
  IDEATION_LOG: 'ideation:log',
  IDEATION_COMPLETE: 'ideation:complete',
  IDEATION_ERROR: 'ideation:error',
  IDEATION_STOPPED: 'ideation:stopped',
  IDEATION_TYPE_COMPLETE: 'ideation:typeComplete',
  IDEATION_TYPE_FAILED: 'ideation:typeFailed',

  // Linear integration
  LINEAR_GET_TEAMS: 'linear:getTeams',
  LINEAR_GET_PROJECTS: 'linear:getProjects',
  LINEAR_GET_ISSUES: 'linear:getIssues',
  LINEAR_IMPORT_ISSUES: 'linear:importIssues',
  LINEAR_CHECK_CONNECTION: 'linear:checkConnection',

  // GitHub integration
  GITHUB_GET_REPOSITORIES: 'github:getRepositories',
  GITHUB_GET_ISSUES: 'github:getIssues',
  GITHUB_GET_ISSUE: 'github:getIssue',
  GITHUB_GET_ISSUE_COMMENTS: 'github:getIssueComments',
  GITHUB_CHECK_CONNECTION: 'github:checkConnection',
  GITHUB_INVESTIGATE_ISSUE: 'github:investigateIssue',
  GITHUB_IMPORT_ISSUES: 'github:importIssues',
  GITHUB_CREATE_RELEASE: 'github:createRelease',

  // GitHub OAuth (gh CLI authentication)
  GITHUB_CHECK_CLI: 'github:checkCli',
  GITHUB_CHECK_AUTH: 'github:checkAuth',
  GITHUB_START_AUTH: 'github:startAuth',
  GITHUB_GET_TOKEN: 'github:getToken',
  GITHUB_GET_USER: 'github:getUser',
  GITHUB_LIST_USER_REPOS: 'github:listUserRepos',
  GITHUB_DETECT_REPO: 'github:detectRepo',
  GITHUB_GET_BRANCHES: 'github:getBranches',
  GITHUB_CREATE_REPO: 'github:createRepo',
  GITHUB_ADD_REMOTE: 'github:addRemote',
  GITHUB_LIST_ORGS: 'github:listOrgs',

  // GitHub OAuth events (main -> renderer) - for streaming device code during auth
  GITHUB_AUTH_DEVICE_CODE: 'github:authDeviceCode',
  GITHUB_AUTH_CHANGED: 'github:authChanged',  // Event: GitHub auth state changed (account swap)

  // GitHub events (main -> renderer)
  GITHUB_INVESTIGATION_PROGRESS: 'github:investigationProgress',
  GITHUB_INVESTIGATION_COMPLETE: 'github:investigationComplete',
  GITHUB_INVESTIGATION_ERROR: 'github:investigationError',

// GitLab integration
  GITLAB_GET_PROJECTS: 'gitlab:getProjects',
  GITLAB_GET_ISSUES: 'gitlab:getIssues',
  GITLAB_GET_ISSUE: 'gitlab:getIssue',
  GITLAB_GET_ISSUE_NOTES: 'gitlab:getIssueNotes',
  GITLAB_CHECK_CONNECTION: 'gitlab:checkConnection',
  GITLAB_INVESTIGATE_ISSUE: 'gitlab:investigateIssue',
  GITLAB_IMPORT_ISSUES: 'gitlab:importIssues',
  GITLAB_CREATE_RELEASE: 'gitlab:createRelease',

  // GitLab Merge Requests (equivalent to GitHub PRs)
  GITLAB_GET_MERGE_REQUESTS: 'gitlab:getMergeRequests',
  GITLAB_GET_MERGE_REQUEST: 'gitlab:getMergeRequest',
  GITLAB_CREATE_MERGE_REQUEST: 'gitlab:createMergeRequest',
  GITLAB_UPDATE_MERGE_REQUEST: 'gitlab:updateMergeRequest',

  // GitLab OAuth (glab CLI authentication)
  GITLAB_CHECK_CLI: 'gitlab:checkCli',
  GITLAB_INSTALL_CLI: 'gitlab:installCli',
  GITLAB_CHECK_AUTH: 'gitlab:checkAuth',
  GITLAB_START_AUTH: 'gitlab:startAuth',
  GITLAB_GET_TOKEN: 'gitlab:getToken',
  GITLAB_GET_USER: 'gitlab:getUser',
  GITLAB_LIST_USER_PROJECTS: 'gitlab:listUserProjects',
  GITLAB_DETECT_PROJECT: 'gitlab:detectProject',
  GITLAB_GET_BRANCHES: 'gitlab:getBranches',
  GITLAB_CREATE_PROJECT: 'gitlab:createProject',
  GITLAB_ADD_REMOTE: 'gitlab:addRemote',
  GITLAB_LIST_GROUPS: 'gitlab:listGroups',

  // GitLab events (main -> renderer)
  GITLAB_INVESTIGATION_PROGRESS: 'gitlab:investigationProgress',
  GITLAB_INVESTIGATION_COMPLETE: 'gitlab:investigationComplete',
  GITLAB_INVESTIGATION_ERROR: 'gitlab:investigationError',

  // GitLab MR Review operations
  GITLAB_MR_GET_DIFF: 'gitlab:mr:getDiff',
  GITLAB_MR_REVIEW: 'gitlab:mr:review',
  GITLAB_MR_REVIEW_CANCEL: 'gitlab:mr:reviewCancel',
  GITLAB_MR_GET_REVIEW: 'gitlab:mr:getReview',
  GITLAB_MR_FOLLOWUP_REVIEW: 'gitlab:mr:followupReview',
  GITLAB_MR_POST_REVIEW: 'gitlab:mr:postReview',
  GITLAB_MR_POST_NOTE: 'gitlab:mr:postNote',
  GITLAB_MR_MERGE: 'gitlab:mr:merge',
  GITLAB_MR_ASSIGN: 'gitlab:mr:assign',
  GITLAB_MR_APPROVE: 'gitlab:mr:approve',
  GITLAB_MR_CHECK_NEW_COMMITS: 'gitlab:mr:checkNewCommits',

  // GitLab MR Review events (main -> renderer)
  GITLAB_MR_REVIEW_PROGRESS: 'gitlab:mr:reviewProgress',
  GITLAB_MR_REVIEW_COMPLETE: 'gitlab:mr:reviewComplete',
  GITLAB_MR_REVIEW_ERROR: 'gitlab:mr:reviewError',

  // GitLab Auto-Fix operations
  GITLAB_AUTOFIX_START: 'gitlab:autofix:start',
  GITLAB_AUTOFIX_STOP: 'gitlab:autofix:stop',
  GITLAB_AUTOFIX_GET_QUEUE: 'gitlab:autofix:getQueue',
  GITLAB_AUTOFIX_CHECK_LABELS: 'gitlab:autofix:checkLabels',
  GITLAB_AUTOFIX_CHECK_NEW: 'gitlab:autofix:checkNew',
  GITLAB_AUTOFIX_GET_CONFIG: 'gitlab:autofix:getConfig',
  GITLAB_AUTOFIX_SAVE_CONFIG: 'gitlab:autofix:saveConfig',
  GITLAB_AUTOFIX_BATCH: 'gitlab:autofix:batch',
  GITLAB_AUTOFIX_GET_BATCHES: 'gitlab:autofix:getBatches',

  // GitLab Auto-Fix events (main -> renderer)
  GITLAB_AUTOFIX_PROGRESS: 'gitlab:autofix:progress',
  GITLAB_AUTOFIX_COMPLETE: 'gitlab:autofix:complete',
  GITLAB_AUTOFIX_ERROR: 'gitlab:autofix:error',
  GITLAB_AUTOFIX_BATCH_PROGRESS: 'gitlab:autofix:batchProgress',
  GITLAB_AUTOFIX_BATCH_COMPLETE: 'gitlab:autofix:batchComplete',
  GITLAB_AUTOFIX_BATCH_ERROR: 'gitlab:autofix:batchError',

  // GitLab Issue Analysis Preview (proactive batch workflow)
  GITLAB_AUTOFIX_ANALYZE_PREVIEW: 'gitlab:autofix:analyzePreview',
  GITLAB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS: 'gitlab:autofix:analyzePreviewProgress',
  GITLAB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE: 'gitlab:autofix:analyzePreviewComplete',
  GITLAB_AUTOFIX_ANALYZE_PREVIEW_ERROR: 'gitlab:autofix:analyzePreviewError',
  GITLAB_AUTOFIX_APPROVE_BATCHES: 'gitlab:autofix:approveBatches',

  // GitLab Issue Triage operations
  GITLAB_TRIAGE_RUN: 'gitlab:triage:run',
  GITLAB_TRIAGE_GET_RESULTS: 'gitlab:triage:getResults',
  GITLAB_TRIAGE_APPLY_LABELS: 'gitlab:triage:applyLabels',
  GITLAB_TRIAGE_GET_CONFIG: 'gitlab:triage:getConfig',
  GITLAB_TRIAGE_SAVE_CONFIG: 'gitlab:triage:saveConfig',

  // GitLab Issue Triage events (main -> renderer)
  GITLAB_TRIAGE_PROGRESS: 'gitlab:triage:progress',
  GITLAB_TRIAGE_COMPLETE: 'gitlab:triage:complete',
  GITLAB_TRIAGE_ERROR: 'gitlab:triage:error',

  // GitHub Auto-Fix operations
  GITHUB_AUTOFIX_START: 'github:autofix:start',
  GITHUB_AUTOFIX_STOP: 'github:autofix:stop',
  GITHUB_AUTOFIX_GET_QUEUE: 'github:autofix:getQueue',
  GITHUB_AUTOFIX_CHECK_LABELS: 'github:autofix:checkLabels',
  GITHUB_AUTOFIX_CHECK_NEW: 'github:autofix:checkNew',
  GITHUB_AUTOFIX_GET_CONFIG: 'github:autofix:getConfig',
  GITHUB_AUTOFIX_SAVE_CONFIG: 'github:autofix:saveConfig',
  GITHUB_AUTOFIX_BATCH: 'github:autofix:batch',
  GITHUB_AUTOFIX_GET_BATCHES: 'github:autofix:getBatches',

  // GitHub Auto-Fix events (main -> renderer)
  GITHUB_AUTOFIX_PROGRESS: 'github:autofix:progress',
  GITHUB_AUTOFIX_COMPLETE: 'github:autofix:complete',
  GITHUB_AUTOFIX_ERROR: 'github:autofix:error',
  GITHUB_AUTOFIX_BATCH_PROGRESS: 'github:autofix:batchProgress',
  GITHUB_AUTOFIX_BATCH_COMPLETE: 'github:autofix:batchComplete',
  GITHUB_AUTOFIX_BATCH_ERROR: 'github:autofix:batchError',

  // GitHub Issue Analysis Preview (proactive batch workflow)
  GITHUB_AUTOFIX_ANALYZE_PREVIEW: 'github:autofix:analyzePreview',
  GITHUB_AUTOFIX_ANALYZE_PREVIEW_PROGRESS: 'github:autofix:analyzePreviewProgress',
  GITHUB_AUTOFIX_ANALYZE_PREVIEW_COMPLETE: 'github:autofix:analyzePreviewComplete',
  GITHUB_AUTOFIX_ANALYZE_PREVIEW_ERROR: 'github:autofix:analyzePreviewError',
  GITHUB_AUTOFIX_APPROVE_BATCHES: 'github:autofix:approveBatches',

  // GitHub PR Review operations
  GITHUB_PR_LIST: 'github:pr:list',
  GITHUB_PR_LIST_MORE: 'github:pr:listMore',  // Load more PRs (pagination)
  GITHUB_PR_GET: 'github:pr:get',
  GITHUB_PR_GET_DIFF: 'github:pr:getDiff',
  GITHUB_PR_REVIEW: 'github:pr:review',
  GITHUB_PR_REVIEW_CANCEL: 'github:pr:reviewCancel',
  GITHUB_PR_GET_REVIEW: 'github:pr:getReview',
  GITHUB_PR_GET_REVIEWS_BATCH: 'github:pr:getReviewsBatch',  // Batch load reviews for multiple PRs
  GITHUB_PR_POST_REVIEW: 'github:pr:postReview',
  GITHUB_PR_DELETE_REVIEW: 'github:pr:deleteReview',
  GITHUB_PR_MERGE: 'github:pr:merge',
  GITHUB_PR_ASSIGN: 'github:pr:assign',
  GITHUB_PR_POST_COMMENT: 'github:pr:postComment',
  GITHUB_PR_FIX: 'github:pr:fix',
  GITHUB_PR_FOLLOWUP_REVIEW: 'github:pr:followupReview',
  GITHUB_PR_CHECK_NEW_COMMITS: 'github:pr:checkNewCommits',
  GITHUB_PR_CHECK_MERGE_READINESS: 'github:pr:checkMergeReadiness',
  GITHUB_PR_MARK_REVIEW_POSTED: 'github:pr:markReviewPosted',
  GITHUB_PR_UPDATE_BRANCH: 'github:pr:updateBranch',
  GITHUB_PR_NOTIFY_EXTERNAL_REVIEW_COMPLETE: 'github:pr:notifyExternalReviewComplete',

  // GitHub PR Review events (main -> renderer)
  GITHUB_PR_REVIEW_PROGRESS: 'github:pr:reviewProgress',
  GITHUB_PR_REVIEW_COMPLETE: 'github:pr:reviewComplete',
  GITHUB_PR_REVIEW_ERROR: 'github:pr:reviewError',
  GITHUB_PR_REVIEW_STATE_CHANGE: 'github:pr:reviewStateChange',
  GITHUB_PR_LOGS_UPDATED: 'github:pr:logsUpdated',

  // GitHub PR Logs (for viewing AI review logs)
  GITHUB_PR_GET_LOGS: 'github:pr:getLogs',

  // GitHub PR Status Polling (production system checks)
  GITHUB_PR_STATUS_POLL_START: 'github:pr:statusPollStart',   // Start polling PR status
  GITHUB_PR_STATUS_POLL_STOP: 'github:pr:statusPollStop',     // Stop polling PR status
  GITHUB_PR_STATUS_UPDATE: 'github:pr:statusUpdate',          // Event: PR status updated (main -> renderer)

  // GitHub PR Memory operations (saves review insights to memory layer)
  GITHUB_PR_MEMORY_GET: 'github:pr:memory:get',        // Get PR review memories
  GITHUB_PR_MEMORY_SEARCH: 'github:pr:memory:search',  // Search PR review memories

  // GitHub Workflow Approval (for fork PRs)
  GITHUB_WORKFLOWS_AWAITING_APPROVAL: 'github:workflows:awaitingApproval',
  GITHUB_WORKFLOW_APPROVE: 'github:workflow:approve',

  // GitHub Issue Triage operations
  GITHUB_TRIAGE_RUN: 'github:triage:run',
  GITHUB_TRIAGE_GET_RESULTS: 'github:triage:getResults',
  GITHUB_TRIAGE_APPLY_LABELS: 'github:triage:applyLabels',
  GITHUB_TRIAGE_GET_CONFIG: 'github:triage:getConfig',
  GITHUB_TRIAGE_SAVE_CONFIG: 'github:triage:saveConfig',

  // GitHub Issue Triage events (main -> renderer)
  GITHUB_TRIAGE_PROGRESS: 'github:triage:progress',
  GITHUB_TRIAGE_COMPLETE: 'github:triage:complete',
  GITHUB_TRIAGE_ERROR: 'github:triage:error',

  // Memory Infrastructure status (LadybugDB - no Docker required)
  MEMORY_STATUS: 'memory:status',
  MEMORY_LIST_DATABASES: 'memory:listDatabases',
  MEMORY_TEST_CONNECTION: 'memory:testConnection',

  // Graphiti validation
  GRAPHITI_VALIDATE_LLM: 'graphiti:validateLlm',
  GRAPHITI_TEST_CONNECTION: 'graphiti:testConnection',

  // Ollama model detection and management
  OLLAMA_CHECK_STATUS: 'ollama:checkStatus',
  OLLAMA_CHECK_INSTALLED: 'ollama:checkInstalled',
  OLLAMA_INSTALL: 'ollama:install',
  OLLAMA_LIST_MODELS: 'ollama:listModels',
  OLLAMA_LIST_EMBEDDING_MODELS: 'ollama:listEmbeddingModels',
  OLLAMA_PULL_MODEL: 'ollama:pullModel',
  OLLAMA_PULL_PROGRESS: 'ollama:pullProgress',

  // Auto Claude source environment configuration
  AUTOBUILD_SOURCE_ENV_GET: 'autobuild:source:env:get',
  AUTOBUILD_SOURCE_ENV_UPDATE: 'autobuild:source:env:update',
  AUTOBUILD_SOURCE_ENV_CHECK_TOKEN: 'autobuild:source:env:checkToken',

  // Changelog operations
  CHANGELOG_GET_DONE_TASKS: 'changelog:getDoneTasks',
  CHANGELOG_LOAD_TASK_SPECS: 'changelog:loadTaskSpecs',
  CHANGELOG_GENERATE: 'changelog:generate',
  CHANGELOG_SAVE: 'changelog:save',
  CHANGELOG_READ_EXISTING: 'changelog:readExisting',
  CHANGELOG_SUGGEST_VERSION: 'changelog:suggestVersion',
  CHANGELOG_SUGGEST_VERSION_FROM_COMMITS: 'changelog:suggestVersionFromCommits',

  // Changelog git operations (for git-based changelog generation)
  CHANGELOG_GET_BRANCHES: 'changelog:getBranches',
  CHANGELOG_GET_TAGS: 'changelog:getTags',
  CHANGELOG_GET_COMMITS_PREVIEW: 'changelog:getCommitsPreview',
  CHANGELOG_SAVE_IMAGE: 'changelog:saveImage',
  CHANGELOG_READ_LOCAL_IMAGE: 'changelog:readLocalImage',

  // Changelog events (main -> renderer)
  CHANGELOG_GENERATION_PROGRESS: 'changelog:generationProgress',
  CHANGELOG_GENERATION_COMPLETE: 'changelog:generationComplete',
  CHANGELOG_GENERATION_ERROR: 'changelog:generationError',

  // Insights operations
  INSIGHTS_GET_SESSION: 'insights:getSession',
  INSIGHTS_SEND_MESSAGE: 'insights:sendMessage',
  INSIGHTS_CLEAR_SESSION: 'insights:clearSession',
  INSIGHTS_CREATE_TASK: 'insights:createTask',
  INSIGHTS_LIST_SESSIONS: 'insights:listSessions',
  INSIGHTS_NEW_SESSION: 'insights:newSession',
  INSIGHTS_SWITCH_SESSION: 'insights:switchSession',
  INSIGHTS_DELETE_SESSION: 'insights:deleteSession',
  INSIGHTS_DELETE_SESSIONS: 'insights:deleteSessions',
  INSIGHTS_ARCHIVE_SESSION: 'insights:archiveSession',
  INSIGHTS_ARCHIVE_SESSIONS: 'insights:archiveSessions',
  INSIGHTS_UNARCHIVE_SESSION: 'insights:unarchiveSession',
  INSIGHTS_RENAME_SESSION: 'insights:renameSession',
  INSIGHTS_UPDATE_MODEL_CONFIG: 'insights:updateModelConfig',

  // Insights events (main -> renderer)
  INSIGHTS_STREAM_CHUNK: 'insights:streamChunk',
  INSIGHTS_STATUS: 'insights:status',
  INSIGHTS_ERROR: 'insights:error',
  INSIGHTS_SESSION_UPDATED: 'insights:sessionUpdated',  // Event: session updated (main -> renderer)

  // File explorer operations
  FILE_EXPLORER_LIST: 'fileExplorer:list',
  FILE_EXPLORER_READ: 'fileExplorer:read',

  // Git operations
  GIT_GET_BRANCHES: 'git:getBranches',
  GIT_GET_BRANCHES_WITH_INFO: 'git:getBranchesWithInfo',
  GIT_GET_CURRENT_BRANCH: 'git:getCurrentBranch',
  GIT_DETECT_MAIN_BRANCH: 'git:detectMainBranch',
  GIT_CHECK_STATUS: 'git:checkStatus',
  GIT_INITIALIZE: 'git:initialize',

  // App auto-update operations
  APP_UPDATE_CHECK: 'app-update:check',
  APP_UPDATE_DOWNLOAD: 'app-update:download',
  APP_UPDATE_DOWNLOAD_STABLE: 'app-update:download-stable',  // Download stable version (for downgrade from beta)
  APP_UPDATE_INSTALL: 'app-update:install',
  APP_UPDATE_GET_VERSION: 'app-update:get-version',
  APP_UPDATE_GET_DOWNLOADED: 'app-update:get-downloaded',  // Get downloaded update info (for showing Install button on Settings open)

  // App auto-update events (main -> renderer)
  APP_UPDATE_AVAILABLE: 'app-update:available',
  APP_UPDATE_DOWNLOADED: 'app-update:downloaded',
  APP_UPDATE_PROGRESS: 'app-update:progress',
  APP_UPDATE_ERROR: 'app-update:error',
  APP_UPDATE_STABLE_DOWNGRADE: 'app-update:stable-downgrade',  // Stable version available for downgrade from beta
  APP_UPDATE_READONLY_VOLUME: 'app-update:readonly-volume',  // App running from read-only volume (DMG), needs to be moved

  // Release operations
  RELEASE_SUGGEST_VERSION: 'release:suggestVersion',
  RELEASE_CREATE: 'release:create',
  RELEASE_PREFLIGHT: 'release:preflight',
  RELEASE_GET_VERSIONS: 'release:getVersions',

  // Release events (main -> renderer)
  RELEASE_PROGRESS: 'release:progress',

  // Debug operations
  DEBUG_GET_INFO: 'debug:getInfo',
  DEBUG_OPEN_LOGS_FOLDER: 'debug:openLogsFolder',
  DEBUG_COPY_DEBUG_INFO: 'debug:copyDebugInfo',
  DEBUG_GET_RECENT_ERRORS: 'debug:getRecentErrors',
  DEBUG_LIST_LOG_FILES: 'debug:listLogFiles',
  DEBUG_SIMULATE_RATE_LIMIT: 'debug:simulateRateLimit',  // Simulate rate limit for testing auto-swap

  // Claude Code CLI operations
  CLAUDE_CODE_CHECK_VERSION: 'claudeCode:checkVersion',
  CLAUDE_CODE_INSTALL: 'claudeCode:install',
  CLAUDE_CODE_GET_VERSIONS: 'claudeCode:getVersions',
  CLAUDE_CODE_INSTALL_VERSION: 'claudeCode:installVersion',
  CLAUDE_CODE_GET_INSTALLATIONS: 'claudeCode:getInstallations',
  CLAUDE_CODE_SET_ACTIVE_PATH: 'claudeCode:setActivePath',

  // MCP Server health checks
  MCP_CHECK_HEALTH: 'mcp:checkHealth',           // Quick connectivity check
  MCP_TEST_CONNECTION: 'mcp:testConnection',     // Full MCP protocol test

  // Sentry error reporting
  SENTRY_STATE_CHANGED: 'sentry:state-changed',  // Notify main process when setting changes
  GET_SENTRY_DSN: 'sentry:get-dsn',              // Get DSN from main process (env var)
  GET_SENTRY_CONFIG: 'sentry:get-config',        // Get full Sentry config (DSN + sample rates)

  // Spell check
  SPELLCHECK_SET_LANGUAGES: 'spellcheck:setLanguages',  // Set spell check language (syncs with i18n)

  // Screenshot capture
  SCREENSHOT_GET_SOURCES: 'screenshot:getSources',  // Get available screens/windows
  SCREENSHOT_CAPTURE: 'screenshot:capture',          // Capture screenshot from source

  // Queue routing (rate limit recovery)
  QUEUE_GET_RUNNING_TASKS_BY_PROFILE: 'queue:getRunningTasksByProfile',
  QUEUE_GET_BEST_PROFILE_FOR_TASK: 'queue:getBestProfileForTask',
  QUEUE_GET_BEST_UNIFIED_ACCOUNT: 'queue:getBestUnifiedAccount', // Unified OAuth + API account selection
  QUEUE_ASSIGN_PROFILE_TO_TASK: 'queue:assignProfileToTask',
  QUEUE_UPDATE_TASK_SESSION: 'queue:updateTaskSession',
  QUEUE_GET_TASK_SESSION: 'queue:getTaskSession',

  // Queue routing events (main -> renderer)
  QUEUE_PROFILE_SWAPPED: 'queue:profileSwapped',      // Task switched to different profile
  QUEUE_SESSION_CAPTURED: 'queue:sessionCaptured',    // Session ID captured from running task
  QUEUE_BLOCKED_NO_PROFILES: 'queue:blockedNoProfiles' // All profiles unavailable
} as const;
