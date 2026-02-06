# Persistent Conversational Agent — Always-Accessible Task Agent

**Date:** 2026-02-06
**Status:** IMPLEMENTATION PLAN COMPLETE — Ready for Ralph prompts
**Priority:** HIGH — Staple feature of the app
**Affects:** Agent lifecycle, task phases, terminal chat, user interaction model

---

## Problem Statement

Currently, each task phase (spec creation, planning, coding, QA) runs as a **separate Python process** that exits when the phase completes. This means:

1. **No agent between phases** — When planning finishes and the process exits, the user cannot ask questions about the plan, review the spec, or discuss strategy before starting coding.
2. **No agent during human review** — After QA completes, the process exits. The user reviews code alone with no ability to ask "why did you change X?" or "what failed in QA?"
3. **No conversational continuity** — Each phase spawns a fresh agent. Even though Graphiti memory and disk files carry context forward, the user has no way to interact with that context conversationally.
4. **The terminal goes dead** — Between phases, the task terminal shows completed output but accepts no input. It's a one-way display, not an interactive session.

---

## Architecture Decision: Companion Agent (Option A)

Spawn a lightweight **read-only companion agent** whenever the main execution process exits and the task isn't complete/failed. The companion:
- Has full context from disk (spec, plan, QA report, code changes)
- Is restricted to Read/Glob/Grep only (safe, non-destructive)
- Uses Sonnet for quality Q&A responses
- Runs in the same terminal session — seamless to the user
- Auto-exits when the next execution phase starts

### Why This Approach

1. **Matches existing spawn/exit architecture** — no fundamental rearchitecture needed
2. **Clean security model** — companion explicitly cannot modify files
3. **Jerry precedent** — we already have a read-only agent pattern (Insights chat)
4. **Context already on disk** — spec.md, implementation_plan.json, qa_report.md
5. **Incremental** — can build and ship phase by phase

---

## Full Lifecycle With Companion

```
1. User creates task "Add user authentication"

2. SPEC CREATION (spec_runner.py running)
   Terminal: [Live output — discovery, requirements, spec writing...]
   User can chat: YES (stdin queue to running process)

3. SPEC COMPLETE → spec_runner.py exits (code 0)
   ↓ agent-manager.ts detects exit with processType='planning'
   ↓ Task is in 'planning' status, NOT complete/failed
   ↓ AUTO-SPAWN: companion_runner.py starts
   Terminal: "─── Agent Ready ───"
   Terminal: "Spec creation complete. I can answer questions about the plan,"
   Terminal: "show you the spec, or discuss the implementation approach."
   Terminal: "Click 'Start Build' when you're ready to begin coding."

4. USER CHATS WITH COMPANION
   User: "Show me the spec summary"
   Companion: [Reads spec.md, formats and presents it]
   User: "How many subtasks?"
   Companion: [Reads implementation_plan.json, lists subtasks with descriptions]
   User: "What files will be modified?"
   Companion: [Reads plan, Globs for existing files, explains approach]

5. User clicks "Start Build"
   ↓ agent-events-handlers.ts receives TASK_START_BUILD
   ↓ Calls agentManager.stopCompanion(taskId) — kills companion gracefully
   ↓ Calls agentManager.startTaskExecution(taskId) — spawns run.py
   Terminal: [Seamless transition — live output of planning + coding]

6. CODING + QA COMPLETE → run.py exits (code 0)
   ↓ Task transitions to 'human_review' status
   ↓ AUTO-SPAWN: companion_runner.py starts (with MORE context now)
   Terminal: "─── Agent Ready ───"
   Terminal: "Coding and QA review complete. I can walk you through"
   Terminal: "the changes, explain decisions, or show the QA report."

7. USER REVIEWS WITH COMPANION
   User: "What files did you change?"
   Companion: [Reads plan, lists all modified files with change descriptions]
   User: "Why did you add a new middleware?"
   Companion: [Reads spec + plan, explains reasoning]
   User: "Show me the QA report"
   Companion: [Reads qa_report.md, formats nicely]
   User: "The auth logic looks wrong in auth.ts, can you read lines 50-80?"
   Companion: [Reads the file, discusses the implementation]

8. User clicks "Approve"
   ↓ Companion exits → Task marked complete

   OR User clicks "Request Changes"
   ↓ Companion exits → QA Fixer spawns → fixes → companion re-spawns
```

---

## Implementation Details

### File Change Summary

| # | File | Action | Layer |
|---|------|--------|-------|
| 1 | `apps/backend/runners/companion_runner.py` | CREATE | Backend |
| 2 | `apps/backend/agents/companion_agent.py` | CREATE | Backend |
| 3 | `apps/frontend/src/shared/types/task.ts` | MODIFY | Shared |
| 4 | `apps/frontend/src/shared/ipc-channels.ts` | MODIFY | Shared |
| 5 | `apps/frontend/src/main/agent/agent-process.ts` | MODIFY | Main |
| 6 | `apps/frontend/src/main/agent/agent-manager.ts` | MODIFY | Main |
| 7 | `apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts` | MODIFY | Main |
| 8 | `apps/frontend/src/renderer/stores/task-store.ts` | MODIFY | Renderer |
| 9 | `apps/frontend/src/renderer/hooks/useIpc.ts` | MODIFY | Renderer |
| 10 | `apps/frontend/src/renderer/components/TaskCard.tsx` | MODIFY | Renderer |
| 11 | `apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx` | MODIFY | Renderer |
| 12 | `apps/frontend/src/preload/api/modules/agent-api.ts` | MODIFY | Preload |

---

### 1. Backend: `companion_runner.py` (NEW)

**Purpose:** CLI entry point for the companion agent process. Spawned by the frontend when an execution phase exits.

```python
# apps/backend/runners/companion_runner.py

"""
Companion Agent Runner — Read-only conversational agent for task Q&A.

Spawned automatically when an execution phase exits.
Provides the user with a conversational interface to ask questions
about the task, spec, plan, code changes, and QA results.

Tools: Read, Glob, Grep ONLY (non-destructive)
Model: Sonnet (fast, good at Q&A)

CLI Args:
  --spec-dir PATH       Path to the spec directory (contains spec.md, plan, etc.)
  --project-dir PATH    Path to the project root
  --task-title STR      Title of the task (for system prompt context)
  --current-phase STR   What phase just completed (spec|planning|coding|qa|human_review)
  --task-id STR         Task ID (for logging)
  --model STR           Model to use (default: sonnet)
"""
```

**Key behaviors:**
- Loads all context from `spec_dir` on startup (spec.md, implementation_plan.json, qa_report.md)
- Builds a rich system prompt with phase summaries
- Initializes `UserMessageQueue` to receive user messages via stdin
- Runs in a conversational loop: wait for user message → respond → wait
- Outputs via stdout using same `__SDK_MSG__` format as other agents
- Exits gracefully on SIGTERM (sent by frontend when execution resumes)

**System prompt template:**
```
You are the task companion for "{task_title}".

CURRENT STATE: {current_phase} phase just completed.

YOUR ROLE:
- Answer questions about this task's spec, plan, implementation, and QA results
- Read files in the project to help the user understand changes
- You are READ-ONLY — you cannot modify any files
- Be concise and helpful

CONTEXT:
== SPEC ==
{spec_md_contents}

== IMPLEMENTATION PLAN ==
{plan_json_summary}

== QA REPORT (if available) ==
{qa_report_contents}

== PHASE HISTORY ==
{phase_summaries}

Available tools: Read, Glob, Grep
The project is at: {project_dir}
The spec is at: {spec_dir}
```

---

### 2. Backend: `companion_agent.py` (NEW)

**Purpose:** Agent logic and context builder for the companion.

```python
# apps/backend/agents/companion_agent.py

class CompanionAgent:
    """Read-only conversational agent for task Q&A between phases."""

    def __init__(self, spec_dir, project_dir, task_title, current_phase):
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.task_title = task_title
        self.current_phase = current_phase

    def build_context(self) -> str:
        """Load all available context from spec_dir files."""
        # Read spec.md (always exists after spec creation)
        # Read implementation_plan.json (exists after planning)
        # Read qa_report.md (exists after QA)
        # Read task_metadata.json (model config, complexity)
        # Summarize each section for the system prompt

    async def run(self):
        """Main conversational loop."""
        # 1. Build context and system prompt
        # 2. Create SDK client with Read/Glob/Grep tools only
        # 3. Print ready message to stdout
        # 4. Loop: wait for user message → send to Claude → stream response
        # 5. Exit on SIGTERM or "exit" command
```

**Context builder reads these files from spec_dir:**

| File | When Available | What It Provides |
|------|---------------|-----------------|
| `spec.md` | After spec creation | Full feature specification |
| `requirements.json` | After spec creation | Structured requirements |
| `implementation_plan.json` | After planning | Subtasks, status, dependencies |
| `qa_report.md` | After QA review | QA findings, pass/fail |
| `QA_FIX_REQUEST.md` | After QA rejection | What needs fixing |
| `task_metadata.json` | After spec creation | Model config, complexity rating |
| `context.json` | After spec creation | Discovered codebase context |

---

### 3. Shared Types: `task.ts` (MODIFY)

**Add companion ProcessType:**
```typescript
// Add 'companion' to existing ProcessType union
export type ProcessType = 'spec-creation' | 'task-execution' | 'qa-process' | 'planning' | 'companion';
```

**Add AgentMode value:**
```typescript
// Add 'companion' to existing AgentMode union
export type AgentMode = 'planning' | 'coding' | 'reviewing' | 'idle' | 'companion';
```

---

### 4. IPC Channels: `ipc-channels.ts` (MODIFY)

**Add companion-specific channels:**
```typescript
// Add to existing IPC_CHANNELS object
TASK_COMPANION_SPAWNED: 'task:companion-spawned',    // Companion process started
TASK_COMPANION_STOPPED: 'task:companion-stopped',    // Companion process exited
TASK_SEND_COMPANION_MESSAGE: 'task:send-companion-message',  // User sends message to companion
```

---

### 5. Agent Process: `agent-process.ts` (MODIFY)

**Changes needed:**

**A. New method `spawnCompanion()`:**
```typescript
async spawnCompanion(
  taskId: string,
  specDir: string,
  projectDir: string,
  taskTitle: string,
  currentPhase: string,
  model: string = 'sonnet'
): Promise<void> {
  // Build args for companion_runner.py
  const companionRunnerPath = path.join(this.getBackendPath(), 'runners', 'companion_runner.py');
  const args = [
    companionRunnerPath,
    '--spec-dir', specDir,
    '--project-dir', projectDir,
    '--task-title', taskTitle,
    '--current-phase', currentPhase,
    '--task-id', taskId,
    '--model', model
  ];

  // Spawn with 'companion' processType
  await this.spawnProcess(taskId, projectDir, args, {}, 'companion');
}
```

**B. Modify exit handler (line ~667):**
```typescript
// After existing exit handling, ADD:
// If this was an execution process and task is transitional, auto-spawn companion
if (processType !== 'companion' && code === 0) {
  this.emitter.emit('execution-complete', taskId, processType);
  // agent-manager will decide whether to spawn companion
}
```

**C. New method `stopCompanion()`:**
```typescript
stopCompanion(taskId: string): void {
  const process = this.state.getProcess(taskId);
  if (process && /* is companion */) {
    // Mark as intentionally killed so exit handler ignores it
    this.state.markSpawnKilled(process.spawnId);
    process.process.kill('SIGTERM');
  }
}
```

---

### 6. Agent Manager: `agent-manager.ts` (MODIFY)

**Changes needed:**

**A. Track companion state:**
```typescript
// Add to class fields
private companionTasks: Set<string> = new Set();  // Tasks with active companions
```

**B. New method `startCompanion()`:**
```typescript
async startCompanion(taskId: string): Promise<void> {
  const context = this.taskExecutionContext.get(taskId);
  if (!context) return;

  // Don't spawn companion if task is completed or failed
  const task = /* get task from store */;
  if (task?.status === 'completed' || task?.status === 'failed') return;

  // Don't spawn if an execution process is already running
  if (this.processManager.hasProcess(taskId)) return;

  const specDir = context.specDir || '';
  const projectPath = context.projectPath;
  const taskTitle = context.taskDescription || 'Untitled Task';
  const currentPhase = this.getCompanionPhase(task?.status);

  await this.processManager.spawnCompanion(
    taskId, specDir, projectPath, taskTitle, currentPhase
  );

  this.companionTasks.add(taskId);
  this.agentModes.set(taskId, 'companion');

  // Emit event so frontend knows companion is active
  this.emitter.emit('companion-spawned', taskId);
}
```

**C. New method `stopCompanion()`:**
```typescript
async stopCompanion(taskId: string): Promise<void> {
  if (!this.companionTasks.has(taskId)) return;

  this.processManager.stopCompanion(taskId);
  this.companionTasks.delete(taskId);
  this.agentModes.delete(taskId);

  // Small delay to let process exit cleanly
  await new Promise(resolve => setTimeout(resolve, 500));

  this.emitter.emit('companion-stopped', taskId);
}
```

**D. Modify `startTaskExecution()` (line ~331):**
```typescript
async startTaskExecution(taskId: string, ...): Promise<void> {
  // FIRST: Kill companion if running
  await this.stopCompanion(taskId);

  // THEN: Existing execution spawn logic...
}
```

**E. Auto-spawn in exit handler (line ~76):**
```typescript
this.on('exit', (taskId: string, code: number | null, processType: ProcessType) => {
  // Existing cleanup...
  this.agentModes.delete(taskId);

  // NEW: Auto-spawn companion after successful execution exit
  if (processType !== 'companion' && code === 0) {
    // Delay slightly to let exit events propagate
    setTimeout(() => {
      this.startCompanion(taskId).catch(err => {
        console.error('[AgentManager] Failed to start companion:', err);
      });
    }, 1500);
  }

  // If companion exited, just clean up tracking
  if (processType === 'companion') {
    this.companionTasks.delete(taskId);
  }
});
```

**F. Helper to determine companion phase context:**
```typescript
private getCompanionPhase(taskStatus?: TaskStatus): string {
  switch (taskStatus) {
    case 'planning': return 'spec_complete';      // Spec done, awaiting build start
    case 'coding': return 'coding_complete';       // Shouldn't happen (coding is active)
    case 'ai_review': return 'qa_complete';        // QA done
    case 'human_review': return 'human_review';    // User reviewing
    default: return 'unknown';
  }
}
```

---

### 7. IPC Handlers: `agent-events-handlers.ts` (MODIFY)

**Changes needed:**

**A. Handle companion events:**
```typescript
// Listen for companion lifecycle
agentManager.on('companion-spawned', (taskId: string) => {
  safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_COMPANION_SPAWNED, taskId);
});

agentManager.on('companion-stopped', (taskId: string) => {
  safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_COMPANION_STOPPED, taskId);
});
```

**B. Handle companion exit in the exit handler (line ~280):**
```typescript
// In the agentManager.on('exit') handler:
if (processType === 'companion') {
  // Companion exited — don't change task status, just notify frontend
  safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_COMPANION_STOPPED, taskId);
  return; // Skip all status transition logic
}
```

**C. Handle user messages to companion:**
```typescript
// New IPC handler for sending messages to companion
ipcMain.handle(IPC_CHANNELS.TASK_SEND_COMPANION_MESSAGE, async (_, taskId: string, message: string) => {
  return agentManager.sendMessageToTask(taskId, message);
});
```

**D. Modify TASK_START_BUILD handler:**
```typescript
// In existing TASK_START_BUILD handler, ADD at the top:
// Kill companion before starting execution
await agentManager.stopCompanion(taskId);
// ... rest of existing start build logic
```

---

### 8. Task Store: `task-store.ts` (MODIFY)

**Add companion tracking state:**
```typescript
interface TaskState {
  // ... existing fields ...
  companionActive: Set<string>;  // Tasks with active companion agents

  // New actions
  setCompanionActive: (taskId: string, active: boolean) => void;
  hasCompanion: (taskId: string) => boolean;
}
```

**Implementation:**
```typescript
companionActive: new Set<string>(),

setCompanionActive: (taskId, active) => {
  set((state) => {
    const newSet = new Set(state.companionActive);
    if (active) {
      newSet.add(taskId);
    } else {
      newSet.delete(taskId);
    }
    return { companionActive: newSet };
  });
},

hasCompanion: (taskId) => {
  return get().companionActive.has(taskId);
},
```

---

### 9. useIpc Hook: `useIpc.ts` (MODIFY)

**Add companion event listeners:**
```typescript
// Listen for companion spawned
useEffect(() => {
  const handler = (_: any, taskId: string) => {
    useTaskStore.getState().setCompanionActive(taskId, true);
  };
  window.api.on(IPC_CHANNELS.TASK_COMPANION_SPAWNED, handler);
  return () => window.api.off(IPC_CHANNELS.TASK_COMPANION_SPAWNED, handler);
}, []);

// Listen for companion stopped
useEffect(() => {
  const handler = (_: any, taskId: string) => {
    useTaskStore.getState().setCompanionActive(taskId, false);
  };
  window.api.on(IPC_CHANNELS.TASK_COMPANION_STOPPED, handler);
  return () => window.api.off(IPC_CHANNELS.TASK_COMPANION_STOPPED, handler);
}, []);
```

---

### 10. TaskCard: `TaskCard.tsx` (MODIFY)

**Add companion indicator to task card:**
```tsx
// In the task card header area, add:
{hasCompanion && (
  <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1" />
    Agent Ready
  </Badge>
)}
```

**Show chat input when companion is active:**
```tsx
// In the expanded task card, when companion is active:
{hasCompanion && (
  <div className="border-t border-border p-2">
    <div className="flex gap-2">
      <Input
        placeholder="Ask the agent about this task..."
        value={companionMessage}
        onChange={(e) => setCompanionMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && companionMessage.trim()) {
            window.api.invoke(IPC_CHANNELS.TASK_SEND_COMPANION_MESSAGE, taskId, companionMessage);
            setCompanionMessage('');
          }
        }}
      />
      <Button size="sm" onClick={sendCompanionMessage}>Send</Button>
    </div>
  </div>
)}
```

---

### 11. TaskMonitorChat: `TaskMonitorChat.tsx` (MODIFY)

**Add companion mode visual indicator:**
```tsx
// When companion is active, show a separator and ready message:
{hasCompanion && (
  <div className="border-t-2 border-green-500/30 my-4 pt-4 px-4">
    <div className="flex items-center gap-2 text-green-400 text-sm mb-2">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span className="font-medium">Agent Ready</span>
      <span className="text-muted-foreground">— ask questions about this task</span>
    </div>
  </div>
)}
```

**Companion messages should have distinct styling:**
- User messages: right-aligned or with "You:" prefix
- Companion responses: left-aligned with subtle green accent border
- Visual separator between execution output and companion conversation

---

### 12. Preload API: `agent-api.ts` (MODIFY)

**Expose companion message IPC to renderer:**
```typescript
sendCompanionMessage: (taskId: string, message: string) =>
  ipcRenderer.invoke(IPC_CHANNELS.TASK_SEND_COMPANION_MESSAGE, taskId, message),
```

---

## Ralph Prompt Plan

| # | Prompt ID | Tasks | Scope | Description |
|---|-----------|-------|-------|-------------|
| 1 | COMPANION_BACKEND | 4 | Backend | Create companion_runner.py + companion_agent.py + context builder |
| 2 | COMPANION_LIFECYCLE | 5 | Frontend Main | ProcessType, spawnCompanion, stopCompanion, auto-spawn on exit, handoff |
| 3 | COMPANION_IPC_STATE | 4 | Frontend IPC+Store | IPC channels, event handlers, task-store state, useIpc listeners |
| 4 | COMPANION_UI | 4 | Frontend Renderer | TaskCard indicator, TaskMonitorChat companion mode, chat input, styling |

**Run order:** 1 first (backend), then 2, then 3, then 4 (sequential — each depends on prior)
**Total tasks:** 17
**Estimated time:** ~15-20 minutes

---

## Resolved Design Decisions

### 1. Companion auto-spawns on ANY successful execution exit
**Decision:** Yes, always auto-spawn if task isn't complete/failed.
**Reasoning:** No dead zones. User always has an agent to talk to. If they don't need it, it just sits idle (minimal resource use).

### 2. Companion exits when execution starts
**Decision:** Kill companion gracefully (SIGTERM) before spawning execution process.
**Reasoning:** Only one process per task at a time. Clean handoff. Companion's purpose is fulfilled — user is ready to proceed.

### 3. Model: Sonnet
**Decision:** Use Sonnet for companion responses.
**Reasoning:** Same as Jerry — good quality for Q&A, fast responses. Haiku would miss nuance. Opus is overkill for "show me the spec."

### 4. No chat history persistence between companion spawns (for now)
**Decision:** Each companion spawn starts fresh with disk context only.
**Reasoning:** Simpler implementation. The companion's context comes from files, not conversation history. If user asked "what files changed?" before coding, that's irrelevant after coding. Can add persistence later if needed.

### 5. Companion available after task completion
**Decision:** YES — companion stays available for post-mortem.
**Reasoning:** "Walk me through what you built" is a valuable interaction even after approval. Only despawn when user explicitly closes the terminal or starts a new task.

### 6. Same terminal session
**Decision:** Companion output appears in the same terminal as execution output.
**Reasoning:** Seamless experience. User sees execution output, then a separator, then companion is ready. No tab switching. Terminal is already the task's communication channel.

---

## Related Issues

- **KANBAN_BUILD_BUTTON** (Fixed) — The gap between planning exit and "Start Build" is exactly where companion fills in
- **Jerry (Insights chat)** — Similar read-only agent pattern, can share tooling
- **TERMINAL_OUTPUT_POLISH** (Running) — Terminal needs to support companion mode visually
- **Backend __SDK_MSG__ consistency** — Companion should emit consistent structured markers
