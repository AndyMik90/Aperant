# Task Lifecycle UX Improvement Plan

**Date:** February 10, 2026
**Status:** Ready to Build
**Scope:** Task card buttons, status transitions, review flow, app restart state
**Decision:** Option B (visual indicator on planning card, no new Kanban column)

---

## Context

After running three planning tasks to completion (spec sheets and prompts created for all three), several UX issues became apparent:

1. **Resume button has no clear purpose** when planning is already finished
2. **Task statuses are inconsistent** — two tasks show "Coding" and one shows "Planning" even though all three have completed specs
3. **"Start Build" is too easy to accidentally click** from the task card without reviewing the spec/prompt first
4. **App restart corrupts task state** — after closing and relaunching, all tasks show "Stop" buttons, agents don't spin up, and status indicators disappear

---

## Current Architecture

### Task Status Model (Two Tracks)

The system tracks two separate status dimensions:

| Dimension | Type | Values | Purpose |
|-----------|------|--------|---------|
| **TaskStatus** | Lifecycle stage | `planning`, `coding`, `ai_review`, `human_review`, `pr_created`, `done` | Broad phase in the task lifecycle |
| **ExecutionPhase** | Real-time progress | `idle`, `starting`, `planning`, `coding`, `qa_review`, `qa_fixing`, `complete`, `failed` | What the agent is doing right now |
| **ReviewReason** | Sub-status detail | `completed`, `errors`, `qa_rejected`, `plan_review` | Why task is in `human_review` |

### Current Button Logic (TaskCard.tsx)

```
Task in 'planning' status:
  ├─ Agent running (isAgentStopped=false) → [Stop] button
  └─ Agent stopped (isAgentStopped=true)  → [Resume] + [Start Build] buttons

Task in 'coding' status:
  ├─ Agent running (isRunning=true)       → [Stop] button
  └─ Agent stopped                        → [Resume] button

Task in 'human_review' with incomplete subtasks → [Resume] button
Task stuck (no process, status says running)    → [Recover] button
```

### Key Stores

| Store | State | Notes |
|-------|-------|-------|
| `task-store.ts` | `stoppedAgents: Set<string>` | Tracks which tasks have been explicitly stopped. **NOT persisted** between app sessions. |
| `task-store.ts` | `tasks[].status` | The TaskStatus value |
| `task-store.ts` | `tasks[].executionProgress` | Phase, progress %, current subtask |
| `task-store.ts` | `tasks[].reviewReason` | Why task needs human review |

---

## Issue 1: Resume Button Has No Clear Purpose After Planning Completes

### Current Behavior

When planning finishes (spec and prompt created), the planning agent stops. `isAgentStopped` becomes `true`, and the task card shows:

```
[Resume]  [Start Build]
```

- **Resume** calls `startTask()` which restarts the planning agent from scratch
- **Start Build** calls `startBuild()` which transitions to coding

### Problem

"Resume" implies the agent was interrupted and needs to continue. But if planning is *done* (spec exists, prompt exists), what would resuming planning do? It would re-run the planning agent unnecessarily, potentially overwriting the existing spec.

The user has no way to review the spec/prompt quality before deciding to start build or send back for replanning.

### Proposed Solution

Replace the two-button layout with a single **"Review"** button on the task card. Clicking "Review" opens the task detail modal where the user can:

1. **Read the spec sheet** and prompt
2. **Approve and Start Build** — transitions to coding (current Start Build behavior)
3. **Add Notes and Replan** — sends back to planning with user feedback (similar to how `human_review` tasks can be sent back with notes)

For tasks where the planning agent was manually stopped mid-planning (spec is NOT complete), keep the current **Resume** button since the agent genuinely needs to continue.

### Detection Logic

How to distinguish "planning complete" from "planning interrupted":

```
Planning Complete (ALL must be true):
  - spec.md exists in task spec directory
  - ralph_prompt.md (or RALPH_PROMPT.md) exists in task spec directory
  - implementation_plan.json has planStatus = "review"
  - task has subtasks created

Planning Interrupted (any of):
  - spec.md does NOT exist
  - ralph_prompt.md does NOT exist (spec created but prompt wasn't generated yet)
  - planStatus != "review"
  - Agent was manually stopped mid-work
```

**Important:** The ralph prompt file has a case mismatch in the codebase:
- `planning_agent.py` → `_generate_ralph_prompt_file()` → `generator.save_prompt()` → defaults to `RALPH_PROMPT.md` (uppercase)
- `orchestrator.py` → explicitly writes `ralph_prompt.md` (lowercase)
- Frontend reads `ralph_prompt.md` (lowercase) via `SpecDocView`
- On macOS (case-insensitive FS) this works, but detection should check both casings for robustness

### Proposed Button States for Planning Tasks

```
Planning agent running                      → [Stop]
Planning interrupted (no spec OR no prompt) → [Resume]
Planning complete (has spec AND prompt)     → [Review]
```

### Files to Modify

- `TaskCard.tsx` — Change button rendering in the `isPlanning` branch
- `task-store.ts` — Add helper function `isPlanningComplete(task)` to check spec/plan status
- Need IPC call to check if both `spec.md` and `ralph_prompt.md` exist (or cache in task metadata)
- Consider normalizing ralph prompt filename to lowercase across the codebase

---

## Issue 2: Status Inconsistency (Coding vs Planning When All Have Specs)

### Current Behavior

Three tasks all have completed spec sheets and prompts, but:
- Two show status = "Coding" (blue badge)
- One shows status = "Planning" (amber badge)

### Root Cause Analysis

The status transition happens in multiple places:

1. **Backend (Python):** When the planning agent finishes, it writes `planStatus: "review"` to `implementation_plan.json`
2. **Frontend (project-store.ts):** On task load, reads the plan file and determines status. If `planStatus === "review"` and `spec.md` exists, it sets `status = 'human_review'` with `reviewReason = 'plan_review'`
3. **Timing Issue:** If the frontend loads tasks before the backend finishes writing the plan file, or if the file watcher misses the change, the status doesn't update correctly

The "Coding" status showing on two tasks likely means `startBuild()` was called at some point (either accidentally, or by the auto-restart logic on app restart), which transitions `status` from `planning` → `coding`.

### The Missing "Waiting Review" Status

The system already has this concept: `human_review` with `reviewReason = 'plan_review'`. However:

1. It's not clearly surfaced in the UI. The card shows "Needs Review" (generic) rather than "Spec Ready for Review"
2. The transition from `planning` → `human_review` doesn't happen reliably when planning completes
3. There's no dedicated Kanban column for "waiting review" in the planning phase

### Proposed Solution

**Option A: New Kanban Column — "Ready for Review"**

Add a new column between Planning and Coding that holds tasks waiting for user review of their spec/prompt. This makes the state visible at a glance.

```
Columns:  [Planning]  →  [Ready for Review]  →  [Coding]  →  [Done]
```

Tasks auto-move to "Ready for Review" when:
- spec.md exists
- implementation_plan.json has planStatus = "review"
- Agent has stopped (not actively planning)

**Option B: Visual Indicator on Planning Card (Lighter Touch)**

Keep the current columns but add a clear visual indicator:

```
Planning Card (agent running):
  Status badge: "Planning" (amber, spinning)

Planning Card (spec complete):
  Status badge: "Spec Ready" (green) or "Awaiting Review" (purple)
  Button: [Review]
```

**Decision: Option B.** No new Kanban column — keep it lightweight with a clear visual indicator on the planning card. Option A (new column) can be revisited later if needed.

### Ensuring Reliable Status Transition

Regardless of which option we choose, the transition from "planning in progress" to "spec ready" needs to be reliable:

1. **Backend should emit a phase transition event** when planning completes (not just write to a file)
2. **Frontend should watch for `planStatus` changes** in the task file watcher
3. **On task load, always re-derive status** from the plan file, not just trust the cached `task.status`

### Files to Modify

- `TaskCard.tsx` — Update status badge logic for planning-complete state
- `task-store.ts` — Add `isPlanningComplete()` helper, reliable status derivation
- `project-store.ts` — Ensure `planStatus: "review"` detection works on load
- `phase-protocol.ts` — Potentially add a new visual phase for "spec_ready" or "awaiting_review"

---

## Issue 3: Replace "Start Build" with "Review" Flow

### Current Behavior

On the task card itself:
```
[Resume]  [Start Build]
```

Clicking "Start Build" immediately transitions the task to coding. There's no confirmation, no review of the spec, no opportunity for feedback.

### Proposed Flow

**On the Task Card:**
```
[Review]
```

**Inside the Task Detail Modal (after clicking Review):**

```
┌─────────────────────────────────────────────┐
│  Task: Implement User Authentication        │
│                                             │
│  [Spec]  [Prompt]  [Subtasks]  [Notes]     │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Spec Content Preview               │    │
│  │  ...                                │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Actions ────────────────────────────┐   │
│  │                                      │   │
│  │  Notes for replanning:               │   │
│  │  [________________________]          │   │
│  │                                      │   │
│  │  [Send Back to Planning]             │   │
│  │  [Start Build]                       │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Implementation Details

The task detail modal already has tabs for Spec, Prompt, and a review section (`TaskReview.tsx`). The key changes are:

1. **Task Card:** Replace "Resume + Start Build" with single "Review" button that opens the modal
2. **Task Detail Modal:** When task is in planning-complete state, show a review panel with:
   - Spec preview (already exists in tabs)
   - Notes textarea for feedback
   - "Send Back to Planning" button — restarts planning with user notes attached
   - "Approve & Start Build" button — calls existing `startBuild()`
3. **"Send Back to Planning"** handler needs to:
   - Store the user's notes (append to task metadata or spec feedback field)
   - Restart the planning agent with the notes as additional context
   - Keep task in `planning` status

### Relationship to Existing Review Flow

The `human_review` status already has a review flow in `TaskReview.tsx` with:
- Merge/Discard/PR/Restart buttons
- Reject with feedback
- Restart from planning

We can **reuse this pattern** for the planning-complete review, but with different actions:
- Instead of Merge/Discard → Approve Build / Send Back to Planning
- The feedback mechanism is the same (notes textarea)

### Files to Modify

- `TaskCard.tsx` — Replace "Resume + Start Build" with "Review" button
- `TaskDetailModal.tsx` — Add planning-review panel when in planning-complete state
- `task-store.ts` — Add `restartPlanningWithNotes(taskId, notes)` function
- Possibly a new component: `PlanningReview.tsx` (or extend `TaskReview.tsx`)

---

## Issue 4: App Restart State Corruption

### Symptoms

After closing and relaunching the app:
1. All tasks show "Stop" button (as if agents are running)
2. Tasks that had completed planning now show incorrect status
3. Planning/coding spinning status indicators are gone
4. Agents don't actually spin up despite the UI suggesting they're running

### Root Cause

The `stoppedAgents: Set<string>` in `task-store.ts` is **not persisted between app sessions**. It initializes as an empty Set on every launch:

```typescript
// task-store.ts line 190
stoppedAgents: new Set<string>(),
```

**Cascade of effects on restart:**

1. App starts → `stoppedAgents` is empty → every task has `isAgentStopped = false`
2. All planning/coding tasks render "Stop" button (because they appear to be "running")
3. After 2 seconds, `App.tsx` checks if coding task processes are actually running
4. For coding tasks: `checkTaskRunning()` returns false → `setAgentStopped(id, true)` → Button corrects to "Resume" (2s delay)
5. **For planning tasks:** Not checked at all in App.tsx! Planning tasks stay showing "Stop" forever
6. Meanwhile, `recreateTaskMonitorTerminals()` auto-restarts planning agents via `recoverStuckTask()` but never updates `isAgentStopped` in the frontend
7. Result: UI shows "Stop" but there's no spinner, no status indicator, and the agent may or may not actually be running in the background

### Proposed Fix

**Fix A: Derive `isAgentStopped` from process state on startup (not from memory)**

Instead of persisting the Set, derive it from reality on each startup:

```
On app start, for each task:
  1. Check if process is actually running via checkTaskRunning()
  2. If running → isAgentStopped = false, show "Stop" button, show spinner
  3. If NOT running → isAgentStopped = true, show appropriate button (Resume/Review/Start Build)
```

This handles both planning and coding tasks uniformly.

**Fix B: Add planning tasks to the App.tsx restart check**

Currently only coding tasks are checked:

```typescript
// Current (App.tsx line 459-465):
for (const task of currentTasks) {
  if (task.status === 'coding') {  // ← Only coding!
    window.electronAPI.checkTaskRunning(task.id).then(...)
  }
}
```

Add planning tasks:

```typescript
// Proposed:
for (const task of currentTasks) {
  if (task.status === 'coding' || task.status === 'planning') {
    window.electronAPI.checkTaskRunning(task.id).then(result => {
      if (result.success && result.data === false) {
        taskStore.setAgentStopped(task.id, true);
      }
    }).catch(() => {});
  }
}
```

**Fix C: Show loading state during the 2-second check period**

The 2-second debounce before checking process status leaves the UI in a wrong state. Add a "checking" state:

```
App starts → All active tasks show a subtle loading indicator (not Stop/Resume)
2 seconds → Process checks complete → Show correct buttons
```

This could be a simple `isCheckingProcesses` flag in the task store that's `true` during startup and `false` after the checks complete.

**Fix D: Prevent `recreateTaskMonitorTerminals()` from auto-restarting planning agents without updating UI**

When planning agents are auto-restarted, the frontend needs to know:

```typescript
// In recreateTaskMonitorTerminals(), after restarting:
taskStore.setAgentStopped(task.id, false);  // Agent is now running
```

### Recommended Implementation Order

1. **Fix B** (5 min) — Add planning tasks to the restart check. Immediate improvement.
2. **Fix D** (10 min) — Update isAgentStopped when auto-restarting planning agents.
3. **Fix C** (30 min) — Add loading state during process check period.
4. **Fix A** (optional) — Full derivation from process state, supersedes B if done.

### Files to Modify

- `App.tsx` — Add planning tasks to process check loop (Fix B), add loading state (Fix C)
- `terminal-store.ts` — Update `isAgentStopped` after auto-restarting planning agents (Fix D)
- `task-store.ts` — Add `isCheckingProcesses` flag for loading state (Fix C)
- `TaskCard.tsx` — Show loading indicator during process check period (Fix C)

---

## Combined Implementation Plan

### Phase 1: Fix App Restart (Critical Bug)

**Priority: Highest** — This is a bug that breaks the app on every restart.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 1.1 | Add planning tasks to App.tsx process check (alongside coding tasks) | `App.tsx` | 5 min |
| 1.2 | Update `isAgentStopped` after auto-restart in `recreateTaskMonitorTerminals` | `terminal-store.ts` | 10 min |
| 1.3 | Don't auto-restart planning agents when planning is complete (spec + prompt exist) | `execution-handlers.ts` | 15 min |
| 1.4 | Add loading state during 2s process check period so buttons don't flash wrong state | `task-store.ts`, `TaskCard.tsx`, `App.tsx` | 30 min |

### Phase 2: Planning-Complete Detection

**Priority: High** — Needed for Phase 3.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 2.1 | Add IPC call `checkPlanningComplete(taskId)` that checks for BOTH `spec.md` AND `ralph_prompt.md` (case-insensitive) | `execution-handlers.ts`, `ipc.ts`, `preload.ts` | 30 min |
| 2.2 | Add `planningComplete` flag to task metadata, cached on load and updated by file watcher | `project-store.ts`, `task-store.ts` | 1 hr |
| 2.3 | Update status badge to show "Spec Ready" / "Awaiting Review" when planning complete | `TaskCard.tsx` | 30 min |
| 2.4 | Normalize ralph prompt filename to `ralph_prompt.md` (lowercase) across planning_agent.py and ralph_prompt_generator.py | `planning_agent.py`, `ralph_prompt_generator.py` | 15 min |

### Phase 3: Replace Buttons with Review Flow

**Priority: High** — Core UX improvement.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 3.1 | Replace "Resume + Start Build" with "Review" on task card | `TaskCard.tsx` | 30 min |
| 3.2 | Add planning review panel to TaskDetailModal | `TaskDetailModal.tsx`, new `PlanningReview.tsx` | 2-3 hrs |
| 3.3 | Implement "Send Back to Planning with Notes" | `task-store.ts`, backend handler | 1-2 hrs |
| 3.4 | Keep "Resume" for interrupted planning (no spec) | `TaskCard.tsx` | 15 min |

### Phase 4: Status Consistency

**Priority: Medium** — Visual polish once the flow is correct.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 4.1 | Add "Awaiting Review" / "Spec Ready" status badge variant | `TaskCard.tsx`, `phase-protocol.ts` | 30 min |
| 4.2 | Ensure status transition reliability on planning complete | `project-store.ts`, file watcher | 1-2 hrs |
| 4.3 | (Future) Consider "Ready for Review" Kanban column | Multiple files | 4+ hrs |

### Total Estimated Effort: 8-12 hours

---

## All Decisions (Finalized)

1. **Option B selected for status display** — Visual indicator on planning card, no new Kanban column.
2. **Detection requires BOTH spec.md AND ralph_prompt.md** — A spec without a prompt means planning was interrupted mid-way.
3. **Resume stays for coding tasks** — Coding can genuinely be interrupted and needs resuming. Only planning-complete tasks get the Review treatment.
4. **"Review" reuses the existing TaskDetailModal** — Already has Spec/Prompt tabs. Add a planning review action panel (approve build / send back with notes) when task is in planning-complete state.
5. **Planning-complete tasks do NOT auto-restart on app restart** — "How the app closes is how it should reopen." Completed planning sits in review. Interrupted planning (no spec) auto-restarts. Coding does not auto-restart (manual resume).
6. **Planning-complete notification uses the existing dual notification system** — Radix UI toast (transient) + Zustand notification store (persistent bell icon). A "Spec Ready" notification already partially exists in `useIpc.ts` lines 363-387. Integrate detection of both `spec.md` + `ralph_prompt.md` into that trigger. Respects the existing `onReviewNeeded` notification setting toggle.
7. **Global "Resume All" banner on restart for interrupted coding tasks** — See Issue 5 below.

---

## Issue 5: Global Resume Banner on App Restart

### Problem

After app restart, coding tasks that were running are now stopped. The user must click "Resume" on each one individually. With 5-10 tasks, this is tedious.

### Proposed Solution

Show a **contextual banner** at the top of the Kanban board when interrupted coding tasks are detected on startup:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ 3 coding tasks were interrupted when the app closed.      │
│   [Resume All]  [Dismiss]                                    │
└──────────────────────────────────────────────────────────────┘
```

### Filtering Logic

The banner only counts and resumes tasks matching ALL of:
- `status === 'coding'`
- `isAgentStopped === true` (process not running)

It explicitly EXCLUDES:
- Planning tasks (any state) — handled by auto-restart or review flow
- `human_review` tasks — waiting for user review, not interrupted
- Tasks already running — no action needed
- Planning-complete tasks — waiting for user to review spec

### Behavior

- **Appears:** After the 2-second process check completes, IF interrupted coding tasks exist
- **"Resume All":** Calls `startTask(taskId)` for each qualifying task. Banner disappears.
- **"Dismiss":** Banner disappears. Tasks stay stopped with individual "Resume" buttons.
- **Auto-dismiss:** If user manually resumes all tasks before clicking the banner, it disappears.

### Implementation

- **State:** Add `interruptedCodingTaskIds: string[]` to task store, populated after App.tsx process check completes
- **UI:** Render banner in `KanbanBoard.tsx` above the columns (or in `TasksHub.tsx` below the tabs)
- **Handler:** Loop through `interruptedCodingTaskIds` calling `startTask()` for each
- **Cleanup:** Clear `interruptedCodingTaskIds` when banner is dismissed or all tasks are resumed

### Files to Modify

- `task-store.ts` — Add `interruptedCodingTaskIds` state and `resumeAllInterrupted()` action
- `App.tsx` — Populate `interruptedCodingTaskIds` after process check completes
- `KanbanBoard.tsx` or `TasksHub.tsx` — Render the banner component
- New component: `InterruptedTasksBanner.tsx` (small, ~50 lines)

---

## Issue 6: Planning-Complete Notification (Existing System Integration)

### Current State

The app already has a dual notification system:
- **Radix UI Toast** (`use-toast.ts`) — Transient popups, bottom-right corner, auto-dismiss
- **Notification Store** (`notification-store.ts`) — Persistent history, bell icon in header, 24hr retention
- **Notification Settings** (`NotificationsSection.tsx`) — Toggles for `onTaskComplete`, `onTaskFailed`, `onReviewNeeded`, `sound`

A "Spec Ready for Review" notification partially exists in `useIpc.ts` (lines 363-387) but doesn't check for ralph prompt existence.

### Proposed Enhancement

When the file watcher detects both `spec.md` AND `ralph_prompt.md` exist for a planning task:

1. **Toast (transient):**
   ```
   ✓ "Implement Auth" — Spec ready for review
     [Review Now]  [Dismiss]
   ```
   - Duration: 10 seconds (matches existing spec-ready toast)
   - "Review Now" opens TaskDetailModal for that task
   - Respects `onReviewNeeded` notification setting

2. **Notification Center (persistent):**
   ```
   type: 'info'
   title: 'Spec ready for review'
   message: task.title
   taskId: task.id
   ```

### Files to Modify

- `useIpc.ts` — Update spec-ready notification trigger to require both files
- `notification-store.ts` — No changes needed (already supports all needed fields)
- `TaskCard.tsx` or `TasksHub.tsx` — "Review Now" action handler opens TaskDetailModal

---

## Combined Implementation Plan (Updated)

### Phase 1: Fix App Restart (Critical Bug)

**Priority: Highest** — This is a bug that breaks the app on every restart.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 1.1 | Add planning tasks to App.tsx process check (alongside coding tasks) | `App.tsx` | 5 min |
| 1.2 | Update `isAgentStopped` after auto-restart in `recreateTaskMonitorTerminals` | `terminal-store.ts` | 10 min |
| 1.3 | Don't auto-restart planning agents when planning is complete (spec + prompt exist) | `execution-handlers.ts` | 15 min |
| 1.4 | Add loading state during 2s process check period so buttons don't flash wrong state | `task-store.ts`, `TaskCard.tsx`, `App.tsx` | 30 min |
| 1.5 | Track interrupted coding tasks and show "Resume All" banner | `task-store.ts`, `App.tsx`, `KanbanBoard.tsx`, new `InterruptedTasksBanner.tsx` | 45 min |

### Phase 2: Planning-Complete Detection

**Priority: High** — Needed for Phase 3.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 2.1 | Add IPC call `checkPlanningComplete(taskId)` that checks for BOTH `spec.md` AND `ralph_prompt.md` (case-insensitive) | `execution-handlers.ts`, `ipc.ts`, `preload.ts` | 30 min |
| 2.2 | Add `planningComplete` flag to task metadata, cached on load and updated by file watcher | `project-store.ts`, `task-store.ts` | 1 hr |
| 2.3 | Update status badge to show "Spec Ready" / "Awaiting Review" when planning complete | `TaskCard.tsx` | 30 min |
| 2.4 | Normalize ralph prompt filename to `ralph_prompt.md` (lowercase) across `planning_agent.py` and `ralph_prompt_generator.py` | `planning_agent.py`, `ralph_prompt_generator.py` | 15 min |

### Phase 3: Replace Buttons with Review Flow

**Priority: High** — Core UX improvement.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 3.1 | Replace "Resume + Start Build" with "Review" on task card (planning-complete only) | `TaskCard.tsx` | 30 min |
| 3.2 | Add planning review panel to TaskDetailModal (reuse existing modal + tabs) | `TaskDetailModal.tsx`, new `PlanningReview.tsx` | 2-3 hrs |
| 3.3 | Implement "Send Back to Planning with Notes" | `task-store.ts`, backend handler | 1-2 hrs |
| 3.4 | Keep "Resume" for interrupted planning (no spec or no prompt) | `TaskCard.tsx` | 15 min |

### Phase 4: Status Consistency + Notifications

**Priority: Medium** — Visual polish once the flow is correct.

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 4.1 | Add "Awaiting Review" / "Spec Ready" status badge variant | `TaskCard.tsx`, `phase-protocol.ts` | 30 min |
| 4.2 | Ensure status transition reliability on planning complete | `project-store.ts`, file watcher | 1-2 hrs |
| 4.3 | Integrate planning-complete notification into existing dual system (toast + notification center) | `useIpc.ts` | 30 min |

### Total Estimated Effort: 10-14 hours

---

## Design Principles

1. **The user reviews before anything transitions to coding.** No accidental starts.
2. **Button state reflects reality.** If no agent is running, don't show "Stop."
3. **Derive state from truth, not from memory.** Process state should be checked, not assumed.
4. **Planning completion is a review checkpoint.** The system should pause and wait for user approval.
5. **How the app closes is how it should reopen.** Coding stopped → stays stopped (with banner offer to resume). Planning complete → stays in review. Planning interrupted → auto-restarts.
6. **Use existing systems.** Notifications go through the existing toast + notification center. Batch resume follows the existing bulk action pattern.
