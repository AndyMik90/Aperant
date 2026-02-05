# SWEEP P2: Minor Fixes

**Date:** 2026-02-05
**Tasks:** 6
**Max Iterations:** 50
**Source:** CODE_SWEEP_REPORT.md
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing SWEEP P2: Minor Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 6-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

Primary documentation:
- docs/CODE_SWEEP_REPORT.md (Full issue details)

---

SWEEP P2: MINOR FIXES (6 tasks)

| # | Task | File | Issue | Promise |
|---|------|------|-------|---------|
| 1 | Fix double iteration | notification-store.ts | Single-pass filter in clearOlderThan | TASK_1_COMPLETE |
| 2 | Fix markAsRead race | notification-store.ts | Use atomic counter operations | TASK_2_COMPLETE |
| 3 | Fix implicit mutation | file-explorer-store.ts | Use iterative approach in collectVisibleNodes | TASK_3_COMPLETE |
| 4 | Add error wrapper | project-store.ts | Wrap TaskStore calls in try/catch | TASK_4_COMPLETE |
| 5 | Fix OSError handling | git_executable.py | Catch (OSError, ValueError) | TASK_5_COMPLETE |
| 6 | Add CancelledError handling | coder.py | Handle asyncio.CancelledError gracefully | TASK_6_COMPLETE |

FINAL: <promise>SWEEP_P2_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Fix Double Iteration in Notification Store
   - File: apps/frontend/src/renderer/stores/notification-store.ts
   - Lines: 115-129
   - Issue: clearOlderThan() filters notifications twice - inefficient
   - Fix: Single-pass filter with counter tracking removed count
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Fix Concurrent markAsRead Race
   - File: apps/frontend/src/renderer/stores/notification-store.ts
   - Lines: 71-85
   - Issue: Concurrent calls could cause unreadCount to go negative
   - Fix: Ensure atomic update pattern or use Math.max more defensively
   - Say: TASK_2_COMPLETE then NEXT: Task 3

3. TASK 3: Fix File Explorer Implicit Mutation
   - File: apps/frontend/src/renderer/stores/file-explorer-store.ts
   - Lines: 146-165
   - Issue: collectVisibleNodes() mutates outer result array in selector
   - Fix: Use iterative stack-based approach instead of recursive mutation
   - Say: TASK_3_COMPLETE then NEXT: Task 4

4. TASK 4: Add Error Wrapper to Project Store
   - File: apps/frontend/src/renderer/stores/project-store.ts
   - Lines: 369-376
   - Issue: removeProject() calls TaskStore without checking initialization
   - Fix: Wrap TaskStore method calls in try/catch
   - Say: TASK_4_COMPLETE then NEXT: Task 5

5. TASK 5: Fix Python OSError Handling
   - File: apps/backend/core/git_executable.py
   - Lines: 138-139
   - Issue: Catches OSError but not ValueError from os.path.isfile on invalid Windows paths
   - Fix: Change except OSError to except (OSError, ValueError)
   - Say: TASK_5_COMPLETE then NEXT: Task 6

6. TASK 6: Add Python CancelledError Handling
   - File: apps/backend/agents/coder.py
   - Lines: 265-308
   - Issue: Main async loop doesn't handle asyncio.CancelledError for graceful shutdown
   - Fix: Add explicit CancelledError handler that logs and re-raises
   - Example:
     ```python
     except asyncio.CancelledError:
         logger.info('Agent cancelled, shutting down gracefully')
         raise
     ```
   - Say: TASK_6_COMPLETE

7. VERIFICATION:
   - Frontend: cd apps/frontend && npm run build
   - Backend: python -m py_compile apps/backend/core/git_executable.py
   - Backend: python -m py_compile apps/backend/agents/coder.py

8. FINAL: <promise>SWEEP_P2_COMPLETE</promise>

---

CRITICAL CONSTRAINTS
1. 6-TASK JOB - Do NOT stop until all 6 tasks are complete.
2. PRESERVE FUNCTIONALITY - Only optimize, don't change behavior
3. BUILDS MUST PASS
4. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

CURRENT STATUS: 0 of 6 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "SWEEP_P2_COMPLETE"
```

---

## Expected Results

| Issue | Before | After |
|-------|--------|-------|
| Double iteration | Two filter passes | Single pass |
| markAsRead race | Possible negative count | Atomic/defensive |
| Implicit mutation | Recursive mutation | Iterative stack |
| Project store | Unhandled errors | Try/catch wrapper |
| OSError | Missing ValueError | Both caught |
| CancelledError | Unhandled | Graceful shutdown |

## Files Modified

1. `apps/frontend/src/renderer/stores/notification-store.ts`
2. `apps/frontend/src/renderer/stores/file-explorer-store.ts`
3. `apps/frontend/src/renderer/stores/project-store.ts`
4. `apps/backend/core/git_executable.py`
5. `apps/backend/agents/coder.py`
