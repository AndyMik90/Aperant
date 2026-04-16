# Auto-Claude MCP Skill

**🚨 Auto-invoke when:** RDR notification "[Auto-Claude RDR]" or user says "fix/recover/resume tasks"

## Launching Auto-Claude from VS Code / Claude Code (Windows 11)

**CRITICAL: ALWAYS use the .bat file to launch Auto-Claude. NEVER open a terminal directly.**

### Launch Policy Inside An Existing Aperant Session

- These launch and restart commands are for explicit start/restart situations only
- If Aperant is already open, do not launch it again
- If the relevant project tab is already open, reuse that tab and do not create a duplicate project tab
- When the user asks to "fully arm" a project inside an already-open Aperant session, roll with the current app and current tab first
- Only start or restart Aperant when the user explicitly asks for it or there is clear evidence the app is not open

### Killing Auto-Claude (MUST kill watchdog, not just Electron)

**CRITICAL: The external watchdog is a separate node.exe process. If you only kill electron.exe, the watchdog thinks it crashed and RESPAWNS it. You must kill the watchdog process too.**

```bash
# Kill BOTH Electron AND the watchdog node.exe processes
taskkill.exe //F //IM "electron.exe" 2>/dev/null; taskkill.exe //F //FI "WINDOWTITLE eq Auto-Claude*" 2>/dev/null; taskkill.exe //F //FI "IMAGENAME eq node.exe" //FI "WINDOWTITLE eq *watchdog*" 2>/dev/null
```

The safest approach: close the terminal/cmd window running `Aperant-MCP.bat` — that kills the watchdog (parent) which kills Electron (child).

### Starting Auto-Claude

```bash
powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process 'C:\Users\topem\source\repos\Aperant-MCP\Aperant-MCP.bat'"
```

**Why clear ELECTRON_RUN_AS_NODE:** VS Code / Claude Code sets this env var which makes Electron run as plain Node.js instead of a GUI app.

### Full Kill + Restart Sequence

```bash
# 1. Kill the bat terminal (kills watchdog + electron)
taskkill.exe //F //FI "WINDOWTITLE eq *Auto-Claude*" 2>/dev/null
# 2. Safety: also kill any orphaned electron processes
taskkill.exe //F //IM "electron.exe" 2>/dev/null
# 3. Wait for processes to die
sleep 2
# 4. Start fresh via .bat (includes watchdog)
powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process 'C:\Users\topem\source\repos\Aperant-MCP\Aperant-MCP.bat'"
```

---

Use this skill when the user wants to:

- Queue coding tasks for Auto-Claude to implement
- Run multiple tasks overnight with shutdown-on-complete
- Create tasks with specific model/thinking configurations
- Delegate implementation work to autonomous agents

## Agent Profiles

| Profile            | Spec Creation                   | Planning         | Coding           | QA Review        | Best For        |
| ------------------ | ------------------------------- | ---------------- | ---------------- | ---------------- | --------------- |
| **auto**     | Opus Ultra Think                | Opus High        | Opus Low         | Opus Low         | Default choice  |
| **complex**  | Opus Ultra Think                | Opus Ultra Think | Opus Ultra Think | Opus Ultra Think | Deep analysis   |
| **balanced** | Sonnet Medium                   | Sonnet Medium    | Sonnet Medium    | Sonnet Medium    | Speed/quality   |
| **quick**    | Haiku Low                       | Haiku Low        | Haiku Low        | Haiku Low        | Fast iterations |
| **custom**   | User-specified model + Thinking |                  |                  |                  | Custom config   |

## MCP Tools Reference

### create_task - Single Task

```json
{
  "projectId": "uuid-from-auto-claude",
  "description": "Detailed task description...",
  "title": "Optional - auto-generated if empty",
  "options": {
    "provider": "MiniMax",
    "model": "opus",
    "requireReviewBeforeCoding": false,
    "baseBranch": "MCD",
    "referencedFiles": ["src/relevant-file.ts"],
    "category": "feature",
    "complexity": "medium",
    "priority": "high"
  }
}
```

**Provider parameter:** Specify which account to use (e.g., "MiniMax", "Primary"). Omit to use the global active account. Requires "Enable profile combinations" in Settings > Accounts.

### list_tasks - List Project Tasks

```json
{
  "projectId": "uuid",
  "status": "backlog"
}
```

Returns: Array of task summaries with taskId, title, description, status, createdAt.

### start_task - Start a Single Task

```json
{
  "projectId": "uuid",
  "taskId": "001-feature-name",
  "options": {
    "model": "opus",
    "baseBranch": "main"
  }
}
```

### get_task_status - Check Task Progress

```json
{
  "projectId": "uuid",
  "taskId": "001-feature-name"
}
```

Returns: taskId, title, status, phase, progress, subtaskCount, completedSubtasks, error, reviewReason.

### start_batch - Multiple Tasks

```json
{
  "projectId": "uuid",
  "tasks": [
    { "description": "First task...", "options": { "priority": "high" } },
    { "description": "Second task..." },
    { "description": "Third task...", "options": { "category": "bug_fix" } }
  ],
  "options": {
    "model": "sonnet",
    "requireReviewBeforeCoding": false
  },
  "startImmediately": true
}
```

### wait_for_human_review - With Shutdown

```json
{
  "projectId": "uuid",
  "taskIds": ["001-feature", "002-bugfix", "003-refactor"],
  "onComplete": {
    "command": "shutdown",
    "args": ["/s", "/t", "120"],
    "delaySeconds": 60
  },
  "pollIntervalMs": 30000
}
```

## RDR (Recover Debug Resend) - Task Recovery System

**CRITICAL: When RDR sends notification → Execute this workflow immediately**

### Instant Response Workflow

```
1. Get batches: get_rdr_batches(projectId)
2. Process by type: Use auto-escalation based on mcp_iteration
3. Report results to user
```

### Auto-Escalation Priority System (6 Levels)

Track attempts via `mcp_iteration` field in implementation_plan.json.

**P1: Auto-CONTINUE** (Attempt 1-2, 95% of cases)

- **Use**: `process_rdr_batch(type: "incomplete")` or `process_rdr_batch(type: "errors")`
- **Sets**: `status: "start_requested"` in implementation_plan.json
- **Result**: File watcher detects change → auto-starts task within 2-3 seconds
- **When**: First detection, task has incomplete subtasks or errors. Tasks usually self-recover.

**P2: Auto-RECOVER** (when P1 fails)

- **Use**: `recover_stuck_task(taskId, autoRestart: true)`
- **When**: P1 didn't work, task entered recovery mode (yellow outline, `stuckSince` set)
- **Result**: Removes stuckSince, sets start_requested, file watcher routes correctly
- **Equivalent to**: Clicking the "Recover" button in the UI

**P3: Request Changes** (Attempt 3+, 4% of cases)

- **Use**: `submit_task_fix_request(taskId, feedback)`
- **Writes**: `QA_FIX_REQUEST.md` with debugging context
- **Analyzes**: Similar errors across multiple tasks
- **Result**: Task gets specific fix instructions before retry
- **When**: Same error appears 2+ times, `mcp_iteration` ≥ 3

**P4: Auto-fix JSON** (anytime)

- **Use**: `process_rdr_batch(type: "json_error")`
- **Fixes**: Corrupted/empty implementation_plan.json files
- **When**: JSON parse errors detected (independent of iteration count)

**P5: Manual Debug** (RARE, `mcp_iteration` ≥ 4)

- **Pattern detection** across failures
- **Root cause investigation**
- **Manual file edits** if needed
- **When**: Same error appears 3+ times, needs deep analysis

**P6: Delete & Recreate OR Build & Restart** (LAST RESORT, `mcp_iteration` ≥ 5)

- **6A: Delete & Recreate Task** — Task is fundamentally broken. Read original description, delete spec + worktree, create corrected replacement via `create_task`
- **6B: Build & Restart Auto-Claude** — Issue is in Auto-Claude itself. Fix source code, trigger `trigger_auto_restart`
- **When**: All priorities 1-5 exhausted
- See `auto-claude-rdr` skill for full details

### Decision Tree

```
IF batch type = "json_error"
  → Priority 4 (auto-fix JSON — can run anytime)

ELSE IF batch type = "incomplete" AND mcp_iteration ≤ 2
  → Priority 1: Auto-CONTINUE (set start_requested, force retry)

ELSE IF task has metadata.stuckSince (yellow outline in UI)
  → Priority 2: Auto-RECOVER (recover_stuck_task, remove stuckSince)

ELSE IF (batch type = "qa_rejected" OR "errors") AND mcp_iteration ≥ 3
  → Priority 3: Request Changes (submit_task_fix_request with context)

ELSE IF mcp_iteration ≥ 4
  → Priority 5: Manual Debug (read logs, find patterns, fix root cause)

ELSE IF mcp_iteration ≥ 5 AND issue is in Auto-Claude source code
  → Priority 6A/6B: Delete & Recreate / Build & Restart

ELSE IF mcp_iteration ≥ 3 AND task is not urgent
  → Priority 6C: Defer to Queue (defer_task — park it, deal with it later)

ELSE
  → Priority 1: Auto-CONTINUE (default — force retry)
```

### MCP Tools Quick Reference

**get_rdr_batches(projectId)** → Get all tasks needing intervention, categorized by type

**process_rdr_batch(projectId, batchType, fixes)** → Batch process incomplete/errors/json_error tasks (P1, P4)

**recover_stuck_task(projectId, taskId, autoRestart?)** → Remove stuckSince, restart stuck tasks (P2)

**submit_task_fix_request(projectId, taskId, feedback)** → Write detailed fix request for single task (P3)

**get_task_error_details(projectId, taskId)** → Get error logs, exitReason, subtask status

**get_task_logs(projectId, taskId, phase?, lastN?)** → Get phase logs (planning/coding/validation)

**defer_task(projectId, taskId, reason?)** → Move broken task to Queue with RDR disabled (P6C — deal with it later)

## Custom Phase Configuration

For fine-grained control, specify per-phase models and thinking:

```json
{
  "options": {
    "phaseModels": {
      "specCreation": "opus",
      "planning": "opus",
      "coding": "sonnet",
      "qaReview": "haiku"
    },
    "phaseThinking": {
      "specCreation": 63999,
      "planning": 16384,
      "coding": 4096,
      "qaReview": 1024
    }
  }
}
```

### Thinking Token Levels

| Level       | Tokens | Use Case                               |
| ----------- | ------ | -------------------------------------- |
| None        | 0      | Fast, no extended thinking             |
| Low         | 1,024  | Quick edits, simple tasks              |
| Medium      | 4,096  | Balanced speed/quality                 |
| High        | 16,384 | Complex reasoning                      |
| Ultra Think | 63,999 | Maximum depth, architectural decisions |

## Task Status Flow

```
backlog → in_progress → ai_review → human_review → pr_created → done
                            ↓
                         error
```

- **backlog** - Task created, not started
- **in_progress** - Agent actively working
- **ai_review** - QA agent reviewing
- **human_review** - Ready for human review (code committed to worktree)
- **pr_created** - PR has been created
- **done** - Merged and complete
- **error** - Something went wrong

## Overnight Workflow Example

User: "Queue these tasks and shutdown when all done"

1. **Create batch** with `balanced` profile (cost-efficient for batch)
2. **Start all tasks** immediately
3. **Wait for human_review** status on all tasks
4. **Execute shutdown** command with 2-minute delay

```
→ start_batch({
    projectId: "uuid",
    tasks: [...],
    options: { model: "sonnet" },
    startImmediately: true
  })
→ wait_for_human_review({
    projectId: "uuid",
    taskIds: [...],
    onComplete: {
      command: "shutdown",
      args: ["/s", "/t", "120"],
      delaySeconds: 60
    }
  })
```

## Important Notes

- **requireReviewBeforeCoding: true** = Task pauses after spec creation for human approval
- **requireReviewBeforeCoding: false** = Task runs fully autonomous until Human Review
- Human Review = All code is written, committed to worktree, ready for merge
- Tasks run in **isolated git worktrees** - safe from main branch
- User can **merge or discard** each worktree after review

## Reference Files

Include relevant files to give the agent context:

```json
{
  "options": {
    "referencedFiles": [
      "src/components/Auth.tsx",
      "src/hooks/useAuth.ts",
      "src/types/user.ts"
    ]
  }
}
```

These files are read by the agent during spec creation for better context.

## Categories

| Category           | When to Use            |
| ------------------ | ---------------------- |
| `feature`        | New functionality      |
| `bug_fix`        | Fixing broken behavior |
| `refactoring`    | Code restructuring     |
| `documentation`  | Docs and comments      |
| `security`       | Security improvements  |
| `performance`    | Speed/efficiency       |
| `ui_ux`          | UI/UX changes          |
| `infrastructure` | Build, CI, config      |
| `testing`        | Test coverage          |

## Complexity Levels

| Level       | Description                    |
| ----------- | ------------------------------ |
| `trivial` | One-liner, typo fix            |
| `small`   | Single file, simple logic      |
| `medium`  | Multiple files, moderate logic |
| `large`   | Many files, complex logic      |
| `complex` | Architectural changes          |

## Priority Levels

| Priority   | When to Use        |
| ---------- | ------------------ |
| `low`    | Nice to have       |
| `medium` | Normal priority    |
| `high`   | Important, do soon |
| `urgent` | Critical, do first |

## Task Chaining (Auto-Start on Completion)

Chain tasks so the next one auto-starts when the previous completes:

```json
{
  "feature": "Task A",
  "status": "pending",
  "chain": {
    "next_task_id": "002-task-b",
    "on_completion": "auto_start",
    "require_approval": false
  }
}
```

**Chain fields:**

- `next_task_id` - The spec ID of the next task to start
- `on_completion` - Set to `"auto_start"` to trigger automatically
- `require_approval` - If `true`, waits for human approval before starting next

**Example chain: A → B → C**

```
065-task-a (chain: 066-task-b) → completes → triggers
066-task-b (chain: 067-task-c) → completes → triggers
067-task-c (no chain) → completes → done
```

## Direct Start Trigger (File-Based)

Trigger a task to start immediately by setting `status: 'start_requested'`:

```bash
mkdir -p ".auto-claude/specs/065-my-task"
echo '{}' > ".auto-claude/specs/065-my-task/task_metadata.json"
cat > ".auto-claude/specs/065-my-task/implementation_plan.json" << 'EOF'
{
  "feature": "My Task",
  "description": "Task description",
  "status": "start_requested",
  "start_requested_at": "2026-01-29T05:00:00Z",
  "phases": [{"name": "Phase 1", "status": "pending"}]
}
EOF
```

The file watcher detects `status: 'start_requested'` and auto-starts the task.

**Use cases:**

- Create and start tasks without MCP tools
- Sequential task creation (A, B, C all start immediately)
- Integration with external systems

## Sequential Task Creation

Create multiple tasks that all start immediately:

```bash
# Task A
mkdir -p ".auto-claude/specs/065-task-a" && echo '{}' > ".auto-claude/specs/065-task-a/task_metadata.json"
echo '{"feature":"Task A","status":"start_requested","phases":[]}' > ".auto-claude/specs/065-task-a/implementation_plan.json"

# Task B
mkdir -p ".auto-claude/specs/066-task-b" && echo '{}' > ".auto-claude/specs/066-task-b/task_metadata.json"
echo '{"feature":"Task B","status":"start_requested","phases":[]}' > ".auto-claude/specs/066-task-b/implementation_plan.json"

# Task C
mkdir -p ".auto-claude/specs/067-task-c" && echo '{}' > ".auto-claude/specs/067-task-c/task_metadata.json"
echo '{"feature":"Task C","status":"start_requested","phases":[]}' > ".auto-claude/specs/067-task-c/implementation_plan.json"
```

All tasks start immediately as they're created.

## Interaction Patterns

| Style                | Method                                      | When to Use                              |
| -------------------- | ------------------------------------------- | ---------------------------------------- |
| **Chaining**   | `chain` field in implementation_plan.json | Dependent tasks (A must finish before B) |
| **Sequential** | Create with `status: start_requested`     | Independent tasks that start immediately |
| **Batch**      | MCP `start_batch` tool                    | Quick batch via MCP API                  |
| **Single**     | MCP `create_task` + `start_task`        | One-off task creation                    |

### Chaining (Dependent Tasks)

Tasks linked via `chain.next_task_id` - next task auto-starts when previous completes.
Best for: pipelines, dependent workflows, staged rollouts.

### Sequential (Parallel Tasks)

Each task created with `status: start_requested` - all start immediately.
Best for: independent tasks, batch processing, parallel work.

### Batch (MCP API)

Use `start_batch` MCP tool with `startImmediately: true`.
Best for: programmatic creation, integration with other tools.

### Single (MCP API)

Use `create_task` then `start_task` MCP tools.
Best for: one-off tasks, interactive creation.

## LLM Manager Control - Build & Restart

**CRITICAL: Claude Code can trigger builds and restart Auto-Claude via MCP, but ONLY if enabled per-project.**

### Permission System

**Two-Level Control:**

1. **Global Setting** (App Settings → General → Auto-Restart on Loop/Crash)
   - `autoRestartOnFailure.enabled` - Master toggle for auto-restart feature
   - Controls whether the feature works at all
   - Location: App-level settings

2. **Per-Project Setting** (Project Settings → General → LLM Manager Build & Restart)
   - `llmManagerEnabled` - Enable/disable LLM Manager control for THIS project
   - Defaults to `true` when Auto-Build is initialized
   - Location: Project-specific settings
   - **User can toggle this ON/OFF per project**

**Both must be enabled for Claude Code to trigger builds/restarts.**

### MCP Tool: trigger_auto_restart

```json
{
  "reason": "prompt_loop" | "crash" | "manual" | "error",
  "buildCommand": "npm run build"  // Optional - defaults to project settings
}
```

**What it does:**
- Triggers a build command (e.g., `npm run build`)
- Restarts Auto-Claude after build completes
- Used when prompt loops, crashes, or errors are detected

### Simple Command-Based Restart (Preferred Method)

Claude Code can restart Auto-Claude using simple shell commands - no special MCP tool required.

**Step 1: Get User's Configured Commands**

Read the user's settings from `settings.json` in Auto-Claude's user data directory:
- **Windows:** `%APPDATA%\auto-claude-ui\settings.json`
- **macOS:** `~/Library/Application Support/auto-claude-ui/settings.json`
- **Linux:** `~/.config/auto-claude-ui/settings.json`

Look for these fields:
```json
{
  "autoRestartOnFailure": {
    "reopenCommand": "<user's OS-specific start command>",
    "buildCommand": "npm run build"
  }
}
```

**Step 2: Execute Restart (Build → Kill → Start)**

**IMPORTANT:** The correct order is Build → Kill → Start (NOT Kill → Build → Start)

**For Build + Restart:**
```bash
# 1. BUILD FIRST (while app is still running)
<buildCommand from settings>  # e.g., npm run build

# 2. THEN kill the process
taskkill //F //IM "electron.exe"  # Windows
pkill -f electron                  # Unix

# 3. THEN start using user's Reopen Command
<reopenCommand from settings>
```

**For Restart Only (no build):**
```bash
# Windows - IMPORTANT: Clear ELECTRON_RUN_AS_NODE env var (VSCode sets it)
taskkill //F //IM "electron.exe"
<reopenCommand from settings>  # User's configured command

# macOS/Linux
pkill -f electron
<reopenCommand from settings>
```

**Example Reopen Commands by OS:**
- **Windows (dev):** `powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process 'C:\path\to\Auto-Claude-Mod.bat'"`
- **macOS (packaged):** `open -a "Auto-Claude"`
- **Linux (AppImage):** `/path/to/auto-claude.AppImage`

**Settings Location:** App Settings → Developer Tools → Auto-Claude MCP System

**Why use simple commands over MCP tool?**
- More direct control
- Doesn't require MCP connection
- Works even if Auto-Claude is unresponsive
- User has full control over the restart command for their OS

**Permission checks:**
1. Checks `autoRestartOnFailure.enabled` (global) - returns error if disabled
2. **Should check** `llmManagerEnabled` (per-project) - not yet implemented in backend

**Example usage:**
```typescript
// From Claude Code
await mcp.call_tool('trigger_auto_restart', {
  reason: 'prompt_loop',
  buildCommand: 'npm run build'
});
```

### When to Use trigger_auto_restart

| Scenario | Use Tool? | Reason |
|----------|-----------|--------|
| Prompt loop detected (agent stuck waiting) | ✅ YES | Rebuild and restart to break the loop |
| Memory leak / high memory usage | ✅ YES | Rebuild and restart to reset memory |
| Task crashed with build errors | ✅ YES | Rebuild to fix compilation issues |
| User manually requests restart | ✅ YES | User-initiated maintenance |
| Normal task completion | ❌ NO | No restart needed |

### Checking if LLM Manager Control is Enabled

**Before calling MCP tools, check project settings:**

```typescript
// Read project settings.json
const projectSettings = await readProjectSettings(projectId);

if (!projectSettings.llmManagerEnabled) {
  return {
    success: false,
    error: 'LLM Manager control is disabled for this project. Enable it in Project Settings → General → LLM Manager Build & Restart.'
  };
}

// Then check global setting
const appSettings = await readAppSettings();

if (!appSettings.autoRestartOnFailure?.enabled) {
  return {
    success: false,
    error: 'Auto-restart feature is disabled. Enable it in Settings → General → Auto-Restart on Loop/Crash.'
  };
}

// Both enabled - proceed with MCP tool call
await mcp.call_tool('trigger_auto_restart', { reason: 'prompt_loop' });
```

### Backend Implementation (Future)

**Files to modify:**
- `apps/backend/auto_claude_tools.py` - MCP tool handlers
- `apps/backend/cli/commands.py` - Build/restart command handlers

**Check both settings:**
```python
# In MCP tool handler
project_settings = load_project_settings(project_dir)
app_settings = load_app_settings()

# Check per-project permission
if not project_settings.get('llmManagerEnabled', True):
    return {"error": "LLM Manager control is disabled for this project"}

# Check global permission
if not app_settings.get('autoRestartOnFailure', {}).get('enabled', False):
    return {"error": "Auto-restart feature is disabled in app settings"}

# Proceed with build/restart
```

### User Control

Users can enable/disable LLM Manager control per-project:

**Location:** Project Settings → General → LLM Manager Build & Restart

**UI:**
```
┌─────────────────────────────────────────┐
│ LLM Manager Build & Restart             │
│ Allow Claude Code to trigger builds...  │
├─────────────────────────────────────────┤
│ ✓ Auto-Build Initialized  .auto-claude │
│ Project is configured for Auto-Build    │
├─────────────────────────────────────────┤
│ Enable LLM Manager Control         [ON] │
│ Allow Claude Code to trigger builds...  │
└─────────────────────────────────────────┘
```

**Toggle ON:**  Claude Code can trigger builds/restarts for this project
**Toggle OFF:** Claude Code cannot control this project (but Auto-Build remains initialized)

### Use Cases for Per-Project Control

| Project | llmManagerEnabled | Reason |
|---------|-------------------|--------|
| Production app | `false` | Prevent accidental changes to live code |
| Experimental features | `true` | Allow Claude Code to iterate quickly |
| Stable library | `false` | Manual review required for all changes |
| Personal project | `true` | Trust Claude Code to manage builds |

### Important Notes

- **Default:** LLM Manager control is **enabled by default** when Auto-Build is initialized
- **Granular:** Each project can have independent settings
- **Safety:** Users can disable per project without affecting others
- **Backend:** Backend enforcement not yet implemented (only frontend toggle exists)

### RDR Priority 6 Integration

Priority 6 has two options depending on where the problem is:

**6A. Delete & Recreate Task** (problem is in the TASK):
1. Read original task description from `spec.md` or `implementation_plan.json`
2. Delete broken spec directory + worktree
3. Create corrected replacement via `create_task` MCP tool
4. Start the new task

**6B. Build & Restart Auto-Claude** (problem is in AUTO-CLAUDE):
1. Claude Code diagnoses bug in Auto-Claude source code
2. Makes changes to Auto-Claude's source files
3. Calls `trigger_auto_restart` with `reason: "manual"` and optional `buildCommand`
4. Auto-Claude builds and restarts, tasks resume

**6C. Defer to Queue** (task is broken but not urgent):
1. Call `defer_task` MCP tool with taskId and reason
2. Task moves to Queue board with RDR disabled
3. Agent killed if running, task data preserved
4. User manually restarts when ready

**When:** `mcp_iteration` ≥ 3+ (6C) or ≥ 5 (6A/6B), priorities 1-5 exhausted. See `auto-claude-rdr` skill for full details.

**Key Points:**
- **6A**: Task is fundamentally wrong — delete and recreate
- **6B**: Auto-Claude itself has a bug — fix source code and restart
- **6C**: Task keeps failing but isn't urgent — park it, deal with it later
- See auto-claude-rdr skill for full RDR priority system documentation

## MCP Server Restart & projectPath Fallback

### Restarting the MCP Server

The MCP server runs as a **standalone tsx process** (stdio subprocess). There is **no hot restart** — you must restart Claude Code entirely:

1. Exit Claude Code (`/exit` or close terminal)
2. Re-open Claude Code
3. Run `/mcp` to verify server reconnected

**Why restart is needed:** The MCP server holds an in-memory project store. After Auto-Claude restarts or projects change, the UUID lookup (`projectId`) may return "Project not found". Restarting Claude Code respawns the MCP server with fresh state.

### ALWAYS Pass projectPath Fallback

**CRITICAL:** When calling ANY MCP tool, ALWAYS include `projectPath` alongside `projectId`. The UUID lookup can fail (stale cache, Auto-Claude restart), but `projectPath` always works:

```typescript
// CORRECT — always include projectPath
mcp__auto-claude-manager__process_rdr_batch({
  projectId: "5d5889f3-...",
  projectPath: "C:\\Users\\topem\\Desktop\\CV Project",  // Fallback
  batchType: "errors",
  fixes: [{ taskId: "989-fix-ejs" }]
})

// WRONG — UUID-only fails after Auto-Claude restart
mcp__auto-claude-manager__process_rdr_batch({
  projectId: "5d5889f3-...",
  batchType: "errors",
  fixes: [{ taskId: "989-fix-ejs" }]
})
```

**The RDR notification always includes both** `Project UUID` and `Project Path` — use both.

## MCP Connection & Troubleshooting

### How the MCP Server Connects

Auto-Claude's MCP server runs as a **stdio** subprocess spawned by Claude Code. Config in `~/.claude.json`:

```json
{
  "mcpServers": {
    "auto-claude-manager": {
      "command": "npx",
      "args": [
        "--yes", "tsx",
        "--import", "file:///C:/Users/topem/source/repos/Aperant-MCP/apps/frontend/src/main/mcp-server/register-loader.mjs",
        "C:/Users/topem/source/repos/Aperant-MCP/apps/frontend/src/main/mcp-server/index.ts"
      ]
    }
  }
}
```

**Config scopes** (checked in order):
1. **User root**: `~/.claude.json` → `mcpServers` (global)
2. **Project**: `~/.claude.json` → `projects["<path>"].mcpServers`
3. **Global Claude**: `~/.claude/.mcp.json`
4. **Local project**: `.mcp.json` in project root

### Critical Windows Rules

- `--import` flag path MUST use `file:///C:/...` prefix (Node reads `C:` as URL scheme without it)
- Main entry point (tsx arg) does NOT need `file:///` — tsx handles it
- `claude mcp add-json` silently strips `cwd` field — always use absolute paths

### If MCP Tools Are Unavailable

1. **Check config**: Read `~/.claude.json`, verify `mcpServers.auto-claude-manager` exists
2. **Re-add if missing**: Edit `~/.claude.json` to restore config (you have permission)
3. **Restart session**: MCP reconnects on new session
4. **Verify**: Server logs `[MCP] Auto-Claude Manager MCP server started` on success

### Common MCP Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ERR_UNSUPPORTED_ESM_URL_SCHEME` | Missing `file:///` prefix on `--import` | Add `file:///` before Windows path |
| MCP tools not in tool list | Config missing or session stale | Re-add config, restart session |
| `claude mcp add-json` strips `cwd` | Known CLI bug | Use absolute paths only |
| Tools timeout | Server crashed or Electron not running | Check Auto-Claude app is running |

### Permission to Fix MCP Config

**You have explicit permission to:**
- Edit `~/.claude.json` to add/fix `mcpServers.auto-claude-manager`
- Edit VS Code settings (`.vscode/settings.json`) if needed for MCP
- Edit project-scoped MCP configs in `~/.claude.json` → `projects["<path>"].mcpServers`
- Use correct absolute paths with `file:///` prefix for Windows
