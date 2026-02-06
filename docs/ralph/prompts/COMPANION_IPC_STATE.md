# COMPANION_IPC_STATE: IPC Channels, Event Handlers, Store State

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (6m 32s)
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Depends On:** COMPANION_LIFECYCLE (run that first)

---

## Problem

The companion lifecycle events from agent-manager need to flow to the renderer. The frontend needs IPC channels, event handlers, task-store state, and useIpc listeners so the UI knows when a companion is active for a task.

## Goal

Wire up the full IPC pipeline: agent-manager events -> IPC handlers -> renderer store -> React components.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing COMPANION_IPC_STATE for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Wire up the IPC pipeline for companion agent events. Add IPC channel constants, event handlers that forward companion-spawned/stopped events to the renderer, task-store state for tracking which tasks have active companions, and useIpc listeners that update the store.

Read the existing IPC patterns in ipc-channels.ts, agent-events-handlers.ts, task-store.ts, and useIpc.ts before making changes.

---

COMPANION_IPC_STATE: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Add IPC channel constants | apps/frontend/src/shared/ipc-channels.ts | MODIFY - find the IPC_CHANNELS object and add three new channels: TASK_COMPANION_SPAWNED with value 'task:companion-spawned', TASK_COMPANION_STOPPED with value 'task:companion-stopped', and TASK_SEND_COMPANION_MESSAGE with value 'task:send-companion-message'. Follow the exact naming convention of existing channels. | TASK_1_COMPLETE |
| 2 | Add companion event handlers | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | MODIFY - add three things: (a) Listen for agentManager.on('companion-spawned') and forward to renderer via safeSendToRenderer with TASK_COMPANION_SPAWNED channel. (b) Listen for agentManager.on('companion-stopped') and forward via TASK_COMPANION_STOPPED. (c) In the existing agentManager.on('exit') handler, add an early return for processType === 'companion' — when companion exits, just send TASK_COMPANION_STOPPED to renderer and return without any status transition logic. (d) Add an ipcMain.handle for TASK_SEND_COMPANION_MESSAGE that calls agentManager.sendMessageToTask(taskId, message). (e) In the existing TASK_START_BUILD handler, add await agentManager.stopCompanion(taskId) before the existing execution start logic. | TASK_2_COMPLETE |
| 3 | Add companion state to task store | apps/frontend/src/renderer/stores/task-store.ts | MODIFY - add: (a) companionActive field of type Set<string> initialized to new Set(). (b) setCompanionActive(taskId: string, active: boolean) action that adds/removes from the Set (follow the same pattern as setAgentStopped). (c) hasCompanion(taskId: string) getter that returns companionActive.has(taskId). Add these to the TaskState interface and the store implementation. | TASK_3_COMPLETE |
| 4 | Add companion useIpc listeners | apps/frontend/src/renderer/hooks/useIpc.ts | MODIFY - add two useEffect listeners following the existing patterns: (a) Listen for TASK_COMPANION_SPAWNED — call useTaskStore.getState().setCompanionActive(taskId, true). (b) Listen for TASK_COMPANION_STOPPED — call useTaskStore.getState().setCompanionActive(taskId, false). Follow the exact same pattern as existing IPC listeners in this file (window.api.on, cleanup with window.api.off). | TASK_4_COMPLETE |

FINAL: <promise>COMPANION_IPC_STATE_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. IPC channel names must follow existing convention ('task:companion-spawned' etc.)
2. Companion exit in the exit handler must NOT trigger any task status changes
3. Companion exit must NOT trigger auto-swap/restart logic
4. TASK_START_BUILD handler must kill companion BEFORE starting execution
5. task-store Set pattern must match existing stoppedAgents Set pattern exactly
6. useIpc listeners must follow existing listener patterns with proper cleanup
7. sendMessageToTask already works for any running process — reuse it for companion messages
8. Also add companion message IPC to the preload API bridge if one exists (check agent-api.ts in preload/)

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT break any existing IPC handlers or event flows
3. Do NOT modify task status transition logic for non-companion processes
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "COMPANION_IPC_STATE_COMPLETE"
```
