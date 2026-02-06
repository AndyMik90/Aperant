# FIX_HIGH_LEAKS_SECURITY: Memory Leaks + XSS Fix (AUDIT-05 to AUDIT-10)

**Date:** 2026-02-06
**Tasks:** 6
**Max Iterations:** 60
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (6m 7s) — 6/6 tasks, build passed
**Depends On:** FIX_COMPANION_CRITICAL (recommended but not required)
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing HIGH priority memory leaks and security issues for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 6-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix 6 high-priority issues: event listener memory leaks, stale closures, resize handle leak, missing error boundary, XSS risk from dangerouslySetInnerHTML, and inconsistent parser cleanup.

Read these files before modifying:
- apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx — event listeners, handleSendMessage, dangerouslySetInnerHTML
- apps/frontend/src/renderer/components/insights/ResizeHandle.tsx — mousemove/mouseup listeners
- apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx — tab content area
- apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts — taskParsers map, cleanupTaskParser

---

FIX_HIGH_LEAKS_SECURITY: 6 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Fix event listener leak in TaskMonitorChat | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | FIX - Find useEffect hooks that add IPC listeners. Ensure every listener added has a matching removal in the cleanup return function. Check for listeners on window.electronAPI that accumulate on re-renders. | TASK_1_COMPLETE |
| 2 | Fix stale closure in handleSendMessage | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | FIX - handleSendMessage uses useCallback but may not include task status in dependencies. Add task or relevant task properties to the dependency array so the callback reflects current task state. | TASK_2_COMPLETE |
| 3 | Fix resize handle event leak | apps/frontend/src/renderer/components/insights/ResizeHandle.tsx | FIX - mousemove and mouseup listeners are added to document during drag but should be removed on EVERY mouseup, not just on component unmount. Move removeEventListener calls into the mouseup handler. | TASK_3_COMPLETE |
| 4 | Add error boundary to BottomPanelTerminal | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | ADD - Wrap the tab content area (where SpecDocView, StructuredOutput, TaskMonitorChat render) in a React error boundary. Create a simple ErrorBoundary class component inline or import one if it exists. Fallback should show a message like 'Something went wrong' with a retry button that resets state. | TASK_4_COMPLETE |
| 5 | Fix dangerouslySetInnerHTML XSS risk | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | FIX - Find where dangerouslySetInnerHTML is used for code highlighting. Either: (a) sanitize the HTML with DOMPurify before inserting (if DOMPurify is in dependencies), or (b) use a safe alternative like rendering code blocks with a React-based syntax highlighter, or (c) escape HTML entities before highlighting. Choose the simplest approach that works with existing dependencies. | TASK_5_COMPLETE |
| 6 | Fix taskParsers cleanup in all exit paths | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | FIX - cleanupTaskParser() is only called in one process exit path. Find all places where agent processes can exit (normal exit, error exit, kill, companion exit) and ensure cleanupTaskParser is called in each. | TASK_6_COMPLETE |

FINAL: <promise>FIX_HIGH_LEAKS_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Read code before fixing — verify each issue exists
2. Memory leak fixes must not break existing functionality
3. Error boundary should be minimal — just catch and display fallback
4. XSS fix should use the simplest approach with existing dependencies
5. Do NOT install new npm packages

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS
1. 6-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure component architecture
3. BUILD MUST PASS
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 6 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "FIX_HIGH_LEAKS_COMPLETE"
```
