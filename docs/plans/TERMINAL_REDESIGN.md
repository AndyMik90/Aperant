# Phase 7: Terminal UX Redesign

**Version:** 1.2
**Date:** 2026-02-04
**Status:** 4 of 4 Tasks Complete - FULLY IMPLEMENTED
**Priority:** P1 - High (UX improvement)

---

## Overview

This document describes the terminal redesign for task cards. The current floating modal approach (TaskTerminalModal) works but creates a disconnected UX. This redesign embeds terminals directly within task cards in the Kanban board.

**Scope:** 4 tasks focused on terminal integration into task cards

---

## Current State Analysis

### The Problem (CRITICAL CONTEXT)

The Claude Code page (formerly Terminals) still has **task terminal columns** (Planning, In Progress, AI Review, Human Review). These columns are **still actively creating terminals** when tasks run, even though we want terminals to live in the Kanban task cards instead.

```
CURRENT (WRONG):
┌─────────────────────────────────────────────────────────────────┐
│ Claude Code Page                                                │
│ ┌──────────┬────────────┬───────────┬──────────────┬──────────┐│
│ │ Planning │ In Progress│ AI Review │ Human Review │ Terminals││
│ │   [T1]   │    [T2]    │   [T3]    │     [T4]     │  [bash]  ││ ← THESE CREATE TERMINALS
│ └──────────┴────────────┴───────────┴──────────────┴──────────┘│
└─────────────────────────────────────────────────────────────────┘

TARGET:
┌─────────────────────────────────────────────────────────────────┐
│ Claude Code Page                                                │
│ [+ New Terminal] [+ New Claude Code]                            │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Terminal 1 (bash)                                           ││ ← ONLY user terminals
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Kanban Page - Task Card                                         │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Task Title                    [Stop] [Build] [Terminal ▼]   ││
│ │ Description...                                              ││
│ ├─────────────────────────────────────────────────────────────┤│
│ │ Terminal output embedded HERE (dropdown expansion)          ││ ← TASK TERMINALS HERE
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Migration Path

**Most of the work is already done.** The terminal functionality exists - it just needs to be MOVED:

1. **TaskTerminalModal.tsx** - Already renders terminal content (keep this code)
2. **Terminal data flow via IPC** - Already works (keep this)
3. **Terminal button on task cards** - Already exists (modify behavior)

The migration is:
- **REMOVE:** Task terminal columns from Claude Code page (CLAUDE-1 in v3.2)
- **MOVE:** Terminal rendering FROM floating modal TO inline card expansion
- **REUSE:** Existing TaskTerminalModal logic, just change where it renders

### What Works (Keep)
- TaskTerminalModal.tsx exists and functions correctly
- Terminal button on task cards opens floating modal
- Terminal data flows correctly via IPC

### What Doesn't Work (Fix)
1. **Disconnected UX** - Terminal opens as floating modal, loses context of which task it belongs to
2. **Terminal output issues** - Still shows "(no path)" and "(no command)" in some tool use displays
3. **No inline expansion** - Users want to see terminal output without leaving the Kanban context
4. **Cluttered Claude Code page** - Has task terminal columns that duplicate Kanban functionality

---

## Design Goals

1. **Inline terminal** - Terminal expands within the task card, pushing other cards down
2. **Contextual** - Terminal is clearly associated with its task
3. **Collapsible** - Users can expand/collapse terminal without losing context
4. **Readable output** - Tool use displays show actual file paths and commands

---

## Tasks

### TERM-1: Inline Terminal Expansion ✅ COMPLETE

**Priority:** P1
**Complexity:** High
**Status:** ✅ DONE - Implemented in TaskCard.tsx (FIX-21)

**Implementation:**
- `isTerminalExpanded` state at TaskCard.tsx:223
- Terminal toggle button at TaskCard.tsx:431
- Inline TaskMonitorChat rendered at TaskCard.tsx:969-991
- No floating modal - terminal expands within card

#### What
Replace floating TaskTerminalModal with inline terminal expansion in task card. When user clicks terminal button, the card expands vertically to show an embedded terminal below the task info.

#### Current UX
```
┌─────────────────────────────┐
│ Task Title                  │
│ Description                 │
│ [Stop] [Build] [Terminal]   │ ← Click Terminal
└─────────────────────────────┘
         ↓
┌───────────────────────────────────┐
│        Floating Modal             │
│  ┌─────────────────────────────┐  │
│  │ Terminal output...          │  │
│  └─────────────────────────────┘  │
└───────────────────────────────────┘
```

#### Target UX
```
┌─────────────────────────────┐
│ Task Title                  │
│ Description                 │
│ [Stop] [Build] [Terminal ▲] │ ← Click Terminal (toggle)
├─────────────────────────────┤
│ Terminal output...          │  ← Inline expansion
│ > npm run build             │
│ Building...                 │
│ ✓ Done                      │
│ [Maximize] [Minimize ▼]     │  ← Terminal controls
└─────────────────────────────┘
```

#### Implementation Steps

1. **Create InlineTerminal component**
   - File: `apps/frontend/src/renderer/components/InlineTerminal.tsx`
   - Embed terminal content within card structure
   - Add expand/collapse animation

2. **Modify TaskCard to support expansion**
   - File: `apps/frontend/src/renderer/components/TaskCard.tsx`
   - Add `isExpanded` state
   - Render InlineTerminal when expanded
   - Handle terminal toggle

3. **Update card layout CSS**
   - Allow card height to grow
   - Add smooth transition animation
   - Ensure other cards shift down properly

4. **Keep modal as fallback**
   - Add "Maximize" button to open full modal
   - Useful for complex debugging sessions

#### Completion Promise
```
<promise>TERM_1_INLINE_TERMINAL_COMPLETE</promise>
```

---

### TERM-2: Fix Tool Use Display ✅ COMPLETE

**Priority:** P0
**Complexity:** Medium
**Status:** ✅ DONE - Implemented in ToolUseCard.tsx

**Implementation:**
- `formatInput()` at ToolUseCard.tsx:57-93 extracts and displays:
  - `file_path` for Read/Write/Edit tools
  - `command` for Bash tool
  - `pattern` for Grep/Glob
  - `url` for WebFetch/WebSearch
- No more "(no path)" or "(no command)" - actual values displayed

#### What
The terminal output shows "(no path)" and "(no command)" for tool use entries. This is the remaining part of FIX-5 that wasn't fully resolved.

#### Current Display
```
┌─────────────────────────────────────┐
│ Edit File                           │
│ Path: (no path)                     │
│ Command: (no command)               │
└─────────────────────────────────────┘
```

#### Target Display
```
┌─────────────────────────────────────┐
│ Edit File                           │
│ Path: src/components/TaskCard.tsx   │
│ Line: 145 → Changed X to Y          │
└─────────────────────────────────────┘
```

#### Implementation Steps

1. **Trace data flow**
   - Find where tool_use events are parsed
   - Identify why path/command aren't being extracted

2. **Fix ToolUseCard component**
   - File: `apps/frontend/src/renderer/components/ToolUseCard.tsx`
   - Extract file path from tool_use input
   - Extract command from tool_use input

3. **Add type-specific displays**
   - Edit: Show file path + line number + change summary
   - Read: Show file path
   - Bash: Show command
   - Write: Show file path
   - Grep/Glob: Show pattern + results count

#### Completion Promise
```
<promise>TERM_2_TOOL_USE_DISPLAY_COMPLETE</promise>
```

---

### TERM-3: Terminal Output Parsing ✅ COMPLETE

**Priority:** P1
**Complexity:** Medium
**Status:** ✅ DONE - StructuredOutput.tsx created, toggle added

**Implementation:**
- `claude-output-parser.ts` (580 lines) parses thinking, code, tool use, diffs
- `StructuredOutput.tsx` created with timeline view
- Raw/structured toggle added to TaskMonitorChat.tsx
- Timeline displays tool names, file paths, and status indicators

#### What
Improve parsing of Claude Code output to display structured information about what's happening.

#### Current Output
```
Raw terminal output with ANSI codes and JSON mixed in
```

#### Target Output
```
┌─────────────────────────────────────┐
│ Step 1: Reading TaskCard.tsx        │
│ Step 2: Editing line 145            │
│ Step 3: Running npm run build       │
│   → Build successful                │
└─────────────────────────────────────┘
```

#### Implementation Steps

1. **Create output parser**
   - File: `apps/frontend/src/renderer/utils/terminal-parser.ts`
   - Parse Claude Code events from output
   - Extract tool use, results, and messages

2. **Create StructuredOutput component**
   - File: `apps/frontend/src/renderer/components/StructuredOutput.tsx`
   - Display parsed output as timeline/steps
   - Show progress indicators

3. **Integrate with InlineTerminal**
   - Use StructuredOutput within InlineTerminal
   - Allow toggle between raw/structured views

#### Completion Promise
```
<promise>TERM_3_OUTPUT_PARSING_COMPLETE</promise>
```

---

### TERM-4: Task Terminal Integration ✅ COMPLETE

**Priority:** P2
**Complexity:** Low
**Status:** ✅ DONE - Status indicator added to TaskCard.tsx

**Implementation:**
- Terminal integrated into TaskCard inline expansion
- Terminal output streams in real-time via TaskMonitorChat
- Auto-scroll to bottom implemented
- Status indicator added:
  - Green (pulsing) = actively running
  - Red = stuck/error state
  - Yellow = needs attention (human_review, ai_review)
  - Gray = idle

#### What
Clean up the integration between task cards and their terminals. Ensure terminal state persists correctly and updates in real-time.

#### Implementation Steps

1. **Ensure terminal state persistence**
   - Terminal output should persist when card collapses
   - Re-expanding shows previous output

2. **Add real-time updates**
   - New output streams into terminal immediately
   - Auto-scroll to bottom for new content

3. **Add terminal status indicator**
   - Small dot/badge on terminal button showing if terminal is active
   - Green = running, Gray = idle, Red = error

#### Completion Promise
```
<promise>TERM_4_TERMINAL_INTEGRATION_COMPLETE</promise>
```

---

## Implementation Order

| Order | Task | Dependency | Status |
|-------|------|------------|--------|
| 1 | TERM-2: Fix Tool Use Display | None | ✅ DONE |
| 2 | TERM-1: Inline Terminal Expansion | TERM-2 | ✅ DONE |
| 3 | TERM-3: Terminal Output Parsing | TERM-1 | ✅ DONE |
| 4 | TERM-4: Task Terminal Integration | TERM-1, TERM-3 | ✅ DONE |

**Current Status:** 4 of 4 tasks complete. Phase 7 Terminal Redesign FULLY IMPLEMENTED.

---

## Files Affected

| File | Changes |
|------|---------|
| `TaskCard.tsx` | Add expansion state, InlineTerminal integration |
| `InlineTerminal.tsx` | New component (inline terminal embed) |
| `ToolUseCard.tsx` | Fix path/command extraction |
| `terminal-parser.ts` | New utility (parse Claude output) |
| `StructuredOutput.tsx` | New component (formatted output display) |
| `TaskCard.css` or Tailwind | Card expansion styles |

---

## Ralph Prompt (Phase 7)

> **NOTE:** Uses the same formatting pattern as the tested v3.2 prompt. See [REMAINING_TASKS.md](REMAINING_TASKS.md#key-formatting-notes-for-future-prompts) for formatting tips.

```bash
/ralph-loop:ralph-loop "
You are completing Phase 7: Terminal UX Redesign for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- You do not get to decide if tasks are worth doing.
- If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\plans\TERMINAL_REDESIGN.md (THIS FILE - read fully)
- docs\plans\REMAINING_TASKS.md
- docs\PROGRESS.md

---

TASKS (4 required – ALL MUST COMPLETE)

| # | Task                              | Promise                              |
|---|-----------------------------------|--------------------------------------|
| 1 | TERM-2: Fix Tool Use Display      | TERM_2_TOOL_USE_DISPLAY_COMPLETE     |
| 2 | TERM-1: Inline Terminal Expansion | TERM_1_INLINE_TERMINAL_COMPLETE      |
| 3 | TERM-3: Terminal Output Parsing   | TERM_3_OUTPUT_PARSING_COMPLETE       |
| 4 | TERM-4: Task Terminal Integration | TERM_4_TERMINAL_INTEGRATION_COMPLETE |

FINAL COMPLETION PROMISE:
- <promise>PHASE_7_TERMINAL_REDESIGN_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs\plans\TERMINAL_REDESIGN.md fully.

2. Task 1 (TERM-2):
   - Complete all steps from TERMINAL_REDESIGN.md.
   - Then output: <promise>TERM_2_TOOL_USE_DISPLAY_COMPLETE</promise>
   - Say: NEXT: Task 2 and begin Task 2.

3. Task 2 (TERM-1):
   - Complete all steps.
   - Then output: <promise>TERM_1_INLINE_TERMINAL_COMPLETE</promise>
   - Say: NEXT: Task 3.

4. Task 3 (TERM-3):
   - Complete all steps.
   - Then output: <promise>TERM_3_OUTPUT_PARSING_COMPLETE</promise>
   - Say: NEXT: Task 4.

5. Task 4 (TERM-4):
   - Complete all steps.
   - Then output: <promise>TERM_4_TERMINAL_INTEGRATION_COMPLETE</promise>
   - Say: NEXT: Verify.

6. Verification:
   - Run: npm run build
   - Fix any errors until the build is clean.

7. Final completion:
   - ONLY when all 4 task promises have been emitted AND npm run build succeeds,
   - THEN output: <promise>PHASE_7_TERMINAL_REDESIGN_COMPLETE</promise>

---

HARD STOP RULE

- You may NOT stop until <promise>PHASE_7_TERMINAL_REDESIGN_COMPLETE</promise> is output.
- If you find yourself writing wrap-up language while tasks remain, STOP and continue working.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "PHASE_7_TERMINAL_REDESIGN_COMPLETE"
```

---

## Success Criteria

- [x] Terminal button on task card toggles inline expansion (not floating modal) ✅
- [x] Tool use displays show actual file paths and commands (no "(no path)") ✅
- [x] Terminal output is parsed and displayed in structured format ✅
- [x] Terminal state persists across expand/collapse ✅
- [x] Real-time output streaming works ✅
- [x] Build passes: `npm run build` ✅

---

## Relationship to Other Tasks

**Completes:** FIX-5 (Terminal readability) - now marked COMPLETE in TODO.md
**Replaces:** SUG-1b (Claude Code Sessions) - inline approach better than separate page
**After:** Phase 6 quick fixes (v3.2 remaining tasks)

---

**Phase 7: Terminal UX Redesign - COMPLETE (4 of 4 tasks)**
