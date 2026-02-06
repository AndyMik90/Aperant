# FIX-25 to FIX-32: Bug Fixes & UX Improvements

**Created:** 2026-02-04
**Status:** ALL COMPLETE (2026-02-04, 17m 9s)
**Priority:** P1

---

## Overview

This document specifies 10 fixes discovered during v3.3 testing:
- **FIX-25-27**: Task/project deletion persistence bugs
- **FIX-28**: Duplicate UI element
- **FIX-29a-c**: Terminal UX improvements (hybrid inline + bottom panel)
- **FIX-30-32**: Icon consolidation and UI cleanup

---

## Bug Fixes

### FIX-25: Project Removal - Two Options

**Problem:** When a project is deleted, its `.auto-claude/specs/` directory is NOT deleted. When the project is re-added, all old tasks reappear. Sometimes you want to keep the data, sometimes you want a clean slate.

**Solution:** Provide TWO options when removing a project:

1. **"Remove from Jerry"** - Just removes from project list, keeps `.auto-claude/specs/` intact
2. **"Delete All Data"** - Full cleanup, removes `.auto-claude/` folder too

**UI Design:**
```
┌─────────────────────────────────────────┐
│  Remove Project?                        │
│                                         │
│  ○ Remove from Jerry                    │
│    (Keep task data for later)           │
│                                         │
│  ○ Delete All Data                      │
│    (Remove .auto-claude/ folder)        │
│                                         │
│           [Cancel]  [Confirm]           │
└─────────────────────────────────────────┘
```

**Implementation:**
```typescript
// In project-store.ts
async removeProject(projectId: string, deleteData: boolean = false) {
  const project = this.getProject(projectId);
  if (project && deleteData) {
    // Delete .auto-claude directory if requested
    const autoClaudeDir = path.join(project.path, '.auto-claude');
    if (existsSync(autoClaudeDir)) {
      await fs.rm(autoClaudeDir, { recursive: true, force: true });
    }
  }
  // Remove from projects.json
  this.projects = this.projects.filter(p => p.id !== projectId);
  await this.save();
}
```

**Files to Modify:**
- `apps/frontend/src/main/project-store.ts` - Add `deleteData` parameter
- `apps/frontend/src/renderer/components/ProjectSettings.tsx` or wherever removal is triggered - Add dialog with options

---

### FIX-26: Clear Task Cache When Project Is Removed

**Problem:** Task cache (3-second TTL) can serve stale tasks after project deletion.

**Root Cause:** `task-store.ts` caches tasks but doesn't invalidate on project removal.

**Fix:**
```typescript
// In task-store.ts or wherever cache is managed
function onProjectRemoved(projectId: string) {
  // Clear cached tasks for this project
  taskCache.delete(projectId);
  // Or invalidate entire cache
  taskCache.clear();
}
```

**Files to Modify:**
- `apps/frontend/src/renderer/stores/task-store.ts`
- `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts`

---

### FIX-27: Delete Tasks From ALL Locations (Main + Worktrees)

**Problem:** Task deletion only removes from one location. If task exists in main project AND worktrees, it persists.

**Root Cause:** `crud-handlers.ts:deleteTask()` only deletes from single path.

**Fix:**
```typescript
// In crud-handlers.ts deleteTask handler
async function deleteTask(taskId: string, projectId: string) {
  const project = getProject(projectId);

  // Delete from main project
  const mainSpecPath = path.join(project.path, '.auto-claude', 'specs', taskId);
  if (existsSync(mainSpecPath)) {
    await fs.rm(mainSpecPath, { recursive: true });
  }

  // NEW: Also delete from all worktrees
  const worktrees = await getWorktrees(project.path);
  for (const worktree of worktrees) {
    const worktreeSpecPath = path.join(worktree.path, '.auto-claude', 'specs', taskId);
    if (existsSync(worktreeSpecPath)) {
      await fs.rm(worktreeSpecPath, { recursive: true });
    }
  }
}
```

**Files to Modify:**
- `apps/frontend/src/main/ipc-handlers/task/crud-handlers.ts`

---

### FIX-28: Remove Duplicate '+' Button from Planning Column

**Problem:** There are TWO "+" buttons to create tasks:
1. In the sidebar (correct - keep this)
2. In the Planning column header (duplicate - remove this)

**Fix:** Remove the "+" button from the Planning column header in KanbanBoard.tsx.

**Files to Modify:**
- `apps/frontend/src/renderer/components/KanbanBoard.tsx`

---

## Terminal UX Improvements (FIX-29a-c)

### Design: Hybrid Inline + Bottom Panel

```
┌─────────────────────────────────────────────────────────────┐
│  Kanban Board                                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │ Planning  │ │ Coding    │ │ Review    │ │ Done      │   │
│  ├───────────┤ ├───────────┤ ├───────────┤ ├───────────┤   │
│  │ ┌───────┐ │ │           │ │           │ │           │   │
│  │ │Task 1 │ │ │           │ │           │ │           │   │
│  │ │ ● ●●● │ │ │  ← Compact preview (3 lines) with dots   │   │
│  │ │[Pop▲] │ │ │  ← "Pop out" button                      │   │
│  │ └───────┘ │ │           │ │           │ │           │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
├─────────────────────────────────────────────────────────────┤
│ ▼ Terminal: Task 1                              [−][□][×]  │  ← Bottom panel (resizable)
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ > Planning started...                                   │ │
│ │ > Reading src/components/App.tsx                        │ │
│ │ > [Tool: Grep] pattern: "useState"                      │ │
│ │ > Analyzing 15 files...                                 │ │
│ │ ─────────────────────────────────────────────────────── │ │
│ │ [Type a message to chat with the agent...]         [⏎] │ │  ← Chat input
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### FIX-29a: Compact Inline Preview

**What:** Show 3-4 lines of terminal output inline in the task card with auto-scroll.

**Implementation:**
```typescript
// In TaskCard.tsx - compact terminal preview
const PREVIEW_LINES = 4;

<div className="terminal-preview h-20 overflow-hidden">
  {terminalLines.slice(-PREVIEW_LINES).map(line => (
    <div key={line.id} className="text-xs text-muted-foreground truncate">
      {line.content}
    </div>
  ))}
</div>
```

**Files to Modify:**
- `apps/frontend/src/renderer/components/TaskCard.tsx`

---

### FIX-29b: Pop Out Button

**What:** Add a "Pop out" button that opens the bottom panel terminal.

**Implementation:**
```typescript
// In TaskCard.tsx
<Button
  size="sm"
  variant="ghost"
  onClick={() => openBottomPanelTerminal(task.id)}
  title="Open in bottom panel"
>
  <ChevronUp className="h-4 w-4" />
  Pop out
</Button>
```

**Files to Modify:**
- `apps/frontend/src/renderer/components/TaskCard.tsx`

---

### FIX-29c: Bottom Panel Terminal

**What:** VS Code-style bottom panel with:
- Full terminal output
- Resizable height (drag handle)
- Chat input to send messages to agent
- Minimize/maximize/close controls

**Implementation:**

1. **Create BottomPanelTerminal.tsx**
```typescript
interface BottomPanelTerminalProps {
  taskId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
}

export function BottomPanelTerminal({ taskId, isOpen, onClose, onMinimize }: Props) {
  const [height, setHeight] = useState(300);
  const [chatInput, setChatInput] = useState('');

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-background border-t"
      style={{ height: isOpen ? height : 0 }}
    >
      {/* Drag handle for resizing */}
      <div className="h-1 cursor-ns-resize bg-border" onMouseDown={startResize} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span>Terminal: {taskTitle}</span>
        <div className="flex gap-2">
          <Button size="icon" onClick={onMinimize}><Minus /></Button>
          <Button size="icon" onClick={toggleMaximize}><Square /></Button>
          <Button size="icon" onClick={onClose}><X /></Button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-auto p-4">
        <TaskMonitorChat taskId={taskId} />
      </div>

      {/* Chat input */}
      <div className="p-2 border-t">
        <input
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message to chat with the agent..."
          className="w-full px-3 py-2 rounded border"
        />
      </div>
    </div>
  );
}
```

2. **Add to KanbanBoard.tsx layout**
```typescript
// State for bottom panel
const [bottomPanelTaskId, setBottomPanelTaskId] = useState<string | null>(null);
const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);

// In render
<div className="flex flex-col h-full">
  <div className="flex-1 overflow-auto">
    {/* Kanban columns */}
  </div>

  <BottomPanelTerminal
    taskId={bottomPanelTaskId}
    isOpen={isBottomPanelOpen}
    onClose={() => setIsBottomPanelOpen(false)}
    onMinimize={() => setIsBottomPanelOpen(false)}
  />
</div>
```

**Files to Create:**
- `apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx`

**Files to Modify:**
- `apps/frontend/src/renderer/components/KanbanBoard.tsx`
- `apps/frontend/src/renderer/components/TaskCard.tsx`

---

## UI Cleanup (FIX-30-32)

### FIX-30: Consolidate Chat Icons

**Problem:** Multiple different icons used for chat-related features:
- Sparkle/wand icon (sidebar Chat item, chat panel header)
- Chat bubble icon (chat history items)

**Solution:** Use single **chat bubble icon** (`MessageSquare` from lucide-react) for:
- Sidebar "Chat" navigation item
- Chat panel header (next to "Chat" title)

**IMPORTANT - DO NOT CHANGE:**
- Jerry avatar icon (keep as is)
- Sparkles icons in Insights.tsx (these are for "Suggested Task" cards and AI features, NOT chat)
- Any sparkles used for AI/suggestion features elsewhere

**Only change:** The navigation/header icons that represent the "Chat" feature itself.

**Files to Modify:**
- `apps/frontend/src/renderer/components/Sidebar.tsx` - Change Chat nav icon to MessageSquare
- `apps/frontend/src/renderer/components/Insights.tsx` - Change ONLY the header icon next to "Chat" title (NOT the Suggested Task sparkles)

---

### FIX-31: Remove Icons from Terminal Buttons

**Problem:** "New Terminal" and "New Claude Code" buttons have icons that look cluttered.

**Solution:** Remove the icons, keep text only for cleaner look.

**Before:** `[+ New Terminal]` `[✨ New Claude Code]`
**After:** `[New Terminal]` `[New Claude Code]`

**Files to Modify:**
- `apps/frontend/src/renderer/components/terminal/TerminalGrid.tsx` or wherever these buttons are

---

### FIX-32: Add "New Claude Code" to Empty State

**Problem:** Agent Terminals empty state only shows "New Terminal" button. Should also have "New Claude Code" option.

**Solution:** Add "New Claude Code" button to the center empty state area.

**Target UI:**
```
┌─────────────────────────────────────────┐
│                                         │
│              [Grid Icon]                │
│           Agent Terminals               │
│  Spawn multiple terminals to run        │
│  Claude agents in parallel.             │
│                                         │
│  [New Terminal]  [New Claude Code]      │
│                                         │
└─────────────────────────────────────────┘
```

**Files to Modify:**
- `apps/frontend/src/renderer/components/terminal/TerminalGrid.tsx`

---

## Implementation Order

| Order | Task | Dependency | Complexity |
|-------|------|------------|------------|
| 1 | FIX-28 | None | Low |
| 2 | FIX-30 | None | Low |
| 3 | FIX-31 | None | Low |
| 4 | FIX-32 | FIX-31 | Low |
| 5 | FIX-25 | None | Medium |
| 6 | FIX-26 | FIX-25 | Low |
| 7 | FIX-27 | FIX-25 | Medium |
| 8 | FIX-29a | None | Medium |
| 9 | FIX-29b | FIX-29a | Low |
| 10 | FIX-29c | FIX-29b | High |

---

## Success Criteria

- [x] Project removal shows dialog with two options (Remove/Delete All) ✅
- [x] "Delete All Data" removes `.auto-claude/` directory ✅
- [x] Task cache cleared on project removal ✅
- [x] Task deletion removes from all worktrees ✅
- [x] Only one "+" button for creating tasks (in sidebar) ✅
- [x] Chat icons consolidated to chat bubble ✅
- [x] Terminal buttons have no icons (text only) ✅
- [x] "New Claude Code" button in empty state ✅
- [x] Task card shows compact terminal preview (3-4 lines) ✅
- [x] "Pop out" button opens bottom panel terminal ✅
- [x] Bottom panel is resizable with drag handle ✅
- [x] Bottom panel has chat input ✅
- [x] Build passes: `npm run build` ✅

**Status:** ALL COMPLETE (2026-02-04, 17m 9s)

---

**Document Version:** 1.2
