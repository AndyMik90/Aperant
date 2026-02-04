# Ralph Prompt: FIX-21 to FIX-23 - Kanban UI Improvements

**Created:** 2026-02-04
**Updated:** 2026-02-04 (clarified FIX-21 implementation)
**Status:** Ready for execution
**Priority:** HIGH

---

## Task Summary

| # | Task | Description |
|---|------|-------------|
| 1 | FIX-21 | Task terminal expands inline within card (not modal) |
| 2 | FIX-22 | Add animated activity indicator when task is running |
| 3 | FIX-23 | Persist Kanban column collapse state across navigation |

---

## Problem 1: Task Terminal Opens as Modal (FIX-21)

Currently when clicking the terminal button on a task card:
- A modal dialog (`TaskTerminalModal`) opens as an overlay
- This covers the entire screen
- User loses context of where they are in the Kanban

**User wants:**
- Terminal should expand INLINE within the task card
- Card grows taller and pushes other cards down
- NOT a floating modal overlay
- Includes the chat input box to send messages to the agent

---

## Problem 2: No Activity Indicator (FIX-22)

Currently when a task is actively running (Planning, Coding):
- Shows static "Planning" badge
- Shows "9m ago" timestamp
- NO indication that the agent is actively working

**User wants:**
- Animated indicator showing the task is actively running
- Something like "Planning..." with animated dots or spinner
- Visual feedback that work is happening

---

## Problem 3: Column Collapse State Not Persisted (FIX-23)

Currently when user collapses Kanban columns:
- Navigate to another page
- Come back to Kanban
- Columns are all uncollapsed again

**User wants:**
- Column collapse state persists across navigation
- When returning to Kanban, columns stay collapsed/expanded as user left them

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer fixing Kanban UI issues for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

---

## TASKS (3 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-21: Task terminal expands inline, not as modal | FIX_21_INLINE_TERMINAL_COMPLETE |
| 2 | FIX-22: Add animated activity indicator | FIX_22_ACTIVITY_INDICATOR_COMPLETE |
| 3 | FIX-23: Persist column collapse state | FIX_23_PERSIST_COLLAPSE_COMPLETE |

**FINAL:** <promise>FIX_21_23_KANBAN_UI_COMPLETE</promise>

---

## FIX-21: Task Terminal Inline Expansion

### Key Files
- apps/frontend/src/renderer/components/TaskCard.tsx (MODIFY)
- apps/frontend/src/renderer/components/TaskTerminalModal.tsx (REFERENCE - copy logic from here)
- apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx (USE - this is the chat component)

### Current Architecture
TaskTerminalModal wraps TaskMonitorChat in a Dialog. TaskMonitorChat already has:
- The full chat UI with messages
- The chat input box (shows when isActive={true})
- Send message functionality

### Implementation Steps

**Step 1: Read existing files**
Read TaskCard.tsx, TaskTerminalModal.tsx, and TaskMonitorChat.tsx to understand the current implementation.

**Step 2: Update TaskCard.tsx state**
Replace modal state with expansion state:
```tsx
// BEFORE:
const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);

// AFTER:
const [isTerminalExpanded, setIsTerminalExpanded] = useState(false);
```

**Step 3: Add terminal management to TaskCard**
Copy the terminal creation logic from TaskTerminalModal (lines 47-76) into TaskCard:
```tsx
// Add these imports
import { TaskMonitorChat } from './terminal/TaskMonitorChat';
import { useTerminalStore } from '../stores/terminal-store';

// Inside TaskCard component:
const terminals = useTerminalStore((state) => state.terminals);
const setActiveTerminal = useTerminalStore((state) => state.setActiveTerminal);
const terminalRef = useRef<HTMLDivElement>(null);

// Get terminal for this task
const expectedTerminalId = `task-${task.id}`;
const terminal = terminals.find(t => t.id === expectedTerminalId);

// Create terminal when expanded (copy from TaskTerminalModal)
useEffect(() => {
  if (!isTerminalExpanded || !task || !projectPath) return;

  const createTerminalIfNeeded = async () => {
    const terminalExists = terminals.some(t => t.id === expectedTerminalId);

    if (!terminalExists && (task.status === 'planning' || task.status === 'coding' || task.status === 'ai_review' || task.status === 'human_review')) {
      try {
        await window.electronAPI.createTerminal({
          id: expectedTerminalId,
          cwd: projectPath,
          projectPath,
          isTaskMonitor: true,
          taskId: task.id,
          specId: task.specId,
          taskTitle: task.title
        });
      } catch (error) {
        console.error('[TaskCard] Error creating task terminal:', error);
      }
    }
  };

  createTerminalIfNeeded();
}, [isTerminalExpanded, task, projectPath, expectedTerminalId, terminals]);
```

**Step 4: Update terminal button handler**
```tsx
const handleToggleTerminal = (e: React.MouseEvent) => {
  e.stopPropagation();
  setIsTerminalExpanded(!isTerminalExpanded);
};
```

**Step 5: Add inline terminal UI after CardContent, inside the Card**
```tsx
{/* Inline terminal expansion - FIX-21 */}
{isTerminalExpanded && (
  <div className=\"border-t border-border\">
    {/* Header with controls */}
    <div className=\"flex items-center justify-between px-3 py-2 bg-muted/30\">
      <span className=\"text-xs font-medium text-muted-foreground\">Agent Terminal</span>
      <div className=\"flex items-center gap-1\">
        <Button
          variant=\"ghost\"
          size=\"icon\"
          className=\"h-6 w-6\"
          onClick={handleOpenInTerminals}
          title=\"Open in Terminals page\"
        >
          <ExternalLink className=\"h-3 w-3\" />
        </Button>
        <Button
          variant=\"ghost\"
          size=\"icon\"
          className=\"h-6 w-6\"
          onClick={(e) => { e.stopPropagation(); setIsTerminalExpanded(false); }}
          title=\"Collapse\"
        >
          <Minimize2 className=\"h-3 w-3\" />
        </Button>
      </div>
    </div>

    {/* Terminal content */}
    <div className=\"h-[350px] overflow-hidden\">
      {terminal ? (
        <TaskMonitorChat
          terminal={terminal}
          terminalRef={terminalRef}
          isActive={true}
          isMinimized={false}
        />
      ) : (
        <div className=\"flex flex-col items-center justify-center h-full text-center p-4\">
          <div className=\"w-6 h-6 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mb-3\" />
          <p className=\"text-muted-foreground text-xs\">Waiting for task output...</p>
        </div>
      )}
    </div>
  </div>
)}
```

**Step 6: Add handleOpenInTerminals function**
```tsx
const { setActiveView } = useNavigation();

const handleOpenInTerminals = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  setIsTerminalExpanded(false);
  setActiveView('terminals');
  if (terminal) {
    setTimeout(() => {
      setActiveTerminal(terminal.id);
    }, 100);
  }
}, [setActiveView, setActiveTerminal, terminal]);
```

**Step 7: Add missing imports**
```tsx
import { Minimize2, ExternalLink } from 'lucide-react';
import { useNavigation } from '../contexts/NavigationContext';
```

**Step 8: Remove TaskTerminalModal usage**
Remove or comment out the TaskTerminalModal at the end of the Card:
```tsx
// REMOVE THIS:
<TaskTerminalModal
  task={task}
  open={isTerminalModalOpen}
  onOpenChange={setIsTerminalModalOpen}
  projectPath={selectedProject?.path}
/>
```

Then output: <promise>FIX_21_INLINE_TERMINAL_COMPLETE</promise>
Say: NEXT: FIX-22 and begin FIX-22

---

## FIX-22: Animated Activity Indicator

File: apps/frontend/src/renderer/components/TaskCard.tsx

Current: Static 'Planning' badge when task is running.
Target: Animated indicator showing active work.

### Implementation

**Step 1: Determine if agent is running**
Add logic to detect if the agent is actively working:
```tsx
// Add near top of component after getting task data
const isAgentRunning = (task.status === 'planning' || task.status === 'coding') &&
  (task.executionProgress?.phase !== 'idle' || terminal);
```

**Step 2: Add animated indicator**
Find where the status badge is rendered and add an animated indicator:
```tsx
// Look for the status badge area and add:
{isAgentRunning && (
  <div className=\"flex items-center gap-1.5 text-xs text-[var(--glow-cyan)]\">
    <Loader2 className=\"h-3 w-3 animate-spin\" />
    <span>Working</span>
  </div>
)}
```

**Step 3: Or add pulse to existing status badge**
```tsx
<Badge className={cn(
  getStatusColor(task.status),
  isAgentRunning && \"animate-pulse\"
)}>
  {task.status}
</Badge>
```

**Step 4: Import Loader2 if needed**
```tsx
import { Loader2 } from 'lucide-react';
```

Then output: <promise>FIX_22_ACTIVITY_INDICATOR_COMPLETE</promise>
Say: NEXT: FIX-23 and begin FIX-23

---

## FIX-23: Persist Column Collapse State

### Key Files
- apps/frontend/src/renderer/components/KanbanBoard.tsx (or KanbanColumn.tsx)
- apps/frontend/src/renderer/stores/ (may need new store or add to existing)

Current: Column collapse state is local component state, lost on navigation.
Target: Column collapse state persists across navigation.

### Implementation (Zustand with persist)

**Step 1: Create kanban-store.ts**
Create new file: apps/frontend/src/renderer/stores/kanban-store.ts
```tsx
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KanbanState {
  collapsedColumns: Record<string, boolean>;
  toggleColumnCollapse: (columnId: string) => void;
  setColumnCollapsed: (columnId: string, collapsed: boolean) => void;
}

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set) => ({
      collapsedColumns: {},
      toggleColumnCollapse: (columnId) =>
        set((state) => ({
          collapsedColumns: {
            ...state.collapsedColumns,
            [columnId]: !state.collapsedColumns[columnId]
          }
        })),
      setColumnCollapsed: (columnId, collapsed) =>
        set((state) => ({
          collapsedColumns: {
            ...state.collapsedColumns,
            [columnId]: collapsed
          }
        }))
    }),
    {
      name: 'kanban-storage'  // localStorage key
    }
  )
);
```

**Step 2: Update KanbanBoard.tsx or KanbanColumn.tsx**
Replace local useState with store:
```tsx
import { useKanbanStore } from '../stores/kanban-store';

// In component:
const collapsedColumns = useKanbanStore((state) => state.collapsedColumns);
const toggleColumnCollapse = useKanbanStore((state) => state.toggleColumnCollapse);

// Replace local isCollapsed state:
const isCollapsed = collapsedColumns[columnId] ?? false;

// On toggle click:
onClick={() => toggleColumnCollapse(columnId)}
```

**Step 3: Remove any local useState for column collapse**
Find and remove:
```tsx
// REMOVE lines like:
const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
```

Then output: <promise>FIX_23_PERSIST_COLLAPSE_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 3 promises were output
3. Output: <promise>FIX_21_23_KANBAN_UI_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 3 fixes are REQUIRED - no skipping
2. After each fix, immediately continue to next
3. DO NOT delete TaskTerminalModal.tsx file (keep for potential other uses)
4. Ensure animations are CSS-based (not JavaScript intervals)
5. The inline terminal MUST include the chat input (isActive={true})
6. The job is done ONLY when <promise>FIX_21_23_KANBAN_UI_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_21_23_KANBAN_UI_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 3 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "FIX_21_23_KANBAN_UI_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TaskCard.tsx` | Replace modal with inline terminal expansion |
| `TaskCard.tsx` | Add animated activity indicator |
| `KanbanBoard.tsx` or `KanbanColumn.tsx` | Use persisted collapse state |
| `kanban-store.ts` (NEW) | Add collapsedColumns state with persist |

---

## Verification After Run

1. Terminal button expands card inline (not modal popup)
2. Chat input box visible in expanded terminal
3. Animated indicator shows when task is actively running
4. Collapse a column -> navigate away -> come back -> column still collapsed
5. Build passes

---

## Completion Promise

```
FIX_21_23_KANBAN_UI_COMPLETE
```
