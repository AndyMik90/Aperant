# INSIGHTS_TASK_SIDEBAR: Fix Task Disappearing Bug + Add Task Sidebar

**Date:** 2026-02-06
**Tasks:** 6
**Max Iterations:** 60
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (4m 40s)

---

## Problem

Tasks created in chat disappear when navigating away because they only exist in chat state.

## Solution

Tasks should NOT live in chat. When created, they go directly to a persistent sidebar.

```
Chat creates task → Sidebar shows task → Task persists across navigation
```

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing INSIGHTS_TASK_SIDEBAR for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 6-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix bug where chat-created tasks disappear. Add persistent task sidebar to Insights page.

The flow should be:
1. User chats with Jerry
2. Jerry suggests a task with Create Task button
3. User clicks Create Task
4. Task immediately appears in sidebar (right side)
5. Task persists in sidebar even when navigating away
6. Sidebar shows task status (pending/running/complete)
7. User can Start or Delete tasks from sidebar

---

INSIGHTS_TASK_SIDEBAR: 6 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create sidebar store | stores/insights-task-queue-store.ts | NEW - persist to localStorage | TASK_1_COMPLETE |
| 2 | Create TaskQueueCard | components/insights/TaskQueueCard.tsx | NEW - task card for sidebar | TASK_2_COMPLETE |
| 3 | Create TaskQueueSidebar | components/insights/TaskQueueSidebar.tsx | NEW - sidebar component | TASK_3_COMPLETE |
| 4 | Add sidebar to Insights | pages/Insights.tsx or similar | MODIFY - add sidebar layout | TASK_4_COMPLETE |
| 5 | Update task creation | insights-store.ts | MODIFY - add to sidebar on create | TASK_5_COMPLETE |
| 6 | Remove task from chat | Insights.tsx/chat component | MODIFY - dont show task in chat | TASK_6_COMPLETE |

FINAL: <promise>TASK_SIDEBAR_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Sidebar store must persist to localStorage immediately on task add
2. Load from localStorage on mount (survives navigation)
3. Sidebar width: 280px, collapsible to 48px icon strip
4. Task card states: pending (blue), running (green), complete (checkmark), failed (red)
5. Pending tasks show [Start] button and delete icon
6. Running tasks show progress bar and elapsed time
7. Complete tasks show [View] button
8. When Create Task clicked in chat: add to sidebar store, NOT to chat state
9. Chat should only show the Create Task button, not track task afterwards

---

COMPONENT SPECS:

TaskQueueSidebar:
- Header: Task Queue (count badge)
- Collapse toggle button
- List of TaskQueueCard components
- Empty state when no tasks

TaskQueueCard:
- Status indicator (colored dot)
- Task title (2 lines max, truncate)
- Action buttons based on state
- Click to open terminal (if running) or details

---

SIDEBAR STORE SCHEMA:

interface QueuedTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

Store should have:
- tasks: QueuedTask[]
- addTask(task)
- removeTask(id)
- updateTaskStatus(id, status)
- loadFromStorage()
- saveToStorage()

---

VERIFICATION:
- Run: npm run build (must pass)
- Verify sidebar appears in Insights page
- Verify tasks persist after navigation

---

CRITICAL CONSTRAINTS

1. 6-TASK JOB - Do NOT stop until all 6 tasks are complete
2. PERSIST IMMEDIATELY - localStorage on every change
3. NO TASK STATE IN CHAT - Chat only triggers creation
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 6 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "TASK_SIDEBAR_COMPLETE"
```

---

## Expected UI

### Insights Page Layout
```
┌──────────────────────────────────────────────────────────────────┐
│ Insights                                                         │
├────────────────────────────────────────────┬─────────────────────┤
│                                            │                     │
│     Chat with Jerry                        │  Task Queue (2)     │
│                                            │                     │
│  ┌──────────────────────────────────┐      │  ┌───────────────┐  │
│  │ 🤖 I can fix that!               │      │  │ 🔵 Fix login  │  │
│  │                                  │      │  │ [Start] 🗑️    │  │
│  │    ┌──────────────┐              │      │  ├───────────────┤  │
│  │    │ Create Task  │              │      │  │ 🟢 Add auth   │  │
│  │    └──────────────┘              │      │  │ ━━━━━░░░      │  │
│  └──────────────────────────────────┘      │  │ 2m 34s        │  │
│                                            │  └───────────────┘  │
│  ┌──────────────────────────────────┐      │                     │
│  │ Type a message...             ⏎  │      │                     │
│  └──────────────────────────────────┘      │                     │
└────────────────────────────────────────────┴─────────────────────┘
```

## Files Created/Modified

1. `stores/insights-task-queue-store.ts` (NEW)
2. `components/insights/TaskQueueCard.tsx` (NEW)
3. `components/insights/TaskQueueSidebar.tsx` (NEW)
4. `pages/Insights.tsx` (MODIFY)
5. `stores/insights-store.ts` (MODIFY)
6. Chat component (MODIFY)
