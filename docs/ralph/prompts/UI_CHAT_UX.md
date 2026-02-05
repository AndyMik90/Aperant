# UI: Chat UX Improvements

**Date:** 2026-02-05
**Tasks:** 4
**Max Iterations:** 75

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are completing UI Chat UX Improvements for Auto-Claude (Jerry).

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/

---

UI CHAT UX IMPROVEMENTS (4 tasks)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | Remove helper text | Remove 'Press Enter to send, Shift+Enter for new line' text | TASK_1_COMPLETE |
| 2 | Typing animation | Add animated dots when agent is thinking/running | TASK_2_COMPLETE |
| 3 | Allow typing while running | Enable chat input while agent is executing (like VSCode Claude) | TASK_3_COMPLETE |
| 4 | Fix chat freezing | Investigate and fix chat freezing issues during agent runs | TASK_4_COMPLETE |

FINAL: <promise>UI_CHAT_UX_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. TASK 1: Remove Helper Text
   - Find the chat input component in apps/frontend/
   - Remove or hide the 'Press Enter to send, Shift+Enter for new line' text
   - Keep the input functionality the same

2. TASK 2: Typing Animation
   - Add animated dots (...) or similar indicator when agent is running
   - Show in the chat area or near the input
   - Animation should pulse/cycle to show activity
   - Stop animation when agent completes

3. TASK 3: Allow Typing While Running
   - Currently input may be disabled during agent execution
   - Enable typing so user can queue messages
   - Messages sent while agent running should queue or wait
   - Reference VSCode Claude extension behavior

4. TASK 4: Fix Chat Freezing
   - Investigate why chat UI freezes during agent runs
   - Check for blocking operations on main thread
   - Ensure renderer process stays responsive
   - Add debouncing or virtualization if needed

5. VERIFICATION:
   - npm run build (from apps/frontend)
   - Visual inspection of chat behavior

6. FINAL:
   When ALL 4 tasks complete:
   <promise>UI_CHAT_UX_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all 4 tasks are complete.
2. ELECTRON APP - Changes are in renderer process (React)
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 75 --completion-promise "UI_CHAT_UX_COMPLETE"
```
