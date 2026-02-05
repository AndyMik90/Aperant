# Fix: Terminal & Timeline Display Improvements

**Created:** 2026-02-04
**Priority:** High
**Status:** Pending

---

## Problems

### 1. Terminal Output Not Useful
The task terminal barely shows any useful information. It should display proper terminal text as it comes from Claude Code - full command output, file contents, error messages, etc.

**Current state:**
- Shows abbreviated tool calls like `[Tool: Read]`, `[Tool: Bash]`
- Doesn't show the actual content/output
- Missing context about what's happening

**Expected:**
- Show actual terminal output (stdout/stderr)
- Show file contents being read/written
- Show command outputs
- Proper syntax highlighting
- Similar to what you see in actual Claude Code terminal

### 2. Timeline View Not Useful
The timeline view displays information in a way that's not actionable or informative.

**Current state:**
- Just lists tool names with minimal context
- Single-line summaries that don't convey what happened
- Hard to understand the flow of execution

**Expected:**
- Expandable entries to see full details
- Clear indication of success/failure per step
- Show relevant snippets (file paths, commands run, errors)
- Visual hierarchy showing phases/steps
- Duration per operation
- Collapsible sections for long outputs

---

## Files to Investigate

### Terminal Components
- `src/renderer/components/terminal/StructuredOutput.tsx` - Timeline view
- `src/renderer/components/terminal/RawTerminal.tsx` - Raw output view
- `src/renderer/components/terminal/ToolUseCard.tsx` - Individual tool displays
- `src/renderer/components/terminal/types.ts` - Data structures

### Data Flow
- `src/main/agent/session.ts` - How terminal data is emitted
- `src/renderer/stores/terminal-store.ts` - How data is stored/processed
- Backend Python agents - What data they send

---

## Improvement Ideas

### Terminal Output
1. **Show full output by default** - Don't truncate unless very long
2. **Syntax highlighting** - For code, JSON, file contents
3. **Copyable content** - Easy copy buttons for commands/paths
4. **Collapsible sections** - For very long outputs
5. **Search within output** - Find text in terminal history

### Timeline View
1. **Expandable cards** - Click to see full details
2. **Better summaries** - "Read 3 files", "Wrote to src/App.tsx", "Ran npm install"
3. **Phase grouping** - Group related operations together
4. **Progress indicators** - Show which step is currently running
5. **Error highlighting** - Make failures obvious with red highlighting
6. **Duration badges** - Show how long each operation took

---

## Reference: Claude Code Terminal

Look at how Claude Code (the CLI) displays information:
- Full file contents when reading
- Complete command output when running bash
- Clear tool call boundaries
- Streaming output as it happens
- Proper formatting and colors

---

## Data Available (from backend)

The backend sends events like:
```python
# Tool use events
{
  "type": "tool_use",
  "tool": "Read",
  "input": {"file_path": "/path/to/file"},
  "output": "... file contents ..."
}

# Text output
{
  "type": "text",
  "content": "Planning to implement..."
}

# Phase changes
{
  "type": "phase",
  "phase": "REQUIREMENTS_GATHERING"
}
```

The frontend needs to render this data more completely.

---

## Suggested Approach

1. **Audit current data flow** - What data is available but not displayed?
2. **Update ToolUseCard** - Show full input/output, not just tool name
3. **Add expansion state** - Allow clicking to expand/collapse details
4. **Improve styling** - Better visual hierarchy, syntax highlighting
5. **Test with real tasks** - Ensure all tool types display properly

---

## Ralph Prompt (optional)

```
Improve the terminal and timeline display in the task panel. Currently it shows
minimal info like "[Tool: Read]" but should show actual content - file contents,
command output, etc. Make ToolUseCard expandable to show full input/output.
Add syntax highlighting for code. Make the timeline view useful by showing
what actually happened at each step, not just tool names.
```
