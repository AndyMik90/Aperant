# Code Review Suggestions: Authentication Failure Fix

This document contains code review suggestions for fixing the authentication failure issue for scheduled tasks after app restart. Each suggestion is structured as a review comment that could be applied directly.

**Related Issue**: #1603
**Analysis Document**: `AUTH_FAILURE_SCHEDULED_TASKS_ANALYSIS.md`

---

## File 1: `apps/frontend/src/main/claude-profile/profile-utils.ts`

### Location: Lines 92-98

**Current Code:**
```typescript
const platformCreds = getCredentialsFromKeychain(expandedConfigDir);
if (!platformCreds.token) {
  // .claude.json exists but credential store is missing tokens - NOT authenticated
  console.warn(`[profile-utils] Profile has .claude.json but no platform credentials for: ${configDir}`);
  return false;
}
return true;
```

**Review Comment:**

> 🔴 **CRITICAL BUG**: This code only checks if a token EXISTS, not if it's VALID (non-expired).
>
> **Problem**: `getCredentialsFromKeychain()` returns `{ token, expiresAt, refreshToken }` but we only check `token` presence. When the app restarts after being closed for hours, the token may be expired but this function still returns `true`.
>
> **Suggested Fix:**
> ```typescript
> const platformCreds = getCredentialsFromKeychain(expandedConfigDir);
> if (!platformCreds.token) {
>   console.warn(`[profile-utils] Profile has .claude.json but no platform credentials for: ${configDir}`);
>   return false;
> }
>
> // NEW: Check if token is expired or near expiry (within 30-minute threshold)
> if (platformCreds.expiresAt) {
>   const PROACTIVE_REFRESH_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
>   const isExpiredOrNearExpiry = Date.now() >= (platformCreds.expiresAt - PROACTIVE_REFRESH_THRESHOLD_MS);
>   if (isExpiredOrNearExpiry) {
>     console.warn(`[profile-utils] Token expired or near expiry for: ${configDir}`, {
>       expiresAt: new Date(platformCreds.expiresAt).toISOString(),
>       now: new Date().toISOString()
>     });
>     return false;
>   }
> }
>
> return true;
> ```
>
> **Impact**: This change will cause `hasValidAuth()` to return `false` for expired tokens, triggering the authentication required flow in the UI.
>
> **Testing**:
> - Unit test with expired `expiresAt` timestamp
> - Unit test with `expiresAt` 29 minutes in the future (should return true)
> - Unit test with `expiresAt` 31 minutes in the future (should return true)
> - Unit test with `expiresAt` in the past (should return false)

---

## File 2: `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`

### Location: Lines 169-178 (TASK_START handler)

**Current Code:**
```typescript
// Check authentication - Claude requires valid auth to run tasks
if (!profileManager.hasValidAuth()) {
  console.warn('[TASK_START] No valid authentication for active profile');
  mainWindow.webContents.send(
    IPC_CHANNELS.TASK_ERROR,
    taskId,
    'Claude authentication required. Please go to Settings > Claude Profiles and authenticate your account, or set an OAuth token.'
  );
  return;
}
```

**Review Comment:**

> 🟡 **ENHANCEMENT**: Add pre-flight token refresh before checking auth validity.
>
> **Problem**: `hasValidAuth()` only checks existence (and with fix #1, expiration). But we should proactively REFRESH the token before failing, since tokens can be refreshed automatically if a refresh token exists.
>
> **Suggested Fix:**
> ```typescript
> // NEW: Pre-flight token refresh to ensure fresh credentials
> // This prevents failures when tokens expired while app was closed
> const { ensureValidToken } = await import('../../claude-profile/token-refresh');
> const activeProfile = profileManager.getActiveProfile();
>
> if (activeProfile.configDir) {
>   const expandedConfigDir = activeProfile.configDir.startsWith('~')
>     ? activeProfile.configDir.replace(/^~/, require('os').homedir())
>     : activeProfile.configDir;
>
>   const tokenResult = await ensureValidToken(expandedConfigDir);
>
>   if (tokenResult.error && tokenResult.errorCode === 'invalid_grant') {
>     console.warn('[TASK_START] Token refresh failed - re-authentication required:', tokenResult.error);
>     mainWindow.webContents.send(
>       IPC_CHANNELS.TASK_ERROR,
>       taskId,
>       'Claude session expired. Please go to Settings > Claude Profiles and re-authenticate your account.'
>     );
>     return;
>   }
>
>   if (!tokenResult.token) {
>     console.warn('[TASK_START] No valid token available:', tokenResult.error);
>     mainWindow.webContents.send(
>       IPC_CHANNELS.TASK_ERROR,
>       taskId,
>       `Authentication failed: ${tokenResult.error || 'Please authenticate your account.'}`
>     );
>     return;
>   }
>
>   if (tokenResult.wasRefreshed) {
>     console.log('[TASK_START] Token was refreshed successfully');
>   }
> }
>
> // Keep existing hasValidAuth check as backup validation
> if (!profileManager.hasValidAuth()) {
>   // ... existing error handling
> }
> ```
>
> **Impact**:
> - Adds ~500ms-2s latency to task start when token needs refresh
> - Prevents auth failures for tasks scheduled before app restart
> - Provides clearer error messages distinguishing "session expired" vs "not authenticated"
>
> **Note**: The same pattern should be applied to:
> - `TASK_UPDATE_STATUS` handler (line 751)
> - `TASK_RECOVER_STUCK` handler (line 1105)

---

## File 3: `apps/frontend/src/main/agent/agent-manager.ts`

### Location: Lines 107-111 (startSpecCreation)

**Current Code:**
```typescript
if (!profileManager.hasValidAuth()) {
  this.emit('error', taskId, 'Claude authentication required. Please authenticate in Settings > Claude Profiles before starting tasks.');
  return;
}
```

**Review Comment:**

> 🟡 **ENHANCEMENT**: Add pre-flight token refresh here as well.
>
> **Problem**: Same issue as execution-handlers.ts - we check auth but don't attempt to refresh expired tokens.
>
> **Suggested Fix:**
> ```typescript
> // NEW: Pre-flight token refresh
> const { ensureValidToken } = await import('../claude-profile/token-refresh');
> const activeProfile = profileManager.getActiveProfile();
>
> if (activeProfile.configDir) {
>   const expandedConfigDir = activeProfile.configDir.startsWith('~')
>     ? activeProfile.configDir.replace(/^~/, require('os').homedir())
>     : activeProfile.configDir;
>
>   try {
>     const tokenResult = await ensureValidToken(expandedConfigDir);
>     if (!tokenResult.token) {
>       const errorMsg = tokenResult.errorCode === 'invalid_grant'
>         ? 'Claude session expired. Please re-authenticate in Settings > Claude Profiles.'
>         : `Authentication failed: ${tokenResult.error || 'Please authenticate your account.'}`;
>       this.emit('error', taskId, errorMsg);
>       return;
>     }
>   } catch (error) {
>     console.error('[AgentManager] Token refresh failed:', error);
>     // Fall through to hasValidAuth check
>   }
> }
>
> if (!profileManager.hasValidAuth()) {
>   this.emit('error', taskId, 'Claude authentication required. Please authenticate in Settings > Claude Profiles before starting tasks.');
>   return;
> }
> ```
>
> **Note**: This method needs to become `async`. Check all callers for compatibility.
>
> **Same pattern applies to**:
> - `startTaskExecution()` (line 201)
> - `startQAProcess()` (if it has auth check)

---

## File 4: `apps/frontend/src/main/index.ts`

### Location: Lines 405-407 (after UsageMonitor.start())

**Current Code:**
```typescript
// Start the usage monitor
const usageMonitor = getUsageMonitor();
usageMonitor.start();
console.warn('[main] Usage monitor initialized and started (after profile load)');
```

**Review Comment:**

> 🟢 **ENHANCEMENT (P1)**: Add proactive token refresh for all profiles at app startup.
>
> **Problem**: When app restarts after being closed for hours, all profile tokens may be expired. UsageMonitor will eventually refresh them, but tasks might try to start before that happens.
>
> **Suggested Fix:**
> ```typescript
> // Start the usage monitor
> const usageMonitor = getUsageMonitor();
> usageMonitor.start();
> console.warn('[main] Usage monitor initialized and started (after profile load)');
>
> // NEW: Proactive token refresh for active profile at startup
> // This ensures the most commonly used profile has fresh credentials immediately
> (async () => {
>   const { ensureValidToken } = await import('./claude-profile/token-refresh');
>   const profileManager = getClaudeProfileManager();
>   const activeProfile = profileManager.getActiveProfile();
>
>   if (activeProfile.configDir) {
>     const expandedConfigDir = activeProfile.configDir.startsWith('~')
>       ? activeProfile.configDir.replace(/^~/, require('os').homedir())
>       : activeProfile.configDir;
>
>     console.log('[main] Checking token validity for active profile:', activeProfile.name);
>
>     const result = await ensureValidToken(expandedConfigDir);
>
>     if (result.wasRefreshed) {
>       console.log('[main] Active profile token was refreshed successfully');
>     } else if (result.error) {
>       console.warn('[main] Active profile may need re-authentication:', result.error);
>
>       // Optionally notify UI if re-auth is needed
>       if (result.errorCode === 'invalid_grant' || result.errorCode === 'missing_credentials') {
>         const authFailureInfo = {
>           profileId: activeProfile.id,
>           profileName: activeProfile.name,
>           failureType: result.errorCode === 'invalid_grant' ? 'expired' : 'missing',
>           message: `Profile "${activeProfile.name}" needs re-authentication.`,
>           detectedAt: new Date()
>         };
>         mainWindow?.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
>       }
>     }
>   }
> })().catch(error => {
>   console.error('[main] Startup token refresh failed:', error);
> });
> ```
>
> **Impact**:
> - May add 500ms-2s to perceived app startup if token refresh needed
> - Ensures active profile is ready for immediate task execution
> - Provides early warning if re-authentication is required
>
> **Alternative**: Could be made non-blocking by not awaiting, but then tasks might start before refresh completes.

---

## File 5: `apps/frontend/src/main/claude-profile/token-refresh.ts`

### Location: Lines 314-326 (ensureValidToken function)

**Current Code:**
```typescript
if (isDebug) {
  console.warn('[TokenRefresh:ensureValidToken] Checking token validity', {
    configDir: expandedConfigDir || 'default'
  });
}
```

**Review Comment:**

> 🟢 **ENHANCEMENT (P1)**: Add more detailed debug logging for auth troubleshooting.
>
> **Problem**: When debugging auth failures, it's difficult to understand the token lifecycle without verbose logging.
>
> **Suggested Fix:**
> ```typescript
> // Always log token state for troubleshooting (not just in debug mode)
> // This helps diagnose auth issues in production without enabling full debug
> const tokenStateForLogging = {
>   configDir: expandedConfigDir || 'default',
>   hasToken: !!creds.token,
>   hasRefreshToken: !!creds.refreshToken,
>   expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'null',
>   isExpired: creds.expiresAt ? Date.now() >= creds.expiresAt : 'unknown',
>   timeUntilExpiry: creds.expiresAt
>     ? Math.round((creds.expiresAt - Date.now()) / 1000 / 60) + ' minutes'
>     : 'unknown',
>   needsRefresh: needsRefresh
> };
>
> // Log at info level for troubleshooting (not debug)
> console.log('[TokenRefresh:ensureValidToken] Token state:', tokenStateForLogging);
> ```
>
> **Impact**: Slightly more verbose logs, but invaluable for debugging auth issues.
>
> **Consider**: Adding a dedicated auth troubleshooting log level or flag.

---

## File 6: `apps/frontend/src/main/services/sdk-session-recovery-coordinator.ts`

### Location: Class definition (P2 - Medium term)

**Review Comment:**

> 🔵 **ENHANCEMENT (P2)**: Add persistence for recovery coordinator state.
>
> **Problem**: The `SDKSessionRecoveryCoordinator` stores all state in memory:
> - Registered operations (tasks, roadmap, ideation)
> - Profile assignments
> - Rate limit cooldowns
> - Session IDs
>
> All of this is lost when the app restarts, making it impossible to:
> - Resume tasks with correct profile
> - Respect rate limit cooldowns
> - Recover SDK sessions
>
> **Suggested Approach:**
> 1. Add persistence file: `{userData}/session-recovery-state.json`
> 2. Persist on operation registration/update
> 3. Load on app startup
> 4. Add version field for migration support
>
> **Data Structure to Persist:**
> ```typescript
> interface PersistedRecoveryState {
>   version: number;
>   operations: Map<string, {
>     operationId: string;
>     profileId: string;
>     sessionId?: string;
>     type: 'task' | 'roadmap' | 'ideation' | 'changelog';
>     registeredAt: number;
>   }>;
>   profileCooldowns: Map<string, {
>     profileId: string;
>     cooldownUntil: number;
>     consecutiveRateLimits: number;
>   }>;
> }
> ```
>
> **Implementation Notes:**
> - Use atomic writes (temp file + rename) for persistence
> - Debounce writes to avoid excessive disk I/O
> - Clear stale entries on load (e.g., operations older than 24 hours)
>
> **This is a larger change** - recommend creating a separate issue/PR for this work.

---

## Summary of Changes

| File | Priority | Type | Estimated Effort |
|------|----------|------|------------------|
| profile-utils.ts | P0 | Bug Fix | 30 min |
| execution-handlers.ts | P0 | Enhancement | 1-2 hours |
| agent-manager.ts | P0 | Enhancement | 1 hour |
| index.ts | P1 | Enhancement | 1 hour |
| token-refresh.ts | P1 | Enhancement | 30 min |
| sdk-session-recovery-coordinator.ts | P2 | Feature | 4-8 hours |

**Total Estimated Effort**:
- P0 (Critical): 2-4 hours
- P1 (Important): 1.5 hours
- P2 (Nice to have): 4-8 hours
