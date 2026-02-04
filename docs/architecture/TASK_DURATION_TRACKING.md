# Task Duration Tracking Architecture

**Version:** 1.0
**Created:** 2026-02-04
**Status:** Ready for implementation

---

## Overview

Track AI work time to help users estimate how long tasks will take:
1. **Phase Duration** - Time spent in each AI phase (planning, coding, ai_review)
2. **Total AI Time** - Combined time the AI was actively working

**Note:** Human review time is NOT tracked because:
- Tasks can sit for hours/days waiting for review
- It doesn't help estimate AI work time
- The purpose is showing "how long will the AI take" not "how long did the task exist"

This data enables:
- Real-time progress display during execution
- Historical metrics for future estimation
- Visibility into AI work patterns

---

## Data Model

### implementation_plan.json Updates

Add `timestamps` and `durations` objects (AI phases only):

```json
{
  "id": "task-001",
  "status": "coding",
  "subtasks": [...],

  "timestamps": {
    "created": "2026-02-04T10:00:00.000Z",
    "planning_started": "2026-02-04T10:00:05.000Z",
    "planning_completed": "2026-02-04T10:15:23.000Z",
    "coding_started": "2026-02-04T10:16:00.000Z",
    "coding_completed": null,
    "ai_review_started": null,
    "ai_review_completed": null
  },

  "durations": {
    "planning_ms": 918000,
    "coding_ms": null,
    "ai_review_ms": null,
    "total_ai_ms": null
  }
}
```

**Note:** Human review timestamps are NOT tracked - timer stops when AI work stops.

---

## UI Display

### 1. Task Card (Kanban)

```
┌─────────────────────────────────────────────┐
│  Task: Implement API endpoints              │
│  Status: Coding  ⏱ 5m 32s                   │
│  ████████████░░░░░░░░ 60%                   │
│  Step 3 of 5                                │
└─────────────────────────────────────────────┘
```

**Display Logic:**
- If task is running (has active agent): Show live elapsed time `⏱ Xm Xs`
- If task is waiting (human_review): Show `Waiting for review (15m)`
- If task is done: Show `Completed in 27m`

### 2. Terminal View (TaskMonitorChat)

```
┌─────────────────────────────────────────────────────────────┐
│  [Terminal output...]                                        │
│                                                              │
│  * Edit(src/api/endpoints.ts)                                │
│    L Added 12 lines, removed 3 lines                         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  ⏱ 5m 32s  │  >> 12 files  +234 -89                         │
└─────────────────────────────────────────────────────────────┘
```

**Footer displays:**
- Left: Elapsed time (live updating)
- Right: File change summary

### 3. Task Details/Summary (After Completion)

```
┌─────────────────────────────────────────────────────────────┐
│  Task: Implement API endpoints                               │
│  Status: ✅ Done                                              │
├─────────────────────────────────────────────────────────────┤
│  AI Work Time                                                │
│  ─────────────────────────────────────────────────────────── │
│  Planning      ████████░░░░░░░░  15m 23s  (58%)              │
│  Coding        █████░░░░░░░░░░░   8m 45s  (33%)              │
│  AI Review     ██░░░░░░░░░░░░░░   2m 12s  ( 8%)              │
│  ─────────────────────────────────────────────────────────── │
│  Total AI Time                   26m 20s                     │
└─────────────────────────────────────────────────────────────┘
```

**Note:** Human review time is excluded - this shows only AI work time.

---

## Implementation Details

### Where to Record Timestamps

| Event | File | Location |
|-------|------|----------|
| Task created | `execution-handlers.ts` | TASK_CREATE handler |
| Planning started | `execution-handlers.ts` | TASK_START (when status='planning') |
| Planning completed | `agent-events-handlers.ts` | On `planning_complete` phase event |
| Coding started | `execution-handlers.ts` | TASK_START_BUILD handler |
| Coding completed | `agent-events-handlers.ts` | On `TASK_{ID}_COMPLETE` promise |
| AI Review started | `agent-events-handlers.ts` | On transition to ai_review |
| AI Review completed | `agent-events-handlers.ts` | On transition from ai_review |
| Human Review started | `execution-handlers.ts` | On transition to human_review |
| Human Review completed | `execution-handlers.ts` | TASK_REVIEW handler |
| Done | `execution-handlers.ts` | TASK_REVIEW (approved=true) |

### Helper Functions Needed

```typescript
// apps/frontend/src/main/utils/task-timestamps.ts

interface TaskTimestamps {
  created?: string;
  planning_started?: string;
  planning_completed?: string;
  coding_started?: string;
  coding_completed?: string;
  ai_review_started?: string;
  ai_review_completed?: string;
  human_review_started?: string;
  human_review_completed?: string;
  done?: string;
}

interface TaskDurations {
  planning_ms?: number;
  coding_ms?: number;
  ai_review_ms?: number;
  human_review_ms?: number;
  total_ms?: number;
}

/**
 * Record a timestamp for a task phase
 */
export async function recordTaskTimestamp(
  planPath: string,
  event: keyof TaskTimestamps
): Promise<void>;

/**
 * Calculate durations from timestamps
 */
export function calculateDurations(
  timestamps: TaskTimestamps
): TaskDurations;

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string;
// Examples: "5s", "2m 15s", "1h 30m", "2h 15m 30s"

/**
 * Format duration short form for task card
 */
export function formatDurationShort(ms: number): string;
// Examples: "5s", "2m", "1h 30m"
```

### UI Components Needed

```typescript
// apps/frontend/src/renderer/components/task/TaskDurationDisplay.tsx

interface TaskDurationDisplayProps {
  taskId: string;
  status: TaskStatus;
  timestamps?: TaskTimestamps;
  isRunning: boolean;
}

// Shows:
// - Live elapsed time if running
// - Phase duration if in specific phase
// - Total duration if complete
```

```typescript
// apps/frontend/src/renderer/components/task/TaskDurationBreakdown.tsx

interface TaskDurationBreakdownProps {
  timestamps: TaskTimestamps;
  durations: TaskDurations;
}

// Shows phase breakdown with progress bars
```

---

## IPC Channels

Add new channel for duration updates:

```typescript
// In ipc.ts
TASK_DURATION_UPDATE = 'task:duration-update'

// Payload
interface TaskDurationUpdate {
  taskId: string;
  event: string;
  timestamp: string;
  elapsed_ms?: number;
}
```

---

## Terminal Store Updates

```typescript
// In terminal-store.ts

interface TaskTerminal {
  // ... existing fields
  startTime?: number;      // When this terminal session started
  elapsedMs?: number;      // Current elapsed time (updated by interval)
}

// Add method to start/stop elapsed time tracking
startElapsedTimer(terminalId: string): void;
stopElapsedTimer(terminalId: string): void;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `execution-handlers.ts` | Record timestamps at phase transitions |
| `agent-events-handlers.ts` | Record timestamps on phase events |
| `task-timestamps.ts` | NEW - Helper functions |
| `terminal-store.ts` | Add elapsed time tracking |
| `TaskCard.tsx` | Display duration on card |
| `TaskMonitorChat.tsx` | Display elapsed time in footer |
| `structured-output.ts` | Add timestamp types |
| `ipc.ts` | Add TASK_DURATION_UPDATE channel |

---

## Verification Checklist

After implementation:

- [ ] Timestamps recorded at each phase transition
- [ ] Task card shows live elapsed time while running
- [ ] Task card shows "Completed in Xm" when done
- [ ] Terminal footer shows elapsed time
- [ ] Duration breakdown visible in task details
- [ ] Timestamps persisted to implementation_plan.json
- [ ] Build passes

---

**Document Version:** 1.0
