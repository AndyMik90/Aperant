# Cross-Project Task Contamination: Missing projectId in Agent Event Pipeline

## Description

When running multiple projects simultaneously, agent events from one project can corrupt the status, badges, and column placement of tasks in another project. The root cause is that the entire agent event pipeline (from process spawn through XState state machine to disk persistence) identifies tasks by `specId` alone, with no project scoping. Since specIds are derived from task descriptions and are not unique across projects, `findTaskAndProject(taskId)` returns the first match across all loaded projects, routing events to the wrong task.

## Severity

**High** - Silent data corruption. Affected tasks show wrong status, wrong badges, land in wrong Kanban columns, and persist corrupted state to disk. On refresh, the corrupted state is reloaded, making the damage permanent until manually fixed.

## Affected Versions

All versions using the XState task state machine (PR #1575 and later).

## Steps to Reproduce

1. Open Auto Claude and load two projects (e.g., "Project A" and "Project B")
2. In Project A, create a task with a specific name (e.g., "write wtf to text file") - this generates specId `016-write-wtf-to-text-file`
3. In Project B, create a task with the same name - this generates the same specId `016-write-wtf-to-text-file`
4. Start both tasks simultaneously (or start Project A's task first, let it reach QA, then start Project B's task)
5. Switch between projects and observe the Kanban board

## Expected Results

- Each project's task progresses independently through its own lifecycle
- Events from Project A's agent process only affect Project A's task card
- Events from Project B's agent process only affect Project B's task card
- Refreshing the app preserves the correct status for both tasks
- Switching between projects shows each task in its correct column with the correct badge

## Actual Results

- Tasks in the non-active project show wrong status badges (e.g., "Coding" badge on a task still in the Planning column)
- Tasks snap to the wrong Kanban column after refresh
- Tasks get stuck in states they should have transitioned out of (e.g., permanently stuck in "Planning")
- "Incomplete" badges appear on tasks that completed their phase successfully
- QA tasks appear in "In Progress" column instead of "AI Review" column after switching projects
- The corrupted state persists to `implementation_plan.json`, so the damage survives app restart

## Root Cause

### Task Identity Collision

Every task has two identifiers:

- **`task.id`** - A UUID, unique globally
- **`task.specId`** - The spec directory name (e.g., `016-write-wtf-to-text-file`), derived from the task description, **not unique across projects**

The backend process uses `specId` as the task identifier in stdout markers. All agent event handlers resolve this back to a Task object via `findTaskAndProject(taskId)`, which searches all projects and returns the first match.

### Missing projectId in Event Pipeline

The agent event pipeline has no project scoping:

```
Backend process (Python)
  -> stdout/stderr (phase markers, task events, logs)
    -> agent-process.ts (parses output, emits typed events)
      -> agent-manager.ts (EventEmitter relay)
        -> agent-events-handlers.ts (event handlers)
          -> findTaskAndProject(taskId)  <-- COLLISION POINT
            -> taskStateManager (XState actor)
              -> persistPlanStatusAndReasonSync (disk)
              -> safeSendToRenderer (IPC to UI)
```

None of the `AgentManagerEvents` carry a `projectId`:

```typescript
// BEFORE: no way to scope events to the correct project
interface AgentManagerEvents {
  log: (taskId: string, log: string) => void;
  error: (taskId: string, error: string) => void;
  exit: (taskId: string, code: number | null, processType: ProcessType) => void;
  'execution-progress': (taskId: string, progress: ExecutionProgressData) => void;
  'task-event': (taskId: string, event: TaskEventPayload) => void;
}
```

### Impact on XState

The `TaskStateManager` maintains one XState actor per taskId and drives column placement, badge display, disk persistence, and renderer notifications. When an event is routed to the wrong project's actor:

1. The actor receives an event invalid for its current state (e.g., `PLANNING_COMPLETE` sent to an actor in `qa_review`)
2. XState either drops the event or transitions to an unexpected state
3. The wrong project's `implementation_plan.json` is overwritten with incorrect status fields
4. On app refresh, the task loads from the corrupted plan file and appears in the wrong column
5. Subsequent legitimate events may be rejected because the actor is in a state that doesn't accept them

### Contamination Example

Given:
- **Project A**: task `016-write-wtf-to-text-file` in QA (`qa_review` state)
- **Project B**: task `016-write-wtf-to-text-file` just started (`planning` state)

When Project B's planner emits `PLANNING_COMPLETE`:
1. `agent-process.ts` emits `task-event` with `taskId = "016-write-wtf-to-text-file"` and no projectId
2. `findTaskAndProject("016-write-wtf-to-text-file")` returns **Project A's task** (first match)
3. `PLANNING_COMPLETE` is sent to **Project A's XState actor** (which is in `qa_review`)
4. Project A's plan file is corrupted; Project B's task never receives the event

## Observed Symptoms

| Symptom | Cause |
|---------|-------|
| "Coding" badge on a task in the Planning column | Project B's `CODING_STARTED` event hit Project A's planning task |
| Task snaps to backlog on refresh | Plan file overwritten without XState fields; wrong project looked up for re-stamp |
| "Incomplete" badge on a task that just finished planning | `PROCESS_EXITED` event from Project B's process hit Project A's `plan_review` actor |
| QA task in "In Progress" column with "AI Review" badge | Execution progress event wrote wrong status to plan file |
| Task stuck in "Planning" forever | Events meant for this task were consumed by the duplicate in another project |

## Fix

Thread `projectId` from the IPC handler that starts each agent process through the entire event pipeline to the lookup function.

### Propagation Chain

```
execution-handlers.ts
  agentManager.startSpecCreation(..., project.id)       <- Origin: project.id from IPC handler
  agentManager.startTaskExecution(..., project.id)
  agentManager.startQAProcess(..., project.id)

agent-manager.ts
  storeTaskContext(..., projectId)                       <- Stored in execution context
  processManager.spawnProcess(..., projectId)            <- Passed to process spawner

agent-process.ts
  this.emitter.emit('log', taskId, ..., projectId)      <- Attached to every emitted event
  this.emitter.emit('task-event', taskId, ..., projectId)
  this.emitter.emit('execution-progress', ..., projectId)
  this.emitter.emit('exit', taskId, ..., projectId)
  this.emitter.emit('error', taskId, ..., projectId)

agent-events-handlers.ts
  findTaskAndProject(taskId, projectId)                  <- Scoped lookup
  taskStateManager.handleTaskEvent(...)                  <- Correct actor receives event
  persistPlanStatusAndReasonSync(...)                    <- Correct plan file updated
  safeSendToRenderer(..., projectId)                     <- Renderer filters by project
```

### Scoped Lookup

`findTaskAndProject` now accepts an optional `projectId`. When provided, it searches only the target project. Falls back to searching all projects for backward compatibility (file watcher events, renderer-initiated actions).

## Files Changed

| File | Change |
|------|--------|
| `apps/frontend/src/main/agent/types.ts` | Added `projectId?: string` to all event signatures |
| `apps/frontend/src/main/agent/agent-manager.ts` | Added `projectId` to context storage, start methods, restart flow |
| `apps/frontend/src/main/agent/agent-process.ts` | Added `projectId` to `spawnProcess` and all `emitter.emit()` calls |
| `apps/frontend/src/main/ipc-handlers/task/shared.ts` | Scoped `findTaskAndProject` by projectId with fallback |
| `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts` | All event handlers receive and forward projectId |
| `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts` | All 9 `agentManager.start*` call sites pass `project.id` |
| `apps/frontend/src/__tests__/integration/subprocess-spawn.test.ts` | Updated test expectations for new projectId parameter |

## Verification

- [ ] Run two projects simultaneously with tasks that have the same specId
- [ ] Verify events from Project A only affect Project A's task cards
- [ ] Verify events from Project B only affect Project B's task cards
- [ ] Refresh the app during various lifecycle stages - tasks remain in correct columns
- [ ] Switch between projects during QA - task stays in AI Review column
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (2639 tests, 0 failures)
