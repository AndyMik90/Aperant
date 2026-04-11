# Auto-Codex RDR - Recovery & Resume, Debug, Resend

**🚨 Auto-invoke when:** RDR notification "[Auto-Codex RDR]"

## Launching Auto-Codex from VS Code / Codex (Windows 11)

**CRITICAL: ALWAYS use the .bat file to launch Auto-Codex. NEVER open a terminal directly.**

### Killing Auto-Codex (MUST kill watchdog, not just Electron)

**CRITICAL: The external watchdog is a separate node.exe process. If you only kill electron.exe, the watchdog thinks it crashed and RESPAWNS it. Kill the bat terminal window instead.**

```bash
# Kill the bat terminal (kills watchdog + electron together)
taskkill.exe //F //FI "WINDOWTITLE eq *Auto-Codex*" 2>/dev/null
# Safety: also kill any orphaned electron processes
taskkill.exe //F //IM "electron.exe" 2>/dev/null
```

### Starting Auto-Codex

```bash
sleep 2  # Wait for processes to die
powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process 'C:\Users\topem\source\repos\Aperant-MCP\Aperant-MCP.bat'"
```

**Why clear ELECTRON_RUN_AS_NODE:** VS Code / Codex sets this env var which makes Electron run as plain Node.js instead of a GUI app.

---

## What is "Recovery"?

RDR handles TWO types of recovery:

1. **Recovery Mode** (Tasks showing yellow outline + "Recover" button)

   - **Cause:** Task stuck (has `metadata.stuckSince` timestamp)
   - **Fix:** Remove `stuckSince` OR update `lastActivity` to exit recovery mode
   - **Visual:** Yellow outline, "Stuck" badge, "Recover" button in UI
   - **File-based:** Delete `metadata.stuckSince` from implementation_plan.json
2. **General RDR Recovery** (Fix/resume ANY problematic task)

   - Incomplete tasks → Resume (set `status: "start_requested"`)
   - JSON errors → Auto-fix corrupted JSON
   - QA rejected → Submit fix request
   - Errors → Debug and fix

## CRITICAL: RDR Notification = Rate Limit Has Reset

**If you receive an RDR notification, the rate limit has ALREADY RESET.** ALWAYS process ALL tasks immediately.

Task log entries showing "You've hit your limit · resets Xam" are **HISTORICAL** — they were written when the task agent hit the limit, NOT reflecting current state. RDR only sends notifications when the Codex session is available again.

**NEVER** refuse to recover tasks because task logs show rate limit messages. Those entries are old. The fact that RDR sent you a notification proves the session is back online.

**Rule:** Receive RDR → process ALL tasks → no exceptions.

## Instant Recovery Workflow

1. **Get batches:** `get_rdr_batches(projectId)` → Returns tasks grouped by problem type
2. **Analyze data:** Use `get_task_error_details` and `get_task_logs` to understand failures
3. **Apply priority:** Choose Priority 1-4 based on problem type and iteration count
4. **Execute recovery/resume/fix:** Use `process_rdr_batch` or `submit_task_fix_request`
5. **Report results:** Summarize actions taken

## Available Data (UI Tabs)

**Overview Tab:** Task status, progress, exit reason, review reason
**Subtasks Tab:** Phase/subtask completion status (X/Y complete)
**Logs Tab:** Planning, Coding, Validation phase logs
**Files Tab:** Changed files, implementation details
**QA Report:** Acceptance criteria validation, issues found

## MCP Tools & Return Data

### get_rdr_batches(projectId)

Returns tasks grouped by type:

- `json_error` - Corrupted implementation_plan.json
- `incomplete` - Tasks with pending subtasks (X/Y complete)
- `qa_rejected` - Failed QA validation
- `errors` - Tasks with exitReason: "error"

Each task includes: taskId, status, subtasks, exitReason, mcp_iteration

### get_task_error_details(projectId, taskId)

Returns:

- Recent logs (last 20 entries)
- exitReason, reviewReason
- Subtask status breakdown
- QA report (if rejected)
- Error context

### get_task_logs(projectId, taskId, phase?, lastN?)

Phases: `planning`, `coding`, `validation`
Returns: Timestamped log entries (default: last 50)

### submit_task_fix_request(projectId, taskId, feedback)

Writes `QA_FIX_REQUEST.md` with:

- Feedback from you
- Context from logs, subtasks, errors
- Auto-updates status to trigger retry

### process_rdr_batch(projectId, batchType, fixes[])

Batch processes multiple tasks:

- `type: "incomplete"` → Auto-resume (Priority 1)
- `type: "json_error"` → Auto-fix JSON (Priority 4)
- `type: "qa_rejected"` or `"errors"` → Request changes (Priority 3)

### recover_stuck_task(projectId, taskId, autoRestart?)

**NEW: File-based recovery tool for stuck tasks**

Recovers individual tasks by removing `metadata.stuckSince` timestamp and optionally restarting them.

**Parameters:**

- `projectId`: The project UUID
- `taskId`: The task/spec ID to recover
- `autoRestart`: (optional, default: true) Whether to auto-restart after recovery

**What it does:**

1. Removes `metadata.stuckSince` from implementation_plan.json (exits recovery mode)
2. If `autoRestart: true`, sets `status: "start_requested"` (triggers Priority 1 auto-resume)
3. Updates both main plan AND worktree plan (agent needs worktree version)
4. File watcher detects changes within 2-3s and routes task appropriately

**Returns:**

- `success`: true/false
- `recovered`: Whether stuckSince was removed
- `action`: What actions were taken
- `message`: Human-readable result

**Usage:**

```typescript
// Recover and restart a single stuck task
mcp__auto-Codex-manager__recover_stuck_task({
  projectId: "1812aa62-aeb1-4e7a-9d5e-b5f7c79d1226",
  taskId: "250-ai-review-stuck-1",
  autoRestart: true
})

// Batch recover multiple tasks in parallel
// Call recover_stuck_task multiple times in one message
```

**When to use:**

- Tasks showing yellow outline + "Stuck" badge in UI
- Tasks in any status (ai_review, in_progress, human_review) with stuckSince timestamp
- Batch recovery by calling multiple times in parallel (4+ tasks at once)

**Implementation:**

- Uses file-based recovery (not IPC) - works from external Codex
- MCP server runs as stdio process, can't access Electron IPC, but CAN write to plan files
- File watcher picks up changes and handles routing automatically

### defer_task(projectId, taskId, reason?)

**Priority 6C: Defer broken task to Queue board with RDR disabled.**

Parks a task that keeps failing so other work continues. Non-destructive — task data preserved.

**Parameters:**

- `projectId`: The project UUID
- `taskId`: The task/spec ID to defer
- `reason`: (optional) Why it's being deferred (logged for context)

**What it does:**

1. Sets task status to `queue` (moves to Queue/Planning board)
2. Disables RDR for this task (`rdrDisabled: true`)
3. Kills running agent process if any
4. Records `deferred_at`, `deferred_reason`, `deferred_from_status` for context
5. Updates both main AND worktree plans + metadata

**Usage:**

```typescript
mcp__auto-Codex-manager__defer_task({
  projectId: "b95d0809-2027-491f-af8d-ea04961e4ec0",
  taskId: "073-broken-task",
  reason: "Keeps failing with same import error — will fix after other tasks"
})
```

**When to use:**

- Task keeps failing after 3+ RDR attempts and isn't urgent
- Want to unblock queue and focus on other tasks
- Task needs manual investigation but not right now
- Prefer to batch-fix broken tasks later

## Auto-Escalation Priority System (6 Levels)

**Priority 1: Auto-CONTINUE** (95% of cases)

First response to detected tasks. Set `start_requested` to restart them — they usually self-recover.

- **Use:** `process_rdr_batch(type: "incomplete")` or `process_rdr_batch(type: "errors")`
- **When:** First detection (`mcp_iteration` ≤ 2), task has incomplete subtasks or errors
- **Result:** Sets `status: "start_requested"` → file watcher auto-starts within 2-3s
- **No analysis needed** — Just force retry. Tasks restart and route to correct board.

**Priority 2: Auto-RECOVER**

Tasks will enter recovery mode for different reasons (yellow outline in UI, `stuckSince` timestamp set).

- **Use:** `recover_stuck_task(taskId, autoRestart: true)`
- **When:** Task has `metadata.stuckSince` set (yellow outline + "Stuck" badge in UI)
- **Result:** Removes `stuckSince`, sets `start_requested`, file watcher routes task correctly
- **Equivalent to:** Clicking the "Recover" button in the UI
- **Note:** P1→P2 escalation happens across RDR iterations (first try = P1, next detection = P2)

**Priority 3: Request Changes** (4% of cases)

Tasks with persistent ERRORS that need troubleshooting context:

- **Use:** `submit_task_fix_request(taskId, feedback)`
- **When:** `mcp_iteration` ≥ 3, same error appears 2+ times
- **Feedback must include:**
  - Error summary from logs
  - What failed (subtask/phase)
  - Context from Overview/Subtasks/Logs tabs
  - Specific fix guidance

**Priority 4: Auto-Fix JSON** (anytime)

Fixes corrupted JSON files immediately — can run at any priority level:

- **Use:** `process_rdr_batch(type: "json_error")`
- **When:** JSON parse errors detected (anytime, independent of iteration count)
- **Result:** Creates minimal valid JSON, triggers retry
- **Method:** Attempts to repair JSON structure, creates minimal valid JSON if unfixable

**Priority 5: Manual Debug** (RARE)

For persistent errors needing deep investigation:

- **When:** `mcp_iteration` ≥ 4, Priorities 1-3 failed repeatedly
- **Actions:**
  - Pattern detection across multiple failures
  - Root cause investigation in logs
  - Manual file edits if needed
- **Note:** This is NOT about pressing Recover button — that's Priority 2

**Priority 6 (LAST RESORT)** - Delete & Recreate, Build & Restart, or Defer to Queue

When all other priorities have failed (`mcp_iteration` ≥ 5), choose based on where the problem is:

**6A. Delete & Recreate Task** (problem is in the TASK)

For tasks that are fundamentally broken beyond repair:

- **When:** Task keeps failing after 4+ attempts, same errors recurring, task approach is flawed
- **Actions:**
  1. Read the original task description from `spec.md` or `implementation_plan.json`
  2. Delete the broken task's spec directory + worktree
  3. Create a new corrected task via `create_task` MCP tool with improved description/approach
  4. Start the new task
- **Result:** Fresh task with corrected approach replaces the broken one
- **Note:** This is a task-level nuclear option. The original task is gone. Use only when the task itself is the problem (wrong approach, impossible requirements, corrupted state beyond JSON fix).

**Example:**

```bash
# 1. Save description
desc=$(python3 -c "import json; print(json.load(open('specs/073-qwik/implementation_plan.json'))['description'])")

# 2. Delete broken task + worktree
rm -rf ".auto-Codex/specs/073-qwik"
rm -rf ".auto-Codex/worktrees/tasks/073-qwik"

# 3. Create corrected replacement via MCP
mcp__auto-Codex-manager__create_task({
  projectId: "uuid",
  description: "Corrected: $desc",
  options: { priority: "high" }
})
```

**6B. Build & Restart Auto-Codex** (problem is in AUTO-Codex)

For critical issues requiring Auto-Codex source code changes:

- **When:** Issue is in Auto-Codex itself (file watcher bug, RDR logic error, UI crash)
- **Use:** `trigger_auto_restart` MCP tool (from auto-Codex-manager MCP server)
- **Requirements:**
  1. Global `autoRestartOnFailure.enabled = true` (App Settings)
  2. Per-project `llmManagerEnabled = true` (Project Settings)
- **Actions:**
  1. Identify bug in Auto-Codex's source code (not task code)
  2. Make changes to Auto-Codex codebase
  3. Trigger build command (default: `npm run build`)
  4. Restart Auto-Codex application
- **Result:** Auto-Codex restarts with fixed code, tasks can resume
- **Note:** This modifies Auto-Codex's SOURCE CODE, not the user's project.

**MCP Tool:**

```json
{
  "tool": "trigger_auto_restart",
  "parameters": {
    "reason": "manual",
    "buildCommand": "npm run build"
  }
}
```

**Permission Check:**

```typescript
// Both must be true to allow build & restart
const globalEnabled = settings.autoRestartOnFailure?.enabled;
const projectEnabled = projectSettings.llmManagerEnabled;

if (!globalEnabled || !projectEnabled) {
  return { error: "Build & restart not enabled" };
}
```

**When NOT to use:**

- Task just needs to be retried (use Priority 1)
- Task needs specific fix guidance (use Priority 2)
- Auto-Codex is working correctly (use Priority 2-4 for task-level fixes)

**6C. Defer to Queue** (task is broken but not urgent — deal with it later)

For tasks that keep failing but don't need immediate attention. Parks the task in the Queue board with RDR disabled so other work continues unblocked.

- **When:** Task keeps failing, you want to focus on other tasks first, come back to it later
- **Use:** `defer_task` MCP tool
- **Actions:**
  1. Sets task status to `queue` (moves to Queue/Planning board)
  2. Disables RDR for this task (`rdrDisabled: true` in task_metadata.json)
  3. Kills running agent if any
  4. Records defer reason and previous status for context
- **Result:** Task is parked in Queue. RDR ignores it. User can manually restart when ready.
- **Note:** Non-destructive — task data is preserved. Unlike 6A, nothing is deleted. Unlike 6B, Auto-Codex isn't restarted. The task just waits.

**MCP Tool:**

```json
{
  "tool": "defer_task",
  "parameters": {
    "projectId": "uuid",
    "taskId": "073-broken-task",
    "reason": "Keeps failing with same import error — will investigate after other tasks complete"
  }
}
```

**When to prefer 6C over 6A/6B:**

| Scenario | Use |
|----------|-----|
| Task is fundamentally wrong (bad requirements) | 6A — Delete & recreate |
| Bug in Auto-Codex itself | 6B — Build & restart |
| Task just won't cooperate but isn't urgent | **6C — Defer to queue** |
| Want to batch-fix broken tasks later | **6C — Defer to queue** |
| Blocking other tasks from running (queue system) | **6C — Defer to queue** |

### Simple Command-Based Restart Workflow

The restart mechanism uses simple shell commands. No special MCP tools required - Codex can execute these directly via Bash.

**Restart Order (IMPORTANT):** Build → Kill → Start

**For Restart Only (no build):**

```bash
# Windows
taskkill //F //IM "electron.exe"
powershell.exe -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process '<reopen-command>'"

# macOS
pkill -f electron
open -a "Auto-Codex"

# Linux
pkill -f electron
/path/to/auto-Codex.AppImage
```

**For Build + Restart:**

```bash
# 1. BUILD FIRST (while app is still running)
cd apps/frontend && npm run build

# 2. THEN kill the process
taskkill //F //IM "electron.exe"  # Windows
pkill -f electron                  # Unix

# 3. THEN start using Reopen Command
<user's configured reopen command>
```

**Settings:**

- `reopenCommand`: User's OS-specific command to start Auto-Codex
- `buildCommand`: Build command (default: `npm run build`)

**Note:** VSCode/Codex sets `ELECTRON_RUN_AS_NODE=1` which breaks Electron apps. The Windows PowerShell command above clears this env var before starting.

## Decision Tree

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

ELSE IF mcp_iteration ≥ 5 AND issue is in Auto-Codex source code
  → Priority 6A/6B: Delete & Recreate / Build & Restart

ELSE IF mcp_iteration ≥ 3 AND task is not urgent
  → Priority 6C: Defer to Queue (defer_task — park it, deal with it later)

ELSE
  → Priority 1: Auto-CONTINUE (default — force retry)
```

## Writing Effective Fix Requests (Priority 3)

Include in `feedback`:

1. **Error summary:** "Task failed at subtask X with error: Y"
2. **Log excerpts:** Recent error messages from `get_task_logs`
3. **Subtask status:** "Completed 5/8 subtasks, stuck at subtask 6"
4. **Context:** What was being attempted when it failed
5. **Fix guidance:** "Check file permissions", "Verify API endpoint exists", etc.

**Example:**

```
Task 073-qwik failed at subtask 6/21 (implementing router).

Error from logs:
  "Module not found: @qwik/router"

Context: Task is trying to import @qwik/router but package not installed.

Fix: Install @qwik/router dependency before importing.
```

---

## Crash Recovery System

Auto-Codex includes an external watchdog process that monitors the Electron app and automatically restarts it when crashes are detected.

### How It Works

**Two-Process Architecture:**

1. **Watchdog Process** (external Node.js process)

   - Monitors the Electron app as a child process
   - Detects abnormal exits (crashes, segfaults, unhandled exceptions)
   - Writes crash flag file with crash details
   - Auto-restarts Electron if enabled in settings
2. **Electron App** (main process)

   - Reads crash flag on startup
   - Sends crash notification to Codex via RDR/MCP
   - Deletes crash flag after processing

**Crash Flag File:**

- Location: `<app-data>/auto-Codex/crash-flag.json`
  - Windows: `%APPDATA%\auto-Codex\crash-flag.json`
  - macOS: `~/Library/Application Support/auto-Codex/crash-flag.json`
  - Linux: `~/.config/auto-Codex/crash-flag.json`
- Written by watchdog when crash detected
- Read by Electron on next startup
- Contains: timestamp, exitCode, signal, logs (last 20 lines)

**LLM Manager (Codex) Integration:**

- Crash notifications automatically sent to Codex via RDR/MCP
- Codex can verify Auto-Codex is back online
- Codex can trigger RDR to recover incomplete tasks
- **Codex can restart Auto-Codex via MCP** (if enabled - see LLM Manager Control below)

**LLM Manager Control (Per-Project Permission):**

- **Location:** Project Settings → General → LLM Manager Build & Restart
- **Setting:** `llmManagerEnabled` (defaults to `true`)
- **Controls:** Whether Codex can trigger builds/restarts for THIS specific project
- **MCP Tool:** `trigger_auto_restart` - Triggers build command and restart
- **Two-level check required:**
  1. Global `autoRestartOnFailure.enabled` (App Settings)
  2. Per-project `llmManagerEnabled` (Project Settings)
- **Use case:** Disable for production projects, enable for experimental work
- **Note:** Backend enforcement not yet implemented (frontend toggle only)

**Used by RDR Priority 6:**
When all other recovery methods fail and the issue is in Auto-Codex's source code, Priority 6 uses this MCP tool to:

1. Allow Codex to modify Auto-Codex's codebase
2. Build the changes
3. Restart Auto-Codex with the fix applied
4. Resume tasks that were blocked by the Auto-Codex bug

### Settings

**Location:** Settings → Developer Tools → Crash Recovery toggle (first item)

**crashRecovery object in settings.json:**

```json
{
  "crashRecovery": {
    "enabled": true,          // Master toggle: ON = auto-restart via watchdog, OFF = do nothing (enabled by default)
    "autoRestart": true,      // Auto-restart after crash (if enabled is true)
    "maxRestarts": 3,         // Max restarts within cooldown period
    "restartCooldown": 60000  // Cooldown period in ms (1 minute)
  }
}
```

**Toggle Behavior:**

- **ON (default)**: Launches Auto-Codex via external watchdog, auto-restarts on crashes
- **OFF**: Standard launch, no crash monitoring or auto-restart

### Crash Notification Format

When Electron detects a crash flag, it sends this message to Codex via RDR:

```markdown
[Auto-Codex Crash Recovery] ⚠️ APP RESTARTED AFTER CRASH

**Crash Details:**
- **Time:** 2026-02-03 14:32:45
- **Exit Code:** 1
- **Signal:** SIGSEGV
- **Restart Attempt:** 2

**Status:** Auto-Codex was automatically restarted by the watchdog

---

**Recent Logs (Last 20 lines):**
```

[FileWatcher] Specs watcher READY
[RDR] Polling tasks...
[ERROR] Segmentation fault at 0x00007fff5fc3d000

```

---

**What Happened?**
The Auto-Codex application crashed unexpectedly. The external watchdog detected
the crash and automatically restarted the application. This notification provides
crash details for debugging.

**Recovery Actions:**
- ✅ Application restarted successfully
- ✅ Crash details logged
- ⚠️ Review logs above for error patterns

**To Disable Crash Recovery:**
Go to Settings → Developer Tools → Crash Recovery (toggle off)
```

### Graceful Restart (MCP Command)

For **intentional** restarts (not crashes), use the graceful restart MCP tool:

**MCP Tool:** `mcp__auto-Codex-manager__trigger_graceful_restart`

**Parameters:**

```json
{
  "reason": "prompt_loop" | "memory_leak" | "manual" | "settings_change" | "recovery",
  "saveState": true,     // Save window bounds and state before restart
  "delay": 2000          // Delay before restart in ms (default: 2000)
}
```

**Example usage:**

```typescript
// From Codex
await window.electronAPI.invoke('restart:graceful', {
  reason: 'prompt_loop',
  saveState: true,
  delay: 3000
});
```

### Crash vs Graceful Restart

| Feature                         | Crash Recovery                    | Graceful Restart                             |
| ------------------------------- | --------------------------------- | -------------------------------------------- |
| **Trigger**               | External watchdog detects crash   | MCP tool or user action                      |
| **Process**               | Watchdog spawns new Electron      | Electron relaunches itself                   |
| **State**                 | Not saved (crash = unexpected)    | Saved before restart                         |
| **Notification**          | Crash details sent to Codex | Optional notification                        |
| **Use Case**              | Unexpected crashes, segfaults     | Prompt loops, memory leaks, settings changes |
| **Crash Loop Protection** | Yes (max 3 restarts/minute)       | No (intentional)                             |

### Crash Loop Protection

If Auto-Codex crashes repeatedly (3+ times within 60 seconds):

1. Watchdog **stops auto-restart** attempts
2. Crash loop notification sent to Codex:
   ```markdown
   [Auto-Codex Crash Recovery] 🔥 CRASH LOOP DETECTED

   Crash count: 3 crashes in 60 seconds
   Stopping restart attempts to prevent infinite loop
   ```
3. Watchdog exits with error code 1

**To recover from crash loop:**

- Investigate crash logs in the notification
- Fix the underlying issue (corrupt file, invalid config, etc.)
- Manually restart Auto-Codex

### Launching with Watchdog

**NPM Scripts:**

```bash
# Development (with watchdog)
npm run dev:watchdog

# Production (with watchdog)
npm run start:watchdog
```

**Manual launch:**

```bash
npx tsx src/main/watchdog/launcher.ts ./node_modules/.bin/electron out/main/index.js
```

### Troubleshooting

**Crash recovery not working:**

1. Check Settings → Developer Tools → Crash Recovery is **enabled**
2. Verify you're launching via `npm run dev:watchdog` or `npm run start:watchdog`
3. Check watchdog logs: `[Watchdog] Process started with PID: ...`

**Crash flag file not deleted:**

- File path: `<app-data>/auto-Codex/crash-flag.json`
- Manually delete if corrupted: `rm <path-to-crash-flag.json>`

**Infinite restart loop:**

- Watchdog stops after 3 crashes/minute automatically
- If watchdog keeps restarting, check `crashRecovery.maxRestarts` in settings

**Crash notifications not appearing in Codex:**

1. Verify MCP connection is active
2. Check that RDR system is enabled
3. Check Electron console for `[CrashRecovery] ✅ Crash notification sent successfully`

**State not restored after restart:**

- Crash recovery does NOT save state (crashes are unexpected)
- Use graceful restart (`restart:graceful`) to save state before restarting

## MCP Server Restart & projectPath Fallback

### Restarting the MCP Server

The MCP server runs as a **standalone tsx process** (stdio subprocess). There is **no hot restart** — you must restart Codex entirely:

1. Exit Codex (`/exit` or close terminal)
2. Re-open Codex
3. Run `/mcp` to verify server reconnected

**Why restart is needed:** The MCP server holds an in-memory project store. After Auto-Codex restarts or projects change, the UUID lookup (`projectId`) may return "Project not found". Restarting Codex respawns the MCP server with fresh state.

### ALWAYS Pass projectPath Fallback

**CRITICAL:** When calling ANY MCP tool, ALWAYS include `projectPath` alongside `projectId`. The UUID lookup can fail (stale cache, Auto-Codex restart), but `projectPath` always works:

```typescript
// CORRECT — always include projectPath
mcp__auto-Codex-manager__recover_stuck_task({
  projectId: "5d5889f3-...",
  projectPath: "C:\\Users\\topem\\Desktop\\CV Project",  // Fallback
  taskId: "250-stuck-task",
  autoRestart: true
})

// WRONG — UUID-only fails after Auto-Codex restart
mcp__auto-Codex-manager__recover_stuck_task({
  projectId: "5d5889f3-...",
  taskId: "250-stuck-task",
  autoRestart: true
})
```

**The RDR notification always includes both** `Project UUID` and `Project Path` — use both.

## MCP Connection & Troubleshooting

### How the MCP Server Connects

Auto-Codex's MCP server runs as a **stdio** subprocess spawned by Codex. Config in `~/.Codex.json`:

```json
{
  "mcpServers": {
    "auto-Codex-manager": {
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
1. **User root**: `~/.Codex.json` → `mcpServers` (global)
2. **Project**: `~/.Codex.json` → `projects["<path>"].mcpServers`
3. **Global Codex**: `~/.Codex/.mcp.json`
4. **Local project**: `.mcp.json` in project root

### Critical Windows Rules

- `--import` flag path MUST use `file:///C:/...` prefix (Node reads `C:` as URL scheme without it)
- Main entry point (tsx arg) does NOT need `file:///` — tsx handles it
- `Codex mcp add-json` silently strips `cwd` field — always use absolute paths

### If MCP Tools Are Unavailable

1. **Check config**: Read `~/.Codex.json`, verify `mcpServers.auto-Codex-manager` exists
2. **Re-add if missing**: Edit `~/.Codex.json` to restore config (you have permission)
3. **Restart session**: MCP reconnects on new session
4. **Verify**: Server logs `[MCP] Auto-Codex Manager MCP server started` on success

### Permission to Fix MCP Config

**You have explicit permission to:**
- Edit `~/.Codex.json` to add/fix `mcpServers.auto-Codex-manager`
- Edit VS Code settings if needed for MCP connectivity
- Edit project-scoped MCP configs in `~/.Codex.json` → `projects["<path>"].mcpServers`
- Use correct absolute paths with `file:///` prefix for Windows
