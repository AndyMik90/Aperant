# Ralph Prompt: FIX-20 to FIX-23 + Settings - Combined UI Batch

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** HIGH
**Tasks:** 7 total

---

## Task Summary

| # | Task | Description |
|---|------|-------------|
| 1 | FIX-20 | Terminal header always visible (even with 0 terminals) |
| 2 | FIX-21 | Task terminal expands inline within card (not modal) |
| 3 | FIX-22 | Add animated activity indicator when task is running |
| 4 | FIX-23 | Persist Kanban column collapse state across navigation |
| 5 | SETTINGS-1 | Remove agentFramework dropdown (only 1 option) |
| 6 | SETTINGS-2 | Merge appearance + display sections |
| 7 | SETTINGS-3 | Move paths display to debug section |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer fixing UI issues for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary Documentation (READ THESE FOR CONTEXT):
- docs/reports/SETTINGS_AUDIT_REPORT.md - Why settings changes are needed
- docs/architecture/TASK_DURATION_TRACKING.md - Task card architecture
- docs/architecture/KANBAN_INLINE_TERMINAL.md - Inline terminal design (if exists)

Component Reference:
- TaskMonitorChat already has chat input (isActive={true} enables it)
- TaskTerminalModal shows how terminal is currently used (reference for FIX-21)
- Zustand stores use persist middleware for localStorage (reference for FIX-23)

---

## TASKS (7 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-20: Terminal header always visible | FIX_20_TERMINAL_HEADER_COMPLETE |
| 2 | FIX-21: Task terminal expands inline | FIX_21_INLINE_TERMINAL_COMPLETE |
| 3 | FIX-22: Animated activity indicator | FIX_22_ACTIVITY_INDICATOR_COMPLETE |
| 4 | FIX-23: Persist column collapse state | FIX_23_PERSIST_COLLAPSE_COMPLETE |
| 5 | SETTINGS-1: Remove agentFramework dropdown | SETTINGS_1_COMPLETE |
| 6 | SETTINGS-2: Merge appearance + display | SETTINGS_2_COMPLETE |
| 7 | SETTINGS-3: Move paths to debug | SETTINGS_3_COMPLETE |

**FINAL:** <promise>FIX_20_23_SETTINGS_COMPLETE</promise>

---

## FIX-20: Terminal Header Always Visible

File: apps/frontend/src/renderer/components/TerminalGrid.tsx

Problem: When terminals.length === 0, the toolbar header is NOT rendered. Only the empty state is shown.

Current behavior:
- 0 terminals: Shows centered empty state with 'New Terminal' button only
- 1+ terminals: Shows toolbar header with 'New Terminal', 'New Claude Code', 'Files' buttons

Target behavior:
- ALWAYS show the toolbar header (regardless of terminal count)
- When 0 terminals, show empty state content BELOW the header

Fix approach:
1. Find the early return for empty state (around lines 354-375)
2. Extract the toolbar header to render BEFORE the if (terminals.length === 0) check
3. Wrap both the empty state and the terminal grid in a common container

Structure should be:
```tsx
return (
  <div className=\"flex h-full flex-col\">
    {/* Toolbar - ALWAYS visible */}
    <div className=\"flex h-10 items-center...\">
      {/* ... toolbar content with New Terminal, New Claude Code, Files buttons ... */}
    </div>

    {/* Content area */}
    {terminals.length === 0 ? (
      {/* Empty state - centered */}
    ) : (
      {/* DndContext with terminal grid */}
    )}
  </div>
);
```

Then output: <promise>FIX_20_TERMINAL_HEADER_COMPLETE</promise>
Say: NEXT: FIX-21

---

## FIX-21: Task Terminal Inline Expansion

### Key Files
- apps/frontend/src/renderer/components/TaskCard.tsx (MODIFY)
- apps/frontend/src/renderer/components/TaskTerminalModal.tsx (REFERENCE - copy logic)
- apps/frontend/src/renderer/components/terminal/TaskMonitorChat.tsx (USE - chat component)

### Current Architecture
TaskTerminalModal wraps TaskMonitorChat in a Dialog. TaskMonitorChat already has:
- The full chat UI with messages
- The chat input box (shows when isActive={true})
- Send message functionality

### Implementation Steps

**Step 1: Update TaskCard.tsx state**
Replace modal state with expansion state:
```tsx
// BEFORE:
const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);

// AFTER:
const [isTerminalExpanded, setIsTerminalExpanded] = useState(false);
```

**Step 2: Add terminal management to TaskCard**
Add imports and terminal logic:
```tsx
import { TaskMonitorChat } from './terminal/TaskMonitorChat';
import { useTerminalStore } from '../stores/terminal-store';
import { Minimize2, ExternalLink } from 'lucide-react';
import { useNavigation } from '../contexts/NavigationContext';

// Inside component:
const terminals = useTerminalStore((state) => state.terminals);
const setActiveTerminal = useTerminalStore((state) => state.setActiveTerminal);
const { setActiveView } = useNavigation();
const terminalRef = useRef<HTMLDivElement>(null);

const expectedTerminalId = \`task-\${task.id}\`;
const terminal = terminals.find(t => t.id === expectedTerminalId);

// Create terminal when expanded
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

**Step 3: Add handlers**
```tsx
const handleToggleTerminal = (e: React.MouseEvent) => {
  e.stopPropagation();
  setIsTerminalExpanded(!isTerminalExpanded);
};

const handleOpenInTerminals = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  setIsTerminalExpanded(false);
  setActiveView('terminals');
  if (terminal) {
    setTimeout(() => setActiveTerminal(terminal.id), 100);
  }
}, [setActiveView, setActiveTerminal, terminal]);
```

**Step 4: Add inline terminal UI after CardContent, inside the Card**
```tsx
{/* Inline terminal expansion - FIX-21 */}
{isTerminalExpanded && (
  <div className=\"border-t border-border\">
    <div className=\"flex items-center justify-between px-3 py-2 bg-muted/30\">
      <span className=\"text-xs font-medium text-muted-foreground\">Agent Terminal</span>
      <div className=\"flex items-center gap-1\">
        <Button variant=\"ghost\" size=\"icon\" className=\"h-6 w-6\" onClick={handleOpenInTerminals} title=\"Open in Terminals\">
          <ExternalLink className=\"h-3 w-3\" />
        </Button>
        <Button variant=\"ghost\" size=\"icon\" className=\"h-6 w-6\" onClick={(e) => { e.stopPropagation(); setIsTerminalExpanded(false); }} title=\"Collapse\">
          <Minimize2 className=\"h-3 w-3\" />
        </Button>
      </div>
    </div>
    <div className=\"h-[350px] overflow-hidden\">
      {terminal ? (
        <TaskMonitorChat terminal={terminal} terminalRef={terminalRef} isActive={true} isMinimized={false} />
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

**Step 5: Remove TaskTerminalModal usage at end of Card**
Remove or comment out TaskTerminalModal component.

Then output: <promise>FIX_21_INLINE_TERMINAL_COMPLETE</promise>
Say: NEXT: FIX-22

---

## FIX-22: Animated Activity Indicator

File: apps/frontend/src/renderer/components/TaskCard.tsx

**Step 1: Add logic to detect if agent is running**
```tsx
const isAgentRunning = (task.status === 'planning' || task.status === 'coding') &&
  (task.executionProgress?.phase !== 'idle' || terminal);
```

**Step 2: Add animated indicator near status badge**
```tsx
import { Loader2 } from 'lucide-react';

// In the card header/status area:
{isAgentRunning && (
  <div className=\"flex items-center gap-1.5 text-xs text-[var(--glow-cyan)]\">
    <Loader2 className=\"h-3 w-3 animate-spin\" />
    <span>Working</span>
  </div>
)}
```

Then output: <promise>FIX_22_ACTIVITY_INDICATOR_COMPLETE</promise>
Say: NEXT: FIX-23

---

## FIX-23: Persist Column Collapse State

**Step 1: Create kanban-store.ts**
Create: apps/frontend/src/renderer/stores/kanban-store.ts
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
    { name: 'kanban-storage' }
  )
);
```

**Step 2: Update KanbanBoard.tsx or KanbanColumn.tsx**
Replace local useState with store:
```tsx
import { useKanbanStore } from '../stores/kanban-store';

const collapsedColumns = useKanbanStore((state) => state.collapsedColumns);
const toggleColumnCollapse = useKanbanStore((state) => state.toggleColumnCollapse);

// Replace: const isCollapsed = someLocalState[columnId];
// With: const isCollapsed = collapsedColumns[columnId] ?? false;

// On toggle: onClick={() => toggleColumnCollapse(columnId)}
```

**Step 3: Remove any local useState for column collapse**

Then output: <promise>FIX_23_PERSIST_COLLAPSE_COMPLETE</promise>
Say: NEXT: SETTINGS-1

---

## SETTINGS-1: Remove agentFramework Dropdown

File: apps/frontend/src/renderer/components/settings/GeneralSettings.tsx

Problem: The agentFramework dropdown only has ONE option ('auto-claude'). Useless dropdown.

Fix: Remove the agentFramework dropdown entirely from the 'agent' section. Keep the setting in type/default for backwards compatibility, just don't show it in UI.

Find and remove the dropdown (approximately lines 136-148):
```tsx
// REMOVE THIS BLOCK:
<div className=\"space-y-3\">
  <Label htmlFor=\"agentFramework\" ...>
  <p className=\"text-sm ...\"}>
  <Select value={settings.agentFramework} ...>
    ...
  </Select>
</div>
```

Then output: <promise>SETTINGS_1_COMPLETE</promise>
Say: NEXT: SETTINGS-2

---

## SETTINGS-2: Merge Appearance + Display Sections

Files:
- apps/frontend/src/renderer/components/settings/AppSettings.tsx
- apps/frontend/src/renderer/components/settings/ThemeSettings.tsx
- apps/frontend/src/renderer/components/settings/DisplaySettings.tsx

Problem: 'appearance' and 'display' are separate sections. They should be merged.

**Step 1: In AppSettings.tsx**
- Remove 'display' from appNavItemsConfig (keep only 'appearance')
- Update renderAppSection to render combined content for 'appearance'

**Step 2: In ThemeSettings.tsx**
- Add the UI Scale controls from DisplaySettings at the bottom
- Import necessary constants (UI_SCALE_MIN, UI_SCALE_MAX, etc.)
- Add section divider before UI Scale

Combined 'appearance' section should show:
- Theme mode (light/dark/system)
- Color theme (7 color options)
- UI Scale (slider + presets)

Then output: <promise>SETTINGS_2_COMPLETE</promise>
Say: NEXT: SETTINGS-3

---

## SETTINGS-3: Move Paths Display to Debug Section

Files:
- apps/frontend/src/renderer/components/settings/AppSettings.tsx
- apps/frontend/src/renderer/components/settings/GeneralSettings.tsx
- apps/frontend/src/renderer/components/settings/DebugSettings.tsx

Problem: The 'paths' section only shows auto-detected CLI tool information (read-only). It's not configurable, so it belongs in 'debug'.

**Step 1: In AppSettings.tsx**
- Remove 'paths' from appNavItemsConfig
- Remove the 'paths' case from renderAppSection

**Step 2: In DebugSettings.tsx**
- Add a new section 'CLI Tools' that shows the auto-detected tool info
- Import/recreate the ToolDetectionDisplay component
- Add useEffect to fetch CLI tools info on mount

**Step 3: In GeneralSettings.tsx**
- Remove the section=\"paths\" conditional branch
- Export ToolDetectionDisplay if needed by DebugSettings

Nav should reduce from 11 to 9 items after SETTINGS-2 and SETTINGS-3.

Then output: <promise>SETTINGS_3_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 7 promises were output
3. Output: <promise>FIX_20_23_SETTINGS_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 7 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. DO NOT delete TaskTerminalModal.tsx file (keep for potential other uses)
4. Ensure animations are CSS-based (not JavaScript intervals)
5. The inline terminal MUST include the chat input (isActive={true})
6. The job is done ONLY when <promise>FIX_20_23_SETTINGS_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_20_23_SETTINGS_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 7 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "FIX_20_23_SETTINGS_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TerminalGrid.tsx` | Always show header toolbar |
| `TaskCard.tsx` | Replace modal with inline terminal + activity indicator |
| `KanbanBoard.tsx` or `KanbanColumn.tsx` | Use persisted collapse state |
| `kanban-store.ts` (NEW) | Column collapse state with persist |
| `GeneralSettings.tsx` | Remove agentFramework dropdown |
| `ThemeSettings.tsx` | Add UI Scale controls (merge display) |
| `AppSettings.tsx` | Remove 'display' and 'paths' from nav |
| `DebugSettings.tsx` | Add CLI tools info display |

---

## Verification After Run

1. Terminal page always shows header (New Terminal, New Claude Code, Files)
2. Terminal button expands card inline (not modal popup)
3. Chat input box visible in expanded terminal
4. Animated indicator shows when task is actively running
5. Collapse column -> navigate away -> come back -> still collapsed
6. Settings nav has 9 items instead of 11
7. Agent settings no longer show agentFramework dropdown
8. Appearance section includes UI Scale
9. Debug section shows CLI tool detection info
10. Build passes

---

## Completion Promise

```
FIX_20_23_SETTINGS_COMPLETE
```
