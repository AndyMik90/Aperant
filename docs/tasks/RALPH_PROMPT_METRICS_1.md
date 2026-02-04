# Ralph Prompt: METRICS-1 - Task Duration Tracking

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** MEDIUM

---

## Feature Summary

Add duration tracking to tasks so users can see how long AI work takes and build estimation knowledge over time.

**Key Principle:** Track AI work time only (planning, coding, ai_review). Human review time is NOT tracked because tasks can sit for hours/days waiting.

| # | Task | Description |
|---|------|-------------|
| 1 | METRICS-1A | Add timestamps to implementation_plan.json |
| 2 | METRICS-1B | Display elapsed time on task card |
| 3 | METRICS-1C | Show AI work time breakdown when task completes |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer adding duration tracking to Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\architecture\TASK_DURATION_TRACKING.md (full specification)

KEY PRINCIPLE: Track AI work time only (planning, coding, ai_review). DO NOT track human_review time.

---

## TASKS (3 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | METRICS-1A: Add timestamps to implementation_plan.json | METRICS_1A_TIMESTAMPS_COMPLETE |
| 2 | METRICS-1B: Display elapsed time on task card | METRICS_1B_CARD_DISPLAY_COMPLETE |
| 3 | METRICS-1C: Show AI work time breakdown on completion | METRICS_1C_BREAKDOWN_COMPLETE |

**FINAL:** <promise>METRICS_1_DURATION_TRACKING_COMPLETE</promise>

---

## METRICS-1A: Add Timestamps to implementation_plan.json

Files:
- apps/frontend/src/main/utils/task-timestamps.ts (CREATE)
- apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts
- apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts

Requirements:
1. Create task-timestamps.ts with:
   - TaskTimestamps interface (created, planning_started, planning_completed, coding_started, coding_completed, ai_review_started, ai_review_completed)
   - TaskDurations interface (planning_ms, coding_ms, ai_review_ms, total_ai_ms)
   - recordTaskTimestamp(planPath, event) function
   - calculateDurations(timestamps) function
   - formatDuration(ms) function returning 'Xh Xm Xs' or 'Xm Xs' or 'Xs'

2. Update execution-handlers.ts to record timestamps:
   - TASK_CREATE: record 'created'
   - TASK_START (planning): record 'planning_started'
   - TASK_START_BUILD: record 'coding_started'

3. Update agent-events-handlers.ts to record timestamps:
   - On planning_complete phase: record 'planning_completed'
   - On TASK_COMPLETE promise: record 'coding_completed'
   - On ai_review start: record 'ai_review_started'
   - On ai_review complete: record 'ai_review_completed'

Then output: <promise>METRICS_1A_TIMESTAMPS_COMPLETE</promise>
Say: NEXT: METRICS-1B and begin METRICS-1B

---

## METRICS-1B: Display Elapsed Time on Task Card

Files:
- apps/frontend/src/renderer/components/task/TaskCard.tsx
- apps/frontend/src/shared/types/task.ts (if needed)

Requirements:
1. Add elapsed time display to task card when task is running:
   - Format: clock icon + 'Xm Xs' (e.g., '⏱ 5m 32s')
   - Update every second while agent is active
   - Position: near status badge

2. When task is complete, show total AI time:
   - Format: 'Completed in Xm' or 'AI time: Xm Xs'

3. Calculate elapsed from timestamps.planning_started or timestamps.coding_started

Then output: <promise>METRICS_1B_CARD_DISPLAY_COMPLETE</promise>
Say: NEXT: METRICS-1C and begin METRICS-1C

---

## METRICS-1C: Show AI Work Time Breakdown

Files:
- apps/frontend/src/renderer/components/task/TaskCard.tsx (or create TaskDurationBreakdown.tsx)

Requirements:
1. When task status is 'done', show breakdown in expanded card or tooltip:
   - Planning: Xm Xs (XX%)
   - Coding: Xm Xs (XX%)
   - AI Review: Xm Xs (XX%)
   - Total AI Time: Xm Xs

2. Optional: Show mini progress bars for visual breakdown

3. Read durations from task.durations in implementation_plan.json

Then output: <promise>METRICS_1C_BREAKDOWN_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 3 promises were output
3. Output: <promise>METRICS_1_DURATION_TRACKING_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 3 tasks are REQUIRED - no skipping
2. DO NOT track human_review time - only AI phases
3. After each task, immediately continue to next
4. NO SUMMARIES - progress summaries are NOT stopping points
5. The job is done ONLY when <promise>METRICS_1_DURATION_TRACKING_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>METRICS_1_DURATION_TRACKING_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 100 --completion-promise "METRICS_1_DURATION_TRACKING_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `task-timestamps.ts` | NEW - Helper functions for timestamps and durations |
| `execution-handlers.ts` | Record timestamps at TASK_CREATE, TASK_START, TASK_START_BUILD |
| `agent-events-handlers.ts` | Record timestamps on phase events |
| `TaskCard.tsx` | Display elapsed time and breakdown |

---

## Verification After Run

1. Create a task → check implementation_plan.json has `timestamps.created`
2. Start planning → check `timestamps.planning_started`
3. Complete planning → check `timestamps.planning_completed` and `durations.planning_ms`
4. Task card shows elapsed time while running
5. Completed task shows AI work time breakdown
6. Build passes

---

## Related Documents

- [TASK_DURATION_TRACKING.md](../architecture/TASK_DURATION_TRACKING.md) - Full specification
- [TASK_DURATION_LOG.md](../metrics/TASK_DURATION_LOG.md) - Duration metrics log

---

## Completion Promise

```
METRICS_1_DURATION_TRACKING_COMPLETE
```
