# FIX_MAJOR_STORES: Store + Layout Fixes (AUDIT-19 to AUDIT-25)

**Date:** 2026-02-06
**Tasks:** 7
**Max Iterations:** 70
**Priority:** MAJOR
**Status:** ✅ EXECUTED SUCCESSFULLY (7m 16s) — 7/7 tasks, build passed
**Depends On:** Batches 1-3 (recommended but not required)
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing MAJOR store and layout issues for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 7-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix 7 issues in Zustand stores, layout components, and IPC handlers: race conditions in terminal recreation, unsafe JSON parsing, stale closures in batch flushing, sidebar bounds, hardcoded colors, inconsistent error handling, and insights cancel race.

---

FIX_MAJOR_STORES: 7 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Fix terminal recreation race condition | apps/frontend/src/renderer/stores/terminal-store.ts | FIX - Find where terminals are recreated. Add a guard that prevents creating a new terminal while the previous one is still disposing. Use a disposing flag or check terminal state before recreation. | TASK_1_COMPLETE |
| 2 | Add try/catch to JSON.parse calls | apps/frontend/src/renderer/stores/task-store.ts | FIX - Find all JSON.parse() calls that receive IPC data. Wrap each in try/catch with a console.error and sensible fallback value. | TASK_2_COMPLETE |
| 3 | Fix stale closure in batch flushing | apps/frontend/src/renderer/stores/task-store.ts | FIX - Find the batch update timer that captures state in a closure. Replace the stale reference with get() to access current state inside the timer callback. | TASK_3_COMPLETE |
| 4 | Clamp sidebar resize bounds | apps/frontend/src/renderer/components/Insights.tsx | FIX - Find where resize handle updates sidebar width. Add min/max bounds clamping (min: 200px, max: 50% of viewport or container width). Prevent sidebar from becoming invisible or covering entire screen. | TASK_4_COMPLETE |
| 5 | Replace hardcoded colors with theme variables | apps/frontend/src/renderer/components/ActivityFeed.tsx | FIX - Find hardcoded hex color values. Replace with CSS variable references (e.g., use text-muted-foreground, bg-muted, border-border, etc.) to support theme changes. | TASK_5_COMPLETE |
| 6 | Standardize IPC error handling pattern | apps/frontend/src/main/ipc-handlers/insights-handlers.ts | FIX - Find IPC handlers that return errors inconsistently (some return { error }, others throw, others return null). Standardize to return { success: false, error: string } pattern for all error cases. Only fix handlers in this file. | TASK_6_COMPLETE |
| 7 | Guard insights cancel against completed generation | apps/frontend/src/main/ipc-handlers/insights-handlers.ts | FIX - Find the cancel handler (insights:cancel or similar). Add a check that generation is still in progress before attempting to cancel. If already completed, return success without error. | TASK_7_COMPLETE |

FINAL: <promise>FIX_MAJOR_STORES_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Read each file before modifying
2. Zustand store fixes must use get() for current state access
3. Sidebar clamp values should be reasonable defaults
4. Theme colors: use Tailwind classes like text-foreground, bg-card, border-border
5. Error handling standardization only in insights-handlers.ts (don't change other files)

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS
1. 7-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure store architecture
3. BUILD MUST PASS
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 7 tasks complete. BEGIN NOW.
" --max-iterations 70 --completion-promise "FIX_MAJOR_STORES_COMPLETE"
```
