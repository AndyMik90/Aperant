# PR #1575 Follow-up: XState Status Lifecycle & Cross-Project Contamination Fixes

## Overview

After the XState task state machine migration (PR #1575), several interrelated bugs surfaced when running multiple projects simultaneously and during normal task lifecycle transitions. These bugs caused tasks to appear in wrong columns, display incorrect badges, and lose status on refresh.

## Bug 1: Cross-Project Task Contamination

### Problem
When two projects have tasks with the same specId (e.g., both have a task `016-write-wtf-to-text-file`), events from Project A's task would affect Project B's task card. Tasks in the secondary project would show wrong status badges (e.g., "Coding" badge on a task in the Planning column).

### Root Cause
`findTaskAndProject(taskId)` searches ALL projects by matching `t.id === taskId || t.specId === taskId`, returning the first match. When the backend emits events using the specId as the task identifier, the lookup could match a task in the wrong project.

Agent events (log, error, exit, execution-progress, task-event) did not carry a `projectId`, so there was no way to scope the lookup to the correct project.

### Fix
- Added `projectId` to all `AgentManagerEvents` type signatures
- Pass `project.id` from all 9 `agentManager.start*` call sites in `execution-handlers.ts`
- Thread `projectId` through `agent-manager.ts` → `agent-process.ts` → all `emitter.emit()` calls
- Updated `findTaskAndProject(taskId, projectId?)` to scope search to the target project when `projectId` is provided, with fallback to searching all projects for backward compatibility
- All event handlers in `agent-events-handlers.ts` now receive and use `projectId`

### Files Changed
- `apps/frontend/src/main/agent/types.ts`
- `apps/frontend/src/main/agent/agent-manager.ts`
- `apps/frontend/src/main/agent/agent-process.ts`
- `apps/frontend/src/main/ipc-handlers/task/shared.ts`
- `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`
- `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
- `apps/frontend/src/__tests__/integration/subprocess-spawn.test.ts`

## Bug 2: "Incomplete" Badge on Plan Review Tasks

### Problem
Tasks with `requireReviewBeforeCoding=true` would complete planning, correctly transition to `plan_review` state, but then immediately show an "Incomplete" badge instead of "Planning" + "Approve Plan".

### Root Cause
Two issues combined:

1. **`PLANNING_COMPLETE` was not in the `TERMINAL_EVENTS` set.** When the spec creation process finished normally (exit code 0), `handleProcessExited` was called. Since `PLANNING_COMPLETE` wasn't terminal, the check didn't skip.

2. **`handleProcessExited` always sent `unexpected: true`**, even for exit code 0. This caused the XState guard `unexpectedExit` to pass, transitioning the task from `plan_review` → `error`, which overwrote the correct `plan_review` reviewReason.

### Fix
- Added `PLANNING_COMPLETE` to the `TERMINAL_EVENTS` set so process exit is skipped when planning has already completed
- Changed `handleProcessExited` to only set `unexpected: true` when `exitCode !== 0` — a code-0 exit is normal and should not trigger error transitions

### Files Changed
- `apps/frontend/src/main/task-state-manager.ts`

## Bug 3: Backend qa.py Racing with XState Status

### Problem
Tasks completing QA would sometimes show "Incomplete" instead of "Needs Review" because the `reviewReason` field was missing.

### Root Cause
The backend `qa.py` tool was writing `plan["status"] = "human_review"` directly to the plan file WITHOUT setting `reviewReason`. This raced with the frontend XState state machine's `persistPlanStatusAndReasonSync()` which writes both `status` and `reviewReason` together. When qa.py wrote last, it clobbered the `reviewReason`.

### Fix
Removed the backend's direct status writes from `qa.py`. The frontend XState state machine is now the sole owner of status transitions — the backend only updates `last_updated` timestamps and QA-specific fields.

### Files Changed
- `apps/backend/agents/tools_pkg/tools/qa.py`

## Bug 4: Plan File Overwrite by Planner Agent

### Problem
After a task started, the frontend would persist XState status fields (`status`, `xstateState`, `executionPhase`) to `implementation_plan.json`. The planner agent would then create the full plan using the Write tool, completely replacing the file and stripping the frontend's status fields. On refresh, the task would snap back to backlog.

### Root Cause
The planner agent writes `implementation_plan.json` via Claude's Write tool, which replaces the entire file. The agent-generated plan does not include frontend status fields (`xstateState`, `executionPhase`), so they are lost.

### Fix
Added a re-stamp mechanism in the file watcher's `progress` event handler. When the file watcher detects a plan file change and the `xstateState` field is missing (indicating the backend overwrote the file), the handler re-persists the current XState state back to the file. This also covers the worktree copy.

### Files Changed
- `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`

## Bug 5: QA Tasks in Wrong Column After Project Switch

### Problem
A task correctly in the "AI Review" column (status `ai_review`, phase `qa_review`) would snap to "In Progress" column after switching to another project and back. The "AI Review" badge would still show, but the card was in the wrong column.

### Root Cause
`persistPlanPhaseSync()` in `plan-file-utils.ts` mapped execution phases to TaskStatus for column placement. It incorrectly mapped `qa_review` and `qa_fixing` to `in_progress` instead of `ai_review`. Every execution-progress event during QA would overwrite the correct `ai_review` status (set by XState) with `in_progress`. On refresh (reading from disk), the task loaded with `status: 'in_progress'` + `executionPhase: 'qa_review'`, placing it in the In Progress column with an AI Review badge.

### Fix
Changed the phase-to-status mapping in `persistPlanPhaseSync`:
- `qa_review` → `ai_review` (was `in_progress`)
- `qa_fixing` → `ai_review` (was `in_progress`)

### Files Changed
- `apps/frontend/src/main/ipc-handlers/task/plan-file-utils.ts`

## Bug 6: updateTaskStatus Not Applying reviewReason

### Problem
Tasks completing planning with `requireReviewBeforeCoding=true` would show an "Incomplete" badge in the Human Review column instead of "Planning" + "Approve Plan". The persisted plan file had the correct `reviewReason: 'plan_review'`, so refreshing the app would fix it.

### Root Cause
`updateTaskStatus` in `task-store.ts` received `reviewReason` as a parameter but never applied it to the task object. The spread was `{ ...t, status, executionProgress }` — missing `reviewReason`. The skip condition also only checked `status`, not `reviewReason`, so transitions where only `reviewReason` changed (e.g., `human_review` with different reasons) were silently dropped.

### Fix
- Added `reviewReason` to the task spread: `{ ...t, status, reviewReason, executionProgress }`
- Updated skip condition to check both `status` AND `reviewReason`

### Files Changed
- `apps/frontend/src/renderer/stores/task-store.ts`

## Bug 7: Task Stuck in "In Progress" After Planning (requireReviewBeforeCoding)

### Problem
Tasks with `requireReviewBeforeCoding=true` would complete planning, XState would correctly transition to `plan_review`, but the task card would remain in the "In Progress" column with `status=in_progress, reviewReason=none, phase=planning`.

### Root Cause
When the process exits with code 1 (expected — the interactive review checkpoint fails in piped mode), `agent-process.ts` emits an `execution-progress` event with `phase: 'failed'` before the `exit` event. The `execution-progress` handler in `agent-events-handlers.ts`:

1. **Called `persistPlanPhaseSync` with `phase: 'failed'`**, which maps `failed` → `status: 'error'`, overwriting the `status: 'human_review'` that XState had already persisted to the plan file
2. **Sent `TASK_EXECUTION_PROGRESS` with `phase: 'failed'` to the renderer**, overwriting the `planning` phase that XState had already emitted via `emitPhaseFromState`

Both operations bypassed XState's authority as the source of truth for status.

### Fix
Added an XState "settled state" guard in the `execution-progress` handler. When XState has already transitioned to a settled state (`plan_review`, `human_review`, `error`, `creating_pr`, `pr_created`, `done`), the handler:
- Skips `persistPlanPhaseSync` to prevent overwriting XState's persisted status
- Skips sending `TASK_EXECUTION_PROGRESS` to the renderer to prevent overwriting XState's emitted phase

XState's own `persistStatus()` and `emitPhaseFromState()` already handle disk and renderer updates correctly when transitioning to these states.

### Files Changed
- `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts`

## Testing

All fixes pass:
- `npm run typecheck` — clean
- `npm run test` — 2649 tests passing, 0 failures
- Manual testing: multi-project with same specIds, review-required tasks, project switching during QA, refresh at all lifecycle stages
