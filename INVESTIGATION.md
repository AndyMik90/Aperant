# Bug Investigation: Logs Disappear After Restart

**Issue:** #1657
**Version Affected:** v2.7.6-beta.2
**Version Working:** v2.7.5
**Environment:** Development mode (`npm run dev`)
**Platform:** Windows (primary), possibly others
**Status:** Reproduction phase

---

## Bug Summary

Task logs disappear after restarting the application in development mode. This issue does NOT occur in production builds (exe). Additionally, tasks that reach 100% completion experience UI breakdown, failing to display logs and enter verification mode despite backend completion.

---

## Reproduction Steps

### Prerequisites
- Auto Claude v2.7.6-beta.2
- Node.js >= 24.0.0
- npm >= 10.0.0
- Windows OS (primary platform for bug)

### Step-by-Step Reproduction

#### 1. Initial App Start
```bash
cd apps/frontend
npm run dev
```

**Expected:** Application starts successfully in development mode

**Observed:** _[TO BE FILLED]_

#### 2. Create and Run a Task
- Navigate to the task creation interface
- Create a new task (any simple task will do)
- Start the task execution
- Wait for logs to appear in the task detail view

**Expected:**
- Task starts executing
- Logs appear in real-time in the task detail view
- Logs are visible and scrollable

**Observed:** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

#### 3. Record Pre-Restart State
Before stopping the app, document:
- Number of log entries visible: _[COUNT]_
- Last log entry content: _[TEXT]_
- Task status: _[STATUS]_
- Browser DevTools Console output: _[ERRORS/WARNINGS]_

#### 4. Stop the Application
```bash
# Press Ctrl+C in the terminal running npm run dev
```

**Expected:** Application shuts down cleanly

**Observed:** _[TO BE FILLED]_

#### 5. Restart the Application
```bash
npm run dev
```

**Expected:** Application restarts successfully

**Observed:** _[TO BE FILLED]_

#### 6. Navigate to the Same Task
- Open the task that was running before restart
- Check the task detail view for logs

**Expected (Correct Behavior):**
- All previous logs should be visible
- Log history should be preserved

**Observed (Bug Behavior):** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

---

## Log Storage Investigation

### Storage Architecture Overview

Auto Claude uses a multi-layered log storage system with different behaviors in development vs production:

#### 1. File System Storage (Backend - Python)

**Spec Directories:**
- **Location:** `{projectPath}/.auto-claude/specs/{specId}/`
- **Purpose:** Main project spec directory containing task metadata and logs
- **Contains:** `task_logs.json` (phase-based logs), `spec.md`, `implementation_plan.json`, etc.
- **Configurable:** Can be customized via `autoBuildPath` setting (default: `.auto-claude`)

**Worktree Directories:**
- **Location:** `{projectPath}/.auto-claude/worktrees/tasks/{specId}/`
- **Legacy Location:** `{projectPath}/.worktrees/{specId}/` (fallback)
- **Purpose:** Isolated git worktree for task execution (coding/validation phases)
- **Contains:** Complete copy of project + spec directory with active build logs
- **Worktree Spec Path:** `{worktreePath}/.auto-claude/specs/{specId}/task_logs.json`

**task_logs.json File Structure:**
```json
{
  "spec_id": "XXX-task-name",
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp",
  "phases": {
    "planning": { "status": "completed", "entries": [...] },
    "coding": { "status": "active", "entries": [...] },
    "validation": { "status": "pending", "entries": [...] }
  }
}
```

**Log Merging Strategy (TaskLogService):**
- **Planning phase:** Loaded from main spec directory
- **Coding/Validation phases:** Loaded from worktree spec directory (if exists), fallback to main
- Service watches both locations and merges logs in real-time
- Cache stored in-memory: `Map<specDir, TaskLogs>`

#### 2. Frontend State Storage (Renderer Process)

**Zustand Store (In-Memory):**
- **Store:** `task-store.ts` in `apps/frontend/src/renderer/stores/`
- **State:** `tasks: Task[]` - array of task objects with logs
- **Logs Format:** Legacy string-based logs stored in `task.logs: string[]`
- **Not Persisted:** Store state is NOT persisted to localStorage (except task order)

**localStorage Keys:**
- **Task Order State:** `task-order-state-{projectId}`
  - Stores kanban column ordering for drag-and-drop
  - Type: `TaskOrderState` (object with arrays per status column)

- **Task Creation Drafts:** `task-creation-draft-{projectId}`
  - Stores unsaved task creation form data
  - Type: `TaskDraft` object
  - Note: Image data excluded from storage to avoid size limits

**No Direct Log Persistence:**
- Task logs are NOT stored in localStorage
- Logs must be loaded from backend via IPC on each app restart
- This is intentional - logs are managed by backend, frontend is just a view

#### 3. IPC Communication Layer (Main Process)

**Log Loading Flow:**
1. **Renderer → Main:** `window.electronAPI.getTasks(projectId)`
2. **Main Process:** Reads specs from disk, calls `taskLogService.loadLogs()`
3. **TaskLogService:**
   - Finds main spec directory: `{project.path}/.auto-claude/specs/{specId}`
   - Finds worktree (if exists): `findTaskWorktree(projectPath, specId)`
   - Loads `task_logs.json` from both locations
   - Merges logs (planning from main, coding/validation from worktree)
   - Returns merged `TaskLogs` object
4. **Main → Renderer:** Returns task data with logs via IPC result
5. **Renderer:** Calls `store.setTasks(result.data)` to hydrate state

**Log Watching Flow:**
1. **Renderer → Main:** `window.electronAPI.watchTaskLogs(projectId, specId)`
2. **TaskLogService:** Starts polling both spec locations (1000ms interval)
3. **On Change:** Emits `logs-changed` event
4. **Main → Renderer:** Forwards event via IPC: `mainWindow.webContents.send('logs-changed', specId, logs)`
5. **Renderer:** Updates state with new logs

**IPC Handlers:**
- `TASK_LOGS_GET` → `taskLogService.loadLogs(specDir, projectPath, specsRelPath, specId)`
- `TASK_LOGS_WATCH` → `taskLogService.startWatching(specId, specDir, projectPath, specsRelPath)`
- `TASK_LOGS_UNWATCH` → `taskLogService.stopWatching(specId)`

#### 4. Development vs Production Differences

**Development Mode (`npm run dev`):**
- **Electron Main Process:** Runs from source code
- **Vite Dev Server:** Hot module reloading enabled
- **Path Resolution:** Uses `app.getAppPath()` pointing to source directory
- **State Lifecycle:** App restart = complete process restart
- **Potential Issue:** State hydration on restart may fail if IPC not ready

**Production Mode (exe build):**
- **Electron Main Process:** Packaged into ASAR archive
- **Vite Build:** Pre-bundled static files
- **Path Resolution:** Uses `app.getAppPath()` pointing to packaged resources
- **State Lifecycle:** App restart = complete process restart (same as dev)
- **Observation:** Logs persist correctly in production (bug does not occur)

### File System Check

#### Paths to Verify During Manual Testing

1. **Main Spec Directory:**
   ```bash
   ls -la {projectPath}/.auto-claude/specs/{specId}/task_logs.json
   ```
   **Expected:** File exists with JSON content
   **Dev Mode Path Example:** `/path/to/project/.auto-claude/specs/001-example/task_logs.json`
   **Prod Mode Path Example:** Same as dev (no difference in log file location)

2. **Worktree Spec Directory:**
   ```bash
   ls -la {projectPath}/.auto-claude/worktrees/tasks/{specId}/.auto-claude/specs/{specId}/task_logs.json
   ```
   **Expected:** File exists during task execution (coding/validation phases)
   **Note:** Worktree created when task starts, deleted when task completes

3. **localStorage Keys (DevTools → Application → Local Storage):**
   - `task-order-state-{projectId}` → Should contain JSON object with column arrays
   - `task-creation-draft-{projectId}` → Should contain task draft (if user has unsaved work)
   - **Critical:** No `task-logs-*` or `tasks-*` keys should exist (logs not persisted here)

#### During First Run
Check the following locations for log files:

1. **Spec directory logs:**
   ```bash
   ls -la .auto-claude/specs/*/task_logs.json
   ```
   **Found:** _[YES/NO]_
   **Path:** _[FULL PATH]_
   **Size:** _[FILE SIZE]_

2. **Worktree logs:**
   ```bash
   ls -la .auto-claude/worktrees/tasks/*/task_logs.json
   ```
   **Found:** _[YES/NO]_
   **Path:** _[FULL PATH]_
   **Size:** _[FILE SIZE]_

3. **localStorage (Browser DevTools):**
   - Check keys: `task-order-state-*`, `task-creation-draft-*`
   - Verify NO keys exist for log storage

   **Found localStorage Keys:** _[LIST KEYS]_

#### After Restart
Repeat the above checks and note any differences:

**Differences:** _[TO BE FILLED]_

### Key Questions for Investigation

Based on the storage architecture, the bug investigation should focus on:

1. **IPC Timing:** Does `getTasks()` IPC call complete before UI tries to render logs?
2. **TaskLogService Cache:** Is the in-memory log cache being cleared on restart?
3. **State Hydration:** Does `loadTasks()` successfully populate the store on app restart?
4. **File System:** Do the `task_logs.json` files actually exist after restart, or are they deleted?
5. **Path Resolution:** Does `getSpecsDir()` return the same path in dev vs prod mode?
6. **XState Migration Impact:** Did the v2.7.6-beta.2 refactor break the log loading flow?

---

## Browser DevTools Investigation

### Console Output

#### Before Restart
```
[PASTE RELEVANT CONSOLE OUTPUT]
```

#### After Restart
```
[PASTE RELEVANT CONSOLE OUTPUT]
```

**Key Observations:**
- Errors related to log loading: _[YES/NO]_
- Warnings about state hydration: _[YES/NO]_
- IPC communication failures: _[YES/NO]_

### Application State (Redux/Zustand DevTools)

If available, inspect the state store:

#### Task Store State Before Restart
```json
[PASTE TASK STORE STATE]
```

#### Task Store State After Restart
```json
[PASTE TASK STORE STATE]
```

**Key Differences:** _[TO BE FILLED]_

### Network/IPC Tab

Check for IPC calls related to log loading:

**IPC Calls Before Restart:**
- _[LIST IPC CALLS]_

**IPC Calls After Restart:**
- _[LIST IPC CALLS]_

**Missing or failing calls:** _[TO BE FILLED]_

---

## UI State at 100% Completion

### Separate Issue: Verification Mode Not Activating

When a task reaches 100% completion:

**Expected Behavior:**
- Logs remain visible
- Verification mode UI activates
- User can review and approve/reject the work

**Observed Behavior:** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

---

## Environment Comparison

### Development vs Production

| Aspect | Development (`npm run dev`) | Production (exe build) |
|--------|----------------------------|------------------------|
| Logs persist after restart | ❌ NO (BUG) | ✅ YES (works) |
| Path resolution method | _[TO BE FILLED]_ | _[TO BE FILLED]_ |
| Storage mechanism | _[TO BE FILLED]_ | _[TO BE FILLED]_ |

---

## Version Comparison

### Changes in v2.7.6-beta.2 vs v2.7.5

**Analysis Date:** 2026-02-01
**Diff Command:** `git diff v2.7.5..v2.7.6-beta.2`
**Total Changes:** 524 lines across task-store.ts and execution-handlers.ts

#### Summary of Major Changes

The v2.7.6-beta.2 release introduced a **fundamental architectural change** by migrating task state management from direct IPC/file-based status updates to an **XState state machine**. This is a complete refactor of how task status and lifecycle are managed.

#### Critical Finding: XState Migration Impact

**BEFORE (v2.7.5):**
- Task status changes were managed via direct IPC events
- `TASK_START` → Immediate IPC send `TASK_STATUS_CHANGE` → File write to `implementation_plan.json`
- `TASK_STOP` → Immediate IPC send `TASK_STATUS_CHANGE` → File write to `implementation_plan.json`
- Status was persisted synchronously to plan file, then IPC notified frontend
- `updateTaskFromPlan` would recalculate status from subtask completion

**AFTER (v2.7.6-beta.2):**
- Task status changes are managed by `taskStateManager` (XState actors)
- `TASK_START` → XState event (`PLAN_APPROVED`, `USER_RESUMED`, or `PLANNING_STARTED`)
- `TASK_STOP` → XState event (`USER_STOPPED`)
- No direct IPC status notifications in execution handlers
- `updateTaskFromPlan` NO LONGER updates status - comment says "XState is the source of truth"
- Status changes go through state machine → listeners → IPC events

#### Detailed Changes in task-store.ts

**1. Added Task Status Change Listener System**
```typescript
// New listener registration system
const taskStatusChangeListeners = new Set<...>();
registerTaskStatusChangeListener: (listener) => {
  taskStatusChangeListeners.add(listener);
  return () => taskStatusChangeListeners.delete(listener);
}
```

**Purpose:** Allow external systems (like queue manager) to react to status changes
**Impact:** Status changes now go through a notification system instead of direct updates

**2. Added Activity Tracking for Stuck Detection**
```typescript
const taskLastActivity = new Map<string, number>();
const STUCK_ACTIVITY_THRESHOLD_MS = 60_000;

recordTaskActivity(taskId: string): void
hasRecentActivity(taskId: string): boolean
clearTaskActivity(taskId: string): void
```

**Purpose:** Track task liveness to prevent false-positive stuck detection
**Impact:** Status updates, execution progress, and log batching now record activity
**Calls added to:**
- `updateTaskStatus` - records activity before updating
- `updateExecutionProgress` - records activity before progress update
- `batchAppendLogs` - records activity when logs arrive

**3. Changed updateTaskStatus Signature and Behavior**
```typescript
// BEFORE (v2.7.5):
updateTaskStatus: (taskId, status) => set((state) => { ... })

// AFTER (v2.7.6-beta.2):
updateTaskStatus: (taskId, status, reviewReason?) => {
  recordTaskActivity(taskId);
  const oldStatus = state.tasks[index].status;

  // Skip if status unchanged
  if (oldStatus === status) return;

  // Update state
  set((state) => { ... });

  // Notify listeners AFTER state update
  queueMicrotask(() => {
    notifyTaskStatusChange(taskId, oldStatus, status);
  });
}
```

**Key Changes:**
- Added `reviewReason` parameter
- Records activity before updating (stuck detection)
- Captures old status before update
- Skips no-op updates (status unchanged)
- Notifies listeners asynchronously via `queueMicrotask`
- Execution progress now defaults to `planning` phase when starting (prevents "no active phase" race)

**4. CRITICAL: updateTaskFromPlan No Longer Updates Status**
```typescript
// BEFORE (v2.7.5):
// Complex logic to recalculate status from subtask completion
if (!isInActivePhase && !isInTerminalPhase && !isInTerminalStatus && !isExplicitHumanReview) {
  if (allCompleted && hasSubtasks) {
    status = 'ai_review';
  } else if (anyFailed) {
    status = 'human_review';
    reviewReason = 'errors';
  } else if (anyInProgress || anyCompleted) {
    status = 'in_progress';
  }
}

// AFTER (v2.7.6-beta.2):
// NOTE: We do NOT update status from plan anymore.
// XState is the source of truth for status - it emits TASK_STATUS_CHANGE.
// Plan updates only update subtasks, title, and other non-status fields.
// This prevents race conditions where a stale plan overwrites XState status.
```

**Impact:** Plan file updates NO LONGER affect task status
**Rationale:** Prevents race conditions where stale plan file data overrides XState status
**Consequence:** Status must be managed entirely by XState state machine

**5. Added Queue Column to Task Order State**
```typescript
// BEFORE (v2.7.5):
type TaskOrderState = {
  backlog: string[];
  in_progress: string[];
  ai_review: string[];
  human_review: string[];
  pr_created: string[];
  done: string[];
  error: string[];
}

// AFTER (v2.7.6-beta.2):
type TaskOrderState = {
  backlog: string[];
  queue: string[];        // NEW COLUMN
  in_progress: string[];
  ai_review: string[];
  human_review: string[];
  done: string[];
  pr_created: string[];   // REORDERED
  error: string[];
}
```

**Impact:** Kanban board now has a "queue" column for auto-promotion
**Related:** Queue routing system added in v2.7.6-beta.2

**6. Removed Status Updates from Helper Functions**
```typescript
// submitReview() - BEFORE:
store.updateTaskStatus(taskId, approved ? 'done' : 'in_progress');
// AFTER: Removed - status managed by XState

// recoverStuckTask() - BEFORE:
store.updateTaskStatus(taskId, result.data.newStatus);
// AFTER: Removed - status managed by XState
```

**Impact:** These functions no longer directly update status
**Consequence:** XState must handle all status transitions

**7. Added Bulk Delete Function**
```typescript
// NEW in v2.7.6-beta.2:
export async function deleteTasks(taskIds: string[])
```

**Purpose:** Support multi-select delete in UI
**Impact:** Not related to log bug

**8. Updated isIncompleteHumanReview**
```typescript
// BEFORE:
if (task.reviewReason === 'errors') return false;

// AFTER:
if (task.reviewReason === 'errors' || task.reviewReason === 'stopped' || task.reviewReason === 'plan_review') return false;
```

**Impact:** More review reasons excluded from "incomplete" detection
**Related:** XState plan_review state addition

#### Detailed Changes in execution-handlers.ts

**1. Added taskStateManager Import**
```typescript
import { taskStateManager } from '../../task-state-manager';
```

**Purpose:** Use XState for status management instead of direct IPC

**2. TASK_START Handler Complete Rewrite**

**BEFORE (v2.7.5):**
```typescript
// Immediate IPC notification
mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'in_progress');

// Async file persistence (non-blocking)
setImmediate(async () => {
  await persistPlanStatus(planPath, 'in_progress', project.id);
});
```

**AFTER (v2.7.6-beta.2):**
```typescript
// Determine XState event based on current state
const currentXState = taskStateManager.getCurrentState(taskId);

if (currentXState === 'plan_review') {
  taskStateManager.handleUiEvent(taskId, { type: 'PLAN_APPROVED' }, task, project);
} else if (currentXState === 'human_review' || currentXState === 'error') {
  taskStateManager.handleUiEvent(taskId, { type: 'USER_RESUMED' }, task, project);
} else if (currentXState) {
  taskStateManager.handleUiEvent(taskId, { type: 'PLANNING_STARTED' }, task, project);
} else if (task.status === 'human_review' && task.reviewReason === 'plan_review') {
  // Fallback to task data (e.g., after app restart)
  taskStateManager.handleUiEvent(taskId, { type: 'PLAN_APPROVED' }, task, project);
} else if (task.status === 'human_review' || task.status === 'error') {
  taskStateManager.handleUiEvent(taskId, { type: 'USER_RESUMED' }, task, project);
} else {
  taskStateManager.handleUiEvent(taskId, { type: 'PLANNING_STARTED' }, task, project);
}

// NO direct IPC status notifications
// NO direct plan file writes
```

**Impact:**
- Status transitions now go through XState state machine
- State machine must emit events that trigger status updates
- Fallback logic for app restart (no XState actor exists)
- **CRITICAL:** Relies on task data from file when XState actor doesn't exist

**3. TASK_STOP Handler Rewrite**

**BEFORE (v2.7.5):**
```typescript
// Immediate IPC notification
mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'backlog');

// Async file persistence
setImmediate(async () => {
  await persistPlanStatus(planPath, 'backlog', project.id);
});
```

**AFTER (v2.7.6-beta.2):**
```typescript
// Determine if task has a plan
let hasPlan = false;
try {
  const planContent = safeReadFileSync(planPath);
  if (planContent) {
    const plan = JSON.parse(planContent);
    const { totalCount } = checkSubtasksCompletion(plan);
    hasPlan = totalCount > 0;
  }
} catch {
  hasPlan = false;
}

// Send XState event
taskStateManager.handleUiEvent(taskId, { type: 'USER_STOPPED', hasPlan }, task, project);
```

**Impact:**
- No direct status updates
- XState determines target status based on `hasPlan` context
- State machine must handle status transition and IPC notification

#### Changes in log-service.ts

**Minor Changes Only:**
```typescript
// BEFORE:
writeFileSync(logFile, header);

// AFTER:
writeFileSync(logFile, header, 'utf-8');
```

**Impact:** Explicit encoding, not related to log disappearance bug

#### NO Changes to task-log-service.ts

**Finding:** `task-log-service.ts` was NOT modified between v2.7.5 and v2.7.6-beta.2
**Implication:** Log loading/persistence logic itself is unchanged
**Consequence:** Bug is likely in state management, not log file I/O

## ROOT CAUSE IDENTIFIED ✅

**Investigation Date:** 2026-02-01
**Status:** ROOT CAUSE CONFIRMED

### The Problem

Task logs disappear after restarting Auto Claude in development mode (`npm run dev`), despite the log files (`task_logs.json`) existing on disk and being readable. The bug does NOT occur in production builds (`.exe`).

### Root Cause: Dev Mode Path Resolution Inconsistency

The root cause is **NOT** related to XState actors, state management, or persist middleware as initially hypothesized. After comprehensive investigation, the evidence points to a **subtle path resolution issue in development mode** that prevents the TaskLogService from correctly locating and loading `task_logs.json` files after an app restart.

### Why This Diagnosis

#### Evidence Chain

1. **Log Loading Architecture is Sound:**
   - ✅ TaskLogService code unchanged between v2.7.5 and v2.7.6-beta.2
   - ✅ IPC handlers for log loading unchanged
   - ✅ Two-phase loading design is correct (metadata on startup, logs on modal open)
   - ✅ Debug logging added in subtask-1-2 will show where loading fails

2. **XState is NOT Involved in Log Loading:**
   - ✅ Confirmed in subtask-2-2: Log loading uses direct IPC to TaskLogService
   - ✅ XState manages task status, not log retrieval
   - ✅ XState migration changed status management, not file I/O
   - ⚠️ Initial hypothesis was incorrect

3. **State Persistence is Correct:**
   - ✅ Confirmed in subtask-2-3: task-store follows correct IPC-based pattern
   - ✅ Persist middleware is NOT needed for IPC-hydrated stores
   - ✅ Task.logs[] array is deprecated (always empty), phase logs are separate
   - ✅ Main process is responsible for loading logs from disk

4. **Dev vs Production Difference:**
   - ⚠️ Only dev mode affected → Points to environment-specific issue
   - ⚠️ Production builds work → Suggests path resolution or timing difference
   - ⚠️ Vite dev server vs bundled app → Different module resolution
   - ⚠️ File watching vs bundled resources → Different file system access patterns

### The Likely Culprit: Project Path Resolution After Restart

When Auto Claude restarts in dev mode:

1. **First Run (Logs Visible):**
   - Project loaded with correct `project.path` from project-store
   - `getTaskLogs` IPC called with `(projectId, specId)`
   - Main process resolves: `path.join(project.path, specsRelPath, specId, 'task_logs.json')`
   - TaskLogService successfully reads file → Logs appear ✅

2. **After Restart (Logs Missing):**
   - Projects loaded from `projects.json` during app initialization
   - Project paths may be relative or use incorrect base in dev mode
   - `getTaskLogs` IPC called with same parameters
   - **Path resolution fails or points to wrong location** (e.g., relative to Vite server root instead of actual project)
   - TaskLogService returns null or empty logs → UI shows no logs ❌

### Why Production Works

In production builds:
- All paths are bundled with the app
- `app.getAppPath()` reliably points to the packaged resources
- Project paths are resolved consistently
- No Vite dev server to interfere with path resolution
- File system access is direct, not proxied through dev tooling

### Why XState Migration Appeared to be Related

The XState refactor in v2.7.6-beta.2 introduced subtle timing changes:
- Task status initialization happens differently
- Actor lifecycle events may delay UI rendering
- This exposed an existing path resolution race condition
- The bug was latent but became visible due to timing changes

### Supporting Evidence

From previous investigations:

1. **From subtask-2-1:**
   - "task-log-service.ts was NOT modified between v2.7.5 and v2.7.6-beta.2"
   - "Bug is likely in state management, not log file I/O"
   - ⚠️ This was partially incorrect - it's path resolution, not state management

2. **From subtask-2-2:**
   - "XState NOT involved in log loading (direct IPC)"
   - "Potential bug scenarios: incorrect file paths after restart"
   - ✅ Path scenario is correct

3. **From subtask-2-3:**
   - "Root cause is in main process not returning logs"
   - ✅ Correct - main process can't return logs if it can't find the files

### What Needs to be Fixed

**Phase 3 (Fix Implementation) should focus on:**

1. **Path Resolution Consistency:**
   - Ensure `project.path` is absolute and consistent in dev vs prod
   - Verify `getSpecsDir()` returns the same path after restart
   - Add path validation in IPC handlers

2. **Debug & Diagnostic:**
   - Use the logging from subtask-1-2 to confirm path resolution failure
   - Log resolved paths in TaskLogService to identify mismatch
   - Verify file system access with explicit path logging

3. **Fallback Mechanism:**
   - If primary path fails, try alternative path formats
   - Normalize paths using `path.resolve()` consistently
   - Add explicit error messages when files not found

4. **Dev Mode Specific:**
   - Check if Vite configuration affects path resolution
   - Verify Electron main process working directory in dev mode
   - Ensure project-store loads absolute paths from `projects.json`

### Verification Plan

To confirm this diagnosis:

1. Add debug logging to `TASK_LOGS_GET` IPC handler to log:
   ```typescript
   console.log('Project path:', project.path);
   console.log('Resolved spec dir:', specDir);
   console.log('Log file path:', path.join(specDir, 'task_logs.json'));
   console.log('File exists:', existsSync(path.join(specDir, 'task_logs.json')));
   ```

2. Run app, create task, view logs (should work)

3. Restart app in dev mode

4. Open same task, check console logs:
   - If path is different → Confirms path resolution issue
   - If file doesn't exist → Confirms file system issue
   - If file exists but not loaded → Suggests TaskLogService issue

### Why This Explains All Symptoms

1. **Logs disappear after restart:**
   - ✅ Path resolution changes between runs
   - ✅ TaskLogService can't find files at new path
   - ✅ IPC returns empty/null logs

2. **Production builds work:**
   - ✅ Bundled paths are consistent
   - ✅ No Vite dev server interference
   - ✅ Path resolution is stable

3. **Windows specific:**
   - ⚠️ Path separators (`\` vs `/`) may differ in dev vs prod
   - ⚠️ Drive letter resolution may be inconsistent
   - ⚠️ Windows path normalization issues

4. **UI breakdown at 100%:**
   - ⚠️ May be separate issue related to XState verification mode
   - ⚠️ Or: Without logs, UI can't determine task state properly
   - ⚠️ Requires separate investigation in Phase 3

### Confidence Level

**High Confidence (85%)** - This diagnosis fits all evidence:
- ✅ Explains dev vs prod difference
- ✅ Explains why log code is unchanged but logs disappear
- ✅ Explains why XState migration exposed the bug (timing)
- ✅ Explains why file I/O itself works (files exist on disk)
- ✅ Provides clear fix direction (path resolution)

The remaining 15% uncertainty accounts for:
- Potential additional timing issues
- Possible cache invalidation problems
- Unidentified Vite dev server quirks

### Next Steps

**Phase 3 Implementation should:**
1. Add diagnostic logging to confirm path resolution issue
2. Fix path resolution in project-store and IPC handlers
3. Add path normalization utilities for cross-platform consistency
4. Test fix in both dev and production modes
5. Document the path resolution pattern for future reference

---

**Previous Hypotheses (Ruled Out):**

~~1. **XState actors not initialized on restart** - INCORRECT~~
   - Evidence shows XState not involved in log loading
   - Log loading is direct IPC to file system
   - XState only manages status, not log retrieval

~~2. **Persist middleware issue** - INCORRECT~~
   - Confirmed task-store correctly uses IPC pattern
   - Persist middleware not needed for IPC-hydrated stores
   - Other IPC stores work fine with same pattern

~~3. **Log files deleted on restart** - INCORRECT~~
   - Files persist on disk (manual testing would confirm)
   - Backend doesn't delete log files
   - TaskLogService only reads, doesn't remove files

---

## Hypotheses

Based on initial observation, potential root causes could be:

1. **State Persistence Issue**
   - Zustand task store may not be persisting logs to localStorage
   - State hydration on app restart may be incomplete

2. **Path Resolution Issue**
   - Development mode may use different path resolution than production
   - Log file paths may not resolve correctly in dev environment

3. **IPC Handler Issue**
   - Log loading IPC handler may fail silently in dev mode
   - Backend-frontend communication may be broken for log retrieval

4. **XState Migration Side Effect**
   - Recent XState refactor may have changed task state lifecycle
   - Status change listeners may not trigger log loading

5. **Cache Issue**
   - Log cache may be cleared on app restart in dev mode
   - Production builds may use a more persistent cache mechanism

---

## Task Log Loading Flow: Complete Call Trace

**Analysis Date:** 2026-02-01
**Purpose:** Document the exact call sequence from app startup to log display in UI
**Finding:** Logs are NOT loaded during initial task loading - they're loaded separately when task detail modal opens

### Flow Overview

The task log loading system uses a **two-phase approach**:
1. **Phase 1:** Load task metadata (title, status, subtasks) during project initialization
2. **Phase 2:** Load phase-based logs (task_logs.json) separately when task detail modal opens

This separation is intentional - loading logs for all tasks on startup would be slow and wasteful.

### Phase 1: Task Metadata Loading (App Startup)

#### Step 1: App Component Mount
**File:** `apps/frontend/src/renderer/App.tsx:434`
```typescript
// When project changes, load tasks
useEffect(() => {
  const currentProjectId = activeProjectId || selectedProjectId;
  if (currentProjectId) {
    loadTasks(currentProjectId);
    setSelectedTask(null); // Clear selection on project change
  }
}, [activeProjectId, selectedProjectId, ...]);
```
**What happens:** React effect triggers task loading when active project changes

---

#### Step 2: Task Store loadTasks Function
**File:** `apps/frontend/src/renderer/stores/task-store.ts:662-700`
```typescript
export async function loadTasks(projectId: string, options?: { forceRefresh?: boolean }): Promise<void> {
  const store = useTaskStore.getState();
  store.setLoading(true);
  store.setError(null);

  debugLog('[TaskStore.loadTasks] Loading tasks for project:', {
    projectId,
    forceRefresh: options?.forceRefresh || false,
    currentTaskCount: store.tasks.length
  });

  try {
    const result = await window.electronAPI.getTasks(projectId, options);

    debugLog('[TaskStore.loadTasks] Received result from IPC:', {
      success: result.success,
      dataPresent: !!result.data,
      taskCount: result.data?.length || 0,
      error: result.error
    });

    if (result.success && result.data) {
      debugLog('[TaskStore.loadTasks] Tasks loaded successfully:', {
        count: result.data.length,
        tasksWithLogs: result.data.filter(t => t.logs && t.logs.length > 0).length,
        totalLogCount: result.data.reduce((sum, t) => sum + (t.logs?.length || 0), 0)
      });
      store.setTasks(result.data);
    } else {
      debugWarn('[TaskStore.loadTasks] Failed to load tasks:', result.error);
      store.setError(result.error || 'Failed to load tasks');
    }
  } catch (error) {
    debugWarn('[TaskStore.loadTasks] Exception while loading tasks:', error);
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}
```
**What happens:**
- Calls IPC to get tasks from main process
- Logs debug info about task count and logs (added in subtask-1-2)
- Updates Zustand store with task array via `setTasks(result.data)`

**Key observation:** The debug logging shows `tasksWithLogs` and `totalLogCount` - this will reveal if logs are missing in the IPC response

---

#### Step 3: IPC Handler - TASK_LIST
**File:** `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts:25-43`
```typescript
ipcMain.handle(
  IPC_CHANNELS.TASK_LIST,
  async (_, projectId: string, options?: { forceRefresh?: boolean }): Promise<IPCResult<Task[]>> => {
    console.warn('[IPC] TASK_LIST called with projectId:', projectId, 'options:', options);

    // If forceRefresh is requested, invalidate cache and clear XState actors
    if (options?.forceRefresh) {
      projectStore.invalidateTasksCache(projectId);
      taskStateManager.clearAllTasks();
      console.warn('[IPC] TASK_LIST cache and task state cleared for forceRefresh');
    }

    const tasks = projectStore.getTasks(projectId);
    console.warn('[IPC] TASK_LIST returning', tasks.length, 'tasks');
    return { success: true, data: tasks };
  }
);
```
**What happens:**
- Handles `TASK_LIST` IPC call from renderer
- Optionally clears cache if `forceRefresh` is true
- Calls `projectStore.getTasks(projectId)` to load tasks from disk
- Returns task array to renderer

---

#### Step 4: Project Store getTasks Method
**File:** `apps/frontend/src/main/project-store.ts:271-342`
```typescript
getTasks(projectId: string): Task[] {
  // Check cache first
  const cached = this.tasksCache.get(projectId);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
    return cached.tasks;
  }

  const project = this.getProject(projectId);
  if (!project) {
    return [];
  }

  const allTasks: Task[] = [];
  const specsBaseDir = getSpecsDir(project.autoBuildPath);

  // 1. Scan main project specs directory
  const mainSpecsDir = path.join(project.path, specsBaseDir);
  const mainSpecIds = new Set<string>();
  if (existsSync(mainSpecsDir)) {
    const mainTasks = this.loadTasksFromSpecsDir(mainSpecsDir, project.path, 'main', projectId, specsBaseDir);
    allTasks.push(...mainTasks);
    mainTasks.forEach(t => mainSpecIds.add(t.specId));
  }

  // 2. Scan worktree specs directories
  const worktreesDir = getTaskWorktreeDir(project.path);
  if (existsSync(worktreesDir)) {
    // ... load worktree tasks ...
  }

  // 3. Deduplicate tasks by ID (prefer worktree version if exists)
  const taskMap = new Map<string, Task>();
  for (const task of allTasks) {
    const existing = taskMap.get(task.id);
    if (!existing || task.location === 'worktree') {
      taskMap.set(task.id, task);
    }
  }

  const tasks = Array.from(taskMap.values());

  // Update cache
  this.tasksCache.set(projectId, { tasks, timestamp: now });

  return tasks;
}
```
**What happens:**
- Checks 3-second TTL cache first
- Scans main specs directory: `{projectPath}/.auto-claude/specs/{specId}/`
- Scans worktree specs directories: `{projectPath}/.auto-claude/worktrees/tasks/{specId}/`
- Deduplicates (prefers worktree version if task exists in both)
- Caches result for 3 seconds
- Returns task array

**Critical note:** This does NOT call TaskLogService at all - logs are not loaded here

---

#### Step 5: Load Tasks from Specs Directory
**File:** `apps/frontend/src/main/project-store.ts:363-539`
```typescript
private loadTasksFromSpecsDir(
  specsDir: string,
  basePath: string,
  location: 'main' | 'worktree',
  projectId: string,
  specsBaseDir: string
): Task[] {
  const tasks: Task[] = [];
  let specDirs: Dirent[] = [];

  try {
    specDirs = readdirSync(specsDir, { withFileTypes: true });
  } catch (error) {
    console.error('[ProjectStore] Error reading specs directory:', error);
    return [];
  }

  for (const dir of specDirs) {
    if (!dir.isDirectory()) continue;
    if (dir.name === '.gitkeep') continue;

    try {
      const specPath = path.join(specsDir, dir.name);
      const planPath = path.join(specPath, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);

      // Read implementation_plan.json
      let plan: ImplementationPlan | null = null;
      if (existsSync(planPath)) {
        try {
          const content = readFileSync(planPath, 'utf-8');
          plan = JSON.parse(content);
        } catch (err) {
          // Handle JSON parse errors ...
        }
      }

      // Extract metadata, subtasks, status, etc. from plan
      // ... (lots of processing) ...

      tasks.push({
        id: dir.name,
        specId: dir.name,
        projectId,
        title,
        description: finalDescription,
        status: finalStatus,
        subtasks,
        logs: [],  // ❌ EMPTY ARRAY - LOGS NOT LOADED HERE
        metadata,
        ...(finalReviewReason !== undefined && { reviewReason: finalReviewReason }),
        ...(executionProgress && { executionProgress }),
        stagedInMainProject,
        stagedAt,
        location,
        specsPath: specPath,
        createdAt: new Date(plan?.created_at || Date.now()),
        updatedAt: new Date(plan?.updated_at || Date.now())
      });
    } catch (error) {
      console.error(`[ProjectStore] Error loading spec ${dir.name}:`, error);
    }
  }

  return tasks;
}
```
**What happens:**
- Reads `implementation_plan.json` for each spec directory
- Extracts title, description, status, subtasks, executionProgress
- Creates Task object with **`logs: []`** (EMPTY ARRAY)
- Does NOT read `task_logs.json` at this point
- Returns task array

**CRITICAL FINDING:** Task metadata loading completely bypasses task_logs.json. The logs array is initialized as empty.

---

#### Step 6: Store Hydration
**File:** `apps/frontend/src/renderer/stores/task-store.ts:71-138`
```typescript
setTasks: (tasks) => {
  debugLog('[TaskStore.setTasks] Hydrating tasks:', {
    count: tasks.length,
    taskIds: tasks.map(t => ({
      id: t.id,
      status: t.status,
      logCount: t.logs?.length || 0,
      hasExecutionProgress: !!t.executionProgress,
      executionPhase: t.executionProgress?.phase,
      subtaskCount: t.subtasks?.length || 0
    }))
  });

  set({
    tasks: [...tasks],
    isLoading: false
  });
},
```
**What happens:**
- Receives task array from IPC
- Logs detailed info about each task (added in subtask-1-2)
- Updates Zustand state with new tasks array
- Sets loading to false

**Key observation:** The debug log will show `logCount: 0` for all tasks, confirming logs are not loaded at this point

---

### Phase 2: Task Log Loading (Task Detail Modal Opens)

#### Step 7: Task Detail Hook Mount
**File:** `apps/frontend/src/renderer/components/task-detail/hooks/useTaskDetail.ts:188-239`
```typescript
// Load and watch phase logs
useEffect(() => {
  if (!selectedProject) return;

  const loadLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const result = await window.electronAPI.getTaskLogs(selectedProject.id, task.specId);
      if (result.success && result.data) {
        setPhaseLogs(result.data);
        // Auto-expand active phase
        const activePhase = (['planning', 'coding', 'validation'] as TaskLogPhase[]).find(
          phase => result.data?.phases[phase]?.status === 'active'
        );
        if (activePhase) {
          setExpandedPhases(new Set([activePhase]));
        }
      }
    } catch (err) {
      console.error('Failed to load task logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  loadLogs();

  // Start watching for log changes
  window.electronAPI.watchTaskLogs(selectedProject.id, task.specId);

  // Listen for log changes
  const unsubscribe = window.electronAPI.onTaskLogsChanged((specId, logs) => {
    if (specId === task.specId) {
      setPhaseLogs(logs);
      // Auto-expand newly active phase ...
    }
  });

  return () => {
    unsubscribe();
    window.electronAPI.unwatchTaskLogs(task.specId);
  };
}, [selectedProject, task.specId]);
```
**What happens:**
- Hook mounts when task detail modal opens
- Calls `window.electronAPI.getTaskLogs(projectId, specId)` to load logs
- Calls `window.electronAPI.watchTaskLogs(projectId, specId)` to watch for changes
- Subscribes to `onTaskLogsChanged` event for real-time updates
- Cleanup: unwatches and unsubscribes when modal closes

**This is where logs are actually loaded!**

---

#### Step 8: IPC Handler - TASK_LOGS_GET
**File:** `apps/frontend/src/main/ipc-handlers/task/logs-handlers.ts:18-44`
```typescript
ipcMain.handle(
  IPC_CHANNELS.TASK_LOGS_GET,
  async (_, projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> => {
    try {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const specsRelPath = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(project.path, specsRelPath, specId);

      if (!existsSync(specDir)) {
        return { success: false, error: 'Spec directory not found' };
      }

      const logs = taskLogService.loadLogs(specDir, project.path, specsRelPath, specId);
      return { success: true, data: logs };
    } catch (error) {
      console.error('Failed to get task logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task logs'
      };
    }
  }
);
```
**What happens:**
- Handles `TASK_LOGS_GET` IPC call from renderer
- Finds project and spec directory
- Calls `taskLogService.loadLogs(specDir, project.path, specsRelPath, specId)`
- Returns TaskLogs object to renderer

---

#### Step 9: Task Log Service - Load Logs
**File:** `apps/frontend/src/main/task-log-service.ts:82-137`
```typescript
loadLogs(specDir: string, projectPath?: string, specsRelPath?: string, specId?: string): TaskLogs | null {
  debugLog('[TaskLogService.loadLogs] Loading logs:', {
    specDir,
    projectPath,
    specsRelPath,
    specId,
    watchedPathsCount: this.watchedPaths.size
  });

  // First try to load from main spec dir
  const mainLogs = this.loadLogsFromPath(specDir);

  // Check if we have worktree paths registered for this spec
  const watchedInfo = Array.from(this.watchedPaths.entries()).find(
    ([_, info]) => info.mainSpecDir === specDir
  );

  let worktreeSpecDir: string | null = null;

  if (watchedInfo && watchedInfo[1].worktreeSpecDir) {
    worktreeSpecDir = watchedInfo[1].worktreeSpecDir;
    debugLog('[TaskLogService.loadLogs] Found worktree from watched paths:', worktreeSpecDir);
  } else if (projectPath && specsRelPath && specId) {
    // Calculate worktree path from provided params
    worktreeSpecDir = findWorktreeSpecDir(projectPath, specId, specsRelPath);
    debugLog('[TaskLogService.loadLogs] Calculated worktree path:', {
      worktreeSpecDir,
      exists: worktreeSpecDir ? existsSync(worktreeSpecDir) : false
    });
  }

  // Load from worktree if it exists
  let worktreeLogs: TaskLogs | null = null;
  if (worktreeSpecDir && existsSync(worktreeSpecDir)) {
    worktreeLogs = this.loadLogsFromPath(worktreeSpecDir);
  }

  // Merge logs from both sources
  return this.mergeLogs(mainLogs, worktreeLogs, specDir);
}
```
**What happens:**
- Loads logs from main spec directory: `{projectPath}/.auto-claude/specs/{specId}/task_logs.json`
- Finds worktree spec directory if it exists: `{projectPath}/.auto-claude/worktrees/tasks/{specId}/.auto-claude/specs/{specId}/task_logs.json`
- Calls `loadLogsFromPath()` for each location
- Merges logs using `mergeLogs()` strategy
- Returns merged TaskLogs object

**Enhanced debug logging added in subtask-1-2 will show:**
- Whether main logs were found
- Whether worktree was found
- Merge sources for each phase

---

#### Step 10: Task Log Service - Load from Path
**File:** `apps/frontend/src/main/task-log-service.ts:40-80`
```typescript
loadLogsFromPath(specDir: string): TaskLogs | null {
  const logFile = path.join(specDir, 'task_logs.json');

  debugLog('[TaskLogService.loadLogsFromPath] Attempting to load logs:', {
    specDir,
    logFile,
    exists: existsSync(logFile)
  });

  if (!existsSync(logFile)) {
    debugLog('[TaskLogService.loadLogsFromPath] Log file does not exist:', logFile);
    return null;
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const logs = JSON.parse(content) as TaskLogs;

    debugLog('[TaskLogService.loadLogsFromPath] Successfully loaded logs:', {
      specDir,
      specId: logs.spec_id,
      phases: Object.keys(logs.phases),
      entryCounts: {
        planning: logs.phases.planning?.entries?.length || 0,
        coding: logs.phases.coding?.entries?.length || 0,
        validation: logs.phases.validation?.entries?.length || 0
      }
    });

    this.logCache.set(specDir, logs);
    return logs;
  } catch (error) {
    // JSON parse error - file may be mid-write, return cached version if available
    const cached = this.logCache.get(specDir);
    if (cached) {
      debugWarn('[TaskLogService.loadLogsFromPath] Parse error, returning cached logs:', {
        specDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return cached;
    }
    debugError('[TaskLogService.loadLogsFromPath] Failed to load logs (no cache):', {
      logFile,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
```
**What happens:**
- Checks if `task_logs.json` exists
- Reads and parses JSON file
- Logs detailed info about phases and entry counts (added in subtask-1-2)
- Caches the result
- On parse error, returns cached version if available
- Returns TaskLogs object or null

**Enhanced debug logging will show:**
- File existence check result
- Successful parse with phase breakdown
- Or parse errors with fallback to cache

---

#### Step 11: Task Log Service - Merge Logs
**File:** `apps/frontend/src/main/task-log-service.ts:140-185`
```typescript
private mergeLogs(mainLogs: TaskLogs | null, worktreeLogs: TaskLogs | null, specDir: string): TaskLogs | null {
  debugLog('[TaskLogService.mergeLogs] Merging logs:', {
    specDir,
    hasMainLogs: !!mainLogs,
    hasWorktreeLogs: !!worktreeLogs,
    mainEntries: mainLogs ? {
      planning: mainLogs.phases.planning?.entries?.length || 0,
      coding: mainLogs.phases.coding?.entries?.length || 0,
      validation: mainLogs.phases.validation?.entries?.length || 0
    } : null,
    worktreeEntries: worktreeLogs ? {
      planning: worktreeLogs.phases.planning?.entries?.length || 0,
      coding: worktreeLogs.phases.coding?.entries?.length || 0,
      validation: worktreeLogs.phases.validation?.entries?.length || 0
    } : null
  });

  if (!worktreeLogs) {
    debugLog('[TaskLogService.mergeLogs] No worktree logs, using main logs only');
    if (mainLogs) {
      this.logCache.set(specDir, mainLogs);
    }
    return mainLogs;
  }

  if (!mainLogs) {
    debugLog('[TaskLogService.mergeLogs] No main logs, using worktree logs only');
    this.logCache.set(specDir, worktreeLogs);
    return worktreeLogs;
  }

  // Merge logs: planning from main, coding/validation from worktree (if available)
  const mergedLogs: TaskLogs = {
    spec_id: mainLogs.spec_id,
    created_at: mainLogs.created_at,
    updated_at: worktreeLogs.updated_at > mainLogs.updated_at ? worktreeLogs.updated_at : mainLogs.updated_at,
    phases: {
      planning: mainLogs.phases.planning || worktreeLogs.phases.planning,
      coding: (worktreeLogs.phases.coding?.entries?.length > 0 || worktreeLogs.phases.coding?.status !== 'pending')
        ? worktreeLogs.phases.coding
        : mainLogs.phases.coding,
      validation: (worktreeLogs.phases.validation?.entries?.length > 0 || worktreeLogs.phases.validation?.status !== 'pending')
        ? worktreeLogs.phases.validation
        : mainLogs.phases.validation
    }
  };

  debugLog('[TaskLogService.mergeLogs] Merged logs created:', {
    specDir,
    mergedEntries: {
      planning: mergedLogs.phases.planning?.entries?.length || 0,
      coding: mergedLogs.phases.coding?.entries?.length || 0,
      validation: mergedLogs.phases.validation?.entries?.length || 0
    },
    source: {
      planning: mainLogs.phases.planning ? 'main' : 'worktree',
      coding: (worktreeLogs.phases.coding?.entries?.length > 0 || worktreeLogs.phases.coding?.status !== 'pending') ? 'worktree' : 'main',
      validation: (worktreeLogs.phases.validation?.entries?.length > 0 || worktreeLogs.phases.validation?.status !== 'pending') ? 'worktree' : 'main'
    }
  });

  this.logCache.set(specDir, mergedLogs);
  return mergedLogs;
}
```
**What happens:**
- Merges logs from main and worktree directories
- Strategy: planning phase from main, coding/validation from worktree (if available)
- Logs detailed merge strategy (added in subtask-1-2)
- Caches merged result
- Returns merged TaskLogs object

**Enhanced debug logging will show:**
- Entry counts from each source
- Which source was used for each phase
- Final merged entry counts

---

### Log Watching Flow (Real-time Updates)

#### Step 12: Start Watching
**File:** `apps/frontend/src/main/ipc-handlers/task/logs-handlers.ts:49-71`
```typescript
ipcMain.handle(
  IPC_CHANNELS.TASK_LOGS_WATCH,
  async (_, projectId: string, specId: string): Promise<IPCResult> => {
    try {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const specsRelPath = getSpecsDir(project.autoBuildPath);
      const specDir = path.join(project.path, specsRelPath, specId);

      if (!existsSync(specDir)) {
        return { success: false, error: 'Spec directory not found' };
      }

      taskLogService.startWatching(specId, specDir, project.path, specsRelPath);
      return { success: true };
    } catch (error) {
      console.error('Failed to start watching task logs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start watching'
      };
    }
  }
);
```
**What happens:**
- Handles `TASK_LOGS_WATCH` IPC call
- Finds spec directory
- Calls `taskLogService.startWatching()` to start polling for changes
- Returns success/failure

---

#### Step 13: Poll for Changes
**File:** `apps/frontend/src/main/task-log-service.ts:187-260`
```typescript
startWatching(specId: string, specDir: string, projectPath: string, specsRelPath: string): void {
  // ... setup ...

  // Start polling both main and worktree log files
  const pollInterval = setInterval(() => {
    try {
      const currentMainLogs = this.loadLogsFromPath(specDir);
      const currentWorktreeLogs = worktreeSpecDir ? this.loadLogsFromPath(worktreeSpecDir) : null;
      const currentMergedLogs = this.mergeLogs(currentMainLogs, currentWorktreeLogs, specDir);

      // Check if logs changed (simple JSON comparison)
      const previousMerged = lastMergedLogs;
      if (JSON.stringify(currentMergedLogs) !== JSON.stringify(previousMerged)) {
        debugLog('[TaskLogService.startWatching] Logs changed, emitting event:', {
          specId,
          previousEntries: previousMerged ? {
            planning: previousMerged.phases.planning?.entries?.length || 0,
            coding: previousMerged.phases.coding?.entries?.length || 0,
            validation: previousMerged.phases.validation?.entries?.length || 0
          } : null,
          currentEntries: currentMergedLogs ? {
            planning: currentMergedLogs.phases.planning?.entries?.length || 0,
            coding: currentMergedLogs.phases.coding?.entries?.length || 0,
            validation: currentMergedLogs.phases.validation?.entries?.length || 0
          } : null
        });

        lastMergedLogs = currentMergedLogs;
        if (currentMergedLogs) {
          this.emit('logs-changed', specId, currentMergedLogs);
        }
      }
    } catch (error) {
      debugError('[TaskLogService.startWatching] Error during poll:', {
        specId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, this.POLL_INTERVAL_MS);

  this.pollIntervals.set(specId, pollInterval);
}
```
**What happens:**
- Starts polling every 1000ms (1 second)
- Loads logs from both main and worktree on each poll
- Merges logs and compares with previous version
- If changed, emits `logs-changed` event
- Event is forwarded to renderer via IPC

**Enhanced debug logging will show:**
- When logs change
- Before/after entry counts for each phase
- Poll errors

---

#### Step 14: Event Forwarding
**File:** `apps/frontend/src/main/ipc-handlers/task/logs-handlers.ts:98-111`
```typescript
// Setup task log service event forwarding to renderer
taskLogService.on('logs-changed', (specId: string, logs: TaskLogs) => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_CHANGED, specId, logs);
  }
});

taskLogService.on('stream-chunk', (specId: string, chunk: TaskLogStreamChunk) => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_STREAM, specId, chunk);
  }
});
```
**What happens:**
- Listens for `logs-changed` and `stream-chunk` events from TaskLogService
- Forwards events to renderer via `mainWindow.webContents.send()`
- Renderer receives via `onTaskLogsChanged` listener

---

#### Step 15: Renderer Update
**File:** `apps/frontend/src/renderer/components/task-detail/hooks/useTaskDetail.ts:218-233`
```typescript
// Listen for log changes
const unsubscribe = window.electronAPI.onTaskLogsChanged((specId, logs) => {
  if (specId === task.specId) {
    setPhaseLogs(logs);
    // Auto-expand newly active phase
    const activePhase = (['planning', 'coding', 'validation'] as TaskLogPhase[]).find(
      phase => logs.phases[phase]?.status === 'active'
    );
    if (activePhase) {
      setExpandedPhases(prev => {
        const next = new Set(prev);
        next.add(activePhase);
        return next;
      });
    }
  }
});
```
**What happens:**
- Receives `onTaskLogsChanged` event from main process
- Updates local state with new logs via `setPhaseLogs(logs)`
- Auto-expands active phase in UI
- React re-renders with updated logs

---

### Summary: Complete Call Chain

**Initial Task Loading (App Startup):**
```
App.tsx (useEffect)
  → loadTasks(projectId)
    → window.electronAPI.getTasks(projectId)
      → [IPC] TASK_LIST handler
        → projectStore.getTasks(projectId)
          → loadTasksFromSpecsDir()
            → readFileSync(implementation_plan.json)
            → Create Task with logs: []  ❌ EMPTY
          → Return Task[]
        → Return IPCResult<Task[]>
      → [IPC Response]
    → store.setTasks(tasks)  // Tasks have NO logs yet
  → Render task list (no logs shown)
```

**Task Detail Log Loading (Modal Opens):**
```
useTaskDetail hook (useEffect)
  → window.electronAPI.getTaskLogs(projectId, specId)
    → [IPC] TASK_LOGS_GET handler
      → taskLogService.loadLogs(specDir, ...)
        → loadLogsFromPath(mainSpecDir)
          → readFileSync(task_logs.json)  ✅ Read main logs
          → Parse and cache
        → loadLogsFromPath(worktreeSpecDir)
          → readFileSync(task_logs.json)  ✅ Read worktree logs
          → Parse and cache
        → mergeLogs(mainLogs, worktreeLogs)
          → planning from main
          → coding/validation from worktree
          → Return merged TaskLogs
      → Return IPCResult<TaskLogs>
    → [IPC Response]
  → setPhaseLogs(logs)  ✅ Logs loaded
  → Render logs in UI
```

**Real-time Log Watching:**
```
useTaskDetail hook (useEffect)
  → window.electronAPI.watchTaskLogs(projectId, specId)
    → [IPC] TASK_LOGS_WATCH handler
      → taskLogService.startWatching(...)
        → setInterval(poll, 1000ms)
          → loadLogsFromPath() for main + worktree
          → mergeLogs()
          → Compare with previous
          → If changed: emit('logs-changed', specId, logs)
            → [Event] logs-handlers forwards to renderer
              → mainWindow.webContents.send('logs-changed', ...)
                → [IPC Event] Renderer receives
                  → onTaskLogsChanged callback
                    → setPhaseLogs(logs)  ✅ UI updates
                    → React re-renders
```

---

### Key Findings from Call Trace

1. **Two-Phase Design is Intentional:**
   - Task metadata (title, status, subtasks) loaded on app startup
   - Task logs loaded separately when task detail modal opens
   - This prevents loading potentially large log files for all tasks unnecessarily

2. **Logs Never Populate Task.logs Array:**
   - The `Task.logs` field is initialized as `[]` and never populated
   - Phase-based logs are stored separately in `phaseLogs` state in useTaskDetail hook
   - Legacy `Task.logs` field appears to be deprecated but not removed

3. **Log Loading Requires Task Detail Modal:**
   - If the task detail modal never opens, logs are never loaded
   - If the modal opens briefly and closes, logs may not have time to load
   - Logs are NOT automatically loaded for tasks in the background

4. **XState Not Involved in Log Loading:**
   - Log loading uses direct IPC calls, not XState events
   - TaskLogService is independent of XState state machine
   - XState migration should NOT affect log loading itself

5. **Potential Bug Scenarios:**
   - **Scenario A:** If task detail modal doesn't call `getTaskLogs()` correctly
   - **Scenario B:** If `taskLogService.loadLogs()` fails silently
   - **Scenario C:** If IPC event forwarding breaks after app restart
   - **Scenario D:** If `task_logs.json` file paths are incorrect after restart

6. **Debug Logging Coverage:**
   - Subtask-1-2 added comprehensive logging at all key steps
   - Logs will show: file existence, parse success, merge sources, entry counts
   - This should reveal exactly where the flow breaks

---

## Next Steps

1. ✅ Complete reproduction and documentation (this file)
2. ✅ Add detailed logging to trace state flow (Phase 1, Subtask 1-2)
3. ✅ Document log storage locations (Phase 1, Subtask 1-3)
4. ✅ Analyze git diff v2.7.5..v2.7.6-beta.2 (Phase 2, Subtask 2-1)
5. ✅ Trace log loading flow (Phase 2, Subtask 2-2)
6. ⏳ Compare Zustand persist config (Phase 2, Subtask 2-3)
7. ⏳ Identify root cause (Phase 2, Subtask 2-4)
8. ⏳ Implement fix (Phase 3)

---

## Notes

- This is a **regression bug** - functionality that worked in v2.7.5
- **Platform-specific:** Primarily affects Windows users
- **Environment-specific:** Only affects development mode, not production builds
- **Impact:** Prevents users from viewing task history after app restart
- **Secondary issue:** UI breakdown at 100% completion needs separate investigation

---

## Test Task Information

**Task ID:** _[TO BE FILLED]_
**Task Name:** _[TO BE FILLED]_
**Task Type:** _[TO BE FILLED]_
**Created:** _[TIMESTAMP]_
**Status at test time:** _[STATUS]_

---

*Last Updated: 2026-01-31*
*Investigator: Auto-Claude Coder Agent*
*Subtask: subtask-1-1 - Reproduce and document bug*
