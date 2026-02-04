# TERM-POLISH: Terminal UI Polish

**Created:** 2026-02-04
**Priority:** LOW
**Tasks:** 2
**Estimated Duration:** ~5-10m

---

## Overview

Optional terminal UX polish tasks. Core functionality already works - these add visual improvements.

---

## Tasks

| # | Task ID | Description |
|---|---------|-------------|
| 1 | TERM-3b | StructuredOutput timeline view component |
| 2 | TERM-4b | Terminal status indicator (green/gray/red dot) |

---

## Ralph Prompt

```bash
/ralph-loop:ralph-loop "
You are completing Phase 7b: Terminal Polish for Jerry.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- You do not get to decide if tasks are worth doing.
- If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\plans\REMAINING_WORK.md
- docs\plans\TERMINAL_REDESIGN.md
- apps\frontend\src\renderer\lib\claude-output-parser.ts (existing parser)
- apps\frontend\src\renderer\components\terminal\TaskMonitorChat.tsx (add toggle here)
- apps\frontend\src\renderer\components\TaskCard.tsx (add status indicator here)

---

TASKS (2 required – ALL MUST COMPLETE)

| # | Task                        | Promise                              |
|---|-----------------------------|--------------------------------------|
| 1 | TERM-3b: StructuredOutput   | TERM_3B_STRUCTURED_OUTPUT_COMPLETE   |
| 2 | TERM-4b: Status indicator   | TERM_4B_STATUS_INDICATOR_COMPLETE    |

FINAL COMPLETION PROMISE:
- <promise>PHASE_7B_TERMINAL_POLISH_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Task 1 (TERM-3b: StructuredOutput Timeline View):
   - Create apps\frontend\src\renderer\components\terminal\StructuredOutput.tsx
   - Display parsed messages as a timeline with step indicators
   - Show tool name, file path, and status for each step
   - Add a raw/structured toggle button to TaskMonitorChat.tsx
   - Use the existing ClaudeOutputParser from claude-output-parser.ts
   - Then output: <promise>TERM_3B_STRUCTURED_OUTPUT_COMPLETE</promise>
   - Say: NEXT: Task 2 and begin Task 2.

2. Task 2 (TERM-4b: Terminal Status Indicator):
   - In TaskCard.tsx, track terminal state (running/idle/error)
   - Add a colored dot indicator next to the terminal button text
   - Green dot = terminal running, Gray dot = idle, Red dot = error
   - Update state based on task.phase (coding/qa_review = running, complete = idle, failed = error)
   - Then output: <promise>TERM_4B_STATUS_INDICATOR_COMPLETE</promise>
   - Say: NEXT: Verify.

3. Verification:
   - Run: npm run build
   - Fix any errors until the build is clean.

4. Final completion:
   - ONLY when both task promises have been emitted AND npm run build succeeds,
   - THEN output: <promise>PHASE_7B_TERMINAL_POLISH_COMPLETE</promise>

---

HARD STOP RULE

- You may NOT stop until <promise>PHASE_7B_TERMINAL_POLISH_COMPLETE</promise> is output.
- If you find yourself writing wrap-up language while tasks remain, STOP and continue working.

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "PHASE_7B_TERMINAL_POLISH_COMPLETE"
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `components/terminal/StructuredOutput.tsx` | CREATE | Timeline view component |
| `components/terminal/TaskMonitorChat.tsx` | MODIFY | Add raw/structured toggle |
| `components/TaskCard.tsx` | MODIFY | Add status indicator dot |

---

## Completion Promises

- `TERM_3B_STRUCTURED_OUTPUT_COMPLETE` - Timeline view created
- `TERM_4B_STATUS_INDICATOR_COMPLETE` - Status dot added
- `PHASE_7B_TERMINAL_POLISH_COMPLETE` - All tasks done, build passes

---

## Related Documents

- [REMAINING_WORK.md](../../plans/REMAINING_WORK.md)
- [TERMINAL_REDESIGN.md](../../plans/TERMINAL_REDESIGN.md)
- [claude-output-parser.ts](../../../apps/frontend/src/renderer/lib/claude-output-parser.ts)
