# Authentication Failure Analysis: Scheduled Tasks After App Restart

## Executive Summary

When tasks are scheduled and the application is closed then reopened, authentication fails for both the console and agents. Even terminal agents cannot re-authenticate. This analysis documents all identified cases, root causes, and proposed solutions.

---

## 1. Problem Statement

**Symptom**: Subtasks scheduled in the past fail to execute after app restart due to authentication failures.

**Affected Components**:
- Task execution (spec creation, implementation, QA)
- Agent processes (coder, planner, QA reviewer/fixer)
- Terminal agents (Claude integration)
- Profile-based authentication system

**User Impact**: Tasks that were scheduled before app closure cannot resume, requiring manual re-authentication and task restart.

---

## 2. Root Cause Analysis

### 2.1 Primary Root Cause: Token Existence vs. Validity Check

**Location**: `apps/frontend/src/main/claude-profile/profile-utils.ts:92-97`

```typescript
const platformCreds = getCredentialsFromKeychain(expandedConfigDir);
if (!platformCreds.token) {
  return false;
}
return true;  // BUG: Returns true even if token is EXPIRED
```

The `isProfileAuthenticated()` function checks only if credentials **exist**, not if they are **valid** (non-expired). This causes `hasValidAuth()` to return `true` for expired tokens.

### 2.2 Secondary Root Cause: UsageMonitor Stops on App Close

**Location**: `apps/frontend/src/main/index.ts:405-406`

The `UsageMonitor` performs proactive token refresh every 30 seconds. When the app closes:
1. `UsageMonitor.stop()` is called
2. No background process exists to refresh tokens
3. OAuth tokens expire after ~8 hours
4. On app restart, stale tokens are used

### 2.3 Tertiary Root Cause: No Pre-flight Token Validation

**Location**: `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts:170`

Before spawning agent processes, the system calls `hasValidAuth()` but does NOT call `ensureValidToken()` to refresh expired tokens.

---

## 3. Exhaustive Case Analysis

### 3.1 Nominal Cases (Expected Behavior)

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| N-01 | App open, task starts immediately | Auth check passes, task runs | Works correctly |
| N-02 | App open, token refreshed by UsageMonitor | Fresh token used | Works correctly |
| N-03 | Token within 30min of expiry, app open | Proactive refresh occurs | Works correctly |

### 3.2 Edge Cases (Boundary Conditions)

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| E-01 | Token expires exactly at task start time | Refresh should occur | **FAILS**: No refresh triggered |
| E-02 | Token expires 1 second after app close | Token should refresh on restart | **FAILS**: Stale token used |
| E-03 | Task scheduled for 12 hours later, app closed for 10 hours | Token should refresh before task runs | **FAILS**: 401 error |
| E-04 | Multiple profiles, active profile token expired | Should fallback or prompt re-auth | **FAILS**: Silent failure |
| E-05 | Profile migrated to isolated directory | Should detect and prompt re-auth | **PARTIAL**: Only for active profile |

### 3.3 Error Cases (Failure Scenarios)

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| ERR-01 | Keychain locked on macOS | Clear error message, prompt unlock | Silently fails task |
| ERR-02 | Token refresh fails (network error) | Retry with exponential backoff | Works (in UsageMonitor only) |
| ERR-03 | Refresh token revoked by server | Prompt re-authentication | **FAILS**: Returns stale token |
| ERR-04 | `persistenceFailed` after token refresh | Should not use non-persisted token | **FAILS**: Token lost on restart |
| ERR-05 | Backend receives expired token | Should trigger frontend re-auth | **FAILS**: 401 with no recovery |
| ERR-06 | Invalid grant error from OAuth | Clear message + re-auth prompt | Partial (UsageMonitor marks for re-auth) |

### 3.4 Concurrency Cases

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| C-01 | Two tasks start simultaneously, both need token refresh | Single refresh, both use new token | Untested |
| C-02 | Token refresh during task spawn | Wait for refresh to complete | **RACE CONDITION**: May use stale token |
| C-03 | Profile switch while task is queued | Use new profile's credentials | **FAILS**: Uses old profile context |
| C-04 | App restart during token refresh | Persist partial state | **FAILS**: State lost |

### 3.5 Integration Cases

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| I-01 | Terminal agent tries to re-authenticate | Should refresh console + agent tokens | **FAILS**: Cannot trigger refresh |
| I-02 | Backend Python process reads stale token | Frontend should pre-refresh | **FAILS**: Backend reads Keychain directly |
| I-03 | CLI tools (claude, gh) need auth | Should share refreshed credentials | **PARTIAL**: Depends on CLAUDE_CONFIG_DIR |
| I-04 | Worktree context with expired token | Should refresh before worktree operations | **FAILS**: Git operations may fail |

### 3.6 State Persistence Cases

| Case ID | Scenario | Expected Behavior | Current Behavior |
|---------|----------|-------------------|------------------|
| S-01 | Task context saved to disk before app close | Should restore with fresh auth | **FAILS**: Auth context not persisted |
| S-02 | Profile assignment for task persisted | Should restore correct profile | **FAILS**: Uses current active profile |
| S-03 | Session ID recovery across restarts | Should resume SDK session | **FAILS**: Session IDs not persisted |
| S-04 | Rate limit cooldowns across restarts | Should respect cooldown period | **FAILS**: Cooldowns reset |

---

## 4. Impact Analysis

### 4.1 Technical Impact

- **Severity**: HIGH - Core functionality broken
- **Scope**: All scheduled/deferred task execution
- **Regression Risk**: Moderate (changes touch auth critical path)
- **Performance**: Token refresh adds ~500ms-2s latency on task start

### 4.2 User Experience Impact

- **Frustration Level**: HIGH - Tasks fail silently or with cryptic errors
- **Workaround**: User must manually re-authenticate and restart tasks
- **Data Loss Risk**: LOW - No data lost, but time wasted

### 4.3 Operational Impact

- **Monitoring**: Auth failures not clearly distinguished from other errors
- **Debugging**: Difficult to trace token expiry timeline
- **Support**: Likely high support burden due to confusing errors

---

## 5. Proposed Solutions

### 5.1 Solution A: Add Expiration Check to `hasValidAuth()` (Quick Fix)

**Pros**: Minimal code change, immediately prevents using expired tokens
**Cons**: Returns `false` for expired tokens, may trigger unnecessary re-auth prompts

**Implementation Complexity**: LOW
**Risk**: LOW

### 5.2 Solution B: Pre-flight Token Refresh Before Task Spawn (Recommended)

**Pros**: Ensures fresh token for every task start, transparent to user
**Cons**: Adds latency to task start (~500ms-2s for refresh)

**Implementation Complexity**: MEDIUM
**Risk**: LOW

### 5.3 Solution C: Proactive Refresh on App Startup (Belt and Suspenders)

**Pros**: Ensures all profiles have fresh tokens immediately
**Cons**: Delays app startup, may refresh tokens that won't be used

**Implementation Complexity**: MEDIUM
**Risk**: LOW

### 5.4 Solution D: Persist Task Auth Context (Long-term)

**Pros**: Enables profile-specific task execution, survives restarts
**Cons**: Significant architecture change, migration needed

**Implementation Complexity**: HIGH
**Risk**: MEDIUM

### 5.5 Solution E: Backend Token Refresh Capability (Comprehensive)

**Pros**: Backend can self-heal, reduces frontend dependency
**Cons**: Duplicates refresh logic, complex coordination

**Implementation Complexity**: HIGH
**Risk**: MEDIUM

---

## 6. Recommended Implementation Order

1. **Phase 1 (Immediate)**: Implement Solution A + B
   - Add expiration check to `hasValidAuth()`
   - Add pre-flight `ensureValidToken()` before task spawn
   - Estimated effort: 2-4 hours

2. **Phase 2 (Short-term)**: Implement Solution C
   - Proactive refresh on app startup
   - Clear error messaging for auth failures
   - Estimated effort: 4-8 hours

3. **Phase 3 (Medium-term)**: Implement Solution D
   - Persist task-profile associations
   - Add session recovery coordinator persistence
   - Estimated effort: 2-3 days

4. **Phase 4 (Long-term)**: Consider Solution E
   - Evaluate backend refresh capability
   - May not be needed if Phase 1-3 sufficient

---

## 7. Files Requiring Changes

| File | Change Type | Priority |
|------|-------------|----------|
| `apps/frontend/src/main/claude-profile/profile-utils.ts` | Add expiration check | P0 |
| `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` | Add pre-flight refresh | P0 |
| `apps/frontend/src/main/agent/agent-manager.ts` | Add pre-flight refresh | P0 |
| `apps/frontend/src/main/index.ts` | Add startup refresh | P1 |
| `apps/frontend/src/main/claude-profile/token-refresh.ts` | Add debug logging | P1 |
| `apps/frontend/src/main/services/sdk-session-recovery-coordinator.ts` | Add persistence | P2 |

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Test `isProfileAuthenticated()` with expired token
- Test `hasValidAuth()` with various token states
- Test `ensureValidToken()` refresh paths

### 8.2 Integration Tests

- Simulate app restart with expired token
- Verify task starts after token refresh
- Test profile switching during task queue

### 8.3 E2E Tests

- Schedule task, close app for >8 hours, reopen
- Verify task executes successfully
- Test terminal re-authentication flow

---

## 9. Open Questions

1. Should expired tokens trigger automatic re-auth modal or require explicit user action?
2. How to handle case where refresh token itself is expired/revoked?
3. Should task-profile associations be persisted to `.auto-claude/` or app userData?
4. What is the acceptable latency for pre-flight token refresh?

---

## 10. References

- Token refresh implementation: `apps/frontend/src/main/claude-profile/token-refresh.ts`
- Profile management: `apps/frontend/src/main/claude-profile-manager.ts`
- Task execution: `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
- Agent spawning: `apps/frontend/src/main/agent/agent-process.ts`
