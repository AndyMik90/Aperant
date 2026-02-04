# Agent-Drift: Architecture Fit

**Date:** 2026-02-04
**Status:** Integration Planning
**Related:** [AGENT_DRIFT_INTEGRATION.md](AGENT_DRIFT_INTEGRATION.md)

---

## How Agent-Drift Fits Into Auto-Claude

Agent-Drift is a **behavioral monitoring layer** that slots between the agent execution and the event pipeline. It doesn't change the core flow—it observes and reports.

---

## Current Architecture (Without Agent-Drift)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTO-CLAUDE ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Python subprocess)                                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ coder.py - Main Agent Loop                                          │    │
│  │                                                                      │    │
│  │   for subtask in implementation_plan:                               │    │
│  │       client = create_claude_client()                               │    │
│  │       response = run_agent_session(client, subtask)  ◄──────────┐   │    │
│  │       post_session_processing(response)                         │   │    │
│  │                                                                  │   │    │
│  └──────────────────────────────────────────────────────────────────│───┘    │
│                                                                      │        │
│  ┌───────────────────────────────────────────────────────────────────│───┐   │
│  │ session.py - Agent Session Execution                              │   │   │
│  │                                                                   │   │   │
│  │   for message in agent_response:                                  │   │   │
│  │       if tool_use:                                                │   │   │
│  │           result = execute_tool(tool_name, args)  ◄───────────────┤   │   │
│  │           emit_sdk_msg("tool_use", {...})  ───────────────────────┼───┼──►│
│  │       if thinking:                                                │   │   │
│  │           emit_sdk_msg("thinking", {...})  ───────────────────────┼───┼──►│
│  │                                                                   │   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  stdout: __SDK_MSG__:{...}  ─────────────────────────────────────────────────┼──►
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  ELECTRON MAIN (TypeScript)                                                  │
│                                                                              │
│  agent-process.ts                                                            │
│    └── Captures stdout → Parses __SDK_MSG__ → Routes events                  │
│                                         │                                    │
│  agent-events-handlers.ts               ▼                                    │
│    └── IPC: 'execution-progress' → Updates stores                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  RENDERER (React)                                                            │
│                                                                              │
│  task-store.ts (Zustand)                                                     │
│    └── updateTask(), updateExecutionProgress()                               │
│                                         │                                    │
│  TaskCard.tsx, Terminal.tsx             ▼                                    │
│    └── UI components subscribe to store, re-render                           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## With Agent-Drift Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTO-CLAUDE + AGENT-DRIFT ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Python subprocess)                                                 │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ apps/backend/drift/  ◄────────────────────────────────── NEW MODULE   │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │  models.py  │  │vectorizer.py│  │ baseline.py │  │ detector.py │  │  │
│  │  │ BehaviorTrace│  │ 7 feature   │  │Thread-safe  │  │Drift scoring│  │  │
│  │  │ DriftReport │  │ extraction  │  │ baseline    │  │ algorithms  │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                           │                                           │  │
│  │                     ┌─────┴─────┐                                     │  │
│  │                     │ monitor.py│ ◄── DriftMonitor class              │  │
│  │                     │           │                                     │  │
│  │                     │ • start_session(task_id)                        │  │
│  │                     │ • track_tool(name, duration, success)           │  │
│  │                     │ • get_interim_report()                          │  │
│  │                     │ • end_session() → DriftReport                   │  │
│  │                     └───────────┘                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                 ▲                                            │
│                                 │ import                                     │
│  ┌──────────────────────────────┴────────────────────────────────────────┐  │
│  │ coder.py - Main Agent Loop                                            │  │
│  │                                                                       │  │
│  │   from drift import DriftMonitor  ◄─────────────────────── NEW IMPORT │  │
│  │                                                                       │  │
│  │   drift_monitor = DriftMonitor(storage_dir=".auto-claude/drift")      │  │
│  │                                                                       │  │
│  │   for subtask in implementation_plan:                                 │  │
│  │       drift_monitor.start_session(task.id)  ◄──────────── NEW: Start  │  │
│  │                                                                       │  │
│  │       client = create_claude_client()                                 │  │
│  │       response = run_agent_session(client, subtask)                   │  │
│  │       post_session_processing(response)                               │  │
│  │                                                                       │  │
│  │       report = drift_monitor.end_session()  ◄──────────── NEW: End    │  │
│  │       emit_sdk_msg("drift_report", report.to_dict())  ◄── NEW: Emit   │  │
│  │                                                                       │  │
│  │       if report.alert_level == "critical":  ◄──────────── NEW: Check  │  │
│  │           halt_and_alert()                                            │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                 │                                            │
│  ┌──────────────────────────────┴────────────────────────────────────────┐  │
│  │ session.py - Agent Session Execution                                  │  │
│  │                                                                       │  │
│  │   for message in agent_response:                                      │  │
│  │       if tool_use:                                                    │  │
│  │           start = time.time()                                         │  │
│  │           result = execute_tool(tool_name, args)                      │  │
│  │           duration = (time.time() - start) * 1000                     │  │
│  │                                                                       │  │
│  │           drift_monitor.track_tool(  ◄───────────────────── NEW: Track│  │
│  │               tool_name,                                              │  │
│  │               duration,                                               │  │
│  │               result.success                                          │  │
│  │           )                                                           │  │
│  │                                                                       │  │
│  │           emit_sdk_msg("tool_use", {...})                             │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  stdout: __SDK_MSG__:{...}  + __SDK_MSG__:{"type":"drift_report",...}  ─────┼─►
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  ELECTRON MAIN (TypeScript)                                                  │
│                                                                              │
│  agent-process.ts                                                            │
│    └── Captures stdout → Parses __SDK_MSG__                                  │
│                                         │                                    │
│  agent-events-handlers.ts               ▼                                    │
│    ├── IPC: 'execution-progress' → Updates stores                            │
│    └── IPC: 'drift-report' → NEW: Routes to drift-store  ◄────── NEW HANDLER│
│                                                                              │
│  drift-handlers.ts  ◄─────────────────────────────────────────── NEW FILE   │
│    ├── drift:get-state → Read reports from .auto-claude/drift/              │
│    ├── drift:reset-baseline → Call Python to reset                          │
│    └── drift:get-baseline → Return baseline info                            │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  RENDERER (React)                                                            │
│                                                                              │
│  drift-store.ts (Zustand)  ◄──────────────────────────────────── NEW STORE  │
│    ├── currentScore: number                                                  │
│    ├── alertLevel: 'normal' | 'warning' | 'critical'                         │
│    ├── recentReports: DriftReport[]                                          │
│    ├── baseline: BaselineInfo                                                │
│    └── actions: fetchState(), resetBaseline()                                │
│                                         │                                    │
│  task-store.ts                          │                                    │
│    └── task.driftScore, task.driftLevel (per-task metrics)                   │
│                                         │                                    │
│                                         ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ UI Components                                                           ││
│  │                                                                         ││
│  │  TaskCard.tsx                                                           ││
│  │    └── <DriftIndicator score={0.12} level="normal" />  ◄──── NEW       ││
│  │                                                                         ││
│  │  DriftDashboard.tsx  ◄─────────────────────────────────────── NEW PAGE ││
│  │    ├── Score timeline chart                                             ││
│  │    ├── Component breakdown radar                                        ││
│  │    ├── Recent alerts list                                               ││
│  │    └── Baseline info + reset button                                     ││
│  │                                                                         ││
│  │  Settings.tsx                                                           ││
│  │    └── Drift Settings section  ◄───────────────────────────── NEW      ││
│  │        ├── Enable/disable toggle                                        ││
│  │        ├── Warning threshold slider                                     ││
│  │        ├── Critical threshold slider                                    ││
│  │        └── Reset baseline button                                        ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Tool Call → Drift Detection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. TOOL EXECUTION (session.py)                                              │
│                                                                              │
│     Claude decides: "Call Write tool with file.py content"                   │
│                          │                                                   │
│                          ▼                                                   │
│     start_time = time.time()                                                │
│     result = execute_tool("Write", {"path": "file.py", "content": "..."})   │
│     duration_ms = (time.time() - start_time) * 1000                         │
│                          │                                                   │
└──────────────────────────┼───────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. DRIFT TRACKING (monitor.py)                                              │
│                                                                              │
│     drift_monitor.track_tool("Write", duration_ms=45.2, success=True)       │
│                          │                                                   │
│                          ▼                                                   │
│     current_trace.tool_invocations.append(                                  │
│         ToolInvocation(                                                     │
│             tool_name="Write",                                              │
│             timestamp=1707062400.123,                                       │
│             duration_ms=45.2,                                               │
│             success=True                                                    │
│         )                                                                   │
│     )                                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼ (at session end or every 10 calls)
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. VECTORIZATION (vectorizer.py)                                            │
│                                                                              │
│     vector = vectorizer.vectorize(trace)                                    │
│                          │                                                   │
│                          ▼                                                   │
│     BehaviorVector(                                                         │
│         tool_sequence=["Read", "Write", "Bash", "Write"],                   │
│         tool_frequency={"Read": 1, "Write": 2, "Bash": 1},                  │
│         mean_tool_duration_ms=52.3,                                         │
│         retry_rate=0.1,                                                     │
│         ...7 feature categories...                                          │
│     )                                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. DRIFT DETECTION (detector.py)                                            │
│                                                                              │
│     report = detector.detect(trace)                                         │
│                          │                                                   │
│                          ▼                                                   │
│     Compare current_vector vs baseline_vector:                              │
│                                                                              │
│     Component Scores:                                                        │
│     ├── tool_sequence:  0.12 (25% weight) │ LCS similarity                  │
│     ├── tool_frequency: 0.08 (20% weight) │ KL divergence                   │
│     ├── timing:         0.15 (15% weight) │ Duration variance               │
│     ├── decision:       0.05 (15% weight) │ Retry rate change               │
│     ├── file_access:    0.02 (10% weight) │ Write/read ratio                │
│     ├── network:        0.00 (10% weight) │ New destinations                │
│     └── output:         0.03 ( 5% weight) │ Stderr ratio                    │
│                                                                              │
│     overall_drift_score = 0.12 * 0.25 + 0.08 * 0.20 + ... = 0.085           │
│                                                                              │
│     alert_level = "normal" (< 0.3)                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. REPORT EMISSION (coder.py)                                               │
│                                                                              │
│     emit_sdk_msg("drift_report", {                                          │
│         "run_id": "task-123-session-5",                                     │
│         "overall_drift_score": 0.085,                                       │
│         "alert_level": "normal",                                            │
│         "component_scores": {...},                                          │
│         "anomalies": []                                                     │
│     })                                                                      │
│                          │                                                   │
│                          ▼                                                   │
│     stdout: __SDK_MSG__:{"type":"drift_report","data":{...}}                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. FRONTEND HANDLING (agent-events-handlers.ts)                             │
│                                                                              │
│     case 'drift_report':                                                    │
│         useDriftStore.getState().addReport(event.data)                      │
│         useTaskStore.getState().updateTask(taskId, {                        │
│             driftScore: event.data.overall_drift_score,                     │
│             driftLevel: event.data.alert_level                              │
│         })                                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. UI UPDATE (React components)                                             │
│                                                                              │
│     TaskCard subscribes to task-store                                       │
│     DriftDashboard subscribes to drift-store                                │
│                          │                                                   │
│                          ▼                                                   │
│     <DriftIndicator score={0.085} level="normal" />                         │
│     Shows: 🟢 0.09                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

### Backend (Python)

| File | Change | Lines |
|------|--------|-------|
| `apps/backend/drift/__init__.py` | NEW | ~30 |
| `apps/backend/drift/models.py` | COPY from Agent-Drift | ~270 |
| `apps/backend/drift/vectorizer.py` | COPY from Agent-Drift | ~340 |
| `apps/backend/drift/baseline.py` | COPY + MODIFY | ~400 |
| `apps/backend/drift/detector.py` | COPY from Agent-Drift | ~480 |
| `apps/backend/drift/monitor.py` | COPY + SIMPLIFY | ~200 |
| `apps/backend/agents/coder.py` | MODIFY (add monitoring) | +50 |
| `apps/backend/agents/session.py` | MODIFY (add tracking) | +20 |

### Frontend (TypeScript)

| File | Change | Lines |
|------|--------|-------|
| `src/main/ipc-handlers/drift-handlers.ts` | NEW | ~80 |
| `src/main/ipc-handlers/index.ts` | MODIFY (add registration) | +3 |
| `src/main/ipc-handlers/agent-events-handlers.ts` | MODIFY (handle drift events) | +15 |
| `src/renderer/stores/drift-store.ts` | NEW | ~100 |
| `src/renderer/stores/task-store.ts` | MODIFY (add drift fields) | +10 |
| `src/renderer/components/drift/DriftIndicator.tsx` | NEW | ~50 |
| `src/renderer/components/drift/DriftDashboard.tsx` | NEW | ~200 |
| `src/renderer/components/settings/DriftSettings.tsx` | NEW | ~80 |

---

## Integration Principles

### 1. Non-Invasive Monitoring
Agent-Drift **observes** tool calls but doesn't **block** them. The monitoring is async and lightweight.

### 2. Existing Event Pattern
Uses the same `emit_sdk_msg()` pattern already in place. No new transport mechanisms needed.

### 3. Zustand Store Pattern
Follows the existing store pattern with `drift-store.ts` alongside `task-store.ts`.

### 4. Gradual Rollout
Can be enabled/disabled per-project via settings. Doesn't affect existing behavior when disabled.

### 5. Data Locality
Stores baselines and reports in `.auto-claude/drift/` within the project directory. No global state pollution.

---

## Critical Alert Handling

When drift score ≥ 0.5:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CRITICAL DRIFT DETECTED                                                     │
│                                                                              │
│  1. coder.py detects critical drift                                         │
│     if report.alert_level == "critical":                                    │
│                                                                              │
│  2. Pause execution                                                         │
│     self.pause_execution("Behavioral anomaly detected")                     │
│                                                                              │
│  3. Emit critical alert                                                      │
│     emit_sdk_msg("drift_critical", {                                        │
│         "score": 0.67,                                                      │
│         "anomalies": [                                                      │
│             "New tools used: {'shell', 'network_fetch'}",                   │
│             "Network calls increased: 0 -> 15",                             │
│             "Stderr ratio spiked: 0% -> 45%"                                │
│         ]                                                                   │
│     })                                                                      │
│                                                                              │
│  4. Frontend shows alert                                                    │
│     - Red banner: "⚠️ Agent behavior anomaly detected"                      │
│     - Task card: 🔴 0.67 CRITICAL                                           │
│     - Notification toast                                                    │
│                                                                              │
│  5. User can:                                                               │
│     - Review anomalies                                                      │
│     - Reset baseline (if false positive)                                    │
│     - Resume execution (if intended)                                        │
│     - Stop task (if suspicious)                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

Agent-Drift integrates as a **passive monitoring layer** that:

1. **Hooks into** `session.py` to track tool calls
2. **Reports via** existing `emit_sdk_msg()` pattern
3. **Stores data** in project-local `.auto-claude/drift/`
4. **Updates UI** via new Zustand store + components
5. **Halts execution** only on critical drift (configurable)

No changes to:
- Claude SDK integration
- MCP server configuration
- Tool execution logic
- Build/test processes

---

**Agent-Drift: Observe, Detect, Alert**
