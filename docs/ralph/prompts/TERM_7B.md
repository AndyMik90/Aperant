# Ralph Prompt: TERM-7B - Terminal UI Enhancements

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** MEDIUM
**Tasks:** 4

---

## Task Summary

Terminal UI enhancements (Phase 7B) - continuation of terminal improvements.

| # | Task | Description |
|---|------|-------------|
| 1 | TERM-5 | Syntax highlighting for code blocks |
| 2 | TERM-6 | Copy buttons on code blocks |
| 3 | TERM-7 | Search in message history |
| 4 | TERM-8 | Message timestamps |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer improving the terminal UI for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary Documentation (READ FOR CONTEXT):
- docs/reports/TERMINAL_UI_GAP_ANALYSIS.md - Gap analysis
- docs/architecture/TASK_UI_REFERENCE.md - Target UI design

Component Reference:
- TaskMonitorChat.tsx is the main terminal chat component
- TERM-7A already implemented: line numbers, expandable outputs, time tracking, status bar

---

## TASKS (4 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | TERM-5: Syntax highlighting | TERM_5_SYNTAX_HIGHLIGHT_COMPLETE |
| 2 | TERM-6: Copy buttons | TERM_6_COPY_BUTTONS_COMPLETE |
| 3 | TERM-7: Search in history | TERM_7_SEARCH_COMPLETE |
| 4 | TERM-8: Message timestamps | TERM_8_TIMESTAMPS_COMPLETE |

**FINAL:** <promise>TERM_PHASE_7B_COMPLETE</promise>

---

## TERM-5: Syntax Highlighting

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: Code blocks render as plain monospace text
Target: Code blocks have syntax-aware coloring

Requirements:
1. Check if highlight.js or Prism.js is already installed, if not add one
2. Detect language from:
   - File extension in Read/Edit tool (e.g., .tsx -> typescript)
   - Code fence language markers if present
3. Apply highlighting to:
   - Code blocks in tool results
   - Bash command inputs/outputs
   - Read tool file contents
4. Keep performance in mind - lazy load highlighter

Then output: <promise>TERM_5_SYNTAX_HIGHLIGHT_COMPLETE</promise>
Say: NEXT: TERM-6

---

## TERM-6: Copy Buttons on Code Blocks

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: No easy way to copy code from terminal output
Target: Each code block has a copy button

Requirements:
1. Add copy-to-clipboard button on:
   - Bash command inputs (the command itself)
   - Code block contents
   - Read tool outputs
   - File paths (separate small copy icon)
2. Position button in top-right corner of code block
3. Show visual feedback on copy:
   - Icon changes briefly (Check icon)
   - Or tooltip says 'Copied!'
4. Use navigator.clipboard.writeText()

Then output: <promise>TERM_6_COPY_BUTTONS_COMPLETE</promise>
Say: NEXT: TERM-7

---

## TERM-7: Search in Message History

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: No way to search through output
Target: Ctrl+F opens search, highlights matches

Requirements:
1. Add search bar that appears with Ctrl+F (or Cmd+F on Mac)
2. Search input at top of message area
3. Highlight matching text in messages (yellow background)
4. Show match count: '3 of 15 matches'
5. Navigation buttons (up/down arrows) to jump between matches
6. Escape key closes search
7. Search should work across:
   - Text content
   - Tool names
   - File paths
   - Command output

Then output: <promise>TERM_7_SEARCH_COMPLETE</promise>
Say: NEXT: TERM-8

---

## TERM-8: Message Timestamps

File: apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx

Current: No timestamps visible on messages
Target: Each message group shows when it occurred

Requirements:
1. Add timestamp to message groups (not every individual block)
2. Format options:
   - Relative: '2m ago', 'just now'
   - Or absolute: '14:32' (24h) or '2:32 PM' (12h based on locale)
3. Position: subtle, on the right side of message header
4. Color: dim/muted-foreground
5. Update relative timestamps periodically (if using relative)

Then output: <promise>TERM_8_TIMESTAMPS_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 4 promises were output
3. Output: <promise>TERM_PHASE_7B_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 4 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. Maintain existing functionality - don't break what TERM-7A implemented
4. Keep performance in mind (syntax highlighting can be heavy)
5. The job is done ONLY when <promise>TERM_PHASE_7B_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>TERM_PHASE_7B_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "TERM_PHASE_7B_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TaskMonitorChat.tsx` | Add syntax highlighting, copy buttons, search, timestamps |
| `package.json` | May add highlight.js or similar (if not present) |

---

## Verification After Run

1. Code blocks have syntax highlighting (colors for keywords, strings, etc.)
2. Copy buttons appear on code blocks
3. Ctrl+F opens search with match highlighting
4. Timestamps visible on messages
5. Build passes

---

## Completion Promise

```
TERM_PHASE_7B_COMPLETE
```
