# Auto-Claude Full Architecture

**Last Updated:** 2026-02-04
**Version:** 1.0
**Status:** 📋 COMPREHENSIVE DOCUMENTATION

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Layer 1: Frontend - React UI](#layer-1-frontend---react-ui)
3. [Layer 2: Frontend - Electron Main Process](#layer-2-frontend---electron-main-process)
4. [Layer 3: IPC Bridge](#layer-3-ipc-bridge)
5. [Layer 4: Backend - Python Agents](#layer-4-backend---python-agents)
6. [Layer 5: File System & Git](#layer-5-file-system--git)
7. [Layer 6: State Management](#layer-6-state-management)
8. [Layer 7: UX Flow](#layer-7-ux-flow)
9. [Layer 8: UI Components](#layer-8-ui-components)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        AUTO-CLAUDE ARCHITECTURE STACK                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                     LAYER 1: REACT UI (RENDERER)                         │    │
│  │  Components → Stores → Hooks → Context                                   │    │
│  │  TaskCard.tsx, KanbanBoard.tsx, Insights.tsx                            │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
│                                 │ window.electronAPI                             │
│                                 │ (Preload Bridge)                               │
│  ┌──────────────────────────────▼──────────────────────────────────────────┐    │
│  │                  LAYER 2: ELECTRON MAIN PROCESS                          │    │
│  │  IPC Handlers → Agent Manager → Terminal Manager                         │    │
│  │  crud-handlers.ts, execution-handlers.ts, agent-manager.ts              │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
│                                 │ spawn/fork                                     │
│                                 │ (Child Process)                                │
│  ┌──────────────────────────────▼──────────────────────────────────────────┐    │
│  │                    LAYER 3: PYTHON BACKEND                               │    │
│  │  spec_runner.py → run.py → qa/loop.py                                   │    │
│  │  Claude API calls, code generation, QA checks                           │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
│                                 │ read/write                                     │
│                                 │ (File I/O)                                     │
│  ┌──────────────────────────────▼──────────────────────────────────────────┐    │
│  │                  LAYER 4: FILE SYSTEM & GIT                              │    │
│  │  .auto-claude/specs/ → worktrees/ → Git operations                      │    │
│  │  spec.md, implementation_plan.json, memories/                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Frontend - React UI

### Technology Stack
- **React 18** with TypeScript
- **Zustand** for state management
- **TailwindCSS** for styling
- **Radix UI** for accessible components
- **i18next** for internationalization

### Directory Structure

```
apps/frontend/src/renderer/
├── components/           # React components
│   ├── TaskCard.tsx     # Individual task display
│   ├── KanbanBoard.tsx  # Drag-drop board
│   ├── Insights.tsx     # Jerry chat interface
│   ├── TerminalGrid.tsx # Terminal management
│   ├── TaskTerminalModal.tsx
│   └── ui/              # Shadcn/ui base components
├── stores/              # Zustand state stores
│   ├── task-store.ts    # Task state & actions
│   ├── terminal-store.ts
│   ├── project-store.ts
│   └── settings-store.ts
├── hooks/               # Custom React hooks
│   ├── useIpc.ts        # IPC communication
│   └── useGlobalTerminalListeners.ts
├── contexts/            # React contexts
│   └── NavigationContext.tsx
└── lib/                 # Utilities
    └── utils.ts
```

### Key Components

#### TaskCard.tsx
**Purpose:** Displays a single task with status, actions, and terminal access.

```typescript
// Key state
const isRunning = task.status === 'coding';
const isPlanning = task.status === 'planning';
const isAgentStopped = useTaskStore((state) => state.isAgentStopped(task.id));

// Key actions
const handleStartStop = (e: React.MouseEvent) => {
  e.stopPropagation();
  if (isRunning && !isStuck) {
    stopTask(task.id);
  } else {
    startTask(task.id);
  }
};
```

#### KanbanBoard.tsx
**Purpose:** Displays tasks in columns by status.

```typescript
// Columns
const columns: TaskStatus[] = ['planning', 'coding', 'ai_review', 'human_review', 'done'];

// Tasks filtered by status
const tasksByStatus = useMemo(() => {
  return columns.reduce((acc, status) => {
    acc[status] = tasks.filter(t => t.status === status);
    return acc;
  }, {} as Record<TaskStatus, Task[]>);
}, [tasks]);
```

### Component Hierarchy

```
App.tsx
├── Sidebar.tsx                    # Navigation
├── TasksHub.tsx                   # Main tasks view
│   ├── KanbanBoard.tsx
│   │   └── TaskCard.tsx (many)
│   │       └── TaskTerminalModal.tsx
│   └── AnalyticsDashboard.tsx
├── TerminalGrid.tsx               # Claude Code page
│   └── Terminal.tsx (many)
├── Insights.tsx                   # Jerry chat
│   └── MessageBubble.tsx (many)
└── Settings (modal)
    └── Various settings panels
```

---

## Layer 2: Frontend - Electron Main Process

### Technology Stack
- **Electron 28+** for desktop app
- **Node.js** for main process
- **electron-vite** for build tooling

### Directory Structure

```
apps/frontend/src/main/
├── index.ts                 # Main process entry
├── agent/                   # Agent management
│   ├── agent-manager.ts     # Spawns Python processes
│   ├── agent-process.ts     # Individual process handling
│   └── parsers/             # Output parsing
├── ipc-handlers/            # IPC communication
│   ├── index.ts             # Handler registration
│   └── task/
│       ├── crud-handlers.ts      # Create, Read, Update, Delete
│       ├── execution-handlers.ts # Start, Stop, Review
│       ├── worktree-handlers.ts  # Git worktree operations
│       └── shared.ts             # Shared utilities
├── terminal/                # Terminal management
│   ├── terminal-manager.ts
│   └── terminal-lifecycle.ts
├── project-store.ts         # Project data persistence
└── file-watcher.ts          # Watch spec files for changes
```

### Agent Manager

**File:** `agent-manager.ts`
**Purpose:** Manages Python process lifecycle.

```typescript
class AgentManager {
  private processes: Map<string, AgentProcess> = new Map();

  // Start planning agent (creates spec)
  async startPlanningAgent(taskId, projectPath, description, specDir, metadata, baseBranch) {
    const args = [
      specRunnerPath,
      '--task', description,
      '--project-dir', projectPath,
      '--spec-dir', specDir,
      '--no-build'  // CRITICAL: Prevents auto-continuation
    ];
    return this.spawn(taskId, args);
  }

  // Start coding agent (executes subtasks)
  async startTaskExecution(taskId, projectPath, specId, options) {
    const args = [
      runPyPath,
      '--spec-dir', specDir,
      '--project-dir', projectPath
    ];
    return this.spawn(taskId, args);
  }

  // Kill running process
  killTask(taskId) {
    const process = this.processes.get(taskId);
    if (process) {
      process.kill();
      this.processes.delete(taskId);
    }
  }
}
```

### IPC Handler Pattern

**File:** `execution-handlers.ts`
**Pattern:** Each handler validates, executes, and responds.

```typescript
ipcMain.handle(
  IPC_CHANNELS.TASK_START_BUILD,
  async (_, taskId: string): Promise<IPCResult> => {
    // 1. Find task and project
    const { task, project } = findTaskAndProject(taskId);
    if (!task || !project) {
      return { success: false, error: 'Task not found' };
    }

    // 2. Validate prerequisites
    if (!existsSync(specFilePath)) {
      return { success: false, error: 'spec.md not created yet' };
    }

    // 3. Execute action
    agentManager.startTaskExecution(taskId, project.path, task.specId, options);

    // 4. Update UI
    mainWindow.webContents.send(IPC_CHANNELS.TASK_STATUS_CHANGE, taskId, 'coding');

    // 5. Persist to file
    await persistPlanStatus(planPath, 'coding', project.id);

    return { success: true };
  }
);
```

---

## Layer 3: IPC Bridge

### Architecture

```
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   RENDERER         │     │     PRELOAD        │     │      MAIN          │
│   (React)          │────▶│   (Bridge API)     │────▶│   (Node.js)        │
│                    │     │                    │     │                    │
│ window.electronAPI │     │ contextBridge      │     │ ipcMain.handle     │
│   .startBuild()    │     │   .exposeInMain    │     │   (handlers)       │
└────────────────────┘     └────────────────────┘     └────────────────────┘
```

### IPC Channels

**File:** `apps/frontend/src/shared/constants/ipc.ts`

```typescript
export const IPC_CHANNELS = {
  // Task CRUD
  TASK_CREATE: 'task:create',
  TASK_LIST: 'task:list',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',

  // Task Execution
  TASK_START: 'task:start',
  TASK_STOP: 'task:stop',
  TASK_START_BUILD: 'task:start-build',  // Manual gate
  TASK_REVIEW: 'task:review',

  // Task Status
  TASK_UPDATE_STATUS: 'task:update-status',
  TASK_STATUS_CHANGE: 'task:status-change',  // Main → Renderer
  TASK_AGENT_STOPPED: 'task:agent-stopped',

  // Phase Updates
  TASK_PHASE_UPDATE: 'task:phase-update',
  EXECUTION_PROGRESS: 'task:execution-progress',

  // Terminal
  TASK_MONITOR_TERMINAL_CREATE: 'task-monitor:terminal-create',
};
```

### Preload API

**File:** `apps/frontend/src/preload/api/task-api.ts`

```typescript
export const taskApi = {
  createTask: (projectId, title, description, metadata) =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, projectId, title, description, metadata),

  startBuild: (taskId) =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_START_BUILD, taskId),

  stopTask: (taskId) =>
    ipcRenderer.send(IPC_CHANNELS.TASK_STOP, taskId),

  onStatusChange: (callback) =>
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGE, callback),
};
```

---

## Layer 4: Backend - Python Agents

### Directory Structure

```
apps/backend/
├── runners/
│   ├── spec_runner.py       # Planning agent
│   └── run.py               # Coding agent
├── qa/
│   ├── loop.py              # QA iteration loop
│   ├── criteria.py          # QA criteria definitions
│   └── report.py            # QA report generation
├── agents/
│   ├── planning_agent.py    # Planning logic
│   ├── coder.py             # Coding logic
│   └── session.py           # Claude API session
├── phase_config.py          # Ralph Wiggum mode config
└── prompts/
    ├── spec_writer.md       # Spec generation prompt
    └── spec_quick.md        # Quick spec prompt
```

### spec_runner.py (Planning Agent)

**Purpose:** Creates spec.md and implementation_plan.json.

```python
# Key arguments
parser.add_argument('--task', required=True, help='Task description')
parser.add_argument('--project-dir', required=True)
parser.add_argument('--spec-dir', required=True)
parser.add_argument('--no-build', action='store_true')  # CRITICAL FLAG

def main():
    # 1. Create worktree for isolated development
    create_worktree(spec_dir, base_branch)

    # 2. Analyze codebase
    context = analyze_codebase(project_dir)

    # 3. Generate spec using Claude API
    spec = generate_spec(task_description, context)
    write_file(spec_dir / 'spec.md', spec)

    # 4. Generate implementation plan with subtasks
    plan = generate_plan(spec)
    write_file(spec_dir / 'implementation_plan.json', plan)

    # 5. STOP if --no-build flag is set
    if args.no_build:
        print('__EXEC_PHASE__:{"phase":"planning","message":"Spec created, waiting for user approval"}')
        return  # DO NOT continue to coding

    # 6. Otherwise, continue to coding (old behavior)
    run_coding_agent(spec_dir)
```

### run.py (Coding Agent)

**Purpose:** Executes subtasks from implementation_plan.json.

```python
def main():
    # 1. Load implementation plan
    plan = load_json(spec_dir / 'implementation_plan.json')

    # 2. For each pending subtask
    for subtask in plan['phases'][0]['subtasks']:
        if subtask['status'] == 'completed':
            continue

        # 3. Update status to in_progress
        subtask['status'] = 'in_progress'
        emit_phase('coding', f"Working on: {subtask['title']}")

        # 4. Execute subtask using Claude
        result = execute_subtask(subtask, context)

        # 5. Update status to completed
        subtask['status'] = 'completed'
        save_plan(plan)

    # 6. Run QA
    qa_result = run_qa_loop(spec_dir)

    # 7. Transition based on QA result
    if qa_result.passed:
        emit_phase('complete', 'All tasks completed successfully')
    else:
        emit_phase('qa_fixing', f'QA failed: {qa_result.error}')
```

### Phase Protocol

**Output format for frontend communication:**

```python
def emit_phase(phase: str, message: str):
    """Output phase marker for frontend to parse."""
    data = json.dumps({"phase": phase, "message": message})
    print(f'__EXEC_PHASE__:{data}', flush=True)
```

**Phases:**
- `planning` - Creating spec
- `coding` - Implementing subtasks
- `qa_review` - Running tests
- `qa_fixing` - Fixing QA failures
- `complete` - All done
- `failed` - Unrecoverable error

---

## Layer 5: File System & Git

### Directory Structure

```
project-root/
├── .auto-claude/
│   ├── specs/
│   │   └── {specId}/
│   │       ├── spec.md                  # Task specification
│   │       ├── implementation_plan.json # Subtasks & status
│   │       ├── requirements.json        # Original task description
│   │       ├── task_metadata.json       # Category, complexity, etc.
│   │       ├── memories/                # Agent memory files
│   │       ├── attachments/             # Attached images
│   │       └── QA_FIX_REQUEST.md        # Feedback from human review
│   └── worktrees/
│       └── {specId}/                    # Isolated git worktree
│           └── (full project copy)
├── .git/
│   └── worktrees/
│       └── {specId}/                    # Git worktree metadata
└── (project files)
```

### implementation_plan.json Schema

```json
{
  "feature": "Task title",
  "description": "Task description",
  "status": "planning|coding|ai_review|human_review|done",
  "planStatus": "pending|planning|coding|review|completed",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "phases": [
    {
      "name": "Implementation",
      "subtasks": [
        {
          "id": "1",
          "title": "Create component",
          "description": "Detailed subtask description",
          "status": "pending|in_progress|completed|failed",
          "started_at": "ISO timestamp",
          "completed_at": "ISO timestamp",
          "actual_output": "What was done"
        }
      ]
    }
  ]
}
```

### Git Worktree Operations

```bash
# Create worktree (done by planning agent)
git worktree add .auto-claude/worktrees/{specId} -b auto-claude/{specId} [base-branch]

# List worktrees
git worktree list

# Remove worktree (done on task completion)
git worktree remove --force .auto-claude/worktrees/{specId}
git branch -D auto-claude/{specId}
```

---

## Layer 6: State Management

### Zustand Stores

#### task-store.ts

```typescript
interface TaskState {
  tasks: Task[];
  stoppedAgents: Set<string>;  // Track which agents were stopped

  // Actions
  loadTasks: (projectId: string) => Promise<void>;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  setAgentStopped: (taskId: string, stopped: boolean) => void;
}

// Exported actions (called from components)
export async function startTask(taskId: string) {
  window.electronAPI.startTask(taskId);
}

export async function stopTask(taskId: string) {
  window.electronAPI.stopTask(taskId);
  store.setAgentStopped(taskId, true);
}

export async function startBuild(taskId: string) {
  const result = await window.electronAPI.startBuild(taskId);
  if (result.success) {
    store.updateTaskStatus(taskId, 'coding');
    store.setAgentStopped(taskId, false);
  } else {
    toast.error('Failed to start build', { description: result.error });
  }
}
```

#### terminal-store.ts

```typescript
interface TerminalState {
  terminals: Terminal[];
  activeTerminalId: string | null;

  addTerminal: (projectPath?: string) => void;
  addClaudeCodeTerminal: (projectPath?: string) => Terminal;
  removeTerminal: (id: string) => void;
}
```

### State Flow

```
User Action → Store Action → IPC Call → Main Process → Python Agent
                                             ↓
                                        File Update
                                             ↓
UI Update ← Store Update ← IPC Event ← File Watcher ←
```

---

## Layer 7: UX Flow

### Task Creation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASK CREATION UX                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. USER ACTION                                                              │
│     └─▶ Clicks "New Task" or creates via Jerry chat                         │
│                                                                              │
│  2. TASK CREATION MODAL                                                      │
│     ├─▶ Enter title (or leave blank for auto-generation)                    │
│     ├─▶ Enter description (required)                                        │
│     ├─▶ Select category (feature, bug_fix, etc.)                            │
│     ├─▶ Attach images (optional)                                            │
│     └─▶ Click "Create Task"                                                 │
│                                                                              │
│  3. IMMEDIATE FEEDBACK                                                       │
│     ├─▶ Task appears in "Planning" column                                   │
│     ├─▶ Status badge shows "Planning"                                       │
│     ├─▶ Progress indicator shows activity                                   │
│     └─▶ Terminal button opens live output                                   │
│                                                                              │
│  4. PLANNING COMPLETES                                                       │
│     ├─▶ Desktop notification: "Spec ready for review"                       │
│     ├─▶ Toast notification in app                                           │
│     ├─▶ Task card shows [Resume] [Start Build] buttons                      │
│     └─▶ User can view spec.md in task detail modal                          │
│                                                                              │
│  5. MANUAL GATE                                                              │
│     ├─▶ User reviews spec.md and implementation_plan.json                   │
│     ├─▶ User clicks "Start Build" to approve                                │
│     └─▶ Task moves to "Coding" status                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Task Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TASK EXECUTION UX                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CODING PHASE                                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  TaskCard shows:                                                      │   │
│  │  ├─ Pulsing ring animation (task-running-pulse)                      │   │
│  │  ├─ Phase badge: "Implementing" with spinner                         │   │
│  │  ├─ Progress bar: "2/5 (40%)" subtasks                               │   │
│  │  ├─ [Stop] button                                                    │   │
│  │  └─ [Terminal] button → opens TaskTerminalModal                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  AI REVIEW PHASE                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  TaskCard shows:                                                      │   │
│  │  ├─ Phase badge: "Testing" or "Fixing Issues"                        │   │
│  │  ├─ QA iteration count (if multiple attempts)                        │   │
│  │  └─ Automatic transition when QA passes                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  HUMAN REVIEW PHASE                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  TaskCard shows:                                                      │   │
│  │  ├─ Review reason badge: "Completed" or "QA Issues"                  │   │
│  │  ├─ Task detail modal with:                                          │   │
│  │  │   ├─ Diff view of changes                                         │   │
│  │  │   ├─ QA report summary                                            │   │
│  │  │   ├─ [Approve] button                                             │   │
│  │  │   └─ [Reject] button with feedback field                          │   │
│  │  └─ Approve → Done, Reject → Back to Coding                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 8: UI Components

### Design System

**Theme:** Oscura Midnight (Dark theme with cyan accents)

```css
/* apps/frontend/src/renderer/styles/globals.css */
:root {
  --background: #0B0B0F;
  --foreground: #E5E5E5;
  --card: #12121A;
  --border: #1E1E2E;
  --primary: #00D4FF;         /* Cyan accent */
  --glow-cyan: #00D4FF;
  --shadow-glow-sm: 0 0 10px rgba(0, 212, 255, 0.3);
}
```

### TaskCard Visual States

```typescript
// TaskCard.tsx
<Card className={cn(
  'card-surface task-card-enhanced cursor-pointer',
  // Running state
  hasActiveAgent && !isStuck && 'ring-2 ring-primary border-primary task-running-pulse',
  // Stuck state
  isStuck && 'ring-2 ring-warning border-warning task-stuck-pulse',
  // Archived state
  isArchived && 'opacity-60 hover:opacity-80',
  // Selected state (multi-select)
  isSelectable && isSelected && 'ring-2 ring-ring border-ring bg-accent/10'
)}>
```

### Badge System

```typescript
// Status badges
<Badge variant={getStatusBadgeVariant(status)}>
  {getStatusLabel(status)}
</Badge>

// Execution phase badges
<Badge className={EXECUTION_PHASE_BADGE_COLORS[phase]}>
  <Loader2 className="animate-spin" />
  {getContextualPhaseLabel(status, phase)}
</Badge>

// Category badges
<Badge className={TASK_CATEGORY_COLORS[category]}>
  <CategoryIcon className="h-2.5 w-2.5" />
  {TASK_CATEGORY_LABELS[category]}
</Badge>
```

### Button States

```typescript
// Planning status - agent running
<Button variant="destructive" onClick={stopTask}>
  <Square /> Stop
</Button>

// Planning status - agent stopped
<>
  <Button variant="outline" onClick={startTask}>
    <Play /> Resume
  </Button>
  <Button variant="default" onClick={startBuild}>
    <Play /> Start Build
  </Button>
</>

// Coding status
<Button variant={isRunning ? 'destructive' : 'default'} onClick={handleStartStop}>
  {isRunning ? <><Square /> Stop</> : <><Play /> {isAgentStopped ? 'Resume' : 'Run'}</>}
</Button>
```

---

## Summary

### Key Architectural Decisions

1. **Electron + React** for cross-platform desktop app
2. **Python backend** for AI agent logic (better Claude SDK support)
3. **Zustand** for lightweight state management
4. **Git worktrees** for isolated task development
5. **IPC bridge** for secure renderer ↔ main communication
6. **Phase protocol** for structured agent ↔ frontend communication

### Key Safeguards

1. **Manual gate** between Planning and Coding (FIX-10)
2. **--no-build flag** prevents auto-continuation
3. **TASK_START_BUILD** is the only path to coding
4. **Kanban drag** does NOT start agents
5. **Status changes** do NOT start agents
6. **Recovery** marks coding tasks as interrupted (no auto-restart)

### Data Flow Summary

```
User → React UI → Zustand Store → IPC → Main Process → Agent Manager → Python
                                                                         ↓
                                                                   Claude API
                                                                         ↓
                                                                   File System
                                                                         ↓
UI Update ← Store ← IPC Event ← File Watcher ← implementation_plan.json ←
```

---

**End of Full Architecture Documentation**
