# CHAT_RESIZABLE_SIDEBARS: Drag-to-Resize Sidebars for Insights Page

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** MEDIUM
**Status:** ✅ EXECUTED SUCCESSFULLY (5m 17s)
**Design Doc:** docs/plans/CHAT_OVERHAUL.md
**Depends On:** CHAT_UI_ALIGNMENT (run that first)

---

## Problem

The Chat History sidebar (256px) and Task Queue sidebar (280px) are fixed-width. Users cannot resize them to see more content or reclaim space for the main chat area.

## Solution

Add draggable resize handles between panels. Save widths to localStorage.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing CHAT_RESIZABLE_SIDEBARS for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Make both sidebars on the Insights page (Chat History on the left, Task Queue on the right) resizable by dragging. Persist widths to localStorage so they survive page navigation.

---

CHAT_RESIZABLE_SIDEBARS: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create ResizeHandle component | apps/frontend/src/renderer/components/insights/ResizeHandle.tsx | NEW FILE - a vertical drag handle component that sits between panels. On mousedown, tracks mousemove to calculate new width. Accepts onResize callback with new pixel width. Shows col-resize cursor on hover, subtle highlight during drag. | TASK_1_COMPLETE |
| 2 | Make Chat History resizable | apps/frontend/src/renderer/components/Insights.tsx | MODIFY - replace fixed w-64 on ChatHistorySidebar with dynamic width from state. Add ResizeHandle between Chat History and Main Chat panels. Min 200px, max 400px, default 256px. Dragging below min collapses the sidebar. | TASK_2_COMPLETE |
| 3 | Make Task Queue resizable | apps/frontend/src/renderer/components/Insights.tsx | MODIFY - replace fixed w-[280px] on TaskQueueSidebar with dynamic width from state. Add ResizeHandle between Main Chat and Task Queue panels. Min 200px, max 450px, default 280px. Dragging below min collapses to 48px icon strip. | TASK_3_COMPLETE |
| 4 | Persist sidebar widths | apps/frontend/src/renderer/components/Insights.tsx | MODIFY - save both sidebar widths to localStorage on resize (key: 'insights-sidebar-widths'). Load saved widths on component mount. Fall back to defaults if no saved widths. | TASK_4_COMPLETE |

FINAL: <promise>CHAT_RESIZABLE_SIDEBARS_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. ResizeHandle should be 4px wide, full height of the panel area
2. On hover: cursor col-resize, background changes to a subtle primary/border color
3. During drag: same visual, prevent text selection on the page
4. Width changes should use React state and inline style (not Tailwind classes) for smooth dragging
5. ChatHistorySidebar and TaskQueueSidebar need to accept a style or width prop instead of using fixed Tailwind width classes
6. localStorage key: 'insights-sidebar-widths', value: JSON { left: number, right: number }
7. No external resize libraries — use mousedown/mousemove/mouseup event handlers
8. The main chat area (center panel) should be flex-1 and fill remaining space automatically

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Both sidebars should be draggable to resize
- Widths should persist after navigating away and back
- Dragging below minimum should collapse the sidebar
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT break existing sidebar collapse/expand functionality
3. Do NOT use any external drag/resize libraries
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "CHAT_RESIZABLE_SIDEBARS_COMPLETE"
```
