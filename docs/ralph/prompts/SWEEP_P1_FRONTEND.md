# SWEEP P1: Major Frontend Fixes

**Date:** 2026-02-05
**Tasks:** 5
**Max Iterations:** 60
**Source:** CODE_SWEEP_REPORT.md
**Status:** ✅ EXECUTED SUCCESSFULLY

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing SWEEP P1: Major Frontend Fixes for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 5-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

Primary documentation:
- docs/CODE_SWEEP_REPORT.md (Full issue details)

---

SWEEP P1: MAJOR FRONTEND FIXES (5 tasks)

| # | Task | File | Issue | Promise |
|---|------|------|-------|---------|
| 1 | Fix filter race condition | issues-store.ts | Reset loading state when filter changes | TASK_1_COMPLETE |
| 2 | Fix parser error handling | terminal-store.ts | Wrap parser.clear() in try/catch | TASK_2_COMPLETE |
| 3 | Fix profile save fallback | settings-store.ts | Add null check for result.data | TASK_3_COMPLETE |
| 4 | Fix MR listener leak | mr-review-store.ts | Capture and store unsubscribe functions | TASK_4_COMPLETE |
| 5 | Fix abort signal check | settings-store.ts | Check signal.aborted before caching | TASK_5_COMPLETE |

FINAL: <promise>SWEEP_P1_FE_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Fix GitHub Issues Filter Race Condition
   - File: apps/frontend/src/renderer/stores/github/issues-store.ts
   - Lines: 169-184
   - Issue: If filter changes during async loadMoreGitHubIssues(), loading spinner stuck
   - Fix: Call setLoadingMore(false) before early return when filter check fails
   - Example:
     ```typescript
     if (currentFilter !== capturedFilter) {
       setLoadingMore(false);  // ADD THIS LINE
       return;
     }
     ```
   - Say: TASK_1_COMPLETE then NEXT: Task 2

2. TASK 2: Fix Terminal Parser Error Handling
   - File: apps/frontend/src/renderer/stores/terminal-store.ts
   - Line: 712
   - Issue: t.parser?.clear() can throw, causing inconsistent state
   - Fix: Wrap in try/catch with error logging
   - Example:
     ```typescript
     try {
       t.parser?.clear();
     } catch (error) {
       console.warn('Parser clear failed:', error);
     }
     ```
   - Say: TASK_2_COMPLETE then NEXT: Task 3

3. TASK 3: Fix Settings Store Profile Save Fallback
   - File: apps/frontend/src/renderer/stores/settings-store.ts
   - Lines: 84-127
   - Issue: Fallback code assumes result.data exists but could be undefined
   - Fix: Add null/undefined check before accessing result.data
   - Example:
     ```typescript
     if (result?.data) {
       // ... push to profiles
     }
     ```
   - Say: TASK_3_COMPLETE then NEXT: Task 4

4. TASK 4: Fix MR Review Store Listener Leak
   - File: apps/frontend/src/renderer/stores/gitlab/mr-review-store.ts
   - Lines: 194-210
   - Issue: Event listeners registered without capturing unsubscribe functions
   - Fix: Store unsubscribe functions and call them on cleanup
   - Example:
     ```typescript
     const unsubscribe = api.on('event', handler);
     // Store unsubscribe for later cleanup
     this.cleanupFunctions.push(unsubscribe);
     ```
   - Say: TASK_4_COMPLETE then NEXT: Task 5

5. TASK 5: Fix Abort Signal Check in Model Discovery
   - File: apps/frontend/src/renderer/stores/settings-store.ts
   - Lines: 255-295 (discoverModels function)
   - Issue: Results cached even if request was aborted
   - Fix: Check signal?.aborted before caching results
   - Example:
     ```typescript
     if (signal?.aborted) {
       return; // Don't cache aborted results
     }
     // ... proceed to cache
     ```
   - Say: TASK_5_COMPLETE

6. VERIFICATION:
   - Run: cd apps/frontend && npm run build
   - Ensure no TypeScript errors

7. FINAL:
   When ALL 5 tasks complete and build passes:
   <promise>SWEEP_P1_FE_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 5-TASK JOB - Do NOT stop until all 5 tasks are complete.
2. TYPESCRIPT - Ensure type safety, no 'any' unless necessary
3. BUILD MUST PASS - Run npm run build before declaring complete
4. CONTINUATION - After each task, say: TASK_N_COMPLETE then NEXT: Task N+1

---

CURRENT STATUS: 0 of 5 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "SWEEP_P1_FE_COMPLETE"
```

---

## Expected Results

| Issue | Before | After |
|-------|--------|-------|
| Filter race | Infinite loading spinner | Loading state reset |
| Parser error | State corruption | Graceful error handling |
| Profile save | Undefined in array | Null check prevents crash |
| MR listeners | Memory leak | Proper cleanup |
| Abort signal | Stale cache | Aborted results discarded |

## Files Modified

1. `apps/frontend/src/renderer/stores/github/issues-store.ts`
2. `apps/frontend/src/renderer/stores/terminal-store.ts`
3. `apps/frontend/src/renderer/stores/settings-store.ts`
4. `apps/frontend/src/renderer/stores/gitlab/mr-review-store.ts`
