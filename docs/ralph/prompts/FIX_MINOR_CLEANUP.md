# FIX_MINOR_CLEANUP: Code Cleanup + Quality (AUDIT-32 to AUDIT-37)

**Date:** 2026-02-06
**Tasks:** 6
**Max Iterations:** 60
**Priority:** MINOR
**Status:** ✅ EXECUTED SUCCESSFULLY (11m 13s) — 6/6 tasks, build passed, Vite warning eliminated
**Depends On:** Batches 1-5 (recommended)
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing MINOR code cleanup and quality issues for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 6-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix 6 code quality issues: dead code removal, duplicate utility extraction, Vite build warning, companion auto-spawn preference, IPC type safety, and unused import cleanup.

---

FIX_MINOR_CLEANUP: 6 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Remove or annotate dead attachments code | apps/frontend/src/renderer/components/insights/ChatInput.tsx | FIX - Find the permanently disabled attachments button. Either remove it entirely with its associated state/handlers, or add a clear TODO comment with context about when it should be enabled. Prefer removal if there's no near-term plan. | TASK_1_COMPLETE |
| 2 | Extract shared timestamp formatting | apps/frontend/src/renderer/utils/format-time.ts | CREATE or MODIFY - Find duplicate timestamp formatting logic in TaskMonitorChat, ActivityFeed, and TaskCard. If a format-time utility already exists, consolidate duplicate formatting into it. If not, create a small utility with the shared formatting functions and update the 3 components to import from it. | TASK_2_COMPLETE |
| 3 | Fix Vite mixed import warning | apps/frontend/src/renderer/stores/insights-task-queue-store.ts | FIX - This file is both dynamically and statically imported, causing a Vite build warning. Standardize to static import everywhere. Find the dynamic import and convert to static import. | TASK_3_COMPLETE |
| 4 | Add companion auto-spawn setting | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | FIX - Find where companion auto-spawn is triggered (the setTimeout that calls spawnCompanion). Add a check for a setting or environment variable that can disable auto-spawn. Default to enabled. Use a simple check like process.env.DISABLE_COMPANION_AUTOSPAWN or read from the app's settings store if accessible from main process. | TASK_4_COMPLETE |
| 5 | Add type safety to IPC event data | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | FIX - Find IPC event handlers where event data is typed as 'any'. Add proper TypeScript interfaces for the event data. Focus on the most commonly used handlers: companion events, complexity-classified, task status updates. Do NOT change every handler — just the ones in this file. | TASK_5_COMPLETE |
| 6 | Remove unused imports | apps/frontend/src/renderer/components/TaskCard.tsx, apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | FIX - Check for unused imports flagged by TypeScript. Remove any imports that are not used. Run build to verify nothing breaks. Only remove imports that are genuinely unused — do not remove type imports that may be used in type annotations. | TASK_6_COMPLETE |

FINAL: <promise>FIX_MINOR_CLEANUP_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Timestamp utility should be minimal — only extract what's genuinely duplicated
2. Vite warning fix should not change runtime behavior
3. Companion setting should default to auto-spawn ENABLED (existing behavior)
4. Type safety improvements should not require runtime changes
5. Unused import removal should be conservative — verify before removing

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors
- Vite warning about mixed imports should be gone (task 3)

---

CRITICAL CONSTRAINTS
1. 6-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT install new npm packages
3. BUILD MUST PASS
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 6 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "FIX_MINOR_CLEANUP_COMPLETE"
```
