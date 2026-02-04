# Task Status & Execution Phase Architecture

**Last Updated:** 2026-02-01
**Version:** 2.7.5

---

## Quick Reference

### Task Status (User-facing workflow stages)
```
planning → coding → ai_review → human_review → done
```

### Execution Phase (Backend agent activities)
```
idle → planning → coding → qa_review → qa_fixing → complete/failed
```

### Key Insight
**Task Status and Execution Phase are DIFFERENT and can legitimately mismatch:**
- Status = "Where in the workflow" (user perspective)
- Phase = "What the agent is doing" (technical detail)

---

## Valid Status/Phase Combinations

| Task Status | Execution Phase | What's Happening | User-Friendly Label |
|------------|----------------|------------------|---------------------|
| `planning` | `idle` | Waiting to start | - |
| `planning` | `planning` | Creating initial spec | "Planning" |
| `coding` | `starting` | Initializing backend | "Starting..." |
| `coding` | `planning` | Creating implementation spec | "Creating Spec" |
| `coding` | `coding` | Writing code | "Implementing" |
| `coding` | `qa_review` | Running tests | "Testing" |
| `coding` | `qa_fixing` | Fixing test failures | "Fixing Issues" |
| `ai_review` | `qa_review` | AI reviewing code | "Reviewing" |
| `ai_review` | `qa_fixing` | Fixing issues | "Fixing Issues" |
| `ai_review` | `complete` | Review passed | "Complete" |
| `human_review` | `idle` | Awaiting human approval | - |
| `done` | `idle` | Task finished | - |

---

## Status Definitions

### `planning`
**User Meaning:** Task is being planned, spec is being created

**Technical Details:**
- Agent is running `spec_runner.py`
- Creating `spec.md` file
- May emit `planning` phase events
- Terminal shows planning agent output

**Transitions:**
- **→ `coding`:** When user clicks "Start Build" button
- **→ `human_review`:** If planning agent fails

---

### `coding`
**User Meaning:** Task is being implemented (code, tests, docs)

**Technical Details:**
- Agent is running `run.py`
- Can be in multiple phases:
  - `planning` - Creating implementation plan
  - `coding` - Writing code
  - `qa_review` - Running tests
  - `qa_fixing` - Fixing failures
- `implementation_plan.json` tracks subtasks
- Terminal shows execution agent output

**Transitions:**
- **→ `ai_review`:** When all subtasks complete and QA starts
- **→ `human_review`:** On completion or errors
- **→ `planning`:** When user clicks "Stop" button

---

### `ai_review`
**User Meaning:** AI is reviewing code quality and tests

**Technical Details:**
- QA agent validating implementation
- Phase is usually `qa_review` or `qa_fixing`
- Agent can loop between review and fixing
- Automatically advances when QA passes

**Transitions:**
- **→ `human_review`:** When QA passes or gives up
- **→ `coding`:** If major rework needed (rare)

---

### `human_review`
**User Meaning:** Awaiting human approval before finalizing

**Technical Details:**
- No active agent execution
- Phase is `idle` or `complete`
- User can:
  - Approve → merges worktree, moves to `done`
  - Reject → returns to `coding` with feedback
  - Request changes → adds to task terminal

**Transitions:**
- **→ `done`:** User approves
- **→ `coding`:** User requests changes
- **→ `pr_created`:** User creates PR from worktree

---

### `pr_created`
**User Meaning:** Pull request has been created from this task's worktree

**Technical Details:**
- Task worktree still exists
- PR URL stored in `task.metadata.prUrl`
- No active execution
- Shown on Worktrees page, not Kanban

**Transitions:**
- **→ `done`:** When PR is merged and worktree cleaned up

---

### `done`
**User Meaning:** Task is complete and changes are merged

**Technical Details:**
- Changes merged to base branch
- Worktree deleted (optional)
- No active execution
- Shown on Worktrees page
- Can be archived

**Transitions:**
- None (terminal state)
- Can be archived (soft delete)

---

## Phase Definitions

### `idle`
- No agent running
- Default state before execution
- Set when task is stopped
- **Note:** Frontend-only phase, never emitted by Python backend

### `starting` ✅ IMPLEMENTED (v2.7.6)
- Brief initialization window (1-2 seconds)
- Between status change and first backend phase event
- Shows "Starting..." badge with pulse animation
- **Status:** Fully implemented in v2.7.6
- **Implementation:**
  - Type: Added to `EXECUTION_PHASES` in phase-protocol.ts
  - UI: Badge colors with `animate-pulse` in task.ts
  - State: task-store.ts initializes with `starting` phase
  - Backend: Maps to `coding` status in agent-events-handlers.ts

### `planning`
- Creating spec or implementation plan
- Researching codebase
- Designing solution approach

### `coding`
- Writing code
- Creating files
- Implementing features

### `qa_review`
- Running tests
- Validating implementation
- Checking code quality

### `qa_fixing`
- Fixing test failures
- Addressing QA issues
- Iterating on code

### `complete`
- Execution finished successfully
- All subtasks done
- QA passed

### `failed`
- Execution failed with errors
- Agent gave up
- Requires human intervention

---

## Status/Phase Synchronization

### How They Stay in Sync

**Backend → Frontend Flow:**
```
1. Python agent emits: __EXEC_PHASE__:{"phase":"coding"}
   ↓
2. Main process parses phase event (agent-events.ts)
   ↓
3. Maps phase to status via phaseToStatus map (agent-events-handlers.ts)
   ↓
4. Validates transition is valid (phase-protocol.ts)
   ↓
5. Persists status to implementation_plan.json
   ↓
6. Sends IPC: TASK_STATUS_CHANGE to renderer
   ↓
7. Updates UI state (task-store.ts)
   ↓
8. TaskCard re-renders with new status/phase
```

**Phase → Status Mapping:**
```typescript
const phaseToStatus = {
  idle: null,              // Don't change status
  starting: "coding",      // Keep in coding
  planning: "coding",      // Spec creation = coding
  coding: "coding",        // Implementation = coding
  qa_review: "ai_review",  // Testing = ai_review
  qa_fixing: "ai_review",  // Fixing = ai_review
  complete: "human_review", // Done = needs approval
  failed: "human_review",  // Failed = needs review
};
```

---

## Race Conditions & Edge Cases

### Race Condition 1: Status Changes Before Phase

**Scenario:**
```
T+0ms:   User clicks "Start Build"
T+10ms:  Status → "coding" (immediate)
T+1000ms: Phase → "planning" (after subprocess spawns)
T+1001ms: UI shows "Coding" with "Planning" badge ❌
```

**Fix:** Use "starting" intermediate phase

---

### Race Condition 2: Rapid Stop/Start

**Scenario:**
```
T+0ms:   User starts task
T+100ms: User stops task (before first phase event)
T+200ms: Phase event arrives for stopped task
```

**Handling:**
- Sequence numbers prevent stale updates
- Task store checks `isAgentStopped` flag
- Stale phase events are ignored

---

### Edge Case 1: Phase Regression

**Scenario:** Backend sends `coding` phase after `qa_review`

**Handling:**
- `completedPhases` array tracks finished phases
- `validateStatusTransition()` blocks backwards movement
- Logs warning and ignores invalid transition

---

### Edge Case 2: Task Crashes Mid-Phase

**Scenario:** Python process crashes during `coding` phase

**Handling:**
- Stuck task detection after 5 seconds
- Shows "Stuck" badge
- User can recover via "Recover" button
- `recoverStuckTask()` cleans up and restarts

---

### Edge Case 3: Multiple Phase Events in Queue

**Scenario:** Backend emits multiple phases rapidly

**Handling:**
- Sequence numbers ensure ordered processing
- Each event increments `sequenceNumber`
- Frontend drops events with lower sequence numbers

---

## File Locations

### Status/Phase Definitions
- **Types:** `src/shared/types/task.ts`
- **Constants:** `src/shared/constants/task.ts`
- **Phase Protocol:** `src/shared/constants/phase-protocol.ts`

### State Management
- **Task Store:** `src/renderer/stores/task-store.ts`
- **Status Updates:** Lines 206-240
- **Execution Progress:** Lines 242-290

### Backend Handlers
- **Execution:** `src/main/ipc-handlers/task/execution-handlers.ts`
- **Agent Events:** `src/main/ipc-handlers/agent-events-handlers.ts`
- **Phase Parsing:** `src/main/agent/agent-events.ts`
- **Process Management:** `src/main/agent/agent-process.ts`

### UI Components
- **Task Card:** `src/renderer/components/TaskCard.tsx`
- **Phase Progress:** `src/renderer/components/PhaseProgressIndicator.tsx`
- **Task Details:** (Find modal component)

### Python Backend
- **Phase Emission:** `apps/backend/core/phase_event.py`
- **Spec Runner:** `apps/backend/spec_runner.py`
- **Task Executor:** `apps/backend/run.py`

---

## IPC Event Flow

### Task Start
```
User Action → task:start IPC
    ↓
execution-handlers.ts: TASK_START (line 115)
    ↓
Immediate: send TASK_STATUS_CHANGE → "coding"
    ↓
Spawn Python subprocess
    ↓
Parse stdout for phase events
    ↓
Emit execution-progress
    ↓
Map phase to status
    ↓
Send TASK_STATUS_CHANGE (if status changed)
    ↓
UI updates
```

### Phase Transition
```
Python: emit_phase("coding")
    ↓
stdout: __EXEC_PHASE__:{"phase":"coding"}
    ↓
agent-process.ts: parseExecutionPhase()
    ↓
Validate not in completedPhases
    ↓
agentManager.emit('execution-progress')
    ↓
agent-events-handlers.ts: execution-progress listener
    ↓
Validate transition with validateStatusTransition()
    ↓
Persist to implementation_plan.json
    ↓
Send IPC: task:executionProgress
    ↓
task-store.ts: updateExecutionProgress()
    ↓
TaskCard re-renders
```

---

## Debugging Guide

### Task Stuck in "Starting..."
**Check:**
1. Backend subprocess running? (`ps aux | grep python`)
2. Phase events being emitted? (Check task terminal)
3. IPC channel open? (DevTools → Network)
4. Sequence numbers incrementing? (Console logs)

### Status/Phase Mismatch
**Check:**
1. What does `implementation_plan.json` say?
2. What phase events were emitted? (Task terminal logs)
3. Is `phaseToStatus` mapping correct?
4. Any validation errors in console?

### Phase Not Updating
**Check:**
1. Is execution actually running? (Backend process alive?)
2. Are phase events being parsed? (Agent process logs)
3. Sequence number issue? (Out of order events dropped)
4. Is phase in `completedPhases` already?

---

## Best Practices

### For Developers

1. **Never assume status = phase**
   - They are different concepts
   - Check both when debugging

2. **Use sequence numbers**
   - Always increment on phase change
   - Check before processing updates

3. **Validate transitions**
   - Use `validateStatusTransition()`
   - Don't skip validation

4. **Log phase changes**
   - Include both old and new values
   - Log sequence numbers

5. **Handle race conditions**
   - Use intermediate states (like "starting")
   - Don't assume events arrive in order

### For Users

1. **Status badge** = Where the task is in workflow
2. **Phase badge** = What the computer is currently doing
3. **It's normal** for phase to differ from status
4. **"Starting..."** means system is initializing
5. **Spinner** means task is actively running

---

## Common Patterns

### Starting a Task
```typescript
// 1. Update status first (optimistic)
updateTaskStatus(taskId, 'coding');

// 2. Set intermediate phase
updateExecutionProgress(taskId, {
  phase: 'starting',
  sequenceNumber: 0
});

// 3. Call backend
await electronAPI.taskStart(taskId);

// 4. Backend will emit real phase events
// 5. UI will update automatically
```

### Stopping a Task
```typescript
// 1. Stop backend
await electronAPI.taskStop(taskId);

// 2. Backend sends status change
// 3. Reset to planning
updateTaskStatus(taskId, 'planning');

// 4. Reset phase
updateExecutionProgress(taskId, {
  phase: 'idle',
  sequenceNumber: 0
});
```

### Monitoring Progress
```typescript
// Listen for execution progress
const unsubscribe = useTaskStore.subscribe(
  (state) => state.tasks.find(t => t.id === taskId)?.executionProgress,
  (progress) => {
    console.log('Phase:', progress?.phase);
    console.log('Progress:', progress?.overallProgress);
  }
);
```

---

## Undocumented Features (Implemented but Not Previously Documented)

### Completed Phases Tracking

**Implementation:** `apps/frontend/src/shared/types/task.ts` (Line 33-36)

```typescript
completedPhases?: CompletablePhase[];  // Phases that have successfully completed
```

**Purpose:** Prevents phase overlap by tracking which phases have finished

**File:** `apps/frontend/src/shared/constants/phase-protocol.ts` (Lines 52-55)
```typescript
export type CompletablePhase = 'planning' | 'coding' | 'qa_review' | 'qa_fixing';
```

**How It Works:**
- When a phase completes, it's added to the `completedPhases` array
- Phase validation checks if prerequisites are in `completedPhases`
- Prevents coding from starting while planning is still active (ACS-203)
- Allows QA loop (qa_review ↔ qa_fixing) without additional prerequisites

**Validation:** `phase-protocol.ts` (Lines 160-200)
```typescript
export function isValidPhaseTransition(
  currentPhase: ExecutionPhase,
  newPhase: ExecutionPhase,
  completedPhases?: CompletablePhase[]
): boolean {
  // Can't start coding until planning is in completedPhases
  // Can't start qa_review until coding is in completedPhases
}
```

---

### Fallback Text-Based Phase Detection

**Implementation:** `apps/frontend/src/main/agent/agent-events.ts` (Lines 45-117)

**Purpose:** Detect phases from log output when structured phase events are missing

**How It Works:**
1. Primary: Parse structured `__EXEC_PHASE__:{"phase":"..."}` events
2. Fallback: Match text patterns in stdout/stderr

**Patterns Detected:**

**For Spec Runner:**
- "discovering" → `planning` phase
- "requirements" → `planning` phase
- "research" → `planning` phase

**For Task Execution:**
- "planner agent" → `planning` phase (if not regressing)
- "coder agent" → `coding` phase (if not regressing)
- "qa reviewer" → `qa_review` phase (if allowed)
- "qa fixer" → `qa_fixing` phase

**Guards:**
```typescript
// checkRegression utility prevents backwards movement
const checkRegression = (phase: string) => {
  return completedPhases.includes(phase as CompletablePhase);
};

// Special QA guard
const canEnterQAPhase =
  currentPhase === 'idle' ||
  currentPhase === 'planning' ||
  currentPhase === 'coding' ||
  completedPhases.includes('coding');
```

**Why It's Needed:**
- Graceful degradation if Python backend fails to emit structured events
- Handles legacy agents that don't use phase_event.py
- Provides redundancy for critical phase transitions

---

### Terminal Phase Protection

**Implementation:** Multiple locations with layered defense

**Protection Layers:**

1. **Frontend Store:** `task-store.ts` (Lines 204-240)
   - Prevents status changes when phase is terminal (`complete`, `failed`)

2. **Backend Validation:** `agent-events-handlers.ts` (Lines 65-125)
   - `validateStatusTransition()` blocks transitions from terminal phases
   - Prevents status downgrade after completion

3. **File Persistence:** `agent-events-handlers.ts` (Lines 356-387)
   - Status persisted to both main and worktree plan files
   - Prevents flip-flop on task list refresh

**Why It's Critical:**
- Prevents completed tasks from showing as "in progress" on refresh
- Avoids race conditions where old events arrive after completion
- Ensures tasks stay in terminal state once reached

---

## Future Improvements

### Completed (v2.7.6)
- [x] Add "starting" intermediate phase ✅
- [x] Context-aware phase labels ✅
  - "Creating Spec", "Implementing", "Testing", "Fixing Issues"

### Planned
- [ ] Better phase transition animations
- [ ] Timeline view of phase history

### Considered
- [ ] Estimated time remaining
- [ ] Phase duration analytics
- [ ] Multi-task resource coordination
- [ ] Phase skip detection/warnings

---

## Change Log

### 2026-02-01 - v2.7.6 (Implementation Complete) ✅
- **IMPLEMENTED:** "Starting" intermediate phase
  - Added to EXECUTION_PHASES, PHASE_ORDER_INDEX
  - Badge with pulse animation during initialization
  - task-store.ts initializes with `starting` phase
  - Backend maps `starting` → `coding` status
- **IMPLEMENTED:** Context-aware phase labels
  - "Creating Spec" (planning during coding)
  - "Implementing" (coding during coding)
  - "Testing" (qa_review during coding)
  - "Fixing Issues" (qa_fixing)
- **IMPLEMENTED:** PhaseProgressIndicator updates
- **IMPLEMENTED:** i18n translations (EN + FR)
- **VERIFIED:** All 1991 tests pass, TypeScript compiles

### 2026-02-01 - v2.7.5 (Documentation Update)
- Documented current architecture comprehensively
- Identified race condition issues and mitigations
- Proposed "starting" phase solution for v2.7.6
- **Added:** Documentation of previously undocumented features:
  - completedPhases tracking mechanism
  - Fallback text-based phase detection
  - Terminal phase protection layers
  - Frontend-only vs backend phases distinction
- Clarified current implementation vs proposed features
- Verified architecture implementation (89% alignment)

### 2024-XX-XX - v2.0.0
- Initial implementation of status/phase separation
- Added execution progress tracking
- Implemented phase protocol

---

**End of Architecture Documentation**
