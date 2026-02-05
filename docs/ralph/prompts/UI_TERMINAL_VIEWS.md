# UI: Terminal Views (RAW + TIMELINE)

**Date:** 2026-02-05
**Tasks:** 2
**Max Iterations:** 100

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing UI Terminal Views for Auto-Claude (Jerry).

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 2-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/
- Reference: docs/ui-reference/RAW_VIEW_REFERENCE.md

---

UI TERMINAL VIEWS (2 tasks)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | RAW view | Match Claude Code terminal: diffs, labels, colors, collapsible | TASK_1_COMPLETE |
| 2 | TIMELINE view | Vertical timeline with icons, action+target, timestamps | TASK_2_COMPLETE |

FINAL: <promise>UI_TERMINAL_VIEWS_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: RAW View Improvements
   Reference: docs/ui-reference/RAW_VIEW_REFERENCE.md

   Features to implement:
   - Tool call labels: Read(path), Update(path), Bash(cmd)
   - Syntax-highlighted code diffs (green adds, red removes)
   - Line numbers in diffs
   - Status bullets with colors
   - Collapsible sections for large outputs (>20 lines)
   - Auto-scroll with pause when user scrolls up
   - Monospace font throughout
   - ANSI color support

2. TASK 2: TIMELINE View
   Simple vertical timeline:
   - Icon per tool type (file, terminal, search, etc.)
   - Action + target on each line (e.g., 'Read src/App.tsx')
   - Brief context underneath (truncated output)
   - Timestamps on the side
   - Expandable for full details
   - Clean, minimal design

3. VERIFICATION:
   - npm run build (from apps/frontend)
   - Visual inspection of both views
   - Test with real agent output

4. FINAL:
   When ALL 2 tasks complete:
   <promise>UI_TERMINAL_VIEWS_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 2-TASK JOB - Do NOT stop until all 2 tasks are complete.
2. REFERENCE DOC - Read docs/ui-reference/RAW_VIEW_REFERENCE.md first
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 100 --completion-promise "UI_TERMINAL_VIEWS_COMPLETE"
```
