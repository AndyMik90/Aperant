# Code Sweep Report

**Date:** 2026-02-06
**Version:** 2.7.5
**Scope:** Full codebase sweep of apps/frontend/src/main, apps/frontend/src/renderer, apps/backend
**Previous Sweep:** 2026-02-05 (26 issues found, 26 fixed)

---

## Executive Summary

| Severity | Found | Fixed | Unfixed |
|----------|-------|-------|---------|
| CRITICAL | 2 | 2 | 0 |
| MAJOR | 8 | 0 | 8 |
| MINOR | 5 | 0 | 5 |
| **Total** | **15** | **2** | **13** |

**Build Status:** PASS (no TypeScript errors)
**Sweep Status:** Documented. 2 critical fixes applied, 13 items documented for follow-up.

---

## Build Results

```
npm run build - SUCCESS
- main: 3,026.39 kB
- preload: 77.50 kB
- renderer: ~5,700 kB total
✓ built in ~19s
```

---

## CRITICAL Issues

### SWEEP-27: Path Traversal in TASK_READ_SPEC_FILE (FIXED)
**File:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
**Lines:** 1513-1536
**Status:** ✅ FIXED
**Issue:** The new `TASK_READ_SPEC_FILE` IPC handler accepted a `fileName` parameter from the renderer and used it directly in `path.join()` without validation. A malicious or corrupted input like `../../sensitive/file.txt` could read arbitrary files outside the spec directory.
**Impact:** Arbitrary file read vulnerability.
**Fix:** Added path traversal check using `path.resolve()` and verifying the resolved path starts with the spec directory prefix.

### SWEEP-28: Debug Print Statements in Production Code (FIXED)
**File:** `apps/backend/agents/memory_manager.py`
**Lines:** 121, 243, 259
**Status:** ✅ FIXED
**Issue:** Three `print("Project memory loaded")` statements were left in production code (added during MEGA_FALLBACK_A implementation). These print to stdout which is the IPC communication channel with the Electron frontend, potentially corrupting the output stream.
**Impact:** Could interfere with stdout-based IPC protocol between Python backend and Electron frontend.
**Fix:** Replaced all three occurrences with `logger.debug("Project memory loaded")`.

---

## MAJOR Issues (Unfixed - Documented)

### SWEEP-29: Race Condition in Project Memory File Operations
**File:** `apps/backend/memory/project_memory.py`
**Lines:** 140-190
**Issue:** `append_to_project_memory()` reads, modifies, and writes the file without file locking. Multiple concurrent sessions could cause lost writes.
**Impact:** Data loss if multiple agents write simultaneously.
**Recommendation:** Implement file-level locking using `fcntl.flock()` (Unix) or `msvcrt.locking()` (Windows).

### SWEEP-30: Missing Input Validation in INSIGHTS_CREATE_TASK
**File:** `apps/frontend/src/main/ipc-handlers/insights-handlers.ts`
**Lines:** 160-261
**Issue:** `title` and `description` parameters are not validated for length or sanitized. Title is used to create filesystem directories.
**Impact:** Potential for excessively long paths or special characters causing filesystem issues.
**Recommendation:** Add length validation and sanitize characters unsuitable for directory names.

### SWEEP-31: Race Condition in Spec Number Calculation
**File:** `apps/frontend/src/main/ipc-handlers/insights-handlers.ts`
**Lines:** 185-200
**Issue:** Between reading directory contents and creating the new spec directory, another process could create a spec with the same number, causing duplicate spec IDs.
**Impact:** Duplicate spec IDs under concurrent task creation.
**Recommendation:** Use atomic directory creation with retry logic.

### SWEEP-32: Companion Agent create_agent_session Not Awaited
**File:** `apps/backend/agents/companion_agent.py`
**Line:** 278
**Issue:** `client.create_agent_session()` may need to be awaited if the SDK client returns a coroutine. Currently called without await.
**Impact:** Could cause runtime errors if the SDK method is async.
**Recommendation:** Verify if `create_agent_session` is async; add `await` if so.

### SWEEP-33: Memory Leak - taskParsers Map Inconsistent Cleanup
**File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
**Lines:** 35-59
**Issue:** `getTaskParser()` creates parsers lazily, but `cleanupTaskParser()` is only called in one exit path. If process exits differently, parser remains in the map.
**Impact:** Memory accumulation over time with many tasks.
**Recommendation:** Register cleanup in all exit paths.

### SWEEP-34: Missing Null Check in Complexity-Classified Event
**File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
**Lines:** 260-278
**Issue:** `findTaskAndProject()` may return undefined task/project, but code accesses them without null check.
**Impact:** Runtime crash if task/project not found.
**Recommendation:** Add `if (!project || !task) return;` guard.

### SWEEP-35: Stale Closure in TaskMonitorChat handleSendMessage
**File:** `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx`
**Line:** 1151
**Issue:** `handleSendMessage` is memoized with `useCallback` but doesn't include `task` in dependency array. If task status changes, the callback won't reflect the update.
**Impact:** Stale state could allow sending messages when task is no longer running.
**Recommendation:** Add `task` or relevant task properties to the dependency array.

### SWEEP-36: Missing Null-Check in Subtask Comparison
**File:** `apps/frontend/src/renderer/stores/task-store.ts`
**Line:** 202
**Issue:** `taskCardPropsAreEqual` assumes `nextTask.subtasks` exists and has the same length as `prevTask.subtasks`.
**Impact:** Unnecessary re-renders when subtask arrays differ in length.
**Recommendation:** Add length equality check before comparing items.

---

## MINOR Issues (Unfixed - Documented)

### SWEEP-37: Hardcoded Text Without i18n in ChatHistorySidebar
**File:** `apps/frontend/src/renderer/components/ChatHistorySidebar.tsx`
**Lines:** 94, 96, 118, 143, 177-180
**Issue:** Several UI strings ("Today", "Yesterday", "Chat History", "No conversations yet", "Delete conversation?") are hardcoded without translation keys.
**Recommendation:** Replace with i18n keys per CLAUDE.md guidelines.

### SWEEP-38: Missing Error State in SpecDocView
**File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
**Lines:** 40-46
**Issue:** When IPC call fails, content is silently set to null. No user-facing error message.
**Recommendation:** Add error state to show specific failure reason.

### SWEEP-39: SpecDocView Cache Never Invalidated
**File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
**Line:** 27
**Issue:** `cacheRef` never clears cached content. If the spec file changes on disk, stale content is shown until component unmounts.
**Recommendation:** Add a refresh mechanism or cache expiration.

### SWEEP-40: Vite Build Warning - Mixed Import Strategy
**File:** `apps/frontend/src/renderer/stores/insights-task-queue-store.ts`
**Issue:** File is both dynamically and statically imported, causing a Vite build warning about chunk optimization.
**Recommendation:** Standardize to either static or dynamic import.

### SWEEP-41: Large Bundle Size (Observation)
**Issue:** Main bundle 3MB, renderer assets 5.7MB total.
**Recommendation:** Consider code splitting for non-critical features.

---

## Files Scanned

### apps/frontend/src/main (Electron Main Process)
- `ipc-handlers/task/execution-handlers.ts`
- `ipc-handlers/agent-events-handlers.ts`
- `ipc-handlers/insights-handlers.ts`
- `agent/agent-manager.ts` (top-level)
- `agent/agent-process.ts`
- `agent/types.ts`

### apps/frontend/src/renderer (React Frontend)
- `stores/task-store.ts`
- `stores/insights-store.ts`
- `stores/insights-task-queue-store.ts`
- `components/TaskCard.tsx`
- `components/terminal/BottomPanelTerminal.tsx`
- `components/terminal/SpecDocView.tsx`
- `components/terminal/TaskMonitorChat.tsx`
- `components/ActivityFeed.tsx`
- `components/ChatHistorySidebar.tsx`
- `components/Insights.tsx`
- `hooks/useIpc.ts`
- `utils/activity-tracker.ts`

### apps/backend (Python Backend)
- `agents/companion_agent.py`
- `agents/memory_manager.py`
- `agents/session.py`
- `memory/project_memory.py`
- `agents/tools_pkg/tools/memory.py`
- `qa/report.py`
- `spec/pipeline/orchestrator.py`
- `prompts_pkg/ralph_prompt_generator.py`
- `phase_config.py`
- `agents/planner.py`
- `agents/coder.py`
- `runners/companion_runner.py`

---

## Recommendations

### Immediate (CRITICAL - Fixed)
1. ✅ Path traversal vulnerability in TASK_READ_SPEC_FILE handler
2. ✅ Debug print statements corrupting IPC stdout channel

### Short-term (MAJOR)
1. Add file locking to project memory operations
2. Validate inputs in INSIGHTS_CREATE_TASK handler
3. Fix spec number calculation race condition
4. Fix stale closure in TaskMonitorChat
5. Add null checks in agent-events-handlers

### Long-term (MINOR)
1. Add i18n keys for ChatHistorySidebar
2. Add error state to SpecDocView
3. Add cache invalidation to SpecDocView
4. Reduce bundle sizes through code splitting

---

**Sweep completed by:** Claude Code Sweep
**Date:** 2026-02-06
**Next sweep recommended:** After major feature releases
