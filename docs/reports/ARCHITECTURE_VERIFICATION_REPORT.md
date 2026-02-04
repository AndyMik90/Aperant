# Architecture Verification Report

**Date:** 2026-02-04
**Scope:** Planning → Coding Manual Gate Verification
**Result:** ✅ **CRITICAL BUG FOUND AND FIXED (FIX-17)**

---

## Executive Summary

Verified the Planning → Coding manual gate architecture at the code level. A critical bug was found in the `TASK_START` handler that could bypass the intended manual gate.

**Status:** ✅ **FIXED** (FIX-17 applied 2026-02-04)

The fix replaced file-existence checks with task.status-based routing in `execution-handlers.ts` lines 230-276.

---

## Verification Results

### ✅ PASS: Planning Agent Uses `--no-build` Flag

**File:** `agent-manager.ts` lines 228-329
**Method:** `startPlanningAgent()`

```typescript
// Lines 289-292
// PLANNING MODE: Pass --auto-approve and --no-build
args.push('--auto-approve');
args.push('--no-build');  // CRITICAL: Prevents auto-continuation
```

**Verdict:** The `startPlanningAgent()` method correctly uses `--no-build` to prevent auto-continuation to coding.

---

### ✅ PASS: TASK_START_BUILD Is The Only Path To Coding

**File:** `execution-handlers.ts` lines 403-532
**Handler:** `TASK_START_BUILD`

```typescript
// Lines 403-408 - Documentation
/**
 * Start Build: Phase 4 - Transition from planning → coding
 *
 * FIX-9: This is the ONLY path that starts the coding agent. It represents an
 * explicit user action (clicking "Start Build" button).
 */
```

**Logic:**
1. Validates spec.md and implementation_plan.json exist
2. Stops planning agent if running
3. Starts `startTaskExecution()` (coding agent)
4. Updates status to 'coding'

**Verdict:** TASK_START_BUILD handler is correctly implemented as the manual gate.

---

### ✅ PASS: TASK_UPDATE_STATUS Doesn't Auto-Start Agents

**File:** `execution-handlers.ts` lines 721-899
**Handler:** `TASK_UPDATE_STATUS`

```typescript
// Lines 887-888
// FIX-8: Auto-start removed - user must click "Start Build" button to start agent
// Status change to 'coding' now only changes the status, not auto-start agent
```

**Verdict:** Kanban drag-drop only changes status, doesn't start agents.

---

### ✅ PASS: Recovery Handler Doesn't Auto-Start Coding

**File:** `execution-handlers.ts` lines 939-1311
**Handler:** `TASK_RECOVER_STUCK`

```typescript
// Lines 1248-1274
if (task.status === 'planning') {
  // Only planning tasks get auto-restarted
  await agentManager.startPlanningAgent(...);
  autoRestarted = true;
} else {
  // FIX-3/FIX-4: Coding tasks should NOT auto-restart on recovery
  // Instead, mark as interrupted so user can click "Resume" button
  console.log(`[Recovery] Task ${taskId} is in coding status, marking as interrupted (no auto-restart)`);
  // Do NOT auto-start the coding agent - user must click "Resume"
  autoRestarted = false;
}
```

**Verdict:** Recovery correctly restarts planning agents but NOT coding agents.

---

### ✅ PASS: Frontend Button Logic

**File:** `TaskCard.tsx` lines 697-764

**Planning Tasks:**
- "Resume" button → calls `startTask(task.id)` → triggers `TASK_START`
- "Start Build" button → calls `startBuild(task.id)` → triggers `TASK_START_BUILD`

**Verdict:** Frontend correctly separates "Resume Planning" from "Start Build".

---

## 🚨 CRITICAL BUG: TASK_START Handler Bypasses Manual Gate

### Location
**File:** `execution-handlers.ts` lines 115-348
**Handler:** `TASK_START`

### The Problem

When a user clicks "Resume" on a planning task, the frontend calls `startTask(task.id)` which triggers `TASK_START`. However, the TASK_START handler **does not check the task's status**. Instead, it only checks:

1. Does `spec.md` exist? (`needsSpecCreation`)
2. Does the task have subtasks? (`needsImplementation`)

### Current Logic (BROKEN)

```typescript
// Lines 233-290
const needsSpecCreation = !hasSpec;
const needsImplementation = hasSpec && task.subtasks.length === 0;

if (needsSpecCreation) {
  // No spec file - need to run spec_runner.py
  agentManager.startSpecCreation(...);  // ⚠️ Uses OLD method without --no-build
} else if (needsImplementation) {
  // Spec exists but no subtasks
  agentManager.startTaskExecution(...);  // ❌ BUG: Starts CODING agent!
} else {
  // Task has subtasks
  agentManager.startTaskExecution(...);  // ❌ BUG: Starts CODING agent!
}
```

### Bug Scenarios

#### Scenario 1: Planning task with spec.md already created
1. User creates a task (status = 'planning')
2. Planning agent creates spec.md and implementation_plan.json
3. User clicks "Stop" (agent stops, status stays 'planning')
4. User clicks "Resume" to continue planning
5. **Expected:** Planning agent restarts with `--no-build`
6. **Actual:** CODING agent starts (`startTaskExecution()`) - BYPASSES THE GATE!

#### Scenario 2: New task without spec.md
1. User creates a task (status = 'planning')
2. User clicks "Resume" immediately
3. **Expected:** Planning agent starts with `--no-build`
4. **Actual:** `startSpecCreation()` starts WITHOUT `--no-build` - may auto-continue to coding!

### Two Sub-Issues

1. **`startSpecCreation()` vs `startPlanningAgent()`**
   - `startSpecCreation()` (old method) does NOT use `--no-build`
   - `startPlanningAgent()` (new method) uses `--no-build`
   - TASK_START handler uses the OLD method

2. **No status check before choosing agent**
   - Handler should check `task.status` to determine which agent to start
   - Currently only checks file existence, not task state

---

## Proposed Fix

### Option 1: Simple Fix - Check Task Status

```typescript
// In TASK_START handler, before the file checks:

// Check task status to determine which agent to use
if (task.status === 'planning') {
  // Planning task - always use startPlanningAgent with --no-build
  const taskDescription = task.description || task.title;
  agentManager.startPlanningAgent(task.specId, project.path, taskDescription, specDir, task.metadata, baseBranch);
} else if (task.status === 'coding') {
  // Coding task - use startTaskExecution
  agentManager.startTaskExecution(taskId, project.path, task.specId, {
    parallel: false,
    workers: 1,
    baseBranch,
    useWorktree: task.metadata?.useWorktree
  });
} else {
  // Other statuses (human_review, etc) - don't start any agent
  console.warn('[TASK_START] Task status does not allow starting:', task.status);
}
```

### Option 2: Deprecate startSpecCreation

1. Update TASK_START to always use `startPlanningAgent()` for planning tasks
2. Update TASK_CREATE to use `startPlanningAgent()` instead of `startSpecCreation()`
3. Eventually remove `startSpecCreation()` as it's the OLD architecture

---

## Architecture Diagram (Updated)

```
User Action                    IPC Handler              Agent Method
────────────────────────────────────────────────────────────────────────
Create Task       ─────────>   TASK_CREATE     ───────> startPlanningAgent() ✅
                                                        [--no-build flag]

Resume Planning   ─────────>   TASK_START      ───────> startSpecCreation()  ❌ OLD
                                               ───────> startTaskExecution() ❌ BUG
                                               SHOULD:  startPlanningAgent() ✅

Start Build       ─────────>   TASK_START_BUILD ─────> startTaskExecution() ✅
                                                        [manual gate]

Resume Coding     ─────────>   TASK_START      ───────> startTaskExecution() ✅
                                                        (only if status='coding')

Kanban Drag       ─────────>   TASK_UPDATE_STATUS ───> (no agent start)     ✅

Recovery Planning ─────────>   TASK_RECOVER_STUCK ───> startPlanningAgent() ✅

Recovery Coding   ─────────>   TASK_RECOVER_STUCK ───> (no auto-start)      ✅
```

---

## Impact Assessment

| Impact | Severity | Description |
|--------|----------|-------------|
| UX | HIGH | Users clicking "Resume" on planning tasks may unexpectedly start coding |
| Architecture | HIGH | Breaks the Planning → Coding manual gate design |
| Data | LOW | No data loss, but work may start prematurely |

---

## Files Requiring Changes

| File | Change |
|------|--------|
| `execution-handlers.ts` | Update TASK_START handler to check task.status |
| | Use `startPlanningAgent()` for planning tasks |
| | Use `startTaskExecution()` only for coding tasks |

---

## Test Cases for Fix Verification

1. **Planning task without spec.md**
   - Click "Resume" → Should start planning agent (check for `--no-build` in logs)

2. **Planning task with spec.md created**
   - Click "Resume" → Should start planning agent, NOT coding agent

3. **Coding task**
   - Click "Resume" → Should start coding agent

4. **Human review task**
   - Should not allow starting any agent via TASK_START

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| `startPlanningAgent()` | ✅ CORRECT | Uses `--no-build` flag |
| `TASK_START_BUILD` | ✅ CORRECT | Proper manual gate |
| `TASK_UPDATE_STATUS` | ✅ CORRECT | No agent auto-start |
| `TASK_RECOVER_STUCK` | ✅ CORRECT | Only restarts planning agents |
| Frontend buttons | ✅ CORRECT | Proper separation of Resume/Start Build |
| **`TASK_START`** | ❌ **BUG** | Uses wrong method, no status check |

---

**Report Generated:** 2026-02-04
**Verified By:** Code-level analysis of execution-handlers.ts and agent-manager.ts
