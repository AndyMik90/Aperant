# Ralph Prompt: TERM Phase 7 - Terminal UI Improvements

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** HIGH (Phase 7A) + MEDIUM (Phase 7B)

---

## Task Summary

Terminal UI improvements to match Claude Code output style. Based on gap analysis in `TERMINAL_UI_GAP_ANALYSIS.md`.

| # | Task | Priority | Description |
|---|------|----------|-------------|
| 1 | TERM-1 | HIGH | Line numbers on diff views |
| 2 | TERM-2 | HIGH | Expandable/truncated long outputs |
| 3 | TERM-3 | HIGH | Token/time tracking display |
| 4 | TERM-4 | HIGH | Status bar with file changes |
| 5 | TERM-5 | MEDIUM | Syntax highlighting |
| 6 | TERM-6 | MEDIUM | Copy buttons on code blocks |
| 7 | TERM-7 | MEDIUM | Search in message history |
| 8 | TERM-8 | MEDIUM | Message timestamps |

---

## Ralph Invocation Prompt (Phase 7A - HIGH Priority)

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer improving the terminal UI for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\reports\TERMINAL_UI_GAP_ANALYSIS.md (gap analysis)
- docs\architecture\TASK_UI_REFERENCE.md (target UI design)

Reference for target style:
- The terminal output should look like Claude Code CLI
- Tool calls as collapsible blocks with bullet points
- Diffs with line numbers
- Expandable long outputs

---

## TASKS (4 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | TERM-1: Add line numbers to diff views | TERM_1_DIFF_LINE_NUMBERS_COMPLETE |
| 2 | TERM-2: Add expandable/truncated long outputs | TERM_2_EXPANDABLE_OUTPUTS_COMPLETE |
| 3 | TERM-3: Add token/time tracking display | TERM_3_TOKEN_TRACKING_COMPLETE |
| 4 | TERM-4: Add status bar with file changes | TERM_4_STATUS_BAR_COMPLETE |

**FINAL:** <promise>TERM_PHASE_7A_COMPLETE</promise>

---

## TERM-1: Line Numbers on Diff Views

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx
Also: apps/frontend/src/renderer/components/terminal/DiffViewer.tsx

Current: Diffs show +/- prefix but no line numbers
Target: Each line shows line number like:
  47 +   <nav>
  48 +     <Link to='/'>Home</Link>
  49 -     <OldComponent />

Requirements:
- Parse line number from diff content or track position
- Display line number before +/- indicator
- Style line numbers in dim color

Then output: <promise>TERM_1_DIFF_LINE_NUMBERS_COMPLETE</promise>
Say: NEXT: TERM-2 and begin TERM-2

---

## TERM-2: Expandable/Truncated Long Outputs

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: All output shown regardless of length
Target: Outputs over N lines show truncated with '... +N lines (click to expand)'

Requirements:
- Add line limit constant (suggest 20 lines default)
- Truncate tool results over the limit
- Show clickable '... +N lines' to expand
- Track expanded state per block

Then output: <promise>TERM_2_EXPANDABLE_OUTPUTS_COMPLETE</promise>
Say: NEXT: TERM-3 and begin TERM-3

---

## TERM-3: Token/Time Tracking Display

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: No token or time tracking visible
Target: Show elapsed time and token count like: 'Zigzagging... (5m 32s - 8.2k tokens)'

Requirements:
- Track start time when task begins
- Display elapsed time in human format (Xm Xs)
- If token info available from backend, display it
- Show in a subtle footer/status area

Then output: <promise>TERM_3_TOKEN_TRACKING_COMPLETE</promise>
Say: NEXT: TERM-4 and begin TERM-4

---

## TERM-4: Status Bar with File Changes

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: No status bar at bottom
Target: Status bar like: '>> 40 files +897 -960'

Requirements:
- Track file modifications from Edit/Write tool results
- Count added/removed lines
- Display in fixed footer bar
- Update in real-time as tools complete

Then output: <promise>TERM_4_STATUS_BAR_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 4 promises were output
3. Output: <promise>TERM_PHASE_7A_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 4 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. NO SUMMARIES - progress summaries are NOT stopping points
4. Maintain existing functionality - don't break what works
5. The job is done ONLY when <promise>TERM_PHASE_7A_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>TERM_PHASE_7A_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "TERM_PHASE_7A_COMPLETE"
```

---

## Ralph Invocation Prompt (Phase 7B - MEDIUM Priority)

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer improving the terminal UI for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\reports\TERMINAL_UI_GAP_ANALYSIS.md (gap analysis)
- docs\architecture\TASK_UI_REFERENCE.md (target UI design)

---

## TASKS (4 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | TERM-5: Add syntax highlighting to code blocks | TERM_5_SYNTAX_HIGHLIGHT_COMPLETE |
| 2 | TERM-6: Add copy buttons to all code blocks | TERM_6_COPY_BUTTONS_COMPLETE |
| 3 | TERM-7: Add search in message history | TERM_7_SEARCH_COMPLETE |
| 4 | TERM-8: Add message timestamps | TERM_8_TIMESTAMPS_COMPLETE |

**FINAL:** <promise>TERM_PHASE_7B_COMPLETE</promise>

---

## TERM-5: Syntax Highlighting

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Requirements:
- Add syntax highlighting library (Prism.js or similar)
- Detect language from file extension or tool context
- Apply highlighting to code blocks in tool results

Then output: <promise>TERM_5_SYNTAX_HIGHLIGHT_COMPLETE</promise>
Say: NEXT: TERM-6 and begin TERM-6

---

## TERM-6: Copy Buttons on Code Blocks

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Requirements:
- Add copy-to-clipboard button on all code output areas
- Show success feedback on copy
- Position button in top-right of code block

Then output: <promise>TERM_6_COPY_BUTTONS_COMPLETE</promise>
Say: NEXT: TERM-7 and begin TERM-7

---

## TERM-7: Search in Message History

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Requirements:
- Add search input (Ctrl+F keyboard shortcut)
- Highlight matching text in messages
- Navigate between matches (up/down)

Then output: <promise>TERM_7_SEARCH_COMPLETE</promise>
Say: NEXT: TERM-8 and begin TERM-8

---

## TERM-8: Message Timestamps

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Requirements:
- Add timestamp to message groups
- Format as HH:MM (24h or 12h based on locale)
- Display subtly (dim color)

Then output: <promise>TERM_8_TIMESTAMPS_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 4 promises were output
3. Output: <promise>TERM_PHASE_7B_COMPLETE</promise>

---

HARD STOP RULE: You may NOT stop until <promise>TERM_PHASE_7B_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "TERM_PHASE_7B_COMPLETE"
```

---

## Expected Changes

### Phase 7A Files
| File | Change |
|------|--------|
| TaskMonitorChat.tsx | Line numbers, expandable outputs, token tracking, status bar |
| DiffViewer.tsx | Line numbers in diff display |

### Phase 7B Files
| File | Change |
|------|--------|
| TaskMonitorChat.tsx | Syntax highlighting, copy buttons, search, timestamps |
| package.json | May add syntax highlighting dependency |

---

## Verification After Run

### Phase 7A
1. Diffs show line numbers
2. Long outputs truncated with expand option
3. Token/time tracking visible
4. Status bar shows file changes

### Phase 7B
1. Code blocks have syntax highlighting
2. Copy button works on code blocks
3. Ctrl+F search works
4. Timestamps visible on messages

---

## Related Documents

- [TERMINAL_UI_GAP_ANALYSIS.md](../reports/TERMINAL_UI_GAP_ANALYSIS.md) - Full gap analysis
- [TASK_UI_REFERENCE.md](../architecture/TASK_UI_REFERENCE.md) - Target UI design

---

## Completion Promises

```
TERM_PHASE_7A_COMPLETE  (HIGH priority - 4 tasks)
TERM_PHASE_7B_COMPLETE  (MEDIUM priority - 4 tasks)
```
