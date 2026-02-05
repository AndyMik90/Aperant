# RAW View UI Reference

**Date:** 2026-02-05
**Source:** Claude Code terminal output

---

## Screenshots

Add screenshots to this folder:
- `raw-view-example-1.png` - Code diff with syntax highlighting
- `raw-view-example-2.png` - Summary table with checkmarks
- `raw-view-example-3.png` - Full session view

---

## Key UI Elements to Implement

### 1. Tool Call Labels
```
● Read(apps/backend/spec/phases/spec_phases.py)
● Update(apps/backend/spec/phases/planning_phases.py)
● Bash(cd "path" && command)
● Searched for 3 patterns (ctrl+o to expand)
```

### 2. Code Diffs
- Green background for additions (`+` lines)
- Red background for deletions (`-` lines)
- Line numbers on left side
- Syntax highlighting for code content
- File path header showing what was changed

### 3. Status Indicators
- `●` bullet points with color coding
- `✅` checkmarks for completed items
- `⚠️` warnings
- `L` for indented output lines

### 4. Collapsible Sections
- `(ctrl+o to expand)` hint text
- Collapsed by default for large outputs
- Expandable on click

### 5. Summary Tables
```
┌─────┬────────────────────────┬────────────┬─────────────────────┐
│  #  │         Task           │   Status   │       Details       │
├─────┼────────────────────────┼────────────┼─────────────────────┤
│ 1   │ Task name              │ ✅ Complete │ Description         │
└─────┴────────────────────────┴────────────┴─────────────────────┘
```

### 6. Typography
- Monospace font throughout
- ANSI color support
- Line wrapping for long content

### 7. Auto-scroll Behavior
- Auto-scroll to bottom when new content arrives
- Pause auto-scroll when user scrolls up
- Resume when user scrolls to bottom

---

## Color Scheme (from Claude Code)

| Element | Color |
|---------|-------|
| Added lines | Green background (#1a3d1a or similar) |
| Removed lines | Red background (#3d1a1a or similar) |
| Line numbers | Muted gray |
| File paths | Cyan/blue |
| Status bullets | White |
| Success checkmarks | Green |
| Warnings | Yellow |
| Errors | Red |

---

## Implementation Notes

1. Parse ANSI escape codes from agent output
2. Convert tool_start/tool_end events to labeled sections
3. Detect diff format and apply syntax highlighting
4. Track scroll position for auto-scroll logic
5. Add collapse/expand toggle for large outputs (>20 lines)
