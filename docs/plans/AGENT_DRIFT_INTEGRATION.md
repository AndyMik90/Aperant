# Agent-Drift Integration Analysis

**Date:** 2026-02-04
**Source:** https://github.com/lukehebe/Agent-Drift
**Local Copy:** C:\Users\AlienZ\Desktop\Auto-Claude\Agent-Drift-main
**Status:** Research Complete - Ready for Implementation Planning
**License:** Check original repo for license terms

---

## Executive Summary

**Agent-Drift** is a runtime behavioral monitoring system that detects when AI agents have been silently compromised through prompt injection, memory poisoning, or behavioral drift. It's a **perfect fit for Auto-Claude** because:

- Zero external dependencies (stdlib only)
- Multiple integration paths (HTTP API, direct embedding, CLI)
- Deterministic detection (no ML black boxes, fully auditable)
- SIEM-like dashboard for visibility
- Designed for agent frameworks like ours

---

## What Problem Does It Solve?

Traditional security focuses on content filtering. Agent-Drift detects compromise at the **execution level** by monitoring:

| Attack Vector | How Agent-Drift Detects |
|---------------|------------------------|
| Prompt Injection | New tools appear, tool sequence changes drastically |
| Memory Poisoning | Network destinations change, external calls spike |
| Behavioral Drift | Retry rates increase, decision patterns shift |
| Jailbreaks | Tool usage deviates from baseline |

**Key insight:** Behavioral changes occur BEFORE output changes. Catch the compromise early.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   AI Agent (Coder, Planner)             │
└─────────────────┬───────────────────────────────────────┘
                  │ (tool calls, timing, patterns)
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Agent-Drift Collection Layer               │
│  ├─ HTTP Listener (port 5001)                          │
│  └─ Direct Integration (Python SDK)                    │
└─────────────────┬───────────────────────────────────────┘
                  │
         ┌────────┼────────┐
         ▼        ▼        ▼
    ┌─────────┬────────┬──────────────┐
    │ Baseline│ Drift  │ Injection    │
    │ Manager │Detector│ Detection    │
    └────┬────┴────┬───┴──────┬───────┘
         │         │          │
         └─────────┼──────────┘
                   ▼
         ┌──────────────────────┐
         │  SIEM Dashboard      │
         │  (WebSocket Updates) │
         └──────────────────────┘
```

---

## Feature Detection Breakdown

Agent-Drift extracts 7 categories of behavioral features:

| Category | Weight | What It Detects |
|----------|--------|-----------------|
| Tool Sequence | 25% | Tool order changes, new tools |
| Tool Frequency | 20% | Usage distribution shifts |
| Timing | 15% | Delays, duration anomalies |
| Decision Patterns | 15% | Retry rate, tools per cycle |
| File Access | 10% | Read/write patterns, scope creep |
| Network | 10% | New destinations, error rates |
| Output | 5% | Stderr ratio, volume changes |

**Alert Levels:**
- **Normal:** < 0.3 drift score
- **Warning:** 0.3 - 0.5 drift score
- **Critical:** ≥ 0.5 drift score

---

## Integration Options for Auto-Claude

### Option A: HTTP Listener (Minimal Changes)

**Setup:**
```bash
# Start listener during Auto-Claude startup
agent-drift listen --port 5001
```

**In Python agents:**
```python
import requests

# After each tool call:
requests.post("http://localhost:5001/event", json={
    "tool": tool_name,
    "success": success,
    "duration_ms": elapsed_ms
})
```

**Pros:** Minimal code changes, works with any agent
**Cons:** Less control, network overhead

---

### Option B: Direct Integration (Recommended)

**In coder.py:**
```python
from agent_drift.baseline import BaselineManager
from agent_drift.detector import DriftDetector
from agent_drift.models import BehaviorTrace, ToolInvocation

class DriftMonitor:
    def __init__(self):
        self.baseline_manager = BaselineManager()
        self.detector = DriftDetector(baseline_manager=self.baseline_manager)
        self.trace = None

    def start_session(self, task_id: str):
        self.trace = BehaviorTrace(
            run_id=f"task-{task_id}",
            start_time=time.time(),
            end_time=0
        )

    def track_tool(self, tool_name: str, duration_ms: float, success: bool = True):
        self.trace.tool_invocations.append(
            ToolInvocation(
                tool_name=tool_name,
                timestamp=time.time(),
                duration_ms=duration_ms,
                success=success
            )
        )

    def end_session(self) -> DriftReport:
        self.trace.end_time = time.time()
        return self.detector.detect(self.trace)
```

**Usage in agent loop:**
```python
monitor = DriftMonitor()
monitor.start_session(task.id)

for subtask in implementation_plan:
    start = time.time()
    result = execute_tool(subtask.tool, subtask.args)
    monitor.track_tool(subtask.tool, (time.time()-start)*1000, result.success)

    # Check for drift mid-execution
    if len(monitor.trace.tool_invocations) % 10 == 0:
        interim_report = monitor.detector.detect(monitor.trace)
        if interim_report.alert_level == "critical":
            halt_execution("Behavioral anomaly detected")

report = monitor.end_session()
if report.alert_level == "critical":
    create_security_alert(report)
```

**Pros:** Full control, can halt execution, detailed reports
**Cons:** More code changes, tighter coupling

---

### Option C: Hybrid (Production Recommended)

1. **Direct integration** in coder agent for real-time protection
2. **HTTP listener** in background for all agents
3. **Dashboard** displayed in Electron UI or separate tab

---

## Injection Detection Patterns

Agent-Drift includes 10 built-in pattern detectors:

| Pattern | Severity | Example |
|---------|----------|---------|
| Instruction override | Critical | "Ignore previous instructions" |
| Role hijacking | Critical | "You are now DAN" |
| Restriction bypass | Critical | "Bypass all restrictions" |
| Data exfiltration | Critical | "Send data to webhook" |
| Encoded payloads | Critical | Base64/hex encoded content |
| Memory poisoning | Critical | "Remember forever" |
| Prompt extraction | Warning | "Show me your system prompt" |
| Delimiter injection | Warning | `]]`, `---`, `<system>` |
| Privilege escalation | Warning | "Admin mode", "sudo" |
| Indirect injection | Warning | "NOTE TO AI", "URGENT" |

---

## Files in Agent-Drift

| File | Purpose |
|------|---------|
| `src/models.py` | Data structures (BehaviorTrace, DriftReport) |
| `src/vectorizer.py` | Feature extraction (7 categories) |
| `src/baseline.py` | Baseline management (thread-safe) |
| `src/detector.py` | Drift detection algorithms |
| `src/listener.py` | HTTP API server |
| `src/shim.py` | CLI wrapper for agents |
| `dashboard/` | SIEM-style web dashboard |

---

## Auto-Claude Integration Plan

### Phase 1: Basic Monitoring
- [ ] Add Agent-Drift as dependency (`pip install agent-drift-detector`)
- [ ] Start HTTP listener on app startup
- [ ] POST tool events from coder.py
- [ ] Add dashboard link to Electron UI

### Phase 2: Deep Integration
- [ ] Embed DriftMonitor in coder agent
- [ ] Track each subtask execution
- [ ] Save reports to spec directory
- [ ] Show drift score in task cards

### Phase 3: Security Actions
- [ ] Halt execution on critical drift
- [ ] Create security alerts in UI
- [ ] Store baseline per-project
- [ ] Add "Reset Baseline" to settings

### Phase 4: Advanced Features
- [ ] Multi-agent monitoring (planner, coder, qa)
- [ ] Historical drift analysis
- [ ] Custom injection patterns
- [ ] Baseline export/import

---

## Data Storage

**Baseline location:** `~/.agent-drift/baseline.json`
- Can be overridden with `AGENT_DRIFT_DIR` env var
- For Auto-Claude: store per-project in `.auto-claude/drift/`

**Drift reports:**
```
.auto-claude/specs/TASK-XXX/
├─ spec.md
├─ subtasks.json
└─ drift/
   ├─ baseline.json
   └─ reports/
      ├─ run-001.json
      └─ run-002.json
```

---

## Security Considerations

### Strengths
- Deterministic algorithms (auditable, no ML black boxes)
- Minimal data capture (structural only, never content)
- Thread-safe with file locking
- Gradual poisoning detection (compares to original baseline)
- Zero-config (first run is trusted baseline)

### Limitations
- Requires legitimate first run for baseline
- Timing detection can be affected by system load
- Relies on behavioral differences (if attack mimics normal behavior, may miss)
- Regex-based tool detection (can miss custom tools)

### Operational Notes
- Default thresholds: 0.3 (warning), 0.5 (critical)
- Keeps up to 100 historical vectors for variance
- Old baselines backed up before reset

---

## Recommended Implementation

**For Auto-Claude v3.x:**

```python
# apps/backend/agents/coder.py

from agent_drift import DriftMonitor

class CoderAgent:
    def __init__(self):
        self.drift_monitor = DriftMonitor(
            baseline_dir=".auto-claude/drift",
            alert_callback=self._on_drift_alert
        )

    async def execute_implementation(self, spec: Spec):
        self.drift_monitor.start_session(spec.task_id)

        try:
            for subtask in spec.subtasks:
                result = await self._execute_subtask(subtask)
                self.drift_monitor.track_tool(
                    subtask.tool,
                    result.duration_ms,
                    result.success
                )
        finally:
            report = self.drift_monitor.end_session()
            self._save_drift_report(spec, report)

    def _on_drift_alert(self, level: str, report: DriftReport):
        if level == "critical":
            self.pause_execution()
            self.emit_security_alert(report)
```

---

## Summary

| Aspect | Value |
|--------|-------|
| Effort to integrate | Medium (2-3 days) |
| Value add | High (security + visibility) |
| Dependencies | None (stdlib only) |
| Dashboard | Optional Flask addon |
| Maintenance | Low (stable, deterministic) |

**Recommendation:** Add to Phase 9 or create dedicated Phase 10 for security hardening.

---

## Detailed Implementation Plan

### What to Keep from Agent-Drift

| File | Keep | Reason |
|------|------|--------|
| `src/models.py` | ✅ **YES** | Core data structures - clean, no dependencies |
| `src/vectorizer.py` | ✅ **YES** | Feature extraction logic - essential |
| `src/baseline.py` | ✅ **YES** | Baseline management with thread-safety |
| `src/detector.py` | ✅ **YES** | Drift detection algorithms |
| `src/monitor.py` | ✅ **YES** | AgentMonitor class for sessions |
| `src/listener.py` | ⚠️ Optional | HTTP API - only if using external listener mode |
| `src/cli.py` | ❌ NO | CLI wrapper - not needed for embedded use |
| `src/shim.py` | ❌ NO | External agent wrapping - not needed |
| `src/canary.py` | ❌ NO | Canary token injection - consider later |
| `src/dashboard/` | ⚠️ Optional | Web dashboard - integrate into Electron UI instead |
| `tests/` | ❌ NO | Original tests - write our own |
| `examples/` | ❌ NO | Examples - not needed |

**Total:** 5 core files, 2 optional

---

### File Mapping: Agent-Drift → Auto-Claude

```
Agent-Drift-main/src/           →    apps/backend/drift/
├── models.py                   →    ├── models.py
├── vectorizer.py               →    ├── vectorizer.py
├── baseline.py                 →    ├── baseline.py
├── detector.py                 →    ├── detector.py
├── monitor.py                  →    ├── monitor.py
└── __init__.py                 →    └── __init__.py (new)
```

**Dashboard integration:**
```
Agent-Drift-main/src/dashboard/server.py (extract HTML)
    ↓
src/renderer/components/DriftDashboard.tsx (new React component)
```

---

### Auto-Claude Directory Structure After Integration

```
apps/backend/
├── agents/
│   ├── coder.py              # ADD: DriftMonitor integration
│   ├── planner.py            # ADD: DriftMonitor integration (Phase 4)
│   └── session.py            # No changes needed
├── drift/                     # NEW: Agent-Drift core
│   ├── __init__.py           # Export DriftMonitor, DriftReport
│   ├── models.py             # BehaviorTrace, BehaviorVector, DriftReport
│   ├── vectorizer.py         # BehaviorVectorizer
│   ├── baseline.py           # BaselineManager (thread-safe)
│   ├── detector.py           # DriftDetector
│   └── monitor.py            # AgentMonitor (simplified)
└── core/
    └── ...

src/renderer/components/
├── settings/
│   └── DriftSettings.tsx      # NEW: Reset baseline, thresholds
└── drift/
    └── DriftDashboard.tsx     # NEW: SIEM-style dashboard
```

---

### Integration Points

#### 1. apps/backend/drift/__init__.py (New)

```python
"""
Agent-Drift integration for Auto-Claude.
Source: https://github.com/lukehebe/Agent-Drift

Behavioral monitoring system for detecting prompt injection,
memory poisoning, and behavioral drift in AI agents.
"""

from .models import (
    BehaviorTrace,
    BehaviorVector,
    ToolInvocation,
    FileAccess,
    NetworkCall,
    DecisionCycle,
    DriftReport,
    Baseline,
)
from .baseline import BaselineManager
from .detector import DriftDetector
from .vectorizer import BehaviorVectorizer
from .monitor import DriftMonitor

__all__ = [
    'DriftMonitor',
    'DriftDetector',
    'BaselineManager',
    'BehaviorTrace',
    'DriftReport',
    'ToolInvocation',
]
```

#### 2. apps/backend/agents/coder.py (Modify)

```python
# Near imports
from drift import DriftMonitor, DriftReport

class CoderAgent:
    def __init__(self, ...):
        # ... existing init ...

        # Initialize drift monitor with project-specific storage
        self.drift_monitor = DriftMonitor(
            storage_dir=os.path.join(project_root, '.auto-claude', 'drift')
        )

    async def execute_task(self, task: Task):
        # Start drift monitoring session
        self.drift_monitor.start_session(task.id)

        try:
            for subtask in task.subtasks:
                start_time = time.time()

                # Execute the subtask
                result = await self._execute_subtask(subtask)

                # Track the tool call
                duration_ms = (time.time() - start_time) * 1000
                self.drift_monitor.track_tool(
                    tool_name=subtask.tool_name,
                    success=result.success,
                    duration_ms=duration_ms
                )

                # Check for critical drift mid-execution
                if self._should_check_drift():
                    interim = self.drift_monitor.get_interim_report()
                    if interim and interim.alert_level == 'critical':
                        self._handle_critical_drift(interim)
                        break

        finally:
            # End session and get final report
            report = self.drift_monitor.end_session()
            if report:
                self._save_drift_report(task, report)
                self._emit_drift_event(report)

    def _should_check_drift(self) -> bool:
        """Check drift every 10 tool calls."""
        return len(self.drift_monitor.current_trace.tool_invocations) % 10 == 0

    def _handle_critical_drift(self, report: DriftReport):
        """Handle critical drift detection."""
        self.emit_event('drift:critical', {
            'score': report.overall_drift_score,
            'anomalies': report.anomalies,
        })
        self.pause_execution("Behavioral anomaly detected")

    def _save_drift_report(self, task: Task, report: DriftReport):
        """Save drift report alongside task spec."""
        drift_dir = os.path.join(task.spec_dir, 'drift')
        os.makedirs(drift_dir, exist_ok=True)

        report_path = os.path.join(drift_dir, f'{report.run_id}.json')
        with open(report_path, 'w') as f:
            json.dump(report.to_dict(), f, indent=2)
```

#### 3. src/main/ipc-handlers/drift-handlers.ts (New)

```typescript
import { ipcMain } from 'electron';

export function registerDriftHandlers(): void {
  // Get drift state for dashboard
  ipcMain.handle('drift:get-state', async (_, projectPath: string) => {
    // Read drift reports from .auto-claude/drift/reports/
    // Return formatted state for dashboard
  });

  // Reset baseline
  ipcMain.handle('drift:reset-baseline', async (_, projectPath: string) => {
    // Call Python backend to reset baseline
  });

  // Get baseline info
  ipcMain.handle('drift:get-baseline', async (_, projectPath: string) => {
    // Return baseline metadata
  });
}
```

#### 4. src/renderer/stores/drift-store.ts (New)

```typescript
import { create } from 'zustand';

interface DriftState {
  monitoring: boolean;
  currentScore: number;
  alertLevel: 'normal' | 'warning' | 'critical';
  recentReports: DriftReport[];
  alerts: DriftAlert[];
  baseline: BaselineInfo | null;

  // Actions
  fetchState: () => Promise<void>;
  resetBaseline: () => Promise<void>;
}

export const useDriftStore = create<DriftState>((set, get) => ({
  // ... implementation
}));
```

---

### Modifications to Existing Agent-Drift Files

#### models.py - No changes needed
The data structures are clean and work as-is.

#### vectorizer.py - No changes needed
Feature extraction is self-contained.

#### baseline.py - Minor modification

```python
# Change default storage from ~/.agent-drift to project-local
def __init__(
    self,
    storage_dir: Optional[str] = None,  # Now required for Auto-Claude
    ...
):
    # Remove global default, require explicit storage_dir
    if storage_dir is None:
        raise ValueError("storage_dir is required for Auto-Claude integration")
    self.storage_dir = Path(storage_dir)
    ...
```

#### detector.py - No changes needed
Detection algorithms are self-contained.

#### monitor.py - Simplify for embedding

```python
# Remove: HTTP server code (DASHBOARD_HTML, Handler class, run_monitor)
# Keep: AgentMonitor class only
# Add: get_interim_report() method for mid-execution checks

class DriftMonitor(AgentMonitor):
    """Simplified monitor for Auto-Claude embedding."""

    def get_interim_report(self) -> Optional[DriftReport]:
        """Get drift report without ending session."""
        if not self.current_trace:
            return None

        with self._lock:
            # Create temporary copy for detection
            temp_trace = BehaviorTrace(
                run_id=self.current_trace.run_id + "-interim",
                start_time=self.current_trace.start_time,
                end_time=time.time(),
                tool_invocations=list(self.current_trace.tool_invocations),
            )
            return self.detector.detect(temp_trace)
```

---

### IPC Events for Drift Monitoring

| Event | Direction | Payload |
|-------|-----------|---------|
| `drift:session-started` | Backend → Frontend | `{ taskId, timestamp }` |
| `drift:tool-tracked` | Backend → Frontend | `{ tool, success, duration }` |
| `drift:session-ended` | Backend → Frontend | `{ report: DriftReport }` |
| `drift:critical` | Backend → Frontend | `{ score, anomalies }` |
| `drift:warning` | Backend → Frontend | `{ score, anomalies }` |
| `drift:reset-baseline` | Frontend → Backend | `{ projectPath }` |
| `drift:get-state` | Frontend → Backend | `{ projectPath }` |

---

### UI Integration

#### Task Card Enhancement

```tsx
// In TaskCard.tsx - add drift indicator
<div className="task-card-footer">
  {task.driftScore !== undefined && (
    <DriftIndicator
      score={task.driftScore}
      level={task.driftLevel}
    />
  )}
</div>
```

#### Settings Page Addition

```tsx
// In Settings.tsx - add drift section
<SettingsSection title="Security - Agent Drift">
  <SettingRow
    label="Enable Drift Monitoring"
    description="Monitor agent behavior for anomalies"
  >
    <Toggle checked={driftEnabled} onChange={setDriftEnabled} />
  </SettingRow>

  <SettingRow
    label="Warning Threshold"
    description="Drift score to trigger warning (0.0-1.0)"
  >
    <NumberInput value={warningThreshold} min={0} max={1} step={0.1} />
  </SettingRow>

  <SettingRow
    label="Critical Threshold"
    description="Drift score to halt execution (0.0-1.0)"
  >
    <NumberInput value={criticalThreshold} min={0} max={1} step={0.1} />
  </SettingRow>

  <Button variant="danger" onClick={resetBaseline}>
    Reset Baseline
  </Button>
</SettingsSection>
```

---

### Implementation Phases (Detailed)

#### Phase 1: Core Integration (1 day)

1. Copy 5 core files to `apps/backend/drift/`
2. Create `__init__.py` with exports
3. Add `from drift import DriftMonitor` to coder.py
4. Basic session start/end logging

**Deliverables:**
- [ ] `apps/backend/drift/` module created
- [ ] DriftMonitor instantiated in CoderAgent
- [ ] Basic logging of drift scores

#### Phase 2: Event Pipeline (0.5 day)

1. Add IPC handlers for drift events
2. Create drift-store.ts in renderer
3. Wire up event listeners

**Deliverables:**
- [ ] `drift-handlers.ts` created
- [ ] `drift-store.ts` created
- [ ] Events flowing frontend ↔ backend

#### Phase 3: UI Integration (1 day)

1. Add DriftIndicator component
2. Add to TaskCard footer
3. Add Settings page section
4. Add simple dashboard panel

**Deliverables:**
- [ ] Drift score visible on task cards
- [ ] Settings for thresholds
- [ ] Basic dashboard showing recent alerts

#### Phase 4: Advanced Features (0.5 day)

1. Per-project baseline storage
2. Baseline export/import
3. Historical drift chart

**Deliverables:**
- [ ] Project-specific baselines
- [ ] Export/import in settings
- [ ] Drift history visualization

---

## Related Files

- [Agent-Drift Source](../Agent-Drift-main/)
- [Agent-Drift GitHub](https://github.com/lukehebe/Agent-Drift) - Original source
- [CODE_SWEEP_REPORT.md](../CODE_SWEEP_REPORT.md) - includes security findings
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) - exception handling issues

---

## Attribution

This integration is based on **Agent-Drift** by [lukehebe](https://github.com/lukehebe).

**Original Repository:** https://github.com/lukehebe/Agent-Drift

Please check the original repository for license terms before integrating.

---

**Agent-Drift: Behavioral IDS for AI Agents**
