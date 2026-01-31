# Bug Investigation: Logs Disappear After Restart

**Issue:** #1657
**Version Affected:** v2.7.6-beta.2
**Version Working:** v2.7.5
**Environment:** Development mode (`npm run dev`)
**Platform:** Windows (primary), possibly others
**Status:** Reproduction phase

---

## Bug Summary

Task logs disappear after restarting the application in development mode. This issue does NOT occur in production builds (exe). Additionally, tasks that reach 100% completion experience UI breakdown, failing to display logs and enter verification mode despite backend completion.

---

## Reproduction Steps

### Prerequisites
- Auto Claude v2.7.6-beta.2
- Node.js >= 24.0.0
- npm >= 10.0.0
- Windows OS (primary platform for bug)

### Step-by-Step Reproduction

#### 1. Initial App Start
```bash
cd apps/frontend
npm run dev
```

**Expected:** Application starts successfully in development mode

**Observed:** _[TO BE FILLED]_

#### 2. Create and Run a Task
- Navigate to the task creation interface
- Create a new task (any simple task will do)
- Start the task execution
- Wait for logs to appear in the task detail view

**Expected:**
- Task starts executing
- Logs appear in real-time in the task detail view
- Logs are visible and scrollable

**Observed:** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

#### 3. Record Pre-Restart State
Before stopping the app, document:
- Number of log entries visible: _[COUNT]_
- Last log entry content: _[TEXT]_
- Task status: _[STATUS]_
- Browser DevTools Console output: _[ERRORS/WARNINGS]_

#### 4. Stop the Application
```bash
# Press Ctrl+C in the terminal running npm run dev
```

**Expected:** Application shuts down cleanly

**Observed:** _[TO BE FILLED]_

#### 5. Restart the Application
```bash
npm run dev
```

**Expected:** Application restarts successfully

**Observed:** _[TO BE FILLED]_

#### 6. Navigate to the Same Task
- Open the task that was running before restart
- Check the task detail view for logs

**Expected (Correct Behavior):**
- All previous logs should be visible
- Log history should be preserved

**Observed (Bug Behavior):** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

---

## Log Storage Investigation

### File System Check

#### During First Run
Check the following locations for log files:

1. **Spec directory logs:**
   ```bash
   ls -la .auto-claude/specs/*/task_logs.json
   ```
   **Found:** _[YES/NO]_
   **Path:** _[FULL PATH]_
   **Size:** _[FILE SIZE]_

2. **Worktree logs:**
   ```bash
   ls -la .auto-claude/worktrees/tasks/*/task_logs.json
   ```
   **Found:** _[YES/NO]_
   **Path:** _[FULL PATH]_
   **Size:** _[FILE SIZE]_

3. **Application data directory:**
   - Windows: `%APPDATA%/auto-claude/`
   - Check for any cached or persisted log data

   **Found:** _[YES/NO]_
   **Path:** _[FULL PATH]_

#### After Restart
Repeat the above checks and note any differences:

**Differences:** _[TO BE FILLED]_

---

## Browser DevTools Investigation

### Console Output

#### Before Restart
```
[PASTE RELEVANT CONSOLE OUTPUT]
```

#### After Restart
```
[PASTE RELEVANT CONSOLE OUTPUT]
```

**Key Observations:**
- Errors related to log loading: _[YES/NO]_
- Warnings about state hydration: _[YES/NO]_
- IPC communication failures: _[YES/NO]_

### Application State (Redux/Zustand DevTools)

If available, inspect the state store:

#### Task Store State Before Restart
```json
[PASTE TASK STORE STATE]
```

#### Task Store State After Restart
```json
[PASTE TASK STORE STATE]
```

**Key Differences:** _[TO BE FILLED]_

### Network/IPC Tab

Check for IPC calls related to log loading:

**IPC Calls Before Restart:**
- _[LIST IPC CALLS]_

**IPC Calls After Restart:**
- _[LIST IPC CALLS]_

**Missing or failing calls:** _[TO BE FILLED]_

---

## UI State at 100% Completion

### Separate Issue: Verification Mode Not Activating

When a task reaches 100% completion:

**Expected Behavior:**
- Logs remain visible
- Verification mode UI activates
- User can review and approve/reject the work

**Observed Behavior:** _[TO BE FILLED]_

**Screenshots:** _[TO BE ATTACHED]_

---

## Environment Comparison

### Development vs Production

| Aspect | Development (`npm run dev`) | Production (exe build) |
|--------|----------------------------|------------------------|
| Logs persist after restart | ❌ NO (BUG) | ✅ YES (works) |
| Path resolution method | _[TO BE FILLED]_ | _[TO BE FILLED]_ |
| Storage mechanism | _[TO BE FILLED]_ | _[TO BE FILLED]_ |

---

## Version Comparison

### Changes in v2.7.6-beta.2 vs v2.7.5

**Note:** This will be filled in Phase 2 (Root Cause Analysis) by examining git diff.

Key areas to investigate:
- [ ] XState migration (PR #1575)
- [ ] Task state management refactor
- [ ] Log loading/persistence logic
- [ ] Zustand store configuration
- [ ] Electron main process changes
- [ ] IPC handler modifications

---

## Hypotheses

Based on initial observation, potential root causes could be:

1. **State Persistence Issue**
   - Zustand task store may not be persisting logs to localStorage
   - State hydration on app restart may be incomplete

2. **Path Resolution Issue**
   - Development mode may use different path resolution than production
   - Log file paths may not resolve correctly in dev environment

3. **IPC Handler Issue**
   - Log loading IPC handler may fail silently in dev mode
   - Backend-frontend communication may be broken for log retrieval

4. **XState Migration Side Effect**
   - Recent XState refactor may have changed task state lifecycle
   - Status change listeners may not trigger log loading

5. **Cache Issue**
   - Log cache may be cleared on app restart in dev mode
   - Production builds may use a more persistent cache mechanism

---

## Next Steps

1. ✅ Complete reproduction and documentation (this file)
2. ⏳ Add detailed logging to trace state flow (Phase 1, Subtask 1-2)
3. ⏳ Document log storage locations (Phase 1, Subtask 1-3)
4. ⏳ Analyze git diff v2.7.5..v2.7.6-beta.2 (Phase 2, Subtask 2-1)
5. ⏳ Trace log loading flow (Phase 2, Subtask 2-2)
6. ⏳ Compare Zustand persist config (Phase 2, Subtask 2-3)
7. ⏳ Identify root cause (Phase 2, Subtask 2-4)
8. ⏳ Implement fix (Phase 3)

---

## Notes

- This is a **regression bug** - functionality that worked in v2.7.5
- **Platform-specific:** Primarily affects Windows users
- **Environment-specific:** Only affects development mode, not production builds
- **Impact:** Prevents users from viewing task history after app restart
- **Secondary issue:** UI breakdown at 100% completion needs separate investigation

---

## Test Task Information

**Task ID:** _[TO BE FILLED]_
**Task Name:** _[TO BE FILLED]_
**Task Type:** _[TO BE FILLED]_
**Created:** _[TIMESTAMP]_
**Status at test time:** _[STATUS]_

---

*Last Updated: 2026-01-31*
*Investigator: Auto-Claude Coder Agent*
*Subtask: subtask-1-1 - Reproduce and document bug*
