# Phase 8: UX Polish & Enhancements

**Version:** 1.1
**Date:** 2026-02-04
**Status:** Planning
**Priority:** P2 - Medium (Quality of Life improvements)

---

## Overview

After completing all core functionality (108 tasks), this phase focuses on polish and UX enhancements that make Jerry more delightful to use.

---

## Selected Improvements

### From User Selection

| ID | Feature | Priority | Complexity |
|----|---------|----------|------------|
| UX-1 | Notification Center | P1 | Medium |
| UX-2 | Drag Reorder Within Columns | P1 | Medium |
| UX-3 | Loading Skeletons | P2 | Low |
| UX-4 | Micro-animations | P2 | Low |

### From SUGGESTIONS.md (Not Yet Done)

| ID | Feature | Priority | Complexity |
|----|---------|----------|------------|
| UX-5 | Keyboard Navigation (j/k, Enter, Esc) | P2 | Low |
| UX-6 | Bulk Operations (select multiple tasks) | P2 | Medium |
| UX-7 | Task Duration & ETA Display (SUG-10) | P2 | Low |

---

## Task Specifications

### UX-1: Notification Center

**What:** Replace scattered toasts with a consolidated notification panel.

**Current State:**
```
Random toasts appearing and disappearing
- Hard to catch if you're not watching
- No history of past notifications
```

**Target State:**
```
┌─────────────────────────────────────────────────┐
│ 🔔 Notifications (3)                    [Clear] │
├─────────────────────────────────────────────────┤
│ ✅ Task "Add login" completed          2m ago   │
│ ⚠️ Task "Fix bug" needs review         5m ago   │
│ 📋 Spec ready for "Dashboard"         10m ago   │
├─────────────────────────────────────────────────┤
│ Earlier Today                                   │
│ ✅ Task "Add logout" completed          1h ago  │
│ 📋 Spec ready for "Profile page"       2h ago  │
└─────────────────────────────────────────────────┘
```

**Implementation:**
1. Create NotificationCenter.tsx component
2. Create notification-store.ts (zustand store)
3. Add bell icon to header with unread count badge
4. Persist notifications (last 24 hours)
5. Group by time (Just now, Earlier, Yesterday)

**Files:**
- `NotificationCenter.tsx` - New component
- `notification-store.ts` - New store
- `Header.tsx` or `Sidebar.tsx` - Add bell icon

---

### UX-2: Drag Reorder Within Columns

**What:** Allow reordering task priority within a column by dragging.

**Current State:**
- Drag-and-drop disabled between columns (by design - tasks move systematically)
- No way to reorder within a column

**Target State:**
```
Planning Column:
┌─────────────────────┐
│ Task A (drag here)  │ ↑↓
│ Task B              │ ↑↓
│ Task C              │ ↑↓
└─────────────────────┘

Drag Task C above Task A to prioritize it
```

**Implementation:**
1. Re-enable @dnd-kit sensors for vertical reordering only
2. Add `priority` or `order` field to task model
3. Update KanbanBoard.tsx to handle reorder within same column
4. Persist order to task store

**Files:**
- `KanbanBoard.tsx` - Enable vertical drag
- `task-store.ts` - Add order handling
- `TaskCard.tsx` - Add drag handle visual

---

### UX-3: Loading Skeletons

**What:** Replace spinners with skeleton loaders for smoother perceived performance.

**Current State:**
```
┌─────────────────────┐
│      [Spinner]      │
│      Loading...     │
└─────────────────────┘
```

**Target State:**
```
┌─────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░ │  <- Animated skeleton
│ ░░░░░░░░░░░         │
│ ░░░░░░░░░░░░░░      │
└─────────────────────┘
```

**Implementation:**
1. Create Skeleton.tsx component (or use shadcn/ui skeleton)
2. Create TaskCardSkeleton.tsx
3. Create TerminalSkeleton.tsx
4. Replace loading states in key components

**Files:**
- `Skeleton.tsx` - Base skeleton component
- `TaskCardSkeleton.tsx` - Task card loading state
- `KanbanBoard.tsx` - Use skeletons while loading

---

### UX-4: Micro-animations

**What:** Add subtle animations for polish and feedback.

**Animations to Add:**

| Element | Animation | Trigger |
|---------|-----------|---------|
| Task cards | Slide in | Card appears |
| Status badge | Color transition | Status changes |
| Progress bar | Smooth fill | Progress updates |
| Buttons | Scale on hover | Mouse hover |
| Modals | Fade + slide | Open/close |
| Terminal output | Fade in lines | New output |
| Notifications | Slide in from right | New notification |

**Implementation:**
1. Add framer-motion or use CSS transitions
2. Create animation constants/presets
3. Apply to key components

**Files:**
- `animations.ts` - Animation presets
- `TaskCard.tsx` - Card animations
- `Modal.tsx` or dialogs - Modal animations

---

### UX-5: Keyboard Navigation

**What:** Full keyboard navigation for power users.

**Shortcuts:**

| Key | Action | Context |
|-----|--------|---------|
| `j` / `↓` | Next task | Kanban board |
| `k` / `↑` | Previous task | Kanban board |
| `Enter` | Open selected task | Kanban board |
| `Escape` | Close modal/panel | Anywhere |
| `s` | Start/Stop task | Task selected |
| `r` | Review spec | Task selected |
| `?` | Show shortcuts help | Anywhere |
| `Ctrl+K` | Quick task (existing) | Anywhere |
| `Ctrl+P` | Global search (existing) | Anywhere |

**Implementation:**
1. Create useKeyboardNavigation hook
2. Add focus management to KanbanBoard
3. Create KeyboardShortcutsHelp modal
4. Add visible focus indicators

**Files:**
- `useKeyboardNavigation.ts` - New hook
- `KanbanBoard.tsx` - Focus management
- `KeyboardShortcutsHelp.tsx` - Help modal

---

### UX-6: Bulk Operations

**What:** Select multiple tasks and perform bulk actions.

**Current State:**
- Must handle tasks one at a time

**Target State:**
```
☑ Task 1: Fix typo
☑ Task 2: Update deps
☑ Task 3: Add tests
☐ Task 4: Refactor API

[Archive (3)] [Delete (3)] [Start All (3)]
```

**Implementation:**
1. Add selection state to task-store
2. Add checkbox to TaskCard
3. Create BulkActionsBar component
4. Add shift+click for range selection

**Files:**
- `task-store.ts` - Selection state
- `TaskCard.tsx` - Add checkbox
- `BulkActionsBar.tsx` - New component
- `KanbanBoard.tsx` - Bulk actions integration

---

### UX-7: Task Duration & ETA Display (SUG-10)

**What:** Display elapsed time per phase and estimated remaining time for running tasks.

**Existing Infrastructure:**
```typescript
// Already defined in apps/frontend/src/shared/types/task.ts
interface TaskTimestamps {
  created: string;
  planning_started?: string;
  planning_completed?: string;
  coding_started?: string;
  coding_completed?: string;
  ai_review_started?: string;
  ai_review_completed?: string;
}

interface TaskDurations {
  planning_ms?: number;
  coding_ms?: number;
  ai_review_ms?: number;
  total_ai_ms?: number;
}

// Already exists in apps/frontend/src/shared/progress.ts
function estimateRemainingTime(startTime: Date, progress: number): number | null
```

**Current State:**
- Types defined but NOT displayed in UI
- `estimateRemainingTime()` function exists but is UNUSED
- No duration display per phase

**Target State:**
```
┌─────────────────────────────────────┐
│ Task: Add user auth                 │
│ Status: Coding (45%)                │
│                                     │
│ ⏱️ Elapsed: 12m 34s                 │
│ 📊 Planning: 2m 15s ✓               │
│ 📊 Coding: 10m 19s (in progress)    │
│ ⏳ ETA: ~15m remaining              │
└─────────────────────────────────────┘
```

**Implementation:**
1. Hook up `estimateRemainingTime()` in TaskProgress.tsx
2. Display elapsed time for current phase
3. Show completed phase durations (Planning: 2m 15s ✓)
4. Add ETA display with "~" prefix (estimates are approximate)
5. Update timestamps when phases complete

**Files:**
- `TaskProgress.tsx` - Add duration/ETA display
- `task-store.ts` - Ensure timestamps are being recorded
- `TaskCard.tsx` - Show elapsed time indicator
- `progress.ts` - Already has utilities (may need `formatDuration()`)

**Caveat:** ETA for AI tasks is inherently unpredictable. Display with "~" and treat as rough estimate.

---

## Implementation Order

| Order | Task | Complexity | Dependencies |
|-------|------|------------|--------------|
| 1 | UX-3: Loading Skeletons | Low | None |
| 2 | UX-4: Micro-animations | Low | None |
| 3 | UX-5: Keyboard Navigation | Low | None |
| 4 | UX-7: Task Duration & ETA | Low | None (infrastructure exists) |
| 5 | UX-1: Notification Center | Medium | None |
| 6 | UX-2: Drag Reorder | Medium | None |
| 7 | UX-6: Bulk Operations | Medium | None |

**Recommended:** Start with UX-3, UX-4, UX-5, UX-7 (low complexity), then medium tasks.

---

## Ralph Prompt (Phase 8)

```bash
/ralph-loop:ralph-loop "
You are completing Phase 8: UX Polish for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude

Primary documentation:
- docs\plans\PHASE_8_UX_POLISH.md (THIS FILE)
- docs\PROGRESS.md

---

TASKS (7 required)

| # | Task | Promise |
|---|------|---------|
| 1 | UX-3: Loading Skeletons | UX_3_SKELETONS_COMPLETE |
| 2 | UX-4: Micro-animations | UX_4_ANIMATIONS_COMPLETE |
| 3 | UX-5: Keyboard Navigation | UX_5_KEYBOARD_NAV_COMPLETE |
| 4 | UX-7: Task Duration & ETA | UX_7_DURATION_ETA_COMPLETE |
| 5 | UX-1: Notification Center | UX_1_NOTIFICATION_CENTER_COMPLETE |
| 6 | UX-2: Drag Reorder | UX_2_DRAG_REORDER_COMPLETE |
| 7 | UX-6: Bulk Operations | UX_6_BULK_OPS_COMPLETE |

FINAL: <promise>PHASE_8_UX_POLISH_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read PHASE_8_UX_POLISH.md fully.
2. Complete each task, output promise, say NEXT.
3. Run npm run build after all tasks.
4. Output final promise.

CURRENT STATUS: 0 of 7 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "PHASE_8_UX_POLISH_COMPLETE"
```

---

## Success Criteria

- [ ] Loading skeletons replace spinners in key views
- [ ] Task cards have entrance animations
- [ ] Status badge transitions smoothly on status change
- [ ] j/k keyboard navigation works on Kanban
- [ ] ? shows keyboard shortcuts help
- [ ] Running tasks show elapsed time (e.g., "⏱️ 12m 34s")
- [ ] Completed phases show duration (e.g., "Planning: 2m 15s ✓")
- [ ] ETA displayed for in-progress tasks (e.g., "~15m remaining")
- [ ] Notification bell shows in header with unread count
- [ ] Clicking bell opens notification panel
- [ ] Can drag tasks within same column to reorder
- [ ] Can select multiple tasks with checkboxes
- [ ] Bulk actions bar appears when tasks selected
- [ ] Build passes: `npm run build`

---

## Related Documentation

- [SUGGESTIONS.md](SUGGESTIONS.md) - Original ideas list
- [TODO.md](../TODO.md) - Master task list
- [PROGRESS.md](../PROGRESS.md) - Activity log

---

**Phase 8: UX Polish - 7 tasks**
