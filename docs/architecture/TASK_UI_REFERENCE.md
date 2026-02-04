# Task UI Reference

**Created:** 2026-02-04
**Purpose:** Visual reference for task card and terminal UI

---

## Kanban Board Overview

```
+-----------------------------------------------------------------------------------+
|  Jerry - Auto-Claude                                                    [_][O][X] |
+-----------------------------------------------------------------------------------+
|  [+ New Task]  [Settings]                                      Project: my-app    |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  PLANNING          CODING           AI REVIEW        HUMAN REVIEW       DONE      |
|  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+|
|  |           |    |           |    |           |    |           |    |           ||
|  | Task Card |    | Task Card |    | Task Card |    | Task Card |    | Task Card ||
|  |           |    |    ^^^    |    |           |    |           |    |           ||
|  +-----------+    +-----------+    +-----------+    +-----------+    +-----------+|
|                   |           |                                                   |
|                   | Task Card |                                                   |
|                   |           |                                                   |
|                   +-----------+                                                   |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Task Card States

### Planning Task (Idle)

```
+---------------------------------------+
| [icon] Add user authentication    ... |
+---------------------------------------+
| Status: planning                      |
| Created: 2 hours ago                  |
|                                       |
| [Resume Planning]  [Start Build]      |
+---------------------------------------+
```

### Planning Task (Running)

```
+---------------------------------------+
| [icon] Add user authentication    ... |
+---------------------------------------+
| Status: planning  [RUNNING]           |
| Phase: Creating spec...               |
|                                       |
| [||||||||-------] 40%                 |
|                                       |
| [Stop]  [Terminal v]                  |
+---------------------------------------+
```

### Coding Task (Running)

```
+---------------------------------------+
| [icon] Add user authentication    ... |
+---------------------------------------+
| Status: coding  [RUNNING]             |
| Phase: Implementing step 3 of 7       |
|                                       |
| [|||||||||||||||-] 85%                |
|                                       |
| [Stop]  [Terminal v]                  |
+---------------------------------------+
```

### Human Review Task

```
+---------------------------------------+
| [icon] Add user authentication    ... |
+---------------------------------------+
| Status: human_review                  |
| Awaiting your review                  |
|                                       |
| [Approve]  [Reject with Feedback]     |
+---------------------------------------+
```

---

## Terminal Dropdown (Expanded)

When user clicks `[Terminal v]` button, the terminal panel expands below the card:

```
+---------------------------------------+
| [icon] Add user authentication    ... |
+---------------------------------------+
| Status: coding  [RUNNING]             |
| Phase: Implementing step 3 of 7       |
|                                       |
| [|||||||||||||||-] 85%                |
|                                       |
| [Stop]  [Terminal ^]                  |
+=======================================+
|                                       |
|  TERMINAL OUTPUT                      |
|  (Should look like Claude Code)       |
|                                       |
+---------------------------------------+
```

---

## Terminal Output Format (Target: Claude Code Style)

The terminal output should match Claude Code's format exactly:

```
+-----------------------------------------------------------------------+
| Terminal: Add user authentication                              [^][X] |
+-----------------------------------------------------------------------+
|                                                                       |
| * Read(apps/frontend/src/auth/login.tsx)                              |
|   L Read 1 file (ctrl+o to expand)                                    |
|                                                                       |
| * I can see the login component. Now I need to add the logout         |
|   button to the header. Let me update the Header component:           |
|                                                                       |
| * Update(apps/frontend/src/components/Header.tsx)                     |
|   L Added 12 lines, removed 2 lines                                   |
|      45 |   return (                                                  |
|      46 |     <header className="app-header">                         |
|      47 +       <nav>                                                 |
|      48 +         <Link to="/">Home</Link>                            |
|      49 +         {isAuthenticated && (                               |
|      50 +           <button onClick={handleLogout}>Logout</button>    |
|      51 +         )}                                                  |
|      52 +       </nav>                                                |
|      53 |     </header>                                               |
|                                                                       |
| * Now let me verify the build compiles. Let me run a quick            |
|   TypeScript check:                                                   |
|                                                                       |
| * Bash(cd "C:/Users/jamie.ballard/Documents/GitHub/Auto-Claude/       |
|        apps/frontend" && npm run build 2>&1 | head -100)              |
|   L > jerry-ui@2.7.5 build                                            |
|     > electron-vite build                                             |
|     ... +21 lines (ctrl+o to expand)                                  |
|   L (timeout 2m)                                                      |
|                                                                       |
| * Build succeeded. TASK 2 is complete.                                |
|                                                                       |
|   LIFECYCLE_2_RALPH_LOOP_COMPLETE                                     |
|                                                                       |
|   NEXT: Task 3 - AI Review Persistent Memory                          |
|                                                                       |
| * Zigzagging... (5m 32s - 8.2k tokens)                                |
|   L Tip: Use /agents to optimize specific tasks...                    |
|                                                                       |
| >                                                                     |
| >> bypass permissions on (shift+tab to cycle) - 40 files +897 -960    |
+-----------------------------------------------------------------------+
```

---

## Key UI Elements

### 1. Tool Call Blocks

Each tool call should be displayed as a collapsible block:

```
* Bash(cd C:\path\to\project && npm run build 2>&1 | head -100)
  L > jerry-ui@2.7.5 build
    > electron-vite build
    ... +21 lines (ctrl+o to expand)
  L (timeout 2m)
```

**Components:**
- `*` - Bullet indicator for tool call
- Tool name in bold/highlight: `Bash`, `Read`, `Update`, `Grep`, etc.
- Arguments in parentheses
- `L` - Result indicator (indented)
- Expandable summary: `... +N lines (ctrl+o to expand)`
- Status indicator: `(timeout 2m)`, `Error: Exit code 1`

### 2. Text Output (Agent Thoughts)

Plain text from the agent should be displayed as prose:

```
* I can see the login component. Now I need to add the logout
  button to the header. Let me update the Header component:
```

### 3. Code Diffs

File changes should show line-by-line diffs:

```
* Update(apps/frontend/src/components/Header.tsx)
  L Added 12 lines, removed 2 lines
     45 |   return (
     46 |     <header className="app-header">
     47 +       <nav>
     48 +         <Link to="/">Home</Link>
     49 +         {isAuthenticated && (
     50 +           <button onClick={handleLogout}>Logout</button>
     51 +         )}
     52 +       </nav>
     53 |     </header>
```

**Diff indicators:**
- `|` - Unchanged line (context)
- `+` - Added line (green highlight)
- `-` - Removed line (red highlight)

### 4. Promise Output

Ralph promises should be visually distinct:

```
LIFECYCLE_2_RALPH_LOOP_COMPLETE

NEXT: Task 3 - AI Review Persistent Memory
```

### 5. Status Bar

Bottom of terminal shows current state:

```
>> bypass permissions on (shift+tab to cycle) - 40 files +897 -960 - esc to interrupt
```

**Components:**
- Permission mode indicator
- File change summary: `N files +added -removed`
- Interrupt hint

### 6. Progress Indicator

When agent is thinking/working:

```
* Zigzagging... (5m 32s - 8.2k tokens)
  L Tip: Use /agents to optimize specific tasks...
```

---

## Color Scheme (Dark Theme)

| Element | Color |
|---------|-------|
| Background | `#1e1e1e` (dark gray) |
| Text | `#d4d4d4` (light gray) |
| Tool names | `#569cd6` (blue) |
| Added lines | `#4ec9b0` (green) |
| Removed lines | `#f14c4c` (red) |
| Line numbers | `#858585` (dim gray) |
| Promises | `#dcdcaa` (yellow) |
| Errors | `#f14c4c` (red) |
| Links | `#3794ff` (bright blue) |

---

## Current vs Target Comparison

### Current Implementation

The current `TaskMonitorChat.tsx` component displays:
- Raw stdout from Python process
- Some structured output parsing
- Basic tool use block rendering

### Target Implementation

Should match Claude Code exactly:
- Collapsible tool call blocks
- Proper diff highlighting with line numbers
- Token/time tracking
- Permission status bar
- Expandable long outputs
- Proper markdown rendering in text

---

## Implementation Files

| Component | File | Purpose |
|-----------|------|---------|
| Terminal Container | `TaskMonitorChat.tsx` | Main terminal wrapper |
| Output Parser | `sdk-output-parser.ts` | Parse Claude SDK output |
| Phase Parser | `phase-event-parser.ts` | Parse `__EXEC_PHASE__` markers |
| Structured Output | `TERMINAL_STRUCTURED_OUTPUT` IPC | Send parsed blocks to renderer |

---

## Phase 7 Tasks (Terminal Redesign)

| Task | Description |
|------|-------------|
| TERM-1 | Implement collapsible tool call blocks |
| TERM-2 | Add proper diff highlighting with line numbers |
| TERM-3 | Add token/time tracking display |
| TERM-4 | Implement expandable long outputs |

---

**Document Version:** 1.0
**Last Updated:** 2026-02-04
