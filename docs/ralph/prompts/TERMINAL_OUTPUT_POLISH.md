# TERMINAL_OUTPUT_POLISH: Improve Task Terminal Output Visual Quality

**Date:** 2026-02-06
**Tasks:** 5
**Max Iterations:** 60
**Priority:** MEDIUM
**Status:** ✅ EXECUTED SUCCESSFULLY (8m 41s)
**Design Doc:** docs/plans/KANBAN_TERMINAL_TIMELINE.md

---

## Problem

The task terminal raw output view (TaskMonitorChat) doesn't match the visual quality of a Claude Code terminal. Tool blocks need clearer boundaries, thinking blocks need better collapse UX, and the overall layout needs better visual separation between messages.

## Reference

See `docs/ui-reference/RAW_VIEW_REFERENCE.md` and screenshots in `docs/ui-reference/` for target visual style.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing TERMINAL_OUTPUT_POLISH for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 5-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Improve the visual quality of the TaskMonitorChat raw output view to look more like a proper Claude Code terminal. Better tool block styling, thinking block UX, message separation, and overall polish.

Reference the existing docs at docs/ui-reference/RAW_VIEW_REFERENCE.md for the target visual style. The main component is at apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx.

---

TERMINAL_OUTPUT_POLISH: 5 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Improve tool block containers | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - tool use blocks (Read, Edit, Write, Bash, Grep, Glob) should render as card-like containers with a header bar showing the tool name + icon, file path, and a subtle border. Not just colored dots — proper bordered sections with clear start/end boundaries. | TASK_1_COMPLETE |
| 2 | Better thinking block UX | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - thinking blocks should be collapsed by default with a clickable 'Thinking...' header that expands to show content. When collapsed, show a subtle animated indicator. When expanded, show content in a muted/italic style. | TASK_2_COMPLETE |
| 3 | Message boundary separation | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - add clear visual separation between assistant messages. Each assistant turn should have a subtle top border or spacing. Add a small role indicator (assistant icon) at the start of each turn. Tool results should be visually nested under their tool call. | TASK_3_COMPLETE |
| 4 | Improve code block rendering | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - code blocks should have a dark background, language label in the top-right corner, proper monospace font, and a copy button. Ensure syntax highlighting is working correctly. Diff outputs (from Edit tool) should show green/red line highlights clearly. | TASK_4_COMPLETE |
| 5 | Status bar during execution | apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx | MODIFY - add a sticky status indicator at the top or bottom of the output showing current state: what tool is running, elapsed time, and a pulsing dot when active. When idle, show 'Completed' or time taken. | TASK_5_COMPLETE |

FINAL: <promise>TERMINAL_OUTPUT_POLISH_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. All changes are visual/CSS only within TaskMonitorChat — do NOT modify the parser or data flow
2. Keep both raw and structured view modes working
3. Dark theme consistent — use existing design system colors (bg-card, border-border, text-muted-foreground, etc.)
4. Tool block headers: icon + tool name + file path, with the same color coding already in place (Blue=Read, Green=Edit, Purple=Bash, etc.)
5. Thinking blocks: collapsed by default, subtle purple/primary border when expanded
6. Ensure auto-scroll still works correctly after visual changes
7. Keep the existing search, copy, and collapse functionality working

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 5-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT modify ClaudeOutputParser or StructuredOutput — only TaskMonitorChat visual rendering
3. Do NOT break the structured view mode
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 5 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "TERMINAL_OUTPUT_POLISH_COMPLETE"
```
