# UI: Layout Fixes

**Date:** 2026-02-05
**Tasks:** 2
**Max Iterations:** 50

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing UI Layout Fixes for Auto-Claude (Jerry).

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 2-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/

---

UI LAYOUT FIXES (2 tasks)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | Bottom panel resize | Pages should shrink/resize when bottom panel opens, not overlap | TASK_1_COMPLETE |
| 2 | Task suggestions persist | Fix suggested tasks disappearing when navigating away from chat | TASK_2_COMPLETE |

FINAL: <promise>UI_LAYOUT_FIXES_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Bottom Panel Resize
   - Find the bottom panel / terminal component
   - When bottom panel opens, main content should shrink
   - Currently terminal overlaps page content
   - Use CSS flexbox or grid to handle resize
   - Content should be fully visible above the panel

2. TASK 2: Task Suggestions Persist
   - Find where suggested tasks are stored/displayed
   - Currently only last suggestion remains when navigating away
   - Persist suggestions in state or store
   - Restore suggestions when returning to chat view

3. VERIFICATION:
   - npm run build (from apps/frontend)
   - Test bottom panel open/close
   - Test navigating away and back to chat

4. FINAL:
   When ALL 2 tasks complete:
   <promise>UI_LAYOUT_FIXES_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 2-TASK JOB - Do NOT stop until all 2 tasks are complete.
2. CSS LAYOUT - Use flexbox/grid, avoid fixed positioning hacks
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "UI_LAYOUT_FIXES_COMPLETE"
```
