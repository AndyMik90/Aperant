# Phase 10: Agent-Drift Integration

**Version:** 1.0
**Date:** 2026-02-04
**Status:** Ready for Implementation
**Priority:** P2 - Security Enhancement
**Source:** https://github.com/lukehebe/Agent-Drift

---

## Overview

Integrate Agent-Drift behavioral monitoring into Auto-Claude using a **minimal, non-intrusive approach**:

- **Task cards** show drift indicator badge
- **Task details** have Drift tab for per-task history
- **Settings** has drift configuration section
- **No separate page** - keeps UI lightweight

**Total Tasks:** 15
**Estimated Duration:** 3 days

---

## UI Design (Option 4: Hybrid Minimal)

### Task Card - Drift Badge
```
┌─────────────────────────────────────────┐
│ Add user authentication                 │
│ ───────────────────────────────────────│
│ Status: In Progress                     │
│ Subtasks: 5/12 complete                 │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 🟢 0.08  │  ⏱ 12:34  │  📊 5/12   │ │  ← Footer with drift badge
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘

Badge colors:
  🟢 Normal (< 0.3)
  🟡 Warning (0.3 - 0.5)
  🔴 Critical (≥ 0.5)
```

### Task Details - Drift Tab
```
┌─────────────────────────────────────────────────────────────┐
│ Task: Add user authentication                               │
│ ─────────────────────────────────────────────────────────── │
│ [Spec] [Subtasks] [Terminal] [Drift]  ← New tab             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Current Score: 0.08 🟢 Normal                              │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Component Breakdown:                                       │
│  ├── Tool Sequence:  0.05 ████░░░░░░ (25%)                 │
│  ├── Tool Frequency: 0.08 █████░░░░░ (20%)                 │
│  ├── Timing:         0.12 ██████░░░░ (15%)                 │
│  ├── Decision:       0.03 ██░░░░░░░░ (15%)                 │
│  ├── File Access:    0.02 █░░░░░░░░░ (10%)                 │
│  ├── Network:        0.00 ░░░░░░░░░░ (10%)                 │
│  └── Output:         0.05 ███░░░░░░░ (5%)                  │
│                                                             │
│  Session History:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Session 5  │ 10:45 AM │ 0.08 🟢 │ 23 tools         │   │
│  │ Session 4  │ 10:32 AM │ 0.12 🟢 │ 18 tools         │   │
│  │ Session 3  │ 10:15 AM │ 0.05 🟢 │ 31 tools         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Anomalies: None detected                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Settings - Drift Section
```
┌─────────────────────────────────────────────────────────────┐
│ Settings                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Security - Agent Drift                                      │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ Enable Drift Monitoring              [✓]                    │
│ Monitor agent behavior for anomalies                        │
│                                                             │
│ Warning Threshold                    [0.3] ────●────        │
│ Drift score to trigger warning                              │
│                                                             │
│ Critical Threshold                   [0.5] ────────●──      │
│ Drift score to halt execution                               │
│                                                             │
│ Auto-halt on Critical                [✓]                    │
│ Automatically pause task on critical drift                  │
│                                                             │
│ [Reset Baseline]                                            │
│ Clear learned behavior patterns                             │
│                                                             │
│ Baseline Status: ✅ Active (12 sessions learned)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Critical Alert Banner
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ DRIFT ALERT: Agent behavior anomaly detected             │
│                                                             │
│ Score: 0.67 (Critical)                                      │
│ Anomalies:                                                  │
│   • New tools used: {'shell', 'curl'}                       │
│   • Network calls increased: 0 → 15                         │
│                                                             │
│ [Resume Anyway]  [Stop Task]  [View Details]                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Task Breakdown

### Backend Tasks (Python)

| ID | Task | File | Complexity |
|----|------|------|------------|
| DRIFT-1 | Copy Agent-Drift core files | apps/backend/drift/ | Low |
| DRIFT-2 | Create drift module __init__.py | apps/backend/drift/__init__.py | Low |
| DRIFT-3 | Simplify monitor.py for embedding | apps/backend/drift/monitor.py | Medium |
| DRIFT-4 | Integrate DriftMonitor in coder.py | apps/backend/agents/coder.py | Medium |
| DRIFT-5 | Add drift event emission | apps/backend/agents/session.py | Low |

### Frontend Tasks (TypeScript)

| ID | Task | File | Complexity |
|----|------|------|------------|
| DRIFT-6 | Create drift-store.ts | src/renderer/stores/drift-store.ts | Medium |
| DRIFT-7 | Create DriftIndicator component | src/renderer/components/drift/DriftIndicator.tsx | Low |
| DRIFT-8 | Create DriftTab component | src/renderer/components/drift/DriftTab.tsx | Medium |
| DRIFT-9 | Add Drift tab to TaskDetails | src/renderer/components/TaskDetails.tsx | Low |
| DRIFT-10 | Add drift badge to TaskCard | src/renderer/components/TaskCard.tsx | Low |
| DRIFT-11 | Create DriftSettings component | src/renderer/components/settings/DriftSettings.tsx | Medium |
| DRIFT-12 | Add drift section to Settings | src/renderer/pages/Settings.tsx | Low |
| DRIFT-13 | Create DriftAlertBanner component | src/renderer/components/drift/DriftAlertBanner.tsx | Medium |

### IPC/Integration Tasks

| ID | Task | File | Complexity |
|----|------|------|------------|
| DRIFT-14 | Create drift IPC handlers | src/main/ipc-handlers/drift-handlers.ts | Medium |
| DRIFT-15 | Register drift handlers | src/main/ipc-handlers/index.ts | Low |

---

## Implementation Details

### DRIFT-1: Copy Agent-Drift Core Files

**Source:** `Agent-Drift-main/src/`
**Destination:** `apps/backend/drift/`

Copy these files:
- `models.py` (as-is)
- `vectorizer.py` (as-is)
- `baseline.py` (as-is)
- `detector.py` (as-is)
- `monitor.py` (will be modified in DRIFT-3)

---

### DRIFT-2: Create drift/__init__.py

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
    'BehaviorVector',
    'DriftReport',
    'ToolInvocation',
]
```

---

### DRIFT-3: Simplify monitor.py

Remove HTTP server code, keep only AgentMonitor class. Add `get_interim_report()` method.

**Remove:**
- `DASHBOARD_HTML` constant
- `Handler` class
- `run_monitor()` function

**Add:**
```python
def get_interim_report(self) -> Optional[DriftReport]:
    """Get drift report without ending session."""
    if not self.current_trace:
        return None

    with self._lock:
        temp_trace = BehaviorTrace(
            run_id=self.current_trace.run_id + "-interim",
            start_time=self.current_trace.start_time,
            end_time=time.time(),
            tool_invocations=list(self.current_trace.tool_invocations),
        )
        return self.detector.detect(temp_trace)
```

---

### DRIFT-4: Integrate DriftMonitor in coder.py

Add to imports:
```python
from drift import DriftMonitor, DriftReport
```

Add to agent initialization:
```python
# Initialize drift monitor
drift_enabled = os.environ.get('AUTO_CLAUDE_DRIFT_ENABLED', 'true').lower() == 'true'
if drift_enabled:
    drift_storage = os.path.join(spec_dir, '..', '..', 'drift')
    self.drift_monitor = DriftMonitor(storage_dir=drift_storage)
else:
    self.drift_monitor = None
```

Add session tracking:
```python
# At start of subtask execution
if self.drift_monitor:
    self.drift_monitor.start_session(f"task-{task_id}-session-{iteration}")

# After each tool call (inside session.py or tool execution)
if self.drift_monitor:
    self.drift_monitor.track_tool(tool_name, duration_ms, success)

# At end of session
if self.drift_monitor:
    report = self.drift_monitor.end_session()
    if report:
        emit_sdk_msg("drift_report", report.to_dict())
        if report.alert_level == "critical":
            emit_sdk_msg("drift_critical", {
                "score": report.overall_drift_score,
                "anomalies": report.anomalies
            })
```

---

### DRIFT-5: Add drift event emission

In `session.py`, add new emit function:
```python
def emit_drift_event(event_type: str, data: dict):
    """Emit drift-related events to frontend."""
    emit_sdk_msg(event_type, data)
```

---

### DRIFT-6: Create drift-store.ts

```typescript
import { create } from 'zustand';

interface DriftReport {
  run_id: string;
  timestamp: string;
  overall_drift_score: number;
  component_scores: Record<string, number>;
  anomalies: string[];
  alert_level: 'normal' | 'warning' | 'critical';
}

interface DriftState {
  // Per-task drift data
  taskDrift: Record<string, {
    currentScore: number;
    alertLevel: 'normal' | 'warning' | 'critical';
    reports: DriftReport[];
    anomalies: string[];
  }>;

  // Global settings
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  autoHalt: boolean;

  // Baseline info
  baselineExists: boolean;
  baselineSessionCount: number;

  // Actions
  updateTaskDrift: (taskId: string, report: DriftReport) => void;
  setEnabled: (enabled: boolean) => void;
  setThresholds: (warning: number, critical: number) => void;
  setAutoHalt: (autoHalt: boolean) => void;
  resetBaseline: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useDriftStore = create<DriftState>((set, get) => ({
  taskDrift: {},
  enabled: true,
  warningThreshold: 0.3,
  criticalThreshold: 0.5,
  autoHalt: true,
  baselineExists: false,
  baselineSessionCount: 0,

  updateTaskDrift: (taskId, report) => set((state) => ({
    taskDrift: {
      ...state.taskDrift,
      [taskId]: {
        currentScore: report.overall_drift_score,
        alertLevel: report.alert_level,
        reports: [...(state.taskDrift[taskId]?.reports || []), report].slice(-20),
        anomalies: report.anomalies,
      },
    },
  })),

  setEnabled: (enabled) => set({ enabled }),

  setThresholds: (warning, critical) => set({
    warningThreshold: warning,
    criticalThreshold: critical,
  }),

  setAutoHalt: (autoHalt) => set({ autoHalt }),

  resetBaseline: async () => {
    await window.api.invoke('drift:reset-baseline');
    set({ baselineExists: false, baselineSessionCount: 0 });
  },

  loadSettings: async () => {
    const settings = await window.api.invoke('drift:get-settings');
    set(settings);
  },
}));
```

---

### DRIFT-7: Create DriftIndicator.tsx

```tsx
import React from 'react';
import { cn } from '@/lib/utils';

interface DriftIndicatorProps {
  score: number;
  level: 'normal' | 'warning' | 'critical';
  size?: 'sm' | 'md';
  showScore?: boolean;
}

export function DriftIndicator({
  score,
  level,
  size = 'sm',
  showScore = true
}: DriftIndicatorProps) {
  const colors = {
    normal: 'bg-green-500/20 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const icons = {
    normal: '🟢',
    warning: '🟡',
    critical: '🔴',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5',
        colors[level],
        size === 'sm' ? 'text-xs' : 'text-sm'
      )}
      title={`Drift Score: ${score.toFixed(3)} (${level})`}
    >
      <span>{icons[level]}</span>
      {showScore && <span>{score.toFixed(2)}</span>}
    </div>
  );
}
```

---

### DRIFT-8: Create DriftTab.tsx

```tsx
import React from 'react';
import { useDriftStore } from '@/stores/drift-store';
import { DriftIndicator } from './DriftIndicator';

interface DriftTabProps {
  taskId: string;
}

export function DriftTab({ taskId }: DriftTabProps) {
  const taskDrift = useDriftStore((s) => s.taskDrift[taskId]);

  if (!taskDrift) {
    return (
      <div className="p-4 text-center text-gray-500">
        No drift data yet. Run the task to start monitoring.
      </div>
    );
  }

  const { currentScore, alertLevel, reports, anomalies } = taskDrift;
  const latestReport = reports[reports.length - 1];

  return (
    <div className="p-4 space-y-4">
      {/* Current Score */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Current Score</h3>
        <DriftIndicator score={currentScore} level={alertLevel} size="md" />
      </div>

      {/* Component Breakdown */}
      {latestReport?.component_scores && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-400">Component Breakdown</h4>
          {Object.entries(latestReport.component_scores).map(([name, score]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="w-28 text-sm capitalize">{name.replace('_', ' ')}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-cyan-500"
                  style={{ width: `${Math.min(score * 100, 100)}%` }}
                />
              </div>
              <span className="w-12 text-xs text-right">{score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Session History */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-400">Session History</h4>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {reports.slice().reverse().map((report, i) => (
            <div
              key={report.run_id}
              className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-sm"
            >
              <span className="text-gray-400">
                {new Date(report.timestamp).toLocaleTimeString()}
              </span>
              <DriftIndicator score={report.overall_drift_score} level={report.alert_level} />
            </div>
          ))}
        </div>
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-yellow-400">Anomalies Detected</h4>
          <ul className="text-sm text-gray-300 space-y-1">
            {anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-yellow-500">•</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

---

### DRIFT-9: Add Drift tab to TaskDetails

In TaskDetails.tsx, add to tabs array:
```tsx
const tabs = [
  { id: 'spec', label: 'Spec' },
  { id: 'subtasks', label: 'Subtasks' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'drift', label: 'Drift' },  // NEW
];
```

Add tab content:
```tsx
{activeTab === 'drift' && <DriftTab taskId={task.id} />}
```

---

### DRIFT-10: Add drift badge to TaskCard

In TaskCard.tsx footer:
```tsx
import { DriftIndicator } from './drift/DriftIndicator';
import { useDriftStore } from '@/stores/drift-store';

// Inside component:
const taskDrift = useDriftStore((s) => s.taskDrift[task.id]);

// In footer JSX:
<div className="flex items-center gap-2">
  {taskDrift && (
    <DriftIndicator
      score={taskDrift.currentScore}
      level={taskDrift.alertLevel}
    />
  )}
  {/* existing footer content */}
</div>
```

---

### DRIFT-11: Create DriftSettings.tsx

```tsx
import React from 'react';
import { useDriftStore } from '@/stores/drift-store';

export function DriftSettings() {
  const {
    enabled,
    warningThreshold,
    criticalThreshold,
    autoHalt,
    baselineExists,
    baselineSessionCount,
    setEnabled,
    setThresholds,
    setAutoHalt,
    resetBaseline,
  } = useDriftStore();

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Security - Agent Drift</h3>

      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">Enable Drift Monitoring</div>
          <div className="text-sm text-gray-400">
            Monitor agent behavior for anomalies
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="toggle"
        />
      </div>

      {/* Warning Threshold */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Warning Threshold</span>
          <span className="text-yellow-400">{warningThreshold}</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="0.9"
          step="0.1"
          value={warningThreshold}
          onChange={(e) => setThresholds(parseFloat(e.target.value), criticalThreshold)}
          className="w-full"
        />
      </div>

      {/* Critical Threshold */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Critical Threshold</span>
          <span className="text-red-400">{criticalThreshold}</span>
        </div>
        <input
          type="range"
          min="0.2"
          max="1.0"
          step="0.1"
          value={criticalThreshold}
          onChange={(e) => setThresholds(warningThreshold, parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Auto-halt Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">Auto-halt on Critical</div>
          <div className="text-sm text-gray-400">
            Automatically pause task on critical drift
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoHalt}
          onChange={(e) => setAutoHalt(e.target.checked)}
          className="toggle"
        />
      </div>

      {/* Baseline Status */}
      <div className="p-3 bg-gray-800/50 rounded">
        <div className="text-sm">
          Baseline Status:{' '}
          {baselineExists ? (
            <span className="text-green-400">
              ✅ Active ({baselineSessionCount} sessions learned)
            </span>
          ) : (
            <span className="text-gray-400">❌ Not yet created</span>
          )}
        </div>
      </div>

      {/* Reset Button */}
      <button
        onClick={resetBaseline}
        className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30"
      >
        Reset Baseline
      </button>
    </div>
  );
}
```

---

### DRIFT-12: Add drift section to Settings

In Settings.tsx:
```tsx
import { DriftSettings } from '@/components/settings/DriftSettings';

// In render:
<section className="space-y-4">
  <DriftSettings />
</section>
```

---

### DRIFT-13: Create DriftAlertBanner.tsx

```tsx
import React from 'react';
import { useDriftStore } from '@/stores/drift-store';
import { useTaskStore } from '@/stores/task-store';

export function DriftAlertBanner() {
  const [visible, setVisible] = React.useState(false);
  const [alertData, setAlertData] = React.useState<{
    taskId: string;
    score: number;
    anomalies: string[];
  } | null>(null);

  const resumeTask = useTaskStore((s) => s.resumeTask);
  const stopTask = useTaskStore((s) => s.stopTask);

  // Listen for critical drift events
  React.useEffect(() => {
    const handler = (_: any, data: any) => {
      if (data.type === 'drift_critical') {
        setAlertData({
          taskId: data.taskId,
          score: data.score,
          anomalies: data.anomalies,
        });
        setVisible(true);
      }
    };

    window.api.on('agent-progress', handler);
    return () => window.api.off('agent-progress', handler);
  }, []);

  if (!visible || !alertData) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[500px] bg-red-900/90 border border-red-500 rounded-lg p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-bold text-red-200">
            DRIFT ALERT: Agent behavior anomaly detected
          </h3>
          <p className="text-red-300 mt-1">
            Score: {alertData.score.toFixed(3)} (Critical)
          </p>
          {alertData.anomalies.length > 0 && (
            <ul className="mt-2 text-sm text-red-200">
              {alertData.anomalies.slice(0, 3).map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => {
            resumeTask(alertData.taskId);
            setVisible(false);
          }}
          className="px-3 py-1.5 bg-yellow-600 text-white rounded text-sm"
        >
          Resume Anyway
        </button>
        <button
          onClick={() => {
            stopTask(alertData.taskId);
            setVisible(false);
          }}
          className="px-3 py-1.5 bg-red-600 text-white rounded text-sm"
        >
          Stop Task
        </button>
        <button
          onClick={() => setVisible(false)}
          className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

---

### DRIFT-14: Create drift-handlers.ts

```typescript
import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export function registerDriftHandlers(agentManager: any, getMainWindow: () => any) {
  // Get drift settings
  ipcMain.handle('drift:get-settings', async () => {
    // Read from project settings or return defaults
    return {
      enabled: true,
      warningThreshold: 0.3,
      criticalThreshold: 0.5,
      autoHalt: true,
      baselineExists: false,
      baselineSessionCount: 0,
    };
  });

  // Save drift settings
  ipcMain.handle('drift:save-settings', async (_, settings) => {
    // Save to project settings
    return { success: true };
  });

  // Reset baseline
  ipcMain.handle('drift:reset-baseline', async (_, projectPath?: string) => {
    const driftDir = path.join(projectPath || process.cwd(), '.auto-claude', 'drift');
    const baselinePath = path.join(driftDir, 'baseline.json');

    if (fs.existsSync(baselinePath)) {
      // Backup before delete
      const backupPath = path.join(driftDir, `baseline.${Date.now()}.bak.json`);
      fs.renameSync(baselinePath, backupPath);
    }

    return { success: true };
  });

  // Get baseline info
  ipcMain.handle('drift:get-baseline', async (_, projectPath?: string) => {
    const driftDir = path.join(projectPath || process.cwd(), '.auto-claude', 'drift');
    const baselinePath = path.join(driftDir, 'baseline.json');

    if (!fs.existsSync(baselinePath)) {
      return { exists: false };
    }

    try {
      const data = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      return {
        exists: true,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        runCount: data.run_count,
        toolCount: Object.keys(data.vector?.tool_frequency || {}).length,
      };
    } catch {
      return { exists: false };
    }
  });

  // Get drift reports for a task
  ipcMain.handle('drift:get-reports', async (_, taskId: string, specDir: string) => {
    const driftDir = path.join(specDir, 'drift');

    if (!fs.existsSync(driftDir)) {
      return [];
    }

    const reports: any[] = [];
    const files = fs.readdirSync(driftDir).filter(f => f.endsWith('.json'));

    for (const file of files.slice(-20)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(driftDir, file), 'utf-8'));
        reports.push(data);
      } catch {}
    }

    return reports.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  });
}
```

---

### DRIFT-15: Register drift handlers

In `src/main/ipc-handlers/index.ts`:

```typescript
import { registerDriftHandlers } from './drift-handlers';

export function setupIpcHandlers(agentManager: any, getMainWindow: () => any) {
  // ... existing handlers ...

  registerDriftHandlers(agentManager, getMainWindow);
}
```

---

## Implementation Order

| Order | Task ID | Description | Dependencies |
|-------|---------|-------------|--------------|
| 1 | DRIFT-1 | Copy Agent-Drift core files | None |
| 2 | DRIFT-2 | Create __init__.py | DRIFT-1 |
| 3 | DRIFT-3 | Simplify monitor.py | DRIFT-1 |
| 4 | DRIFT-4 | Integrate in coder.py | DRIFT-2, DRIFT-3 |
| 5 | DRIFT-5 | Add event emission | DRIFT-4 |
| 6 | DRIFT-14 | Create IPC handlers | None |
| 7 | DRIFT-15 | Register handlers | DRIFT-14 |
| 8 | DRIFT-6 | Create drift-store | DRIFT-14 |
| 9 | DRIFT-7 | Create DriftIndicator | None |
| 10 | DRIFT-8 | Create DriftTab | DRIFT-6, DRIFT-7 |
| 11 | DRIFT-9 | Add tab to TaskDetails | DRIFT-8 |
| 12 | DRIFT-10 | Add badge to TaskCard | DRIFT-7, DRIFT-6 |
| 13 | DRIFT-11 | Create DriftSettings | DRIFT-6 |
| 14 | DRIFT-12 | Add to Settings page | DRIFT-11 |
| 15 | DRIFT-13 | Create DriftAlertBanner | DRIFT-6 |

---

## Success Criteria

### Backend
- [ ] Drift module exists at apps/backend/drift/
- [ ] DriftMonitor tracks tool calls in coder.py
- [ ] Drift reports saved to spec/drift/ directory
- [ ] drift_report and drift_critical events emitted
- [ ] Python syntax valid: `python -m py_compile apps/backend/drift/*.py`

### Frontend
- [ ] Drift store manages per-task drift state
- [ ] DriftIndicator shows colored badge with score
- [ ] DriftTab shows component breakdown and history
- [ ] TaskCard footer shows drift badge
- [ ] Settings has drift configuration section
- [ ] Critical alert banner appears on drift_critical event

### Integration
- [ ] IPC handlers respond to drift:* channels
- [ ] Reset baseline deletes and backs up baseline.json
- [ ] Build passes: `npm run build`
- [ ] Tests pass: `npm test`

---

## Verification

After implementation:

1. **Start a task** - Drift monitoring should begin
2. **Watch task cards** - Badge should appear after first session
3. **Click task** - Drift tab should show component scores
4. **Check settings** - Drift section should show baseline status
5. **Reset baseline** - Should clear and start fresh

---

## Related Files

- [AGENT_DRIFT_INTEGRATION.md](AGENT_DRIFT_INTEGRATION.md) - Research and analysis
- [AGENT_DRIFT_ARCHITECTURE_FIT.md](AGENT_DRIFT_ARCHITECTURE_FIT.md) - Architecture diagrams
- [Agent-Drift Source](../../Agent-Drift-main/) - Original code
- [GitHub Source](https://github.com/lukehebe/Agent-Drift)

---

**Phase 10: Agent-Drift Integration - 15 tasks**
