# Task Phase Flow - Detailed Code-Level Documentation

**Last Updated:** 2026-02-04
**Version:** 1.0
**Status:** 📋 DOCUMENTATION

---

## Overview

This document provides a detailed, code-level breakdown of what happens at each phase when a task moves through the Auto-Claude system. It maps the **documented architecture** to the **actual code implementation**.

---

## Phase Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TASK PHASE FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐                                                            │
│  │  TASK_CREATE    │  User creates task via UI                                  │
│  │  (IPC Handler)  │  crud-handlers.ts:42-302                                   │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ 1. Creates spec directory                                            │
│           │ 2. Writes implementation_plan.json (status: pending)                 │
│           │ 3. Writes requirements.json                                          │
│           │ 4. AUTO-SPAWNS Planning Agent                                        │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │    PLANNING     │  Planning Agent runs (spec_runner.py)                      │
│  │  status='planning' │  agent-manager.ts:228-328 (startPlanningAgent)          │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ Agent creates:                                                       │
│           │   - spec.md                                                          │
│           │   - implementation_plan.json (with subtasks)                         │
│           │   - Worktree (git worktree add)                                      │
│           │                                                                      │
│           │ CRITICAL: Agent uses --no-build flag                                 │
│           │           Does NOT auto-continue to coding                           │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │  PLANNING DONE  │  Agent stops, waits for user                               │
│  │  (User Review)  │  UI shows: [Resume] [Start Build]                          │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ ════════════════════════════════════════════                        │
│           │ ║  MANUAL GATE - User clicks "Start Build"  ║                        │
│           │ ║  This is the ONLY path to Coding phase    ║                        │
│           │ ════════════════════════════════════════════                        │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │ TASK_START_BUILD│  User clicks "Start Build" button                          │
│  │  (IPC Handler)  │  execution-handlers.ts:424-532                             │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ 1. Validates spec.md exists                                          │
│           │ 2. Validates implementation_plan.json exists                         │
│           │ 3. Stops planning agent if running                                   │
│           │ 4. Starts Coding Agent (startTaskExecution)                          │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │     CODING      │  Coding Agent runs (run.py)                                │
│  │  status='coding' │  agent-manager.ts:334-410 (startTaskExecution)            │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ Agent executes subtasks from implementation_plan.json                │
│           │ Updates subtask status: pending → in_progress → completed            │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │   AI_REVIEW     │  QA process runs                                           │
│  │ status='ai_review' │  Runs tests, validates implementation                   │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ QA Pass → human_review                                               │
│           │ QA Fail → loops back to coding                                       │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │  HUMAN_REVIEW   │  User approves or rejects                                  │
│  │status='human_review'│  execution-handlers.ts:537-718 (TASK_REVIEW)           │
│  └────────┬────────┘                                                            │
│           │                                                                      │
│           │ Approve → Merge worktree → done                                      │
│           │ Reject → Write feedback → restart QA                                 │
│           ▼                                                                      │
│  ┌─────────────────┐                                                            │
│  │      DONE       │  Changes merged, worktree cleaned up                       │
│  │  status='done'  │                                                            │
│  └─────────────────┘                                                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Task Creation

### Trigger
User clicks "New Task" button or creates task via Jerry chat.

### IPC Handler
**File:** `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts`
**Handler:** `TASK_CREATE` (lines 42-302)

### Code Flow

```typescript
// 1. Validate project exists
const project = projectStore.getProject(projectId);

// 2. Generate spec ID (e.g., "001-add-feature")
const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle}`;

// 3. Create spec directory
const specDir = path.join(specsDir, specId);
mkdirSync(specDir, { recursive: true });

// 4. Create initial implementation_plan.json
const implementationPlan = {
  feature: finalTitle,
  description: description,
  status: 'pending',  // ← Initial status
  phases: []
};
writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2));

// 5. Create task object with status='planning'
const task: Task = {
  id: specId,
  status: 'planning',  // ← Task starts in planning
  ...
};

// 6. AUTO-START Planning Agent (if conditions met)
if (canSpawnAgent && hasAuth && mainWindow) {
  await agentManager.startPlanningAgent(
    specId,
    project.path,
    description,
    specDir,
    taskMetadata,
    baseBranch
  );
}
```

### Files Created

```
.auto-claude/specs/{specId}/
├── implementation_plan.json   # status: pending, phases: []
├── requirements.json          # Task description
├── task_metadata.json         # Category, complexity, etc.
└── attachments/               # If images attached
```

### What Gets Spawned
- **Planning Agent** via `startPlanningAgent()` (not `startSpecCreation()`)
- Uses `--no-build` flag to prevent auto-continuation

---

## Phase 2: Planning (Agent Running)

### Trigger
Automatic - immediately after task creation.

### Agent Manager
**File:** `apps/frontend/src/main/agent/agent-manager.ts`
**Method:** `startPlanningAgent()` (lines 228-328)

### Code Flow

```typescript
// Build arguments for spec_runner.py in PLANNING MODE
const args = [specRunnerPath, '--task', taskDescription, '--project-dir', projectPath];

// Pass spec directory (already created by TASK_CREATE)
args.push('--spec-dir', specDir);

// CRITICAL FLAG: --no-build prevents auto-continuation to coding
args.push('--no-build');

// Start the process
const process = spawn(pythonPath, args, {
  cwd: projectPath,
  env: combinedEnv
});
```

### What the Planning Agent Does

1. **Reads task description** from requirements.json
2. **Analyzes codebase** to understand context
3. **Creates worktree** for isolated development:
   ```bash
   git worktree add .auto-claude/worktrees/{specId} -b auto-claude/{specId}
   ```
4. **Generates spec.md** with detailed implementation plan
5. **Generates subtasks** in implementation_plan.json:
   ```json
   {
     "status": "planning",
     "phases": [
       {
         "name": "Implementation",
         "subtasks": [
           { "id": "1", "title": "Create component", "status": "pending" },
           { "id": "2", "title": "Add tests", "status": "pending" }
         ]
       }
     ]
   }
   ```
6. **STOPS** - does NOT auto-continue to coding due to `--no-build` flag

### Files Created/Modified

```
.auto-claude/specs/{specId}/
├── spec.md                    # ✨ NEW - Detailed spec
├── implementation_plan.json   # ✨ UPDATED - Now has subtasks
└── memories/                  # ✨ NEW - Agent memory files
    └── ...

.auto-claude/worktrees/{specId}/  # ✨ NEW - Git worktree
└── (copy of project files)
```

---

## Phase 3: Manual Gate - Start Build

### Trigger
User clicks "Start Build" button on task card.

### UI Component
**File:** `apps/frontend/src/renderer/components/TaskCard.tsx`
**Lines:** 697-764

```typescript
// FIX-14: "Start Build" only shown when agent is stopped (spec may be ready)
{isAgentStopped ? (
  // Agent was stopped - show Resume + Start Build
  <>
    <Button onClick={() => startTask(task.id)}>Resume</Button>
    <Button onClick={() => startBuild(task.id)}>Start Build</Button>
  </>
) : (
  // Agent is running - show Stop button only (no Start Build)
  <Button onClick={() => stopTask(task.id)}>Stop</Button>
)}
```

### IPC Handler
**File:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
**Handler:** `TASK_START_BUILD` (lines 424-532)

### Code Flow

```typescript
// 1. Validate spec.md exists
if (!existsSync(specFilePath)) {
  return { success: false, error: 'spec.md has not been created yet' };
}

// 2. Validate implementation_plan.json exists
if (!existsSync(planFilePath)) {
  return { success: false, error: 'implementation_plan.json has not been created yet' };
}

// 3. Stop planning agent if still running
if (agentManager.isRunning(taskId)) {
  agentManager.killTask(taskId);
  await new Promise(resolve => setTimeout(resolve, 500));
}

// 4. Start the CODING agent (NOT planning agent)
agentManager.startTaskExecution(
  taskId,
  project.path,
  task.specId,
  { parallel: false, workers: 1, baseBranch }
);

// 5. Update status to 'coding'
mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'coding');
```

### Key Point
**This is the ONLY path that starts the coding agent.**
- Kanban drag does NOT start agents (FIX-8)
- Status changes do NOT start agents (FIX-9)
- Only explicit user action via "Start Build" button

---

## Phase 4: Coding (Agent Running)

### Trigger
`TASK_START_BUILD` handler calls `startTaskExecution()`.

### Agent Manager
**File:** `apps/frontend/src/main/agent/agent-manager.ts`
**Method:** `startTaskExecution()` (lines 334-410)

### Code Flow

```typescript
// Build arguments for run.py
const args = [
  runPyPath,
  '--spec-dir', specDir,
  '--project-dir', projectPath,
];

// Run.py uses the worktree if it exists
if (useWorktree) {
  args.push('--worktree', worktreePath);
}

// Start the process
const process = spawn(pythonPath, args, {
  cwd: workingDir,  // Either worktree or project path
  env: combinedEnv
});
```

### What the Coding Agent Does

1. **Reads implementation_plan.json** to get subtask list
2. **For each subtask:**
   - Updates status: `pending` → `in_progress`
   - Executes the subtask (writes code, runs commands)
   - Updates status: `in_progress` → `completed`
3. **Outputs phase markers:**
   ```
   __EXEC_PHASE__:{"phase":"coding","message":"Implementing feature X"}
   ```
4. **Runs QA checks** after subtasks complete
5. **Transitions to ai_review or human_review** based on QA results

### Status Updates via IPC

```typescript
// Frontend receives phase updates
ipcMain.on('agent-output', (event, taskId, output) => {
  // Parse phase markers
  const match = output.match(/__EXEC_PHASE__:(.+)/);
  if (match) {
    const phaseData = JSON.parse(match[1]);
    // Update executionProgress in task store
    mainWindow.webContents.send('TASK_PHASE_UPDATE', taskId, phaseData);
  }
});
```

---

## Phase 5: AI Review

### Trigger
Coding agent completes all subtasks and starts QA.

### Status
`status='ai_review'`, `executionProgress.phase='qa_review'`

### What Happens

1. **Runs test suite** (`npm test`, `npm run build`, etc.)
2. **Validates implementation** against spec requirements
3. **If tests pass:** Transitions to `human_review`
4. **If tests fail:**
   - Creates QA_FIX_REQUEST.md with failure details
   - Loops back to `coding` with `phase='qa_fixing'`

### QA Loop Configuration (Ralph Wiggum Mode)

```python
# apps/backend/phase_config.py
RALPH_WIGGUM_CONFIG = {
    "qa_max_iterations": 100,           # Normal: 50
    "qa_consecutive_errors_limit": 5,   # Normal: 3
    "qa_recurring_issue_threshold": 5,  # Normal: 3
    "force_pivot_on_circular": True,    # Tries alternative strategies
}
```

---

## Phase 6: Human Review

### Trigger
QA passes → status changes to `human_review`.

### UI Display
Task card shows:
- "Review Reason" badge (completed, qa_rejected, etc.)
- "Approve" button
- "Reject" button with feedback field

### IPC Handler
**File:** `apps/frontend/src/main/ipc-handlers/task/execution-handlers.ts`
**Handler:** `TASK_REVIEW` (lines 537-718)

### Code Flow (Approve)

```typescript
if (approved) {
  // Write approval to QA report
  writeFileSync(qaReportPath, '# QA Review\n\nStatus: APPROVED\n...');

  // Update status to 'done'
  mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'done');
}
```

### Code Flow (Reject)

```typescript
if (!approved) {
  // 1. Reset main branch to pre-merge state
  spawnSync('git', ['reset', 'HEAD'], { cwd: project.path });
  spawnSync('git', ['checkout', '--', '.'], { cwd: project.path });

  // 2. Write feedback to QA_FIX_REQUEST.md
  writeFileSync(fixRequestPath, `# QA Fix Request\n\n${feedback}\n`);

  // 3. Restart QA process
  agentManager.startQAProcess(taskId, qaProjectPath, task.specId);

  // 4. Update status back to 'coding'
  mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'coding');
}
```

---

## Phase 7: Done

### Trigger
User approves in human review.

### What Happens

1. **QA report written** with APPROVED status
2. **Status updated** to `done`
3. **Worktree can be cleaned up** (optional)
4. **Changes are merged** to base branch

### Worktree Cleanup
**Handler:** `TASK_UPDATE_STATUS` with `forceCleanup: true`

```typescript
if (options?.forceCleanup) {
  // Remove worktree
  execFileSync('git', ['worktree', 'remove', '--force', worktreePath]);
  // Delete branch
  execFileSync('git', ['branch', '-D', branch]);
}
```

---

## Key Safeguards

### 1. Manual Gate Enforcement (FIX-10)

```typescript
// TASK_UPDATE_STATUS handler (lines 722-898)
// FIX-8: Auto-start removed - user must click "Start Build"
// Status change to 'coding' now only changes the status, not auto-start agent
```

### 2. Planning Agent Uses --no-build

```typescript
// agent-manager.ts line 302
args.push('--no-build');  // CRITICAL: Prevents auto-start of coding
```

### 3. Kanban Drag Does Not Start Agents

```typescript
// execution-handlers.ts lines 722-728
// FIX-8/FIX-9: This handler ONLY changes the task status.
// It does NOT start any agents.
```

### 4. Recovery Doesn't Auto-Start Coding Tasks

```typescript
// execution-handlers.ts lines 1249-1274
// FIX-3/FIX-4: Coding tasks should NOT auto-restart on recovery
// Instead, mark as interrupted so user can click "Resume" button
```

---

## Status/Phase Mapping

| User Action | IPC Handler | Agent Method | Status | Phase |
|-------------|-------------|--------------|--------|-------|
| Create Task | TASK_CREATE | startPlanningAgent | planning | planning |
| Stop Planning | TASK_STOP | killTask | planning | idle |
| Start Build | TASK_START_BUILD | startTaskExecution | coding | coding |
| Stop Coding | TASK_STOP | killTask | coding | idle |
| QA Starts | (auto) | startQAProcess | ai_review | qa_review |
| QA Fails | (auto) | (loops) | coding | qa_fixing |
| QA Passes | (auto) | (stops) | human_review | idle |
| Approve | TASK_REVIEW | (none) | done | complete |
| Reject | TASK_REVIEW | startQAProcess | coding | qa_fixing |

---

## Summary

The current architecture **correctly separates** Planning and Coding phases:

1. **Task creation** → Auto-starts Planning Agent
2. **Planning Agent** → Creates spec, then **STOPS** (--no-build flag)
3. **User reviews spec** → Clicks "Start Build" (manual gate)
4. **Coding Agent** → Implements subtasks
5. **QA Review** → Validates implementation
6. **Human Review** → User approves or rejects
7. **Done** → Changes merged

The key architectural decision is the **manual gate** between Planning and Coding, enforced by:
- `--no-build` flag in Planning Agent
- `TASK_START_BUILD` as the only path to Coding Agent
- `TASK_UPDATE_STATUS` does NOT auto-start agents

---

**End of Task Phase Flow Documentation**
