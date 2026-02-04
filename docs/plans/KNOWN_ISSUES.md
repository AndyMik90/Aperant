# Known Issues & Fixes

**Last Updated:** 2026-02-03
**Version:** 2.7.6

---

## Table of Contents

1. [Issue #1: startBuild Error Not Shown in UI](#issue-1-startbuild-error-not-shown-in-ui)
2. [Issue #2: Phase Labels Not Updating in Real Time](#issue-2-phase-labels-not-updating-in-real-time)
3. [Issue #3: Planning Agent Not Starting on App Restart](#issue-3-planning-agent-not-starting-on-app-restart)
4. [Issue #4: Stuck Task Recovery Calling Wrong Handler](#issue-4-stuck-task-recovery-calling-wrong-handler)
5. [Issue #5: Terminal Output Not Legible](#issue-5-terminal-output-not-legible)
6. [Issue #6: Task Auto-Transitions from Planning to Coding](#issue-6-task-auto-transitions-from-planning-to-coding)
7. [Issue #7: No Alert When Planning Completes](#issue-7-no-alert-when-planning-completes)
8. [Issue #8: Kanban Drag Auto-Starts Coding Agent](#issue-8-kanban-drag-auto-starts-coding-agent)
9. [Issue #9: No User-Initiated Flag for Transitions](#issue-9-no-user-initiated-flag-for-transitions)
10. [Issue #10: Status Validation Allows All Non-Regressive Transitions](#issue-10-status-validation-allows-all-non-regressive-transitions)

---

## Issue #1: startBuild Error Not Shown in UI

### Description
When a user clicks "Start Build" on a task that hasn't completed planning (no `spec.md` or `implementation_plan.json`), the error is only logged to the console. The user sees no feedback in the UI.

### Current Behavior
```
User clicks "Start Build"
  ↓
Backend validates files exist (execution-handlers.ts:440-452)
  ↓
Returns: { success: false, error: "Cannot start build: spec.md has not been created yet..." }
  ↓
task-store.ts:743 logs error to console
  ↓
Returns false (no UI notification)
  ↓
User sees nothing - button appears to do nothing
```

### Console Output
```
[task-store] startBuild failed: Cannot start build: spec.md has not been created yet. Continue planning first.
```

### Expected Behavior
- User should see a toast/notification explaining why the build can't start
- Button could be disabled with a tooltip explaining the requirement
- UI should indicate spec.md is still being created

### Files Involved
| File | Lines | Description |
|------|-------|-------------|
| `src/renderer/stores/task-store.ts` | 734-749 | `startBuild()` function - no UI feedback |
| `src/renderer/components/TaskCard.tsx` | 795-803 | Start Build button click handler |
| `src/main/ipc-handlers/task/execution-handlers.ts` | 436-452 | Validation logic |

### Proposed Fix
**Option A: Toast Notification**
```typescript
// In task-store.ts startBuild function
import { toast } from 'sonner'; // or your toast library

export async function startBuild(taskId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.startBuild(taskId);
    if (result.success) {
      store.updateTaskStatus(taskId, 'coding');
      return true;
    }
    // Show user-friendly error
    toast.error('Cannot Start Build', {
      description: result.error || 'Planning must complete first. Wait for spec.md to be created.'
    });
    return false;
  } catch (error) {
    toast.error('Build Error', {
      description: 'An unexpected error occurred. Check the console for details.'
    });
    return false;
  }
}
```

**Option B: Disable Button Until Ready**
```typescript
// In TaskCard.tsx, disable Start Build button if spec doesn't exist
<Button
  variant="default"
  size="sm"
  disabled={!task.specReady} // Add specReady flag to task
  title={task.specReady ? t('tooltips.startBuild') : 'Waiting for spec to be created...'}
>
```

**Option C: Both (Recommended)**
Combine both approaches for best UX:
- Disable button when spec isn't ready (proactive)
- Show toast on error as fallback (reactive)

### Priority
**High** - Users need feedback when actions fail

---

## Issue #2: Phase Labels Not Updating in Real Time

### Description
The execution phase labels (Creating Spec, Implementing, Testing, Fixing Issues) are defined in i18n but not updating in real-time as the task progresses.

### Current i18n Definitions
```json
"execution": {
  "phases": {
    "idle": "Idle",
    "starting": "Starting...",
    "planning": "Planning",
    "coding": "Coding",
    "reviewing": "Reviewing",
    "fixing": "Fixing Issues",
    "complete": "Complete",
    "failed": "Failed",
    "creatingSpec": "Creating Spec",
    "implementing": "Implementing",
    "testing": "Testing"
  }
}
```

### Root Causes

#### Cause A: Python Backend Not Emitting Phase Events
The backend (`apps/backend/run.py` and `spec_runner.py`) may not be emitting `__EXEC_PHASE__` events properly.

**Check:**
1. Look for `emit_phase()` calls in Python code
2. Verify `phase_event.py` is imported and used
3. Check terminal output for `__EXEC_PHASE__` markers

**Expected Python output:**
```
__EXEC_PHASE__:{"phase":"planning"}
... agent output ...
__EXEC_PHASE__:{"phase":"coding"}
... agent output ...
```

#### Cause B: IPC Event Flow Broken
The frontend may not be receiving or processing phase events.

**IPC Flow:**
```
Python emits __EXEC_PHASE__
  ↓
agent-process.ts parses stdout (parseExecutionPhase)
  ↓
agentManager.emit('execution-progress', data)
  ↓
agent-events-handlers.ts listener receives event
  ↓
Sends IPC: task:executionProgress
  ↓
task-store.ts updateExecutionProgress()
  ↓
TaskCard re-renders
```

**Debugging Checklist:**
1. [ ] Check terminal for `__EXEC_PHASE__` markers
2. [ ] Add console.log in `parseExecutionPhase()`
3. [ ] Add console.log in `updateExecutionProgress()`
4. [ ] Check React DevTools for state updates

#### Cause C: Context-Aware Labels Not Applied
The contextual labels (`creatingSpec`, `implementing`, `testing`) require mapping logic to display based on status+phase combination.

**Current Code Location:** `src/renderer/components/TaskCard.tsx`

**Required Logic:**
```typescript
function getContextualPhaseLabel(status: TaskStatus, phase: ExecutionPhase): string {
  // During coding status, use contextual labels
  if (status === 'coding') {
    switch (phase) {
      case 'planning': return t('execution.phases.creatingSpec');
      case 'coding': return t('execution.phases.implementing');
      case 'qa_review': return t('execution.phases.testing');
      case 'qa_fixing': return t('execution.phases.fixing');
      default: return t(`execution.phases.${phase}`);
    }
  }
  return t(`execution.phases.${phase}`);
}
```

### Files Involved
| File | Lines | Description |
|------|-------|-------------|
| `src/renderer/stores/task-store.ts` | 408-447 | `updateExecutionProgress()` |
| `src/renderer/components/TaskCard.tsx` | - | Phase badge rendering |
| `src/main/agent/agent-events.ts` | 45-117 | Phase parsing (structured + fallback) |
| `src/main/agent/agent-process.ts` | - | Stdout parsing |
| `apps/backend/core/phase_event.py` | - | Python phase emission |

### Debugging Commands
```bash
# Check if Python emits phase events
grep -r "emit_phase" apps/backend/

# Check if agent-events.ts parses properly
grep -r "__EXEC_PHASE__" apps/frontend/src/

# Check IPC event handlers
grep -r "execution-progress\|executionProgress" apps/frontend/src/
```

### Priority
**High** - Core feature for user visibility into task progress

---

## Issue #3: Planning Agent Not Starting on App Restart

### Description
When the app restarts with a task in `planning` status, the planning agent doesn't restart automatically, leaving the task stuck.

### Console Output
```
[TerminalStore] Task 001-comprehensive-codebase-analysis-documentation is planning but no process running, will restart planning agent
[TerminalStore] Auto-restarting 1 stuck task(s)...
[TerminalStore] Task 001-comprehensive-codebase-analysis-documentation restarted successfully
[task-store] startBuild failed: Cannot start build: spec.md has not been created yet. Continue planning first.
```

### Analysis
The logs show a sequence issue:
1. ✅ Task correctly detected as stuck (`planning` with no process)
2. ✅ `recoverStuckTask` is called
3. ✅ Recovery reports success
4. ❌ Then `startBuild` is called and fails

This suggests **two things are triggering simultaneously**:
- The auto-recovery (correct) calling `startPlanningAgent`
- Something else calling `startBuild` (incorrect)

### Possible Causes

#### Cause A: UI Button Click Race
User or auto-click on "Start Build" button before recovery completes.

#### Cause B: Multiple Recovery Paths
Both `terminal-store.ts` and `task-store.ts` may have recovery logic that conflict.

#### Cause C: recoverStuckTask Logic Bug
The handler may be calling the wrong function for planning tasks.

### Code Investigation

**terminal-store.ts (Lines 925-950):**
```typescript
// Phase 2: For planning tasks, also check if process is running
if (task.status === 'planning') {
  const runningResult = await window.electronAPI.checkTaskRunning(task.id);
  if (runningResult.success && runningResult.data === false) {
    console.log(`[TerminalStore] Task ${task.id} is planning but no process running, will restart planning agent`);
    tasksToRestart.push(task.id);
  }
}

// Auto-restart calls recoverStuckTask
setTimeout(async () => {
  for (const taskId of tasksToRestart) {
    // Use recoverStuckTask with autoRestart to properly restart the task
    // For planning tasks, this will call startPlanningAgent
    // For coding tasks, this will call startTaskExecution
```

**execution-handlers.ts (recoverStuckTask handler):**
Need to verify it checks `task.status === 'planning'` and calls `startPlanningAgent`.

### Files to Check
| File | What to Check |
|------|---------------|
| `src/main/ipc-handlers/task/execution-handlers.ts` | `recoverStuckTask` handler logic |
| `src/renderer/stores/terminal-store.ts` | Auto-restart logic |
| `src/renderer/stores/task-store.ts` | Any competing recovery logic |
| `src/renderer/components/TaskCard.tsx` | Button state during recovery |

### Priority
**Critical** - Tasks become stuck and unusable after app restart

---

## Issue #4: Stuck Task Recovery Calling Wrong Handler

### Description
Related to Issue #3 - the `recoverStuckTask` may be calling `startBuild` instead of `startPlanningAgent` for planning tasks.

### Expected Flow
```
Task status = 'planning'
  ↓
recoverStuckTask called
  ↓
Check: task.status === 'planning'?
  ↓ YES
Call: agentManager.startPlanningAgent(taskId)
  ↓
Planning resumes
```

### Actual Flow (Bug)
```
Task status = 'planning'
  ↓
recoverStuckTask called
  ↓
???
  ↓
startBuild is called
  ↓
Fails: "spec.md has not been created yet"
```

### Code Location
`src/main/ipc-handlers/task/execution-handlers.ts` - `TASK_RECOVER_STUCK` handler

### Required Check
```typescript
handle(IPC_CHANNELS.TASK_RECOVER_STUCK, async (event, { taskId, autoRestart }) => {
  const task = await getTaskById(taskId);

  // CRITICAL: Check status before deciding which agent to start
  if (task.status === 'planning') {
    // Resume planning agent, NOT build
    await agentManager.startPlanningAgent(taskId, project, task);
    return { success: true };
  }

  if (task.status === 'coding') {
    // Resume coding agent
    await agentManager.startTaskExecution(taskId, project, task);
    return { success: true };
  }

  // ... handle other statuses
});
```

### Priority
**Critical** - Core recovery functionality broken

---

## Issue #5: Terminal Output Not Legible

### Description
The task terminal shows cryptic, unreadable output that doesn't help users understand what the agent is doing. Key information is hidden or displayed as empty boxes.

### Screenshot Analysis
Current terminal output shows:
```
● Write  [error]                    ← No file path shown
● Bash Run command
   [IN]                             ← Command not visible, empty box
● Read                              ← No file path shown
● Starting phase 4: CONTEXT DISCOVERY
  Starting phase 5: SPEC DOCUMENT CREATION  ← These are good!
● Read
● Read
● Read                              ← Which files? No info
● Write  [success]                  ← What file was written?
● Bash Run command
   [IN]                             ← Empty, unreadable
● Bash Run command
   [IN]                             ← Empty, unreadable
...
```

### Problems Identified

#### Problem A: Tool Operations Show No Context
| Current | Expected |
|---------|----------|
| `Read` | `Read: src/components/App.tsx` |
| `Write [error]` | `Write: config.json - Error: Permission denied` |
| `Bash Run command [IN]` | `Bash: npm install lodash` |

#### Problem B: Empty "IN" Boxes
The terminal shows `[IN]` boxes that are empty or truncated:
- Commands are not visible
- Input/output not displayed
- No way to know what executed

#### Problem C: No Progress Context
Between "Starting phase 4" and "Starting phase 5":
- User sees random Read/Write/Bash entries
- No explanation of what's being done
- No connection to the phase

### Expected Behavior

**Good Terminal Output Example:**
```
● Starting phase 4: CONTEXT DISCOVERY
  ├─ Read: package.json (analyzing dependencies)
  ├─ Read: src/index.ts (finding entry point)
  ├─ Bash: npm list --depth=0 ✓
  └─ Analyzing 15 source files...

● Starting phase 5: SPEC DOCUMENT CREATION
  ├─ Write: .auto-build/specs/001/spec.md ✓
  ├─ Write: .auto-build/specs/001/implementation_plan.json ✓
  └─ Spec created successfully!
```

### Files Involved

| File | Description |
|------|-------------|
| `src/renderer/components/Terminal.tsx` | Terminal display component |
| `src/renderer/components/TerminalLine.tsx` | Individual line rendering |
| `apps/backend/core/` | Python agent output formatting |
| `src/main/agent/agent-process.ts` | Output parsing and forwarding |

### Proposed Fixes

#### Fix A: Show File Paths in Tool Operations
```typescript
// Terminal line should include context
interface TerminalToolLine {
  tool: 'Read' | 'Write' | 'Bash' | 'Search';
  target?: string;      // File path or command
  status?: 'success' | 'error' | 'running';
  detail?: string;      // Error message or result summary
}

// Render as:
// ● Read: src/components/App.tsx ✓
// ● Write: config.json ✗ Permission denied
// ● Bash: npm test (running...)
```

#### Fix B: Display Bash Commands
```typescript
// Instead of empty [IN] box, show actual command
<div className="terminal-bash">
  <span className="tool-name">Bash:</span>
  <code className="command">{command}</code>
  <span className="status">{status}</span>
</div>
```

#### Fix C: Group Operations Under Phases
```typescript
// Structure terminal output hierarchically
interface PhaseGroup {
  phase: string;           // "CONTEXT DISCOVERY"
  operations: ToolLine[];  // Read, Write, Bash under this phase
  summary?: string;        // "Analyzed 15 files"
}
```

#### Fix D: Add Human-Readable Summaries
The Python backend should emit human-readable descriptions:
```python
# In phase_event.py or similar
def emit_tool_action(tool: str, action: str, target: str = None):
    """Emit a tool action with human-readable description"""
    print(f"__TOOL_ACTION__:{json.dumps({
        'tool': tool,
        'action': action,
        'target': target,
        'description': f'{action}: {target}' if target else action
    })}")
```

### UI/UX Recommendations

1. **Collapsible Sections**: Group operations under phase headers
2. **Progress Indicators**: Show "3 of 15 files analyzed"
3. **Color Coding**: Green for success, red for errors, yellow for warnings
4. **Timestamps**: Show how long each operation took
5. **Search/Filter**: Allow filtering by tool type or status
6. **Copy Command**: Right-click to copy bash commands

### Priority
**High** - Core usability issue. Users cannot understand what the agent is doing, leading to confusion and loss of trust.

---

## Issue #6: Task Auto-Transitions from Planning to Coding

### Description
Tasks are automatically moving from `planning` status to `coding` status without user intervention. According to the documented architecture, this transition should **ONLY** happen when the user explicitly clicks the "Start Build" button.

### Expected Behavior (Per Architecture Doc)
```
Task in 'planning' status
  ↓
User reviews spec.md and implementation_plan.json
  ↓
User clicks "Start Build" button
  ↓
System validates spec exists
  ↓
Status changes to 'coding'
  ↓
Coding agent starts
```

### Actual Behavior (Bug)
```
Task in 'planning' status
  ↓
Planning agent creates spec
  ↓
??? (Something auto-triggers)
  ↓
Status automatically changes to 'coding'
  ↓
User never got to review the spec
```

### Why This Is a Problem
1. **User Control Lost**: Users should decide when to start building
2. **No Review Opportunity**: Users can't review spec before coding begins
3. **Waste of Resources**: Coding may start on an incorrect spec
4. **Breaks Workflow**: Human-in-the-loop control is bypassed

### Documented Workflow (TASK_ARCHITECTURE.md)

From the architecture documentation:
```
### `planning`
**User Meaning:** Task is being planned, spec is being created

**Transitions:**
- **→ `coding`:** When user clicks "Start Build" button  ← USER ACTION REQUIRED
- **→ `human_review`:** If planning agent fails
```

### Possible Causes

#### Cause A: Auto-Transition in Phase Handler
The `phaseToStatus` mapping might be incorrectly changing status:
```typescript
const phaseToStatus = {
  planning: "coding",  // ← This maps planning phase to coding STATUS
  // Should this be null to prevent auto-transition?
};
```

#### Cause B: Planning Agent Completion Triggers Build
When `spec_runner.py` completes, it might emit a phase that triggers coding:
```python
# If planning emits 'complete' or 'coding' phase, it may auto-start build
emit_phase("complete")  # This might trigger status change
```

#### Cause C: Recovery Logic Bug
The stuck task recovery (Issue #3/#4) might be calling startBuild instead of just resuming planning.

#### Cause D: Race Condition
Multiple events might be queued that override user-controlled transitions.

### Files to Investigate

| File | What to Check |
|------|---------------|
| `src/main/ipc-handlers/agent-events-handlers.ts` | `phaseToStatus` mapping, status transitions |
| `apps/backend/spec_runner.py` | What phase is emitted on completion |
| `src/renderer/stores/task-store.ts` | `updateTaskFromPlan()` - auto status changes |
| `src/main/agent/agent-events.ts` | Phase event handling |

### Key Code Locations

**agent-events-handlers.ts - phaseToStatus mapping:**
```typescript
const phaseToStatus: Record<string, TaskStatus | null> = {
  idle: null,
  starting: "coding",
  planning: "coding",      // ← PROBLEM: This auto-changes to coding
  coding: "coding",
  qa_review: "ai_review",
  qa_fixing: "ai_review",
  complete: "human_review",
  failed: "human_review",
};
```

**The Issue:**
When the planning agent is running and emits a `planning` phase, the mapping says to set status to `coding`. This is wrong for the initial planning status - it should stay as `planning` until the user clicks "Start Build".

### Proposed Fix

**Option A: Separate Phase-to-Status Logic by Current Status**
```typescript
function mapPhaseToStatus(currentStatus: TaskStatus, phase: ExecutionPhase): TaskStatus | null {
  // If already in planning status, DON'T auto-transition to coding
  if (currentStatus === 'planning') {
    // Only planning → human_review on failure is allowed automatically
    if (phase === 'failed') return 'human_review';
    return null; // Stay in planning
  }

  // If in coding status, use normal mapping
  if (currentStatus === 'coding') {
    return phaseToStatus[phase] || null;
  }

  return null;
}
```

**Option B: Add "requireReview" Flag Check**
```typescript
// If task has requireReview flag, don't auto-transition
if (task.metadata?.requireReview && currentStatus === 'planning') {
  return null; // User must manually approve
}
```

**Option C: Explicit User Action Required**
Add a field to track if user has approved the spec:
```typescript
interface Task {
  // ...
  specApproved?: boolean;  // Set to true when user clicks "Start Build"
}

// Only transition if approved
if (!task.specApproved && phase === 'coding') {
  return null; // Can't auto-start coding
}
```

### Priority
**Critical** - Breaks the core user-controlled workflow. User loses the ability to review specs before coding begins.

---

## Issue #7: No Alert When Planning Completes

### Description
When the planning agent finishes creating the spec and implementation plan, there is no notification or alert to the user. Users don't know when to review the spec.

### Expected Behavior (Per Workflow Doc)
```
Planning agent completes
  ↓
System detects spec.md and implementation_plan.json created
  ↓
ALERT USER: "Spec ready for review!"
  ↓
User opens task, reviews spec
  ↓
User clicks "Start Build"
```

### Actual Behavior
```
Planning agent completes
  ↓
... silence ...
  ↓
User has no idea planning is done
  ↓
User may miss the review window
  ↓
(Or Issue #6 auto-transitions, skipping review entirely)
```

### Why This Matters
Per [TASK_WORKFLOW.md](../architecture/TASK_WORKFLOW.md), the workflow has a **user action gate** between Planning and Coding. The user MUST:
1. Be notified that planning is complete
2. Review the spec
3. Manually click "Start Build"

Without an alert, users don't know when to take action.

### Proposed Alert Methods

#### Method A: Toast Notification
```typescript
// When planning agent completes successfully
import { toast } from 'sonner';

function onPlanningComplete(task: Task) {
  toast.success('Spec Ready for Review', {
    description: `"${task.title}" is ready. Review the spec and click Start Build.`,
    duration: 10000, // Stay visible longer
    action: {
      label: 'Review Now',
      onClick: () => openTaskDetails(task.id)
    }
  });
}
```

#### Method B: Badge on Task Card
```typescript
// Task card shows "Review Spec" badge
{task.status === 'planning' && task.specReady && (
  <Badge variant="warning" className="animate-pulse">
    Review Spec
  </Badge>
)}
```

#### Method C: Desktop Notification
```typescript
// System-level notification
if (Notification.permission === 'granted') {
  new Notification('Auto-Claude: Spec Ready', {
    body: `Task "${task.title}" is ready for review`,
    icon: '/icon.png'
  });
}
```

#### Method D: Sound Alert (Optional)
```typescript
// Play a subtle sound
const audio = new Audio('/sounds/spec-ready.mp3');
audio.volume = 0.3;
audio.play();
```

### Detection Logic

How to know planning is complete:
```typescript
// Option 1: Watch for files
function checkSpecReady(task: Task): boolean {
  const specPath = `${task.specPath}/spec.md`;
  const planPath = `${task.specPath}/implementation_plan.json`;
  return existsSync(specPath) && existsSync(planPath);
}

// Option 2: Listen for agent completion event
agentManager.on('planning-complete', (taskId) => {
  const task = getTask(taskId);
  showSpecReadyAlert(task);
});

// Option 3: Phase transition to 'idle' while status is 'planning'
if (task.status === 'planning' && task.executionProgress?.phase === 'idle') {
  // Planning agent finished
  if (checkSpecReady(task)) {
    showSpecReadyAlert(task);
  }
}
```

### Files to Modify

| File | Change |
|------|--------|
| `src/main/agent/agent-manager.ts` | Emit 'planning-complete' event |
| `src/renderer/stores/task-store.ts` | Listen for completion, trigger alert |
| `src/renderer/components/TaskCard.tsx` | Show "Review Spec" badge |
| `src/renderer/lib/notifications.ts` | Create alert utility (new file) |

### i18n Strings Needed

```json
{
  "notifications": {
    "specReadyTitle": "Spec Ready for Review",
    "specReadyDescription": "\"{{title}}\" is ready. Review the spec and click Start Build.",
    "reviewNow": "Review Now"
  },
  "labels": {
    "reviewSpec": "Review Spec",
    "specReady": "Spec Ready"
  }
}
```

### Priority
**High** - Essential for the user-controlled workflow. Without this, users miss the review step.

### Related
- [Issue #6: Auto-Transition Bug](#issue-6-task-auto-transitions-from-planning-to-coding) - Together these break the review workflow
- [TASK_WORKFLOW.md](../architecture/TASK_WORKFLOW.md) - Documents the intended workflow

---

## Issue #8: Kanban Drag Auto-Starts Coding Agent

### Description
When a user drags a task from the "Planning" column to the "Coding" column in the Kanban board, the coding agent **automatically starts** without requiring the user to click "Start Build".

### Code Location
**File:** `src/main/ipc-handlers/task/execution-handlers.ts`
**Lines:** 869-973

### Current Behavior
```
User drags task: Planning → Coding in Kanban
  ↓
KanbanBoard.tsx handleStatusChange() (line 700)
  ↓
Calls persistTaskStatus(taskId, 'coding')
  ↓
Triggers TASK_UPDATE_STATUS IPC handler
  ↓
Handler checks: status === 'coding' && !agentManager.isRunning(taskId)
  ↓
AUTO-CALLS: agentManager.startTaskExecution() (lines 936-962)
  ↓
Coding agent starts WITHOUT user confirmation
```

### Problem Code
```typescript
// execution-handlers.ts lines 869-973
if (status === 'coding' && !agentManager.isRunning(taskId)) {
  // ... authentication and git checks ...

  // If no spec exists, auto-starts spec creation
  agentManager.startSpecCreation(...)  // Line 933

  // If spec exists, auto-starts task execution
  agentManager.startTaskExecution(...)  // Lines 936-962
}
```

### Why This Is a Problem
1. **Bypasses "Start Build" Button**: The documented workflow requires user to click "Start Build"
2. **No Spec Review**: User can skip reviewing spec.md by just dragging
3. **Accidental Execution**: Mis-drag starts coding immediately
4. **Workflow Violation**: Per TASK_WORKFLOW.md, Planning→Coding is a user-controlled gate

### Expected Behavior
```
User drags task: Planning → Coding in Kanban
  ↓
Task moves to Coding column (status updated)
  ↓
Task shows "Pending" or "Click Start Build"
  ↓
NO AGENT STARTS
  ↓
User must click "Start Build" to start coding
```

### Proposed Fix
**Remove auto-start logic from TASK_UPDATE_STATUS handler:**
```typescript
// execution-handlers.ts - REMOVE lines 869-973
// Status changes should NOT auto-start agents
// Only the explicit "Start Build" button should start the coding agent

// The TASK_START_BUILD handler (line 411) is the ONLY place
// that should call agentManager.startTaskExecution()
```

### Priority
**Critical** - Completely bypasses the user-controlled workflow gate

---

## Issue #9: No User-Initiated Flag for Transitions

### Description
The system cannot distinguish between:
- User clicking "Start Build" button (should start coding)
- User dragging in Kanban (should NOT auto-start)
- Auto-recovery restarting a task (context-dependent)
- Status change from backend event (should NOT auto-start)

### Why This Matters
The documented workflow has **two types of status changes**:

| Action | Should Start Agent? |
|--------|---------------------|
| User clicks "Start Build" | ✅ YES |
| Kanban drag-and-drop | ❌ NO |
| Recovery auto-restart | ⚠️ Only if explicitly requested |
| Backend phase event | ❌ NO |

Currently, ALL of these trigger the same code path in `TASK_UPDATE_STATUS`.

### Proposed Fix
**Add `userInitiated` flag to IPC calls:**

```typescript
// IPC call structure
interface StatusChangeRequest {
  taskId: string;
  status: TaskStatus;
  userInitiated: boolean;  // NEW FLAG
  source: 'start-build' | 'kanban-drag' | 'recovery' | 'backend-event';
}

// Handler logic
if (status === 'coding') {
  if (request.userInitiated && request.source === 'start-build') {
    // Only start agent when user explicitly clicked "Start Build"
    agentManager.startTaskExecution(...)
  }
  // Otherwise, just update status without starting agent
}
```

### Files to Modify
| File | Change |
|------|--------|
| `src/shared/types/ipc.ts` | Add `userInitiated` and `source` to IPC types |
| `src/main/ipc-handlers/task/execution-handlers.ts` | Check flags before auto-starting |
| `src/renderer/components/KanbanBoard.tsx` | Pass `userInitiated: false` for drag |
| `src/renderer/stores/task-store.ts` | Pass `userInitiated: true` for Start Build |

### Priority
**High** - Required to properly enforce user-controlled gates

---

## Issue #10: Status Validation Allows All Non-Regressive Transitions

### Description
The `validateStatusTransition()` function allows ANY status transition as long as it doesn't regress phases. It does not enforce that Planning→Coding must be user-initiated.

### Code Location
**File:** `src/main/ipc-handlers/agent-events-handlers.ts`
**Lines:** 65-125

### Current Logic
```typescript
function validateStatusTransition(
  currentStatus: TaskStatus,
  newStatus: TaskStatus,
  currentPhase: ExecutionPhase,
  phase: ExecutionPhase
): boolean {
  // Lines 99-104: Only blocks phase regressions
  if (wouldPhaseRegress(currentPhase, phase as ExecutionPhase)) {
    return false;
  }

  // Otherwise, ALLOWS the transition
  return true;  // Line 124
}
```

### Problem
The validation function has no concept of:
- User-initiated vs auto-initiated transitions
- Required gates (Planning→Coding needs user action)
- Source of the transition request

### Proposed Enhancement
```typescript
function validateStatusTransition(
  currentStatus: TaskStatus,
  newStatus: TaskStatus,
  currentPhase: ExecutionPhase,
  phase: ExecutionPhase,
  options?: {
    userInitiated?: boolean;
    source?: string;
  }
): { valid: boolean; reason?: string } {

  // Check phase regression
  if (wouldPhaseRegress(currentPhase, phase)) {
    return { valid: false, reason: 'Phase regression not allowed' };
  }

  // ENFORCE USER-CONTROLLED GATES
  if (currentStatus === 'planning' && newStatus === 'coding') {
    if (!options?.userInitiated) {
      return {
        valid: false,
        reason: 'Planning→Coding requires user to click Start Build'
      };
    }
  }

  return { valid: true };
}
```

### Priority
**Medium** - Defense-in-depth validation

---

## Summary Table

| Issue | Severity | Impact | Status |
|-------|----------|--------|--------|
| #1 startBuild Error UI | High | UX confusion | 📝 Documented |
| #2 Phase Labels Not Updating | High | Core feature broken | 📝 Documented |
| #3 Planning Not Restarting | Critical | Tasks stuck | 📝 Documented |
| #4 Recovery Wrong Handler | Critical | Tasks stuck | 📝 Documented |
| #5 Terminal Not Legible | High | User confusion | 📝 Documented |
| #6 Auto-Transition Bug | Critical | Workflow broken | 📝 Documented |
| #7 No Planning Complete Alert | High | User misses review | 📝 Documented |
| #8 Kanban Drag Auto-Starts | **Critical** | Bypasses Start Build | 📝 Documented |
| #9 No User-Initiated Flag | High | Can't distinguish sources | 📝 Documented |
| #10 Validation Too Permissive | Medium | No gate enforcement | 📝 Documented |

---

## Next Steps

### Priority Order

**CRITICAL (Must Fix First):**
1. **Issue #8:** Remove auto-start from TASK_UPDATE_STATUS handler (Kanban drag bypass)
2. **Issue #6:** Fix phaseToStatus mapping auto-transition
3. **Issue #9:** Add `userInitiated` flag to distinguish transition sources
4. **Issue #3/#4:** Fix recovery logic for planning tasks

**HIGH (Fix After Critical):**
5. **Issue #7:** Add alert when planning completes
6. **Issue #1:** Add toast notifications for startBuild failures
7. **Issue #5:** Improve terminal readability
8. **Issue #2:** Trace IPC flow for phase label updates
9. **Issue #10:** Add gate enforcement to validateStatusTransition()

### Key Architectural Principle

**PLANNING and CODING are SEPARATE:**

```
┌─────────────────────────────────────────────────────────────────┐
│                     TWO SEPARATE AGENTS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PLANNING AGENT              │     CODING AGENT               │
│   ──────────────              │     ────────────               │
│   • Auto-starts on task       │     • Only starts on user      │
│     creation                  │       "Start Build" click      │
│   • Creates spec.md           │     • Reads spec.md            │
│   • Creates impl_plan.json    │     • Executes subtasks        │
│   • Runs spec_runner.py       │     • Runs run.py              │
│   • Status: 'planning'        │     • Status: 'coding'         │
│                               │                                │
│         ↓                     │           ↓                    │
│   ALERT USER ────────────────►│◄── USER CLICKS START BUILD     │
│   "Spec ready for review"     │                                │
│                               │                                │
└─────────────────────────────────────────────────────────────────┘
```

The transition between these agents is a **USER-CONTROLLED GATE**.

---

## Related Documentation

- [Task Architecture](../architecture/TASK_ARCHITECTURE.md) - Status/Phase system
- [Integration Workflow](INTEGRATION_WORKFLOW.md) - v2.7.6 implementation details
- [Task Status Fix Plan](TASK_STATUS_FIX_PLAN.md) - Original fix plan

---

**End of Known Issues Documentation**
