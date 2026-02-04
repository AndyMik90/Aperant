# Ralph Prompt: FIX-21 + FIX-22 - Task Card UI Improvements

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** HIGH

---

## Task Summary

| # | Task | Description |
|---|------|-------------|
| 1 | FIX-21 | Task terminal expands inline, not as modal |
| 2 | FIX-22 | Add animated activity indicator when task is running |

---

## Problem 1: Task Terminal Opens as Modal

Currently when clicking the terminal button on a task card in Kanban:
- A modal dialog (`TaskTerminalModal`) opens as an overlay
- This covers the entire screen
- User loses context of where they are in the Kanban

**User wants:**
- Terminal should expand INLINE within the task card
- NOT a floating modal overlay
- Card expands to show terminal content

---

## Problem 2: No Activity Indicator

Currently when a task is actively running (Planning, Coding, etc.):
- Shows static "Planning" badge
- Shows "4m ago" timestamp
- NO indication that the agent is actively working

**User wants:**
- Animated indicator showing the task is actively running
- Something like "Planning..." with animated dots
- Visual feedback that work is happening

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer fixing the task card UI for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

---

## TASKS (2 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-21: Task terminal expands inline, not as modal | FIX_21_INLINE_TERMINAL_COMPLETE |
| 2 | FIX-22: Add animated activity indicator | FIX_22_ACTIVITY_INDICATOR_COMPLETE |

**FINAL:** <promise>FIX_21_22_TASK_CARD_COMPLETE</promise>

---

## FIX-21: Task Terminal Inline Expansion

Files:
- apps/frontend/src/renderer/components/TaskCard.tsx
- apps/frontend/src/renderer/components/TaskTerminalModal.tsx

Current behavior: Terminal button opens TaskTerminalModal as Dialog overlay.

Target behavior: Terminal button expands the card inline to show terminal content.

Implementation:
1. Replace isTerminalModalOpen state with isTerminalExpanded
2. When expanded, render TaskMonitorChat below the card content (inside the card)
3. Add collapse button in expanded header
4. Keep 'open in terminals page' as secondary option
5. Remove TaskTerminalModal usage from TaskCard

Card layout when expanded:
```
┌─────────────────────────────────┐
│  Task Title        [−] [↗]     │  <- Collapse and pop-out buttons
│  Status: Planning...           │
│  Progress bar                   │
├─────────────────────────────────┤
│  [TaskMonitorChat content]      │
│  Shows agent activity           │
│  Height: 300-400px              │
└─────────────────────────────────┘
```

Then output: <promise>FIX_21_INLINE_TERMINAL_COMPLETE</promise>
Say: NEXT: FIX-22 and begin FIX-22

---

## FIX-22: Animated Activity Indicator

File: apps/frontend/src/renderer/components/TaskCard.tsx

Current behavior: Static 'Planning' badge with no animation when task is running.

Target behavior: When task has an active agent (status is 'planning' or 'coding' and agent is running), show animated indicator.

Implementation options:

Option A: Animated dots after status text
```tsx
// When agent is running
<Badge>
  Planning<span className=\"animate-pulse\">...</span>
</Badge>
```

Option B: Pulsing badge
```tsx
<Badge className={cn(isRunning && \"animate-pulse\")}>
  Planning
</Badge>
```

Option C: Spinner + text (RECOMMENDED)
```tsx
{isAgentRunning && (
  <div className=\"flex items-center gap-1.5 text-xs text-muted-foreground\">
    <Loader2 className=\"h-3 w-3 animate-spin\" />
    <span>Working...</span>
  </div>
)}
```

Requirements:
1. Detect when agent is actively running (not just status, but actual agent activity)
   - Check if terminal exists for task
   - Check executionProgress.phase !== 'idle'
2. Show animated indicator near the status badge or in footer
3. Can use Loader2 spinner, pulsing dots, or animated text
4. Animation should be subtle, not distracting

Add to card footer or near status:
```tsx
{isAgentRunning && (
  <div className=\"flex items-center gap-1 text-xs text-[var(--glow-cyan)]\">
    <Loader2 className=\"h-3 w-3 animate-spin\" />
    Working
  </div>
)}
```

Then output: <promise>FIX_22_ACTIVITY_INDICATOR_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify both promises were output
3. Output: <promise>FIX_21_22_TASK_CARD_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. Both fixes are REQUIRED - no skipping
2. After each fix, immediately continue to next
3. DO NOT remove TaskTerminalModal.tsx file entirely
4. Ensure animations are CSS-based (not JavaScript intervals)
5. The job is done ONLY when <promise>FIX_21_22_TASK_CARD_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_21_22_TASK_CARD_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 2 tasks complete. BEGIN NOW.
" --max-iterations 100 --completion-promise "FIX_21_22_TASK_CARD_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TaskCard.tsx` | Replace modal with inline expansion |
| `TaskCard.tsx` | Add isTerminalExpanded state |
| `TaskCard.tsx` | Render TaskMonitorChat inline when expanded |
| `TaskCard.tsx` | Add animated activity indicator |
| `TaskCard.tsx` | Import Loader2 icon if not already |

---

## Verification After Run

1. Terminal button expands card inline (not modal)
2. Terminal content visible within expanded card
3. Can collapse card back to normal
4. When task is actively running, animated indicator visible
5. Build passes

---

## Completion Promise

```
FIX_21_22_TASK_CARD_COMPLETE
```
