# Kanban Bug Fix + Terminal Output + Timeline Redesign

**Date:** 2026-02-06
**Status:** DESIGN COMPLETE — Ready for Ralph prompts
**Priority:** HIGH
**Affects:** Kanban board, task terminal output, activity timeline

---

## Issue 1: Start Build Button Doesn't Appear After Planning

### Problem
When a task finishes the planning phase naturally (agent completes and exits), the "Start Build" button never appears. The user has to manually click "Stop" first, which then reveals the "Start Build" button.

### Root Cause
In `TaskCard.tsx:870-937`, the "Start Build" button visibility is gated on `isAgentStopped`:
- `isAgentStopped === true` → Show "Resume" + "Start Build"
- `isAgentStopped === false` → Show "Stop" only

`isAgentStopped` is ONLY set to `true` when the user manually clicks Stop (via `onTaskAgentStopped` event in `useIpc.ts:218-223`). When planning completes naturally, this event never fires.

### Fix
When the agent process exits naturally after planning, the backend should emit the same `onTaskAgentStopped` event (or a new `onPlanningComplete` event). The frontend should treat natural planning completion the same as a manual stop — show "Start Build".

### Key Files
| File | Role |
|------|------|
| `TaskCard.tsx:870-937` | Button visibility conditional |
| `task-store.ts:619-633` | `setAgentStopped` / `isAgentStopped` |
| `useIpc.ts:218-223` | Event listener for stopped state |
| Backend agent process | Needs to emit event on natural planning exit |

---

## Issue 2: Terminal Raw Output Doesn't Match Claude Code

### Problem
The task terminal output (raw view) doesn't look like a real Claude Code terminal session. While the system has structured parsing (`ClaudeOutputParser`), rich formatting (`TaskMonitorChat`), and syntax highlighting, the overall visual presentation needs improvement to feel like an actual Claude Code terminal.

### Current Architecture
```
Raw Output → ClaudeOutputParser → TaskMonitorChat (raw view)
                                → StructuredOutput (timeline view)
```

### What Exists
- `TaskMonitorChat.tsx` (1,460 lines) — rich formatted output
- `StructuredOutput.tsx` — timeline step view
- `ClaudeOutputParser` — parses thinking, tools, code, diffs
- Color-coded tool blocks (Blue=Read, Green=Edit, Purple=Bash)
- Syntax highlighting via highlight.js
- Collapsible long outputs, copy buttons, search

### Investigation: Do Phases Render Differently?
**Result: NO.** All phases (planning, coding, QA) use the identical rendering pipeline:
- Same component: `TaskMonitorChat`
- Same IPC channels: `TERMINAL_OUTPUT` + `TERMINAL_STRUCTURED_OUTPUT`
- Same parser: `SDKOutputParser` (universal, no phase branching)
- Same terminal type: `isTaskMonitor: true` (reused across phases)

**Why it LOOKS different:** The backend Python agents for each phase format their output differently. Some emit proper `__SDK_MSG__` structured markers, others emit raw text. The visual inconsistency comes from the data, not the renderer.

**Implication:** Fixing TaskMonitorChat visual rendering will improve ALL phases at once.

### What Needs Improvement
1. Tool blocks need clearer visual boundaries (card-like containers, not just colored dots)
2. Better visual separation between agent messages and tool outputs
3. Thinking blocks should be collapsible with a subtle indicator
4. File paths in tool outputs should be more prominent
5. Overall layout should feel more like a terminal session with clear message boundaries
6. Better status indicators during active execution
7. Ensure all backend agents emit consistent `__SDK_MSG__` structured markers (future task)

### Reference
- `docs/ui-reference/RAW_VIEW_REFERENCE.md`
- `docs/ui-reference/Screenshot 2026-02-05 112314.png`

---

## Issue 3: Timeline Page Needs Redesign

### Problem
The current ActivityFeed is a simple flat list in a 256px scrollbox — not a real timeline. No connecting lines, no date grouping, no visual hierarchy, no task durations.

### Current State
- `ActivityFeed.tsx` — simple icon + text + timestamp rows
- Max 50 entries in localStorage
- 256px max-height scrollable box
- Rendered below AnalyticsDashboard in Analytics tab
- No visual timeline elements

### Redesign Goals
1. **Vertical timeline line** — continuous line connecting events
2. **Date grouping** — "Today", "Yesterday", "Feb 5" headers
3. **Event nodes** — colored circles on the timeline (green=success, red=fail, blue=active)
4. **Event cards** — small cards with task title, description, duration, status badge
5. **Phase durations** — show how long each phase took (planning: 2m, building: 5m)
6. **Task linking** — click to navigate to task in Kanban
7. **Full-page treatment** — give it room to breathe, not a tiny box
8. **Filtering** — by event type, task, date range

### Data Needs
Current ActivityEntry has: id, type, taskId, taskTitle, timestamp, details
Need to add: duration, phaseInfo, additional metadata

---

## Ralph Prompt Plan

| # | Prompt | Tasks | Description |
|---|--------|-------|-------------|
| 1 | KANBAN_BUILD_BUTTON | 3 | Fix planning→build transition bug |
| 2 | TERMINAL_OUTPUT_POLISH | 5 | Improve raw terminal output visual quality |
| 3 | TIMELINE_REDESIGN | 5 | Rebuild ActivityFeed as proper timeline |

**Run order:** 1 first (bug fix), then 2 and 3 can run in any order.
