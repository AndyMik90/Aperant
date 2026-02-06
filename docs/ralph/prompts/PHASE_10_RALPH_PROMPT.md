# Phase 10: Agent-Drift Integration - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-04
**Tasks:** 15
**Max Iterations:** 200

---

## Quick Start

Copy and paste this into Ralph:

```bash
/ralph-loop:ralph-loop "
You are completing Phase 10: Agent-Drift Integration for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 15-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude
- Agent-Drift source: C:\Users\AlienZ\Desktop\Auto-Claude\Agent-Drift-main\src

Primary documentation:
- docs\plans\PHASE_10_AGENT_DRIFT.md (THIS IS YOUR SPEC)
- docs\plans\AGENT_DRIFT_INTEGRATION.md (Research context)
- docs\plans\AGENT_DRIFT_ARCHITECTURE_FIT.md (Architecture diagrams)
- docs\PROGRESS.md

---

PHASE 10: AGENT-DRIFT INTEGRATION (15 tasks)

BACKEND TASKS (5):

| # | Task | File | Promise |
|---|------|------|---------|
| 1 | DRIFT-1: Copy core files | apps/backend/drift/ | DRIFT_1_COPY_COMPLETE |
| 2 | DRIFT-2: Create __init__.py | apps/backend/drift/__init__.py | DRIFT_2_INIT_COMPLETE |
| 3 | DRIFT-3: Simplify monitor.py | apps/backend/drift/monitor.py | DRIFT_3_MONITOR_COMPLETE |
| 4 | DRIFT-4: Integrate in coder.py | apps/backend/agents/coder.py | DRIFT_4_CODER_COMPLETE |
| 5 | DRIFT-5: Add event emission | apps/backend/agents/session.py | DRIFT_5_EVENTS_COMPLETE |

IPC TASKS (2):

| # | Task | File | Promise |
|---|------|------|---------|
| 6 | DRIFT-14: Create IPC handlers | src/main/ipc-handlers/drift-handlers.ts | DRIFT_14_HANDLERS_COMPLETE |
| 7 | DRIFT-15: Register handlers | src/main/ipc-handlers/index.ts | DRIFT_15_REGISTER_COMPLETE |

FRONTEND TASKS (8):

| # | Task | File | Promise |
|---|------|------|---------|
| 8 | DRIFT-6: Create drift-store | src/renderer/stores/drift-store.ts | DRIFT_6_STORE_COMPLETE |
| 9 | DRIFT-7: Create DriftIndicator | src/renderer/components/drift/DriftIndicator.tsx | DRIFT_7_INDICATOR_COMPLETE |
| 10 | DRIFT-8: Create DriftTab | src/renderer/components/drift/DriftTab.tsx | DRIFT_8_TAB_COMPLETE |
| 11 | DRIFT-9: Add to TaskDetails | src/renderer/components/TaskDetails.tsx | DRIFT_9_DETAILS_COMPLETE |
| 12 | DRIFT-10: Add to TaskCard | src/renderer/components/TaskCard.tsx | DRIFT_10_CARD_COMPLETE |
| 13 | DRIFT-11: Create DriftSettings | src/renderer/components/settings/DriftSettings.tsx | DRIFT_11_SETTINGS_COMPLETE |
| 14 | DRIFT-12: Add to Settings page | src/renderer/pages/Settings.tsx | DRIFT_12_SETTINGSPAGE_COMPLETE |
| 15 | DRIFT-13: Create DriftAlertBanner | src/renderer/components/drift/DriftAlertBanner.tsx | DRIFT_13_BANNER_COMPLETE |

FINAL: <promise>PHASE_10_AGENT_DRIFT_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs\plans\PHASE_10_AGENT_DRIFT.md FULLY first.
   This file contains ALL implementation code.

2. BACKEND (Tasks 1-5):
   a. DRIFT-1: Copy these files from Agent-Drift-main/src/ to apps/backend/drift/:
      - models.py (as-is)
      - vectorizer.py (as-is)
      - baseline.py (as-is)
      - detector.py (as-is)
      - monitor.py (will modify in DRIFT-3)

   b. DRIFT-2: Create __init__.py with exports (see spec)

   c. DRIFT-3: In monitor.py:
      - REMOVE: DASHBOARD_HTML, Handler class, run_monitor()
      - KEEP: AgentMonitor class
      - ADD: get_interim_report() method (see spec)

   d. DRIFT-4: In coder.py:
      - Add import: from drift import DriftMonitor, DriftReport
      - Initialize DriftMonitor in agent
      - Add start_session/track_tool/end_session calls
      - Emit drift_report events

   e. DRIFT-5: In session.py:
      - Add emit_drift_event helper function

3. IPC (Tasks 6-7):
   a. DRIFT-14: Create drift-handlers.ts with:
      - drift:get-settings
      - drift:save-settings
      - drift:reset-baseline
      - drift:get-baseline
      - drift:get-reports

   b. DRIFT-15: Register in index.ts

4. FRONTEND (Tasks 8-15):
   a. Create components in order (see spec for full code)
   b. Use existing patterns from task-store.ts and other components
   c. Follow the Tron/dark theme styling

5. VERIFICATION:
   - npm run build (must pass)
   - npm test (fix any new failures)
   - python -m py_compile apps/backend/drift/*.py

6. FINAL:
   When ALL 15 promises emitted AND builds pass:
   <promise>PHASE_10_AGENT_DRIFT_COMPLETE</promise>

---

KEY IMPLEMENTATION NOTES

1. DRIFT INDICATOR COLORS:
   - Normal (< 0.3): green-500
   - Warning (0.3-0.5): yellow-500
   - Critical (>= 0.5): red-500

2. BADGE FORMAT: emoji + score
   - 🟢 0.12
   - 🟡 0.35
   - 🔴 0.67

3. STORE PATTERN: Follow existing Zustand patterns in task-store.ts

4. IPC PATTERN: Follow existing patterns in ipc-handlers/

5. STYLING: Use existing Tailwind classes, match dark theme

---

CRITICAL CONSTRAINTS

1. 15-TASK JOB - Do NOT stop until all 15 tasks are complete.
2. ALL REQUIRED - Every task must be executed.
3. NO SUMMARIES - Progress summaries are NOT stopping points.
4. CONTINUATION - After each task, say: NEXT: Task N

---

ANTI-SKIP RULES

You may NOT skip because:
- Task seems complex
- Current implementation works well
- You prefer a different design

You may ONLY skip if:
- Real error after 3 fix attempts
- Required file does not exist
- Dependency is genuinely missing

If you skip, you MUST:
- Document in docs\PROGRESS.md
- Mark task as blocked, not complete
- Continue to next task

---

HARD STOP RULE

You may NOT stop until:
- All 15 task promises have been output, AND
- <promise>PHASE_10_AGENT_DRIFT_COMPLETE</promise> has been output

If you write wrap-up language while tasks remain:
- STOP that thought
- Check how many tasks remain
- Continue with: NEXT: Task N

CURRENT STATUS: 0 of 15 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "PHASE_10_AGENT_DRIFT_COMPLETE"
```

---

## Task Checklist

### Backend
- [ ] DRIFT-1: Copy core files → `<promise>DRIFT_1_COPY_COMPLETE</promise>`
- [ ] DRIFT-2: Create __init__.py → `<promise>DRIFT_2_INIT_COMPLETE</promise>`
- [ ] DRIFT-3: Simplify monitor.py → `<promise>DRIFT_3_MONITOR_COMPLETE</promise>`
- [ ] DRIFT-4: Integrate in coder.py → `<promise>DRIFT_4_CODER_COMPLETE</promise>`
- [ ] DRIFT-5: Add event emission → `<promise>DRIFT_5_EVENTS_COMPLETE</promise>`

### IPC
- [ ] DRIFT-14: Create IPC handlers → `<promise>DRIFT_14_HANDLERS_COMPLETE</promise>`
- [ ] DRIFT-15: Register handlers → `<promise>DRIFT_15_REGISTER_COMPLETE</promise>`

### Frontend
- [ ] DRIFT-6: Create drift-store → `<promise>DRIFT_6_STORE_COMPLETE</promise>`
- [ ] DRIFT-7: Create DriftIndicator → `<promise>DRIFT_7_INDICATOR_COMPLETE</promise>`
- [ ] DRIFT-8: Create DriftTab → `<promise>DRIFT_8_TAB_COMPLETE</promise>`
- [ ] DRIFT-9: Add to TaskDetails → `<promise>DRIFT_9_DETAILS_COMPLETE</promise>`
- [ ] DRIFT-10: Add to TaskCard → `<promise>DRIFT_10_CARD_COMPLETE</promise>`
- [ ] DRIFT-11: Create DriftSettings → `<promise>DRIFT_11_SETTINGS_COMPLETE</promise>`
- [ ] DRIFT-12: Add to Settings page → `<promise>DRIFT_12_SETTINGSPAGE_COMPLETE</promise>`
- [ ] DRIFT-13: Create DriftAlertBanner → `<promise>DRIFT_13_BANNER_COMPLETE</promise>`

### Final
- [ ] Build passes
- [ ] Tests pass
- [ ] `<promise>PHASE_10_AGENT_DRIFT_COMPLETE</promise>`

---

## Success Criteria

### Backend
- [ ] `apps/backend/drift/` module exists with 5 files
- [ ] DriftMonitor tracks tool calls
- [ ] Drift reports saved to spec/drift/
- [ ] Events emitted via emit_sdk_msg()
- [ ] Python syntax valid

### Frontend
- [ ] DriftIndicator shows colored badge
- [ ] DriftTab shows breakdown + history
- [ ] TaskCard footer has drift badge
- [ ] Settings has drift section
- [ ] Alert banner appears on critical

### Integration
- [ ] IPC handlers respond
- [ ] Reset baseline works
- [ ] Build passes
- [ ] Tests pass

---

## Attribution

Based on Agent-Drift by lukehebe: https://github.com/lukehebe/Agent-Drift

---

**Phase 10: Agent-Drift Integration - 15 tasks | ~3 days**
