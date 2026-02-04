# Terminal UI Gap Analysis

**Date:** 2026-02-04
**Purpose:** Compare current terminal implementation vs Claude Code target
**Status:** Analysis complete, Ralph tasks ready

---

## Executive Summary

The current terminal UI implementation has a solid foundation with structured output parsing and tool-specific rendering. However, several UX refinements are needed to match Claude Code's polished output style.

| Category | Implemented | Missing | Priority |
|----------|-------------|---------|----------|
| Core Parsing | 10/10 | 0 | - |
| Tool Rendering | 8/12 | 4 | HIGH |
| UX Features | 5/12 | 7 | MEDIUM |

---

## Current Implementation (What's Working)

### ✅ Structured Output Parsing
- **SDKOutputParser** (`sdk-output-parser.ts:1-266`) - Parses `__SDK_MSG__:{json}` markers
- **ClaudeOutputParser** (`claude-output-parser.ts:1-581`) - Streaming parser for renderer
- **PhaseEventParser** (`phase-event-parser.ts:1-121`) - Parses `__EXEC_PHASE__` markers

### ✅ Tool-Specific Rendering (`TaskMonitorChat.tsx`)
| Tool | Lines | What it shows |
|------|-------|---------------|
| Read | 258-305 | File path, line ranges, expandable content |
| Edit | 192-255 | Unified diff (red removed, green added) |
| Bash | 131-189 | IN/OUT format with command and output |
| Grep | 307-340 | Line count with expandable results |
| Glob | 341-391 | File count with expandable list |

### ✅ UI Features
- **Bullet colors by tool type** (lines 36-48): Read=blue, Write=green, Bash=purple, etc.
- **Collapsible thinking blocks** with toggle all (lines 61-87)
- **Phase headers** with styled borders (lines 434-453)
- **Auto-scrolling** with scroll-to-bottom button (lines 614-644)
- **Chat input** for sending messages to running tasks (lines 706-745)
- **Success/error status colors** (lines 51-55)

### ✅ IPC Architecture
| Channel | Purpose |
|---------|---------|
| `TERMINAL_OUTPUT` | Raw terminal output |
| `TERMINAL_STRUCTURED_OUTPUT` | Parsed StructuredBlock objects |
| `TASK_STEP_COMPLETE` | Ralph step promise detected |
| `TASK_RALPH_COMPLETE` | Task completion promise detected |

---

## Missing Features (Gaps vs Claude Code)

### HIGH Priority - Tool Rendering Gaps

#### GAP-1: Line Numbers on Diff Views

**Current:** Simple stacked diff with +/- prefixes
**Target:** Line numbers on each line (like Claude Code screenshot)

```
Current:                          Target:
+ added line                      47 +   added line
- removed line                    48 -   removed line
  context line                    49 |   context line
```

**Files:**
- `TaskMonitorChat.tsx` lines 192-255 (Edit tool rendering)
- `DiffViewer.tsx` lines 1-104

**Implementation Requirements:**
1. Parse the `old_string` and `new_string` from Edit tool input
2. If available, extract starting line number from tool input or default to 1
3. Display format: `{lineNum} {indicator} {content}` where indicator is `+`, `-`, or `|`
4. Style line numbers with dim/muted color (e.g., `text-gray-500`)
5. Right-align line numbers for consistent column width

---

#### GAP-2: Expandable Long Outputs

**Current:** All output shown regardless of length
**Target:** Large outputs truncated with expandable option

```
Target display:
  L Read 1 file
    1  | import React from 'react';
    2  | import { useState } from 'react';
    3  | ...
    ... +47 lines (click to expand)
```

**File:** `TaskMonitorChat.tsx` - All tool result rendering sections

**Implementation Requirements:**
1. Add constant `MAX_VISIBLE_LINES = 20` (configurable)
2. For tool results with more than MAX_VISIBLE_LINES:
   - Show first 15 lines
   - Show "... +N lines (click to expand)" button
   - On click, show all lines
3. Track expanded state per block using block ID or index
4. Style the expand button as clickable link (blue, underline on hover)

---

#### GAP-3: Token/Time Tracking Display

**Current:** No token or time tracking visible
**Target:** Show elapsed time and token count

```
Target display at bottom of terminal:
* Working... (5m 32s · 8.2k tokens)
```

**File:** `TaskMonitorChat.tsx` - Add footer/status area

**Implementation Requirements:**
1. Track task start time in terminal store or component state
2. Display elapsed time in format: `Xh Xm Xs` or `Xm Xs` or `Xs`
3. If backend provides token count (via structured output), display it
4. Format tokens as: `8.2k` for 8200, `1.5M` for 1500000
5. Update every second while task is running
6. Position: subtle footer area below messages, above input

---

#### GAP-4: Status Bar with File Changes

**Current:** No status bar at bottom
**Target:** Status bar showing file modification summary

```
Target display:
┌─────────────────────────────────────────────────────────┐
│ >> 40 files  +897 -960                                  │
└─────────────────────────────────────────────────────────┘
```

**File:** `TaskMonitorChat.tsx` - Add fixed footer component

**Implementation Requirements:**
1. Track file modifications from Edit/Write tool results:
   - Count unique files modified
   - Sum lines added (from `new_string` length vs `old_string`)
   - Sum lines removed
2. Update counts in real-time as tool_result blocks arrive
3. Display format: `>> {fileCount} files  +{added} -{removed}`
4. Style: fixed position at bottom, dark background, monospace font
5. Colors: green for added count, red for removed count

---

### MEDIUM Priority - UX Gaps

#### GAP-5: Syntax Highlighting in Code Blocks

**Current:** Plain monospace text
**Target:** Language-aware syntax highlighting

**Files:**
- `TaskMonitorChat.tsx`
- `package.json` (add dependency)

**Implementation Requirements:**
1. Add syntax highlighting library (Prism.js recommended - already common in React)
2. Detect language from file extension in tool input (e.g., `.tsx` → TypeScript)
3. Apply highlighting to:
   - Read tool file content
   - Edit tool old_string/new_string
   - Bash tool output (shell syntax)
4. Fallback to plain text if language unknown

---

#### GAP-6: Copy Button on Code Blocks

**Current:** Only DiffViewer has copy button
**Target:** Copy button on all code output areas

**File:** `TaskMonitorChat.tsx` - Add to all code sections

**Implementation Requirements:**
1. Add copy button (clipboard icon) to top-right of each code block
2. On click: copy content to clipboard
3. Show feedback: button changes to checkmark for 2 seconds
4. Apply to: Read content, Edit diffs, Bash output, Grep results
5. Style: semi-transparent, appears on hover

---

#### GAP-7: Tool Result Visual Pairing

**Current:** Tool use and result shown as separate blocks
**Target:** Visual connection showing result belongs to tool call

**File:** `TaskMonitorChat.tsx` - Update block rendering logic

**Implementation Requirements:**
1. When rendering tool_result, indent it under the corresponding tool_use
2. Use visual connector (line or indentation) to show relationship
3. Match tool_use_id from result to tool's id
4. Consider collapsing tool+result into single expandable unit

---

#### GAP-8: Streaming Indicator

**Current:** No typing animation while waiting
**Target:** Animated indicator during agent work

**File:** `TaskMonitorChat.tsx` - Add loading state

**Implementation Requirements:**
1. Detect when agent is "thinking" (between messages)
2. Show animated indicator (e.g., pulsing dots, spinner)
3. Position at bottom of message list
4. Hide when new content arrives

---

#### GAP-9: Search in Message History

**Current:** No search capability
**Target:** Ctrl+F search within terminal

**File:** `TaskMonitorChat.tsx` - Add search component

**Implementation Requirements:**
1. Add keyboard shortcut Ctrl+F to open search bar
2. Search bar appears at top of terminal
3. Highlight matching text in messages (yellow background)
4. Show match count: "3 of 15 matches"
5. Up/Down arrows or Enter to navigate between matches
6. Escape to close search

---

#### GAP-10: Message Timestamps

**Current:** No timestamps on messages
**Target:** HH:MM timestamps for message groups

**File:** `TaskMonitorChat.tsx` - Add to message headers

**Implementation Requirements:**
1. Record timestamp when each message/block arrives
2. Display timestamp at start of message groups (not every line)
3. Format: `HH:MM` (24-hour) or locale-based
4. Style: dim/muted color, small font
5. Only show timestamp when >1 minute since last timestamp

---

#### GAP-11: Error Block Formatting

**Current:** Errors shown as plain red text
**Target:** Styled error blocks with context

**File:** `TaskMonitorChat.tsx` - Enhance error rendering

**Implementation Requirements:**
1. Error blocks get distinct styling: red border, light red background
2. Show error type/code if available
3. If error contains file path + line, make it clickable
4. Preserve stack traces with proper formatting

---

## Architecture Diagram (Current)

```
┌─────────────────────────────────────────────────────────────┐
│ Backend (Python) - Logs with markers                        │
│ __SDK_MSG__:{"type":"tool_use","name":"Read",...}           │
└────────────────────┬────────────────────────────────────────┘
                     │ stdout/stderr
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Main Process (Electron)                                     │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ AgentManager (event emitter)                             ││
│ │ - "log" event for each line                              ││
│ └────────────┬─────────────────────────────────────────────┘│
│              │                                              │
│ ┌────────────▼──────────────────────────────────────────────┐│
│ │ agent-events-handlers.ts                                  ││
│ │ - Creates SDKOutputParser per task                        ││
│ │ - Parses to StructuredBlock                               ││
│ │ - Emits TERMINAL_STRUCTURED_OUTPUT IPC                    ││
│ └────────────┬──────────────────────────────────────────────┘│
└──────────────┼──────────────────────────────────────────────┘
               │ IPC: TERMINAL_STRUCTURED_OUTPUT
               ▼
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React)                                            │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ TerminalStore (Zustand)                                  ││
│ │ - appendStructuredBlock(terminalId, block)               ││
│ └────────────┬─────────────────────────────────────────────┘│
│              │                                              │
│ ┌────────────▼──────────────────────────────────────────────┐│
│ │ TaskMonitorChat Component                                ││
│ │ - ContentBlockRenderer routes by type                    ││
│ │ - ToolBlock handles tool-specific formatting             ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## File Summary

| File | Lines | Purpose | Needs Changes |
|------|-------|---------|---------------|
| TaskMonitorChat.tsx | 752 | Rich chat UI renderer | YES - GAP 1-4, 6-11 |
| DiffViewer.tsx | 104 | Side-by-side diff viewer | YES - GAP 1 |
| claude-output-parser.ts | 581 | Streaming parser | Minor |
| sdk-output-parser.ts | 266 | SDK marker parser | No |
| terminal-store.ts | 200+ | Terminal state | Minor |
| structured-output.ts | 145 | Type definitions | No |

---

## Recommended Ralph Tasks

### Phase 7A: Terminal Core Improvements (HIGH)

| Task | Description | Files |
|------|-------------|-------|
| TERM-1 | Add line numbers to diff views | TaskMonitorChat.tsx, DiffViewer.tsx |
| TERM-2 | Add expandable/truncated long outputs | TaskMonitorChat.tsx |
| TERM-3 | Add token/time tracking display | TaskMonitorChat.tsx |
| TERM-4 | Add status bar with file changes | TaskMonitorChat.tsx |

### Phase 7B: Terminal UX Enhancements (MEDIUM)

| Task | Description | Files |
|------|-------------|-------|
| TERM-5 | Add syntax highlighting | TaskMonitorChat.tsx + new dependency |
| TERM-6 | Add copy buttons to all code blocks | TaskMonitorChat.tsx |
| TERM-7 | Add search in message history | TaskMonitorChat.tsx |
| TERM-8 | Add message timestamps | TaskMonitorChat.tsx |

---

## Verification Checklist

After implementation, verify:

- [ ] Diff views show line numbers (GAP-1)
- [ ] Long outputs truncated with expand option (GAP-2)
- [ ] Token/time tracking visible (GAP-3)
- [ ] Status bar shows file changes (GAP-4)
- [ ] Code blocks have syntax highlighting (GAP-5)
- [ ] Copy button on all code blocks (GAP-6)
- [ ] Search works in terminal (GAP-7)
- [ ] Timestamps on messages (GAP-8)

---

**Report Generated:** 2026-02-04
**Completion Promise:** `TERMINAL_GAP_ANALYSIS_COMPLETE`
