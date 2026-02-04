# Phase 7: Terminal UX Redesign

**Version:** 1.0
**Date:** 2026-02-04
**Status:** Design Complete - Ready for Implementation
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

### TERM-1: Inline Terminal Expansion

**Priority:** P1
**Complexity:** High

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

### TERM-2: Fix Tool Use Display

**Priority:** P0
**Complexity:** Medium

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

### TERM-3: Terminal Output Parsing

**Priority:** P1
**Complexity:** Medium

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

### TERM-4: Task Terminal Integration

**Priority:** P2
**Complexity:** Low

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

| Order | Task | Dependency | Estimate |
|-------|------|------------|----------|
| 1 | TERM-2 | None | Medium |
| 2 | TERM-1 | TERM-2 (for content) | High |
| 3 | TERM-3 | TERM-1 | Medium |
| 4 | TERM-4 | TERM-1, TERM-3 | Low |

**Recommended approach:** Start with TERM-2 (fix the data) before TERM-1 (change the UX).

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

```bash
/ralph-loop:ralph-loop "
You are completing Phase 7: Terminal UX Redesign for Auto-Claude.

Repository: C:\Users\AlienZ\Desktop\Auto-Claude

Primary documentation:
- C:\Users\AlienZ\Desktop\Auto-Claude\docs\plans\TERMINAL_REDESIGN.md (THIS FILE)
- C:\Users\AlienZ\Desktop\Auto-Claude\docs\plans\REMAINING_TASKS.md
- C:\Users\AlienZ\Desktop\Auto-Claude\docs\PROGRESS.md

## TASKS (4 required)

| # | Task | Promise |
|---|------|---------|
| 1 | TERM-2: Fix Tool Use Display | TERM_2_TOOL_USE_DISPLAY_COMPLETE |
| 2 | TERM-1: Inline Terminal Expansion | TERM_1_INLINE_TERMINAL_COMPLETE |
| 3 | TERM-3: Terminal Output Parsing | TERM_3_OUTPUT_PARSING_COMPLETE |
| 4 | TERM-4: Task Terminal Integration | TERM_4_TERMINAL_INTEGRATION_COMPLETE |

**FINAL:** <promise>PHASE_7_TERMINAL_REDESIGN_COMPLETE</promise>

Execute each task completely. Output promise after each. Continue until final promise.
" --max-iterations 150 --completion-promise "PHASE_7_TERMINAL_REDESIGN_COMPLETE"
```

---

## Success Criteria

- [ ] Terminal button on task card toggles inline expansion (not floating modal)
- [ ] Tool use displays show actual file paths and commands (no "(no path)")
- [ ] Terminal output is parsed and displayed in structured format
- [ ] Terminal state persists across expand/collapse
- [ ] Real-time output streaming works
- [ ] Build passes: `npm run build`

---

## Relationship to Other Tasks

**Completes:** FIX-5 (Terminal readability) - marked as "Partial" in TODO.md
**Replaces:** SUG-1b (Claude Code Sessions) - inline approach better than separate page
**After:** Phase 6 quick fixes (v3.2 remaining tasks)

---

**Phase 7: Terminal UX Redesign - 4 tasks total**
