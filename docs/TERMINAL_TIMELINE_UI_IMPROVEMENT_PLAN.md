# Terminal & Timeline UI Improvement Plan

**Date:** February 10, 2026
**Status:** Proposed
**Priority Order:** Phase-Centric Layout > Clean Up Noise > Density & Grouping

---

## Executive Summary

The current terminal and timeline views in the bottom panel (`BottomPanelTerminal`) provide two ways to observe task execution: a **Raw view** (Claude Code-style chat) and a **Timeline/Structured view** (vertical step list). After analyzing real task output with 222+ timeline steps across planning, coding, and validation phases, we identified three high-impact improvement areas that will dramatically improve readability and usability.

---

## Current Architecture

### Data Flow

```
Backend (Python)
  task_logger/streaming.py  -->  __TASK_LOG_*__:{JSON} markers via stdout
       |
Main Process (Electron)
  sdk-output-parser.ts      -->  Parses markers into ParsedMessage[] / TaskLogStreamChunk
  task-log-service.ts        -->  Watches task_logs.json, merges main + worktree logs, polls 1000ms
       |
Renderer (React)
  terminal-store.ts          -->  Terminal { messages: ParsedMessage[], parser, isStreaming }
       |
  BottomPanelTerminal.tsx    -->  Container with view mode tabs (Raw | Timeline | Spec | Prompt)
    TaskMonitorChat.tsx       -->  Raw view: rich chat with tool blocks, syntax highlighting
    StructuredOutput.tsx      -->  Timeline view: vertical step list with colored dots
    TaskLogs.tsx              -->  Phase-based collapsible logs (used in task detail sidebar)
```

### Key Components

| Component | File | Role |
|-----------|------|------|
| `BottomPanelTerminal` | `terminal/BottomPanelTerminal.tsx` | Container, view mode tabs, resize, split view |
| `TaskMonitorChat` | `terminal/TaskMonitorChat.tsx` | Raw Claude Code-style output with tool blocks |
| `StructuredOutput` | `terminal/StructuredOutput.tsx` | Timeline view, step list with icons/colors |
| `TaskLogs` | `task-detail/TaskLogs.tsx` | Phase-based collapsible logs with status badges |
| `ActivityTimeline` | `task-detail/ActivityTimeline.tsx` | Simplified timeline for task detail view |

### Key Types (from `shared/types/task.ts`)

- `TaskLogPhase`: `'planning' | 'coding' | 'validation'`
- `TaskLogEntryType`: `'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error' | 'success' | 'info'`
- `ExecutionProgress`: `{ phase, phaseProgress, overallProgress, currentSubtask?, completedPhases? }`
- `TaskPhaseLog`: `{ phase, status, started_at, completed_at, entries[] }`

---

## Problems Identified

### 1. No Phase Structure in Timeline View
The `StructuredOutput` timeline renders every content block as a flat list. With 222 steps across planning/coding/validation, there is no visual separation between phases. Users cannot tell where planning ended and coding began. The only phase indicator is a small `[Phase: ...]` text marker that looks like any other step.

### 2. Noise and Data Leakage
- **`__TASK_LOG_TEXT__` JSON blobs** appear in raw terminal output when the SDK output parser fails to fully consume them
- **Security settings blocks** (allowed/disallowed tools list) repeat 5-6 times per task execution
- **Spec orchestrator output appears twice** due to duplicate run detection issues
- The raw view shows internal framework chatter that obscures actual meaningful agent work

### 3. Flat Tool Call Rendering
Each tool call produces two timeline rows (call + output), creating visual noise. When an agent reads 15 files in sequence, that is 30 timeline rows with no grouping. There is no way to adjust information density based on what the user needs at that moment.

### 4. Stale Timestamps
Every timeline step shows relative timestamps like "10m ago" that all read the same after a few minutes, providing no useful information. Duration "0" appears on steps that complete instantly.

---

## Improvement Plan

### Priority 1: Phase-Centric Layout with Progress Header

**Goal:** Transform the flat timeline into a phase-structured view with persistent progress awareness.

#### 1A. Persistent Progress Header (StructuredOutput)

Add a sticky header bar at the top of `StructuredOutput` that always shows current execution state.

**Component:** New `ProgressHeader` component inside `StructuredOutput.tsx`

**Design:**
```
[Planning: Done (2m 14s)] [Coding: Step 3/5 ████░░ 60%] [Validation: Pending]
```

**Data source:** The `ExecutionProgress` type already provides `phase`, `phaseProgress`, `overallProgress`, and `completedPhases`. This data is available on the `Task` object via the task store.

**Implementation:**
- Add a `taskId` prop to `StructuredOutput` (currently it only receives `messages`)
- Use `useTaskStore` to get the task's `executionProgress`
- Render a sticky `div` with `position: sticky; top: 0; z-index: 10` at the top of the timeline
- Show three phase pills: Planning, Coding, Validation
- Each pill shows: phase name, status icon (spinner/checkmark/pending), duration if completed, progress bar if active
- Color-code using existing `PHASE_COLORS` from `TaskLogs.tsx`:
  - Planning: amber
  - Coding: blue (info)
  - Validation: purple

**Files to modify:**
- `StructuredOutput.tsx` (add progress header, accept `taskId` prop)
- `BottomPanelTerminal.tsx` (pass `taskId` to `StructuredOutput` via `PanelContent`)
- `TaskMonitorChat.tsx` (pass `taskId` through to `StructuredOutput` when in timeline mode)

#### 1B. Phase Cards with Collapsible Sections (StructuredOutput)

Replace the flat step list with collapsible phase groups. Each phase becomes a card that contains its steps.

**Design:**
```
[v] Planning                    Done  2m 14s
    Thinking > Analyzing requirements...
    Read > package.json
    Read > tsconfig.json
    Search > "existing patterns"
    ...

[v] Coding                     Running  Step 3/5
    Thinking > Implementation plan...
    Edit > UserForm.tsx
    Write > validation.ts
    Bash > npm run typecheck
    ...

[ ] Validation                  Pending
```

**Implementation:**
- Modify the `timelineSteps` memo in `StructuredOutput` to detect phase boundaries
- Currently, phase transitions are detected via `block.text?.startsWith('[Phase:')` — use this to split steps into phase groups
- Create a new `PhaseCard` component wrapping each group
- Each `PhaseCard` has:
  - Collapsible header with phase name, status badge, duration, step count
  - Content area containing the `TimelineStep` components for that phase
  - Auto-expand the currently active phase, collapse completed phases
- Reuse the styling patterns from `PhaseLogSection` in `TaskLogs.tsx` (border colors, status badges, icons)

**Files to modify:**
- `StructuredOutput.tsx` (major refactor: add PhaseCard, group steps by phase)

#### 1C. Phase Duration Tracking

Compute per-phase durations from timestamp data in the timeline steps.

**Implementation:**
- In the `timelineSteps` memo, track first and last timestamp per phase
- Display duration on phase card headers: "Planning (2m 14s)" / "Coding (running, 5m 32s elapsed)"
- Use the existing `formatDuration()` helper

**Files to modify:**
- `StructuredOutput.tsx` (compute phase durations in memo)

---

### Priority 2: Clean Up Noise

**Goal:** Remove framework chatter, duplicate content, and data leaks from both views.

#### 2A. Filter `__TASK_LOG_TEXT__` from Raw View

The `__TASK_LOG_TEXT__:{...}` markers sometimes leak through to the raw terminal display. These are internal protocol markers that should never be visible to users.

**Implementation:**
- In `TaskMonitorChat.tsx`, add a filter in the message rendering pipeline
- Check each text block for the `__TASK_LOG_` prefix pattern
- Strip or hide any text content matching `/^__TASK_LOG_\w+__:/`
- Also filter these from `StructuredOutput` timeline text blocks

**Files to modify:**
- `TaskMonitorChat.tsx` (filter text blocks containing `__TASK_LOG_`)
- `StructuredOutput.tsx` (filter in `timelineSteps` memo)

#### 2B. Deduplicate Security Settings Blocks

The security settings block (listing allowed/disallowed tools) appears multiple times per task because it is emitted at the start of each agent invocation within a task.

**Implementation approach — two options:**

**Option A (Frontend filter):** Detect the security settings block pattern in the rendered output and show only the first occurrence, collapsing subsequent ones into a "Security settings (repeated)" indicator.
- Pattern detection: Look for text blocks containing "IMPORTANT: Tool permissions" or "Allowed tools:" or similar markers
- Track seen occurrences in a ref/memo, hide duplicates

**Option B (Backend fix):** Modify the backend to only emit security settings once per task execution, not once per agent invocation.
- This is the cleaner fix but requires backend changes

**Recommended:** Option A for immediate improvement, Option B as follow-up.

**Files to modify:**
- `TaskMonitorChat.tsx` (detect and collapse repeated security blocks)
- `StructuredOutput.tsx` (filter security text from timeline)

#### 2C. Deduplicate Spec Orchestrator Output

The spec orchestrator output appears twice due to the same text being emitted from both the main process and the worktree process logging.

**Implementation:**
- In `task-log-service.ts`, the merge logic already handles main + worktree logs — add deduplication based on content hash + timestamp proximity
- If two entries have identical content and timestamps within 2 seconds, keep only one

**Files to modify:**
- `task-log-service.ts` (add deduplication in merge logic)

#### 2D. Fix Stale Relative Timestamps

Replace "10m ago" with absolute timestamps or elapsed time from task start.

**Implementation:**
- Change `formatRelativeTime()` in `StructuredOutput.tsx` to show elapsed time from the first step: "+0:00", "+0:15", "+2:14", etc.
- This gives meaningful context about when each step happened relative to the task start
- Keep the "just now" / "Xs ago" format only for steps less than 30 seconds old (still relevant during active execution)
- Remove the trailing "0" duration display for steps with duration < 100ms (already partially handled)

**Files to modify:**
- `StructuredOutput.tsx` (refactor `formatRelativeTime`, add task-relative elapsed time)

---

### Priority 3: Tool Call Grouping & Density Toggle

**Goal:** Reduce visual noise from repetitive tool calls and give users control over information density.

#### 3A. Group Consecutive Same-Type Tool Calls

When an agent reads 10 files in a row, instead of showing 10 separate "Read > file.tsx" rows, group them:

**Design:**
```
Read  10 files                          [expand v]
  package.json, tsconfig.json, UserForm.tsx, validation.ts,
  api/routes.ts, api/auth.ts, ...
```

**Implementation:**
- In `StructuredOutput.tsx`, add a post-processing step after building `timelineSteps`
- Detect consecutive tool_use blocks with the same `toolName`
- If 3+ consecutive same-type calls, collapse into a `ToolGroup` component
- `ToolGroup` shows: tool icon, tool name, count, expandable file list
- Clicking expands to show individual steps
- Keep the original individual rendering for groups of 1-2

**New component:** `ToolCallGroup` within `StructuredOutput.tsx`

**Files to modify:**
- `StructuredOutput.tsx` (add grouping logic, ToolCallGroup component)

#### 3B. View Density Toggle

Add a density selector to the timeline header: Compact / Standard / Verbose.

**Design:**
```
[Header bar]  Steps: 222  |  Compact  Standard  Verbose
```

| Density | What it shows |
|---------|--------------|
| **Compact** | Phase headers + errors + final results only. Tool calls collapsed into summary counts per phase: "Read 45 files, Edited 12, Ran 8 commands". Thinking blocks hidden. |
| **Standard** (default) | Phase cards with tool call groups, thinking summaries ("Thinking... analyzing 3 approaches"), error details. |
| **Verbose** | Everything: individual tool calls, full thinking text, all text blocks, full paths. Current behavior. |

**Implementation:**
- Add a `density` state to `StructuredOutput`: `'compact' | 'standard' | 'verbose'`
- Add density selector buttons in the timeline header (next to existing step count)
- Filter/group steps based on density setting:
  - Compact: Only phase markers, errors, success messages
  - Standard: Phase cards + tool groups (from 3A) + truncated thinking
  - Verbose: Current full rendering
- Persist density preference in localStorage

**Files to modify:**
- `StructuredOutput.tsx` (add density state, filtering logic, density selector UI)

#### 3C. Parallel Agent Visual Separation

When subagents run in parallel, their outputs interleave without visual separation.

**Implementation:**
- Detect `Task` tool_use blocks (spawning subagents) and their corresponding outputs
- In the timeline, indent subagent steps and add a subtle left border with the parent agent's color
- Show subagent label: "Subagent: research-api-patterns"
- This creates a visual tree structure for parallel work

**Files to modify:**
- `StructuredOutput.tsx` (detect Task tool blocks, add nesting/indentation)

---

## Implementation Order & Estimates

| Step | Task | Est. Effort | Dependencies |
|------|------|-------------|--------------|
| 1A | Progress Header | Small (1-2 hours) | None |
| 1B | Phase Cards | Medium (3-4 hours) | 1A |
| 1C | Phase Duration | Small (30 min) | 1B |
| 2A | Filter __TASK_LOG__ | Small (30 min) | None |
| 2B | Dedup Security Blocks | Small (1 hour) | None |
| 2C | Dedup Orchestrator | Small (1 hour) | None |
| 2D | Fix Timestamps | Small (30 min) | None |
| 3A | Tool Call Grouping | Medium (2-3 hours) | 1B |
| 3B | Density Toggle | Medium (2-3 hours) | 3A |
| 3C | Parallel Agent Separation | Medium (2-3 hours) | 1B |

**Total estimated effort:** 14-18 hours

**Recommended execution:** All Priority 2 items (2A-2D) can be done in parallel with Priority 1 since they touch different parts of the rendering pipeline. Priority 3 depends on Priority 1B (phase cards) being in place first.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `StructuredOutput.tsx` | Major: phase cards, progress header, grouping, density, timestamps |
| `TaskMonitorChat.tsx` | Minor: filter __TASK_LOG__ markers, dedup security blocks |
| `BottomPanelTerminal.tsx` | Minor: pass taskId to StructuredOutput |
| `task-log-service.ts` | Minor: dedup logic in merge |

The majority of work is concentrated in `StructuredOutput.tsx`, which is currently 469 lines. The refactored version will likely be 800-1000 lines, or can be split into sub-components: `ProgressHeader.tsx`, `PhaseCard.tsx`, `ToolCallGroup.tsx`, `DensitySelector.tsx`.

---

## Design Principles

1. **Phase awareness first.** Users care about "is planning done? how far along is coding?" before they care about individual tool calls.
2. **Progressive disclosure.** Show the summary by default, let users drill into details on demand.
3. **No information loss.** Verbose mode should show everything the current view shows. We are adding layers of summarization on top, not removing data.
4. **Consistent styling.** Reuse the color palette and icons from existing components (PHASE_COLORS, TOOL_COLORS, status badges).
5. **Performance.** All grouping and filtering happens in useMemo. No re-renders on scroll. Virtual scrolling if step count exceeds 500.
