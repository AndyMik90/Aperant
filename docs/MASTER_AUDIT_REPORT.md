# Master Audit Report — Auto-Claude Frontend + Backend

**Date:** 2026-02-06
**Sources:** UI Audit (Claude deep investigation) + Code Sweep #2 (Ralph Loop)
**Total Unique Issues:** 39
**Fixed:** 2 (by sweep)
**Open:** 37

---

## How This Was Generated

Two independent audits were run in parallel:

1. **UI Audit** — 5 parallel Claude investigation agents scanned: TaskCard, Terminal components, Stores/hooks, Insights/layout, IPC handlers/preload. Found ~32 unique issues.
2. **Code Sweep #2** — Ralph Loop automated sweep across main process, renderer, and backend. Found 15 issues, fixed 2 critical.

This report merges both sources, deduplicates overlapping findings, and assigns a unified priority ranking.

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | Companion chat completely broken |
| HIGH | 10 | Memory leaks, XSS risk, stale closures, missing cleanup |
| MAJOR | 12 | Race conditions, missing validation, null checks |
| MINOR | 12 | UX polish, i18n, loading states, dead code |
| **Total** | **37** | **Open items** |

---

## CRITICAL — Companion Chat is Non-Functional (3 issues)

These 3 issues together mean the companion agent chat feature does not work at all from the UI.

### AUDIT-01: Missing Preload Bridge for TASK_SEND_COMPANION_MESSAGE
- **Source:** UI Audit
- **File:** `apps/frontend/src/preload/api/task-api.ts`
- **Issue:** The IPC handler for `TASK_SEND_COMPANION_MESSAGE` exists in main process, but there's no corresponding preload bridge method. `window.api.sendCompanionMessage()` doesn't exist in the renderer.
- **Impact:** Companion chat input in TaskCard cannot send messages — clicking Send does nothing.
- **Fix:** Add `sendCompanionMessage(taskId, message)` to the preload API bridge.

### AUDIT-02: getCompanionPhase() Type Mismatch
- **Source:** UI Audit
- **File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- **Issue:** `getCompanionPhase(taskId)` receives a `taskId` string but the function expects a `taskStatus` string to determine the phase. It always returns undefined/wrong phase.
- **Impact:** Even if AUDIT-01 is fixed, companion messages fail silently because the phase lookup is broken.
- **Fix:** Pass the task's current status instead of taskId, or look up status from taskId internally.

### AUDIT-03: Race Condition — Auto-Spawn vs Context Deletion
- **Source:** UI Audit + Sweep (related to SWEEP-33)
- **File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- **Issue:** Two competing `setTimeout` calls — one at ~1000ms spawns the companion, another at ~1500ms deletes the execution context. The spawn can win, but then crash because the context it needs was deleted 500ms later.
- **Impact:** Companion agent intermittently crashes on startup between task phases.
- **Fix:** Guard companion spawn against missing context, or clear the deletion timeout when spawning.

---

## HIGH — Memory Leaks, Security, Stale State (10 issues)

### AUDIT-04: Companion State Not Cleaned on Task Deletion
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/stores/task-store.ts`
- **Issue:** `companionActive` Set entries are never removed when a task is deleted. The Set grows unboundedly.
- **Impact:** Memory leak — grows with each task lifecycle.
- **Fix:** Remove taskId from `companionActive` in the task deletion handler.

### AUDIT-05: Event Listener Memory Leak in TaskMonitorChat
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx`
- **Issue:** `useEffect` adds IPC listeners but cleanup function doesn't remove all of them. Listeners accumulate on re-renders.
- **Impact:** Memory leak and duplicate event handling.
- **Fix:** Return proper cleanup functions that call `removeListener` for every added listener.

### AUDIT-06: Stale Closure in handleSendMessage
- **Source:** UI Audit + Sweep (SWEEP-35)
- **File:** `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx`
- **Line:** ~1151
- **Issue:** `handleSendMessage` is memoized with `useCallback` but doesn't include `task` in its dependency array. If task status changes, the callback won't reflect it.
- **Impact:** Can send messages to a task that's no longer running.
- **Fix:** Add `task` or relevant task properties to the dependency array.

### AUDIT-07: Resize Handle Event Leak
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/insights/ResizeHandle.tsx`
- **Issue:** `mouseup`/`mousemove` listeners added to `document` but cleanup only runs on component unmount, not on each mouseup.
- **Impact:** Accumulated event listeners if resize is used repeatedly.
- **Fix:** Remove document listeners in the mouseup handler, not just on unmount.

### AUDIT-08: Missing Error Boundary in BottomPanelTerminal
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx`
- **Issue:** No React error boundary wrapping the tab content area. A crash in SpecDocView or StructuredOutput takes down the entire bottom panel.
- **Impact:** Single component error kills the whole terminal area.
- **Fix:** Wrap content area in an error boundary with fallback UI.

### AUDIT-09: dangerouslySetInnerHTML XSS Risk
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx`
- **Issue:** Code highlighting uses `dangerouslySetInnerHTML` without sanitization. If agent output contains malicious HTML, it gets executed.
- **Impact:** XSS vulnerability — agent output could execute arbitrary scripts in the Electron renderer.
- **Fix:** Sanitize HTML with DOMPurify before inserting, or use a safe rendering approach.

### AUDIT-10: taskParsers Map Inconsistent Cleanup (SWEEP-33)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- **Lines:** 35-59
- **Issue:** `getTaskParser()` creates parsers lazily, but `cleanupTaskParser()` is only called in one exit path.
- **Impact:** Memory accumulation over time with many tasks.
- **Fix:** Register cleanup in all process exit paths.

### AUDIT-11: Index-Based Keys in DurationBreakdown
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/TaskCard.tsx`
- **Issue:** `phases.map((phase, i) => <div key={i}>` — if phases reorder, React reconciliation breaks.
- **Impact:** UI glitches when phase order changes.
- **Fix:** Use `phase.name` or a stable identifier as key.

### AUDIT-12: Null Ref in Companion Badge Render
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/TaskCard.tsx`
- **Issue:** Companion badge renders without null-checking the task status first.
- **Impact:** Potential crash on edge cases with undefined status.
- **Fix:** Add null guard before rendering companion badge.

### AUDIT-13: Missing Null Check in Complexity-Classified Event (SWEEP-34)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- **Lines:** 260-278
- **Issue:** `findTaskAndProject()` may return undefined, but code accesses properties without null check.
- **Impact:** Runtime crash if task/project not found.
- **Fix:** Add `if (!project || !task) return;` guard.

---

## MAJOR — Race Conditions, Missing Validation (12 issues)

### AUDIT-14: Race Condition in Project Memory File Operations (SWEEP-29)
- **Source:** Code Sweep
- **File:** `apps/backend/memory/project_memory.py`
- **Issue:** `append_to_project_memory()` reads, modifies, and writes without file locking.
- **Impact:** Data loss if multiple agents write simultaneously.
- **Fix:** Add file-level locking (platform-appropriate).

### AUDIT-15: Missing Input Validation in INSIGHTS_CREATE_TASK (SWEEP-30)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/main/ipc-handlers/insights-handlers.ts`
- **Issue:** `title` and `description` not validated for length or sanitized. Title creates filesystem directories.
- **Impact:** Filesystem issues with long/special-character paths.
- **Fix:** Add length validation and character sanitization.

### AUDIT-16: Race Condition in Spec Number Calculation (SWEEP-31)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/main/ipc-handlers/insights-handlers.ts`
- **Issue:** Between reading directory and creating spec directory, another process could create same number.
- **Impact:** Duplicate spec IDs under concurrent task creation.
- **Fix:** Use atomic directory creation with retry.

### AUDIT-17: Companion create_agent_session Not Awaited (SWEEP-32)
- **Source:** Code Sweep
- **File:** `apps/backend/agents/companion_agent.py`
- **Issue:** `client.create_agent_session()` may be async but isn't awaited.
- **Impact:** Runtime errors if SDK method is async.
- **Fix:** Verify and add `await` if needed.

### AUDIT-18: Missing Null-Check in Subtask Comparison (SWEEP-36)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/renderer/stores/task-store.ts`
- **Issue:** `taskCardPropsAreEqual` assumes `nextTask.subtasks` exists and has same length.
- **Impact:** Unnecessary re-renders when subtask arrays differ.
- **Fix:** Add length equality check before comparing items.

### AUDIT-19: Race Condition in Terminal Recreation
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/stores/terminal-store.ts`
- **Issue:** Terminal can be recreated while previous one is still disposing.
- **Impact:** Orphaned terminal instances.
- **Fix:** Guard terminal creation against pending disposals.

### AUDIT-20: Unsafe JSON Parsing in Task Store
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/stores/task-store.ts`
- **Issue:** `JSON.parse()` calls without try/catch on IPC data.
- **Impact:** Runtime crash on malformed data.
- **Fix:** Wrap in try/catch with fallback.

### AUDIT-21: Stale Closure in Batch Flushing
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/stores/task-store.ts`
- **Issue:** Batch update timer captures stale state reference.
- **Impact:** Missed updates or stale data being flushed.
- **Fix:** Access state via `get()` inside the timer callback.

### AUDIT-22: Sidebar Min/Max Bounds Bug
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/Insights.tsx`
- **Issue:** Resize handle allows dragging beyond viewport bounds.
- **Impact:** Sidebar can become invisible or cover entire screen.
- **Fix:** Clamp resize values to sensible min/max bounds.

### AUDIT-23: Hardcoded Colors Not Using Theme
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/ActivityFeed.tsx`
- **Issue:** Some colors are hardcoded hex values instead of CSS variables.
- **Impact:** Breaks with theme changes.
- **Fix:** Replace with theme-aware CSS variables.

### AUDIT-24: Inconsistent Error Handling Patterns
- **Source:** UI Audit
- **Files:** Multiple IPC handlers
- **Issue:** Some return `{ error }`, others throw, others return null.
- **Impact:** Inconsistent error handling in renderer.
- **Fix:** Standardize to one pattern across all IPC handlers.

### AUDIT-25: Race Condition in Insights Cancel
- **Source:** UI Audit
- **File:** `apps/frontend/src/main/ipc-handlers/insights-handlers.ts`
- **Issue:** Cancel can fire after generation completes — no guard.
- **Impact:** Trying to cancel a completed operation.
- **Fix:** Check generation state before canceling.

---

## MINOR — UX Polish, i18n, Loading States (12 issues)

### AUDIT-26: Missing ARIA Labels on Tab Buttons
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx`
- **Fix:** Add `aria-label` to Raw/Timeline/Spec/Prompt tab buttons.

### AUDIT-27: Missing Error State in SpecDocView (SWEEP-38)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
- **Fix:** Add error state when IPC call fails.

### AUDIT-28: SpecDocView Cache Never Invalidated (SWEEP-39)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
- **Fix:** Add refresh button or cache expiration.

### AUDIT-29: Missing Loading State in SpecDocView
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
- **Fix:** Show spinner while IPC loads the file.

### AUDIT-30: Copy Button Has No Feedback
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/terminal/SpecDocView.tsx`
- **Fix:** Show "Copied!" confirmation after click.

### AUDIT-31: Hardcoded Text Without i18n (SWEEP-37)
- **Source:** Code Sweep + UI Audit
- **Files:** `ChatHistorySidebar.tsx`, `TaskCard.tsx`
- **Fix:** Replace hardcoded strings with i18n keys.

### AUDIT-32: Dead Code — Disabled Attachments Button
- **Source:** UI Audit
- **File:** `apps/frontend/src/renderer/components/insights/ChatInput.tsx`
- **Fix:** Remove or add TODO with timeline.

### AUDIT-33: Duplicate Timestamp Formatting
- **Source:** UI Audit
- **Files:** TaskMonitorChat, ActivityFeed, TaskCard
- **Fix:** Extract shared formatting utility.

### AUDIT-34: Vite Build Warning — Mixed Import (SWEEP-40)
- **Source:** Code Sweep
- **File:** `apps/frontend/src/renderer/stores/insights-task-queue-store.ts`
- **Fix:** Standardize to static import.

### AUDIT-35: Companion Auto-Spawn Ignores User Preference
- **Source:** UI Audit
- **File:** `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- **Fix:** Add setting to disable companion auto-spawn.

### AUDIT-36: Missing Type Safety on IPC Event Data
- **Source:** UI Audit
- **Files:** Multiple IPC handlers
- **Fix:** Replace `any` types with proper interfaces.

### AUDIT-37: Unused Imports
- **Source:** UI Audit
- **Files:** Multiple components
- **Fix:** Remove unused imports flagged by TypeScript.

---

## Fix Plan — Ralph Loop Batches

### Batch 1: CRITICAL — Companion Chat (4 tasks)
Fix AUDIT-01 through AUDIT-04. Makes companion chat functional.
**Prompt:** [FIX_COMPANION_CRITICAL.md](ralph/prompts/FIX_COMPANION_CRITICAL.md)
**Est. Duration:** 5-8 min

### Batch 2: HIGH — Memory Leaks + Security (6 tasks)
Fix AUDIT-05 through AUDIT-10. Plugs memory leaks and XSS risk.
**Prompt:** [FIX_HIGH_LEAKS_SECURITY.md](ralph/prompts/FIX_HIGH_LEAKS_SECURITY.md)
**Est. Duration:** 8-12 min

### Batch 3: HIGH + MAJOR — Null Checks + Race Conditions (8 tasks)
Fix AUDIT-11 through AUDIT-18. Stability and data integrity.
**Prompt:** [FIX_MAJOR_STABILITY.md](ralph/prompts/FIX_MAJOR_STABILITY.md)
**Est. Duration:** 6-10 min

### Batch 4: MAJOR — Store + Layout Fixes (7 tasks)
Fix AUDIT-19 through AUDIT-25. Race conditions and consistency.
**Prompt:** [FIX_MAJOR_STORES.md](ralph/prompts/FIX_MAJOR_STORES.md)
**Est. Duration:** 6-10 min

### Batch 5: MINOR — Polish (6 tasks)
Fix AUDIT-26 through AUDIT-31. UX improvements.
**Prompt:** [FIX_MINOR_POLISH.md](ralph/prompts/FIX_MINOR_POLISH.md)
**Est. Duration:** 5-8 min

### Batch 6: MINOR — Cleanup (6 tasks)
Fix AUDIT-32 through AUDIT-37. Code quality.
**Prompt:** [FIX_MINOR_CLEANUP.md](ralph/prompts/FIX_MINOR_CLEANUP.md)
**Est. Duration:** 4-6 min

---

## Cross-Reference: Sweep IDs → Audit IDs

| Sweep ID | Audit ID | Status |
|----------|----------|--------|
| SWEEP-27 | — | ✅ Already fixed (path traversal) |
| SWEEP-28 | — | ✅ Already fixed (debug prints) |
| SWEEP-29 | AUDIT-14 | Open |
| SWEEP-30 | AUDIT-15 | Open |
| SWEEP-31 | AUDIT-16 | Open |
| SWEEP-32 | AUDIT-17 | Open |
| SWEEP-33 | AUDIT-10 | Open |
| SWEEP-34 | AUDIT-13 | Open |
| SWEEP-35 | AUDIT-06 | Open |
| SWEEP-36 | AUDIT-18 | Open |
| SWEEP-37 | AUDIT-31 | Open |
| SWEEP-38 | AUDIT-27 | Open |
| SWEEP-39 | AUDIT-28 | Open |
| SWEEP-40 | AUDIT-34 | Open |
| SWEEP-41 | — | Documented (observation) |

---

**Generated:** 2026-02-06
**Next step:** Run Batch 1 (CRITICAL) first — companion chat is broken end-to-end.
