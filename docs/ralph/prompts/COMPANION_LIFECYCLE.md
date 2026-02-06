# COMPANION_LIFECYCLE: Frontend Process Spawn/Kill/Auto-Spawn

**Date:** 2026-02-06
**Tasks:** 5
**Max Iterations:** 60
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (4m 22s)
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Depends On:** COMPANION_BACKEND (run that first)

---

## Problem

The frontend agent process manager doesn't know about companion agents. It needs methods to spawn companions, kill them when execution resumes, and auto-spawn them when an execution phase exits successfully.

## Goal

Add companion process lifecycle management to agent-process.ts and agent-manager.ts. When an execution process exits (code 0) and the task isn't complete/failed, auto-spawn a companion. When execution resumes (Start Build), kill the companion first.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing COMPANION_LIFECYCLE for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 5-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

---

OBJECTIVE: Add companion agent process lifecycle management to the frontend. The companion process should auto-spawn when an execution phase exits successfully, and be killed when the next execution phase starts. This requires changes to agent-process.ts (spawn/kill methods), agent-manager.ts (auto-spawn logic, companion tracking, handoff), and the shared types.

Read the existing code in agent-process.ts and agent-manager.ts thoroughly before making changes. Match the existing patterns exactly.

---

COMPANION_LIFECYCLE: 5 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Add companion ProcessType | apps/frontend/src/shared/types/task.ts | MODIFY - find the ProcessType union type and add 'companion' to it. Also find the AgentMode type (may be in agent-manager.ts or types) and add 'companion' to it. Search for both types across the codebase to find the exact location. | TASK_1_COMPLETE |
| 2 | Add spawnCompanion method | apps/frontend/src/main/agent/agent-process.ts | MODIFY - add a new async method spawnCompanion(taskId, specDir, projectDir, taskTitle, currentPhase, model?) that builds the CLI args for companion_runner.py (located at apps/backend/runners/companion_runner.py) and calls this.spawnProcess() with processType 'companion'. The args should be: [companionRunnerPath, '--spec-dir', specDir, '--project-dir', projectDir, '--task-title', taskTitle, '--current-phase', currentPhase, '--task-id', taskId, '--model', model]. Also add a stopCompanion(taskId) method that gets the process, marks its spawn as killed (this.state.markSpawnKilled), and kills it with SIGTERM. | TASK_2_COMPLETE |
| 3 | Add companion tracking to agent-manager | apps/frontend/src/main/agent/agent-manager.ts | MODIFY - add: (a) a private companionTasks Set<string> field to track which tasks have active companions. (b) async startCompanion(taskId) method that checks taskExecutionContext exists, task isn't completed/failed, no process already running, then calls this.processManager.spawnCompanion() with context from taskExecutionContext (specDir, projectPath, taskDescription). Sets agentMode to 'companion', adds to companionTasks, emits 'companion-spawned' event. (c) async stopCompanion(taskId) method that checks companionTasks, calls processManager.stopCompanion(), removes from tracking, waits 500ms, emits 'companion-stopped'. (d) a private getCompanionPhase(taskStatus) helper that maps status to phase string. | TASK_3_COMPLETE |
| 4 | Auto-spawn on execution exit | apps/frontend/src/main/agent/agent-manager.ts | MODIFY - in the existing 'exit' event handler (around line 76), add logic: when processType is NOT 'companion' AND code is 0 (success), call this.startCompanion(taskId) after a 1500ms delay (setTimeout). When processType IS 'companion', just clean up companionTasks tracking — do NOT trigger any status changes or restarts. Make sure the companion auto-spawn doesn't fire if the task is completed or failed. | TASK_4_COMPLETE |
| 5 | Kill companion on execution start | apps/frontend/src/main/agent/agent-manager.ts | MODIFY - in the existing startTaskExecution() method (around line 331), add 'await this.stopCompanion(taskId)' as the FIRST line before any existing logic. This ensures the companion is killed before the execution process spawns. Do the same in startPlanningAgent() if it exists — anywhere a new process is about to spawn for a task. | TASK_5_COMPLETE |

FINAL: <promise>COMPANION_LIFECYCLE_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Only ONE process per task at a time — companion must exit before execution spawns
2. Auto-spawn delay of 1500ms after execution exit — lets exit events propagate first
3. Don't auto-spawn if task status is 'completed' or 'failed'
4. Don't auto-spawn if a process is already running for the task
5. Companion exit should NOT trigger status changes (unlike execution exits)
6. Companion exit should NOT trigger auto-swap/restart logic
7. stopCompanion must use markSpawnKilled so the exit handler ignores the intentional kill
8. startCompanion must emit 'companion-spawned' event for IPC handlers to forward to renderer
9. stopCompanion must emit 'companion-stopped' event
10. Match existing code patterns — same error handling, logging, event emission style

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 5-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT change any existing execution/planning/QA process behavior
3. Do NOT modify the process exit handler for non-companion processes (only ADD companion logic)
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 5 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "COMPANION_LIFECYCLE_COMPLETE"
```
