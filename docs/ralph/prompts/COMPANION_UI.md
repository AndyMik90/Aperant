# COMPANION_UI: TaskCard Indicator + Terminal Companion Mode + Chat Input

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (4m 37s)
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Depends On:** COMPANION_IPC_STATE (run that first)

---

## Problem

The UI has no visual indication when a companion agent is active for a task. Users need to see that the agent is ready, have a chat input to ask questions, and see companion responses styled differently from execution output.

## Goal

Add companion mode visual elements to TaskCard (badge + chat input) and TaskMonitorChat (ready indicator + companion message styling).

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing COMPANION_UI for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Add visual companion mode elements to the task UI. When a companion agent is active (useTaskStore hasCompanion returns true), the TaskCard should show an 'Agent Ready' badge and a chat input. The TaskMonitorChat terminal should show a visual separator and ready indicator when companion mode activates.

Read TaskCard.tsx and TaskMonitorChat.tsx thoroughly before making changes. Use the existing useTaskStore to get companion state.

---

COMPANION_UI: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Add companion badge to TaskCard | apps/frontend/src/renderer/components/TaskCard.tsx | MODIFY - import hasCompanion from useTaskStore. In the task card header area (near the existing status badges), add a conditional badge when hasCompanion(task.id) is true: a Badge with variant='outline', classes 'text-xs border-green-500/50 text-green-400', containing a pulsing green dot (w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse) and text 'Agent Ready'. Place it near the existing complexity badge or status indicators. | TASK_1_COMPLETE |
| 2 | Add chat input to TaskCard | apps/frontend/src/renderer/components/TaskCard.tsx | MODIFY - when hasCompanion(task.id) is true AND the task card is expanded (showing terminal/details), add a chat input section at the bottom. Use a div with border-t border-border p-2, containing a flex row with: (a) an Input component with placeholder 'Ask the agent about this task...', (b) a Send Button (size sm). Add local state for the message text. On Enter key or Send click, call window.api.invoke with IPC_CHANNELS.TASK_SEND_COMPANION_MESSAGE passing taskId and message, then clear the input. Import IPC_CHANNELS from shared. | TASK_2_COMPLETE |
| 3 | Add companion ready indicator to terminal | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - add a companion mode indicator that shows when the companion is active. At the bottom of the message list (or after the last execution output), render a separator div with: border-t-2 border-green-500/30, then a flex row with a pulsing green dot, 'Agent Ready' text in text-green-400 font-medium, and muted subtext 'ask questions about this task'. Get companion state from useTaskStore. This indicator should appear when hasCompanion is true for the current task. | TASK_3_COMPLETE |
| 4 | Style companion messages differently | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - companion agent responses come through the same TERMINAL_OUTPUT channel as execution output. To distinguish them visually, check if the task has an active companion (hasCompanion). When companion is active, new messages should render with: a subtle left border (border-l-2 border-green-500/30), slightly different background (bg-green-500/5), and the role indicator should say 'Companion' instead of 'Assistant'. This can be done by checking the companion state when rendering new message blocks. | TASK_4_COMPLETE |

FINAL: <promise>COMPANION_UI_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Badge uses existing Badge component from the design system (ui/badge)
2. Input uses existing Input component from the design system (ui/input)
3. Button uses existing Button component from the design system (ui/button)
4. Green color scheme for companion elements: green-500 for active indicator, green-400 for text
5. Pulsing dot animation: animate-pulse class on a small rounded div
6. Chat input should clear after sending and refocus
7. Enter key sends message, Shift+Enter for newline is NOT needed (single-line input)
8. Don't break existing TaskCard functionality — companion elements are additive only
9. Don't break existing TaskMonitorChat rendering — companion styling is additive
10. Use dark theme consistent colors (bg-card, border-border, text-muted-foreground)

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure existing TaskCard or TaskMonitorChat layout
3. Do NOT modify any data flow or parsing logic
4. Companion elements should be conditional — only show when hasCompanion is true
5. BUILD MUST PASS
6. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "COMPANION_UI_COMPLETE"
```
