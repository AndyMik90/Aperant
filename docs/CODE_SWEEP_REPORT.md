# Code Sweep Report

**Date:** 2026-02-08
**Version:** 2.7.5
**Scope:** Full codebase sweep of apps/frontend/src/main, apps/frontend/src/renderer, apps/backend
**Previous Sweeps:** Sweep #1 (2026-02-05, 26 fixed), Sweep #2 (2026-02-06, 15 found/2 fixed), UI Audit (2026-02-06, 24 fixed)

---

## Executive Summary — Sweep #3

| Severity | Found | Fixed | Unfixed |
|----------|-------|-------|---------|
| CRITICAL | 1 | 0 | 1 |
| MAJOR | 7 | 0 | 7 |
| MINOR | 10 | 2 | 8 |
| **Total** | **18** | **2** | **16** |

**Build Status:** PASS (no TypeScript errors, build succeeds)
**Test Status:** 23 pre-existing test failures in 6 files (all pre-existing, none introduced by this sweep)
**Fixes Applied:** 2 safe, behavior-preserving fixes

---

## Build Results

```
npm run build - SUCCESS
- main: built successfully
- preload: 78.70 kB
- renderer: ~5,700 kB total (largest: index-BGSrm7Rh.js at 4,559 kB)
Built in ~5s
```

## Test Results

```
npm test (vitest)
- 82 test files, 1997 tests total
- 1964 passed, 10 skipped, 23 failed (6 files)
- All failures are PRE-EXISTING (verified by stashing sweep changes)
```

**Pre-existing test failures:**
1. `task-order.test.ts` — 14 failures (localStorage persistence tests, tests don't match current implementation)
2. `task-store.test.ts` — 1 failure (title update test expects plan.feature to override title, but implementation now preserves user's original title)
3. `agent-events.test.ts` — 3 failures (failed phase detection tests)
4. `ipc-handlers.test.ts` — 1 failure (exit event with failure status)
5. `parsers.test.ts` — 1 failure (build failure detection)
6. `ipc-bridge.test.ts` — 1 failure (removeProject method missing from preload API)

---

## Fixes Applied in This Sweep

### FIX-S3-01: Wrong Logger Instance in session.py (FIXED)
**File:** `apps/backend/agents/session.py`
**Line:** 288
**Severity:** MINOR
**Issue:** Used `logging.error()` (module-level) instead of `logger.error()` (configured per-module logger). The module defines `logger = logging.getLogger(__name__)` at line 63, and all other logging calls use `logger`. This call bypassed the configured logger, meaning log routing/filtering/formatting would differ for this critical error path.
**Fix:** Changed `logging.error(...)` to `logger.error(...)`.

### FIX-S3-02: Model Label Mismatch in UI (FIXED)
**File:** `apps/frontend/src/shared/constants/models.ts`
**Line:** 13
**Severity:** MINOR
**Issue:** The Opus model dropdown label showed "Claude Opus 4.5" but the `MODEL_ID_MAP` maps to `claude-opus-4-6`. The display label was outdated after the model ID was updated to 4.6.
**Fix:** Changed label from `'Claude Opus 4.5'` to `'Claude Opus 4.6'`.

---

## CRITICAL Issues (Unfixed — Documented)

### SWEEP-42: Fragile Companion Agent Auto-Spawn Race Condition
**File:** `apps/frontend/src/main/agent/agent-manager.ts`
**Lines:** 129-180
**Issue:** The companion agent auto-spawn uses a 1500ms setTimeout with a follow-up 2000ms context cleanup. This creates overlapping timing windows where:
1. Companion starts spawning (1500ms)
2. Context cleanup runs (2000ms), awaiting the companion spawn promise
3. If task events fire during this 500ms gap (task restart, re-run, error), the companion can spawn with stale context or be killed mid-spawn

The code uses `companionSpawnPromise` to coordinate, but the promise only resolves after the companion start attempt — it doesn't protect against state changes during the window.

**Impact:** Companion agent may spawn with stale context, fail silently, or be cleaned up before fully initializing. In worst case, task appears to have companion support but it's actually dead.
**Recommendation:** Implement a proper state machine with explicit phases: `coder_running` -> `coder_exited` -> `spawning_companion` -> `companion_ready`. Block state transitions during `spawning_companion`.
**Note:** This is already annotated in the code with FIX-032 comment. The existing workaround is functional but fragile.

---

## MAJOR Issues (Unfixed — Documented)

### SWEEP-43: validateStatusTransition Allows Invalid Transitions When Task Not Found
**File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
**Line:** 91
**Issue:** `validateStatusTransition()` returns `true` when task is `undefined`, meaning if `findTaskAndProject()` fails to locate the task, ANY status transition is allowed through. The downstream code at line 694 has `if (task && project)` guards for persistence, so the transition won't be persisted — but the renderer still receives the status change event.
**Impact:** Phantom status changes sent to renderer for unknown tasks. In practice, this is unlikely to cause visible bugs since the renderer also looks up the task, but it pollutes the event stream.
**Recommendation:** Return `false` when task is undefined and log a warning.

### SWEEP-44: Task Order Tests Out of Sync With Implementation
**File:** `apps/frontend/src/renderer/__tests__/task-order.test.ts`
**Lines:** Multiple (14 failures)
**Issue:** The task order store's persistence mechanism appears to have changed (localStorage pattern), but the tests still expect the old behavior. 14 tests fail consistently in the suite.
**Impact:** Test coverage gap — task order persistence is untested.
**Recommendation:** Update tests to match current `saveTaskOrder`/`loadTaskOrder`/`clearTaskOrder` implementation.

### SWEEP-45: updateTaskFromPlan Title Test Out of Sync
**File:** `apps/frontend/src/renderer/__tests__/task-store.test.ts`
**Line:** 332
**Issue:** Test expects `plan.feature` to update `task.title`, but line 446 of `task-store.ts` now reads: `title: t.metadata?.originalTitle || t.title` — explicitly preserving the user's original title.
**Impact:** Test fails, title update behavior is untested.
**Recommendation:** Update test to verify the new behavior (title preserved, not overwritten).

### SWEEP-46: Agent Events Test Failures (Failed Phase Detection)
**File:** `apps/frontend/src/main/__tests__/agent-events.test.ts`
**Lines:** Multiple (3 failures)
**Issue:** Tests for "Fallback Text Matching - Failed Phase" expect certain text patterns to be detected as failed phases. The text matching logic appears to have been refactored.
**Impact:** Failed phase detection untested.
**Recommendation:** Review `parseExecutionPhase` implementation and update test expectations.

### SWEEP-47: IPC Bridge Missing removeProject Method
**File:** `apps/frontend/src/__tests__/integration/ipc-bridge.test.ts`
**Issue:** Test expects `removeProject` to exist on the preload API, but this method may not be exposed through the preload bridge.
**Impact:** Integration test gap.
**Recommendation:** Either add `removeProject` to the preload API or update the test.

### SWEEP-48: Ideation Handler Cleanup Functions Never Called
**File:** `apps/frontend/src/main/ipc-handlers/ideation-handlers.ts`
**Lines:** 116-132
**Issue:** `registerIdeationHandlers()` returns a cleanup function that removes 7 event listeners from `agentManager`. However, this cleanup function is never invoked — `setupIpcHandlers()` does not store or call it. The listeners persist for the app lifetime.
**Impact:** Not a leak per se (app-lifetime is correct), but if handlers were ever re-registered (hot reload, test scenarios), listeners would stack.
**Recommendation:** Store and invoke cleanup on re-registration or app shutdown.

### SWEEP-49: Memory Manager close() Doesn't Handle CancelledError
**File:** `apps/backend/agents/memory_manager.py`
**Lines:** 265-273
**Issue:** `get_graphiti_context()` finally block catches generic `Exception` when closing memory, but `asyncio.CancelledError` (which is a `BaseException`, not `Exception` in Python 3.9+) would escape the handler and leave the connection unclosed.
**Impact:** Memory/connection leak if coroutine is cancelled during Graphiti operations.
**Recommendation:** Add explicit `except BaseException` or `except (Exception, asyncio.CancelledError)` in the finally block's inner try/except.

---

## MINOR Issues (Unfixed — Documented)

### SWEEP-50: Silent Exception Swallowing in insights_runner.py
**File:** `apps/backend/runners/insights_runner.py`
**Lines:** 73, 91, 110, 121, 134
**Issue:** Five `except Exception: pass` blocks silently ignore all errors when loading project context files (index, roadmap, tasks, plan, metadata).
**Impact:** If files are corrupted, the system continues without warning. Data issues are invisible.
**Recommendation:** Log at warning level instead of silently passing.

### SWEEP-51: PTY Ring Buffer Uses O(n) shift() Operations
**File:** `apps/frontend/src/main/terminal/pty-daemon.ts`
**Lines:** 263-284
**Issue:** Buffer management uses `Array.shift()` which is O(n) for each removal. Under heavy terminal output, this could be slow.
**Recommendation:** Consider a circular buffer or deque for better performance.

### SWEEP-52: ViewStateContext Unnecessary Memoization Dependencies
**File:** `apps/frontend/src/renderer/contexts/ViewStateContext.tsx`
**Lines:** 37-44
**Issue:** `useMemo` for context value includes stable `useCallback` references in its dependency array. Since these callbacks have empty dependency arrays, they never change, making their inclusion in the memo deps unnecessary.
**Recommendation:** Simplify to `[showArchived]` only.

### SWEEP-53: NavigationContext No Optional Hook Variant
**File:** `apps/frontend/src/renderer/contexts/NavigationContext.tsx`
**Lines:** 45-53
**Issue:** `useNavigation()` throws if used outside provider, but there's no `useNavigationOptional()` variant for components that might be conditionally rendered outside the provider tree (e.g., in tests).
**Recommendation:** Add an optional variant that returns `null` instead of throwing.

### SWEEP-54: Project Store Debounce Timer Not Cleared on Error
**File:** `apps/frontend/src/renderer/stores/project-store.ts`
**Lines:** 212-233
**Issue:** `saveTabStateToMain()` catch block doesn't clear the debounce timer reference, so subsequent calls will queue additional saves without checking if the previous IPC call failed.
**Recommendation:** Set `saveTabStateTimeout = null` in the catch block.

### SWEEP-55: Terminal Store Linear Lookup Performance
**File:** `apps/frontend/src/renderer/stores/terminal-store.ts`
**Lines:** 75-76, 549-552
**Issue:** Terminal lookup uses `Array.find()` which is O(n). With many terminals open, this creates performance overhead on every output write.
**Recommendation:** Add a `Map<string, Terminal>` index for O(1) lookups.

### SWEEP-56: Subtask Validation Runs on Every Plan Update Without Change Detection
**File:** `apps/frontend/src/renderer/stores/task-store.ts`
**Lines:** 287-294, 298-325
**Issue:** `validatePlanData()` and full subtask array reconstruction runs on every `updateTaskFromPlan` call, even if the plan data hasn't changed.
**Recommendation:** Add a shallow comparison or hash check before rebuilding subtasks.

### SWEEP-57: Settings Store Uses Non-Serializable Map in State
**File:** `apps/frontend/src/renderer/stores/settings-store.ts`
**Line:** 26
**Issue:** `discoveredModels: Map<string, ModelInfo[]>` is stored in Zustand state. Maps are not JSON-serializable, which would cause issues if persistence middleware is ever added.
**Recommendation:** Convert to a plain object `Record<string, ModelInfo[]>` for serialization compatibility.

---

## Previously Documented Issues (From Sweeps #1-2 and UI Audit)

### Status of SWEEP-29 through SWEEP-41 (Sweep #2)
- **SWEEP-29 (Race in project memory):** Still open. Needs file locking.
- **SWEEP-30 (Input validation in INSIGHTS_CREATE_TASK):** Partially addressed — title length and sanitization added.
- **SWEEP-31 (Spec number race):** Still open.
- **SWEEP-32 (Companion agent await):** Still open. Needs SDK API verification.
- **SWEEP-33 (taskParsers cleanup):** Fixed in UI Audit (AUDIT-10).
- **SWEEP-34 (Null check in complexity-classified):** Already has null check at line 295. FALSE POSITIVE.
- **SWEEP-35 (Stale closure in handleSendMessage):** Fixed in UI Audit (AUDIT-06).
- **SWEEP-36 (Subtask comparison):** Still open.
- **SWEEP-37 (i18n in ChatHistorySidebar):** Still open.
- **SWEEP-38 (SpecDocView error state):** Still open.
- **SWEEP-39 (SpecDocView cache):** Still open.
- **SWEEP-40 (Mixed import strategy):** Still open.
- **SWEEP-41 (Bundle size):** Still open (observation).

---

## Files Scanned

### apps/frontend/src/main (Electron Main Process) — 226 files
- `agent/agent-manager.ts` — companion spawn lifecycle, event listeners
- `agent/agent-process.ts` — process management, error handlers
- `agent/agent-queue.ts` — task queue, project scanning
- `ipc-handlers/task/execution-handlers.ts` — task lifecycle, status transitions
- `ipc-handlers/agent-events-handlers.ts` — event forwarding, phase parsing
- `ipc-handlers/insights-handlers.ts` — insights creation, message handling
- `ipc-handlers/ideation-handlers.ts` — ideation event listeners
- `ipc-handlers/terminal-handlers.ts` — terminal invocation
- `terminal/pty-daemon.ts` — PTY buffer management
- `terminal/pty-daemon-client.ts` — socket handling
- `file-watcher.ts` — plan file watching
- `services/` — various service modules

### apps/frontend/src/renderer (React Frontend) — 80+ files
- `stores/task-store.ts` — task state management, plan updates
- `stores/terminal-store.ts` — terminal state, output callbacks
- `stores/insights-store.ts` — chat messages, streaming
- `stores/settings-store.ts` — model discovery, profile management
- `stores/notification-store.ts` — notification tracking
- `stores/project-store.ts` — project/tab state persistence
- `hooks/useIpc.ts` — IPC batching, phase changes
- `hooks/useGlobalTerminalListeners.ts` — global output listeners
- `hooks/useClaudeLoginTerminal.ts` — auth terminal
- `contexts/ViewStateContext.tsx` — view state memoization
- `contexts/NavigationContext.tsx` — navigation context
- `components/terminal/TaskMonitorChat.tsx` — chat interface
- `components/insights/ResizeHandle.tsx` — resize handle cleanup

### apps/backend (Python Backend) — 50+ files
- `agents/session.py` — session management, subtask processing
- `agents/coder.py` — coder agent implementation
- `agents/companion_agent.py` — companion agent
- `agents/memory_manager.py` — Graphiti memory integration
- `agents/user_message_queue.py` — thread-safe message queue
- `runners/insights_runner.py` — insights chat runner
- `core/client.py` — SDK client factory
- `core/file_utils.py` — atomic file operations
- `core/progress.py` — progress tracking

---

## Recommendations

### Immediate (Fix Now)
1. Update failing tests to match current implementation (SWEEP-44, SWEEP-45, SWEEP-46, SWEEP-47)
2. Address CancelledError gap in memory_manager.py (SWEEP-49)

### Short-term (Next Sprint)
1. Implement state machine for companion spawn lifecycle (SWEEP-42)
2. Return false from validateStatusTransition when task is undefined (SWEEP-43)
3. Store and invoke ideation handler cleanup functions (SWEEP-48)
4. Add warning logging to insights_runner exception handlers (SWEEP-50)

### Long-term (Backlog)
1. Replace PTY ring buffer with circular buffer (SWEEP-51)
2. Add terminal lookup index (SWEEP-55)
3. Add plan change detection before subtask rebuild (SWEEP-56)
4. Convert Map to Record in settings store (SWEEP-57)

---

**Sweep completed by:** Claude Code Sweep #3
**Date:** 2026-02-08 (morning)
**Fixes applied:** 2 (FIX-S3-01, FIX-S3-02)
**Next sweep recommended:** After test suite is brought back to green

---
---

# Code Sweep #4: Comprehensive Multi-Layer Audit
**Date:** 2026-02-08 (evening)
**Auditor:** Claude Sonnet 4.5 with Three Specialized Explore Agents
**Scope:** Full systematic audit of all three layers (Main Process, Renderer, Backend)

---

## Executive Summary — Sweep #4

| Severity | Found | Description |
|----------|-------|-------------|
| CRITICAL | 18 | Unhandled promise rejections, race conditions, missing completion gates |
| MAJOR | 18 | Error handling gaps, resource leaks, state management bugs |
| MINOR | 8 | Code quality improvements, performance optimizations |
| **Total** | **44** | **New issues identified** |

**Key Findings:**
- **12 CRITICAL issues** in async/await error handling and promise lifecycle
- **6 CRITICAL issues** in Ralph/Wiggum integration (missing completion gates, race conditions)
- **Multiple memory leaks** from event listeners not being cleaned up
- **Race conditions** in concurrent file updates and terminal state management

---

## Part 1: Electron Main Process (18 Issues)

### CRITICAL Issues
