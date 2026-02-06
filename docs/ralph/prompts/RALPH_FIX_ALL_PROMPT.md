# Ralph Prompt: Fix All UI/UX Issues

Copy and paste this into Ralph:

---

```
/ralph-loop:ralph-loop "You are fixing multiple UI/UX issues in Jerry (Auto-Claude). Complete ALL tasks below.

## ⚠️ EXECUTION RULES
- Complete each task in order
- Output promise after each task
- Do NOT stop until final promise is output
- Do NOT ask for confirmation - execute autonomously

---

## TASK 1: Fix TaskDetailModal Buttons
**File:** `src/renderer/components/task-detail/TaskDetailModal.tsx`

Remove the old 'Start Task' button (lines ~277-296) and implement the new gated workflow matching TaskCard.tsx:
- Planning + agent running → Show 'Stop' button only
- Planning + agent stopped + spec ready → Show 'Resume' + 'Start Build' buttons
- Planning + agent stopped + no spec → Show 'Resume' only
- Coding + agent running → Show 'Stop'
- Coding + agent stopped → Show 'Resume'

Reference: `src/renderer/components/TaskCard.tsx` lines 880-940 for correct implementation.

Also fix `src/renderer/components/task-detail/TaskActions.tsx` line 89.

<promise>TASK_1_DETAIL_BUTTONS_FIXED</promise>

---

## TASK 2: Fix Terminal Auto-Scroll
**Files:**
- `src/renderer/components/terminal/StructuredOutput.tsx`
- `src/renderer/components/terminal/RawTerminal.tsx`

Terminal should auto-scroll to bottom when new content arrives. Add:
```tsx
useEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}, [messages]); // or relevant content state
```

<promise>TASK_2_TERMINAL_AUTOSCROLL_FIXED</promise>

---

## TASK 3: Fix Chat Scroll Position
**File:** `src/renderer/components/Insights.tsx`

Chat should always be at bottom on mount - no visible scroll animation. Use useLayoutEffect:
```tsx
useLayoutEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}, []);
```

<promise>TASK_3_CHAT_SCROLL_FIXED</promise>

---

## TASK 4: Fix Aria-Hidden Focus Error
**Files:** Check all Radix dialog/popover/select components

The error 'Blocked aria-hidden on an element because its descendant retained focus' is causing tasks to stop.

Fix by ensuring focus is moved before closing dialogs:
```tsx
const handleClose = () => {
  document.activeElement?.blur();
  setOpen(false);
};
```

Or add error boundary around task components to prevent focus errors from killing tasks.

<promise>TASK_4_ARIA_HIDDEN_FIXED</promise>

---

## TASK 5: Fix Multi-Task Creation in Chat
**Files:**
- `src/renderer/components/Insights.tsx`
- `src/renderer/stores/insights-store.ts`

When creating multiple tasks from chat, only the last task stays visible. Fix by ensuring:
1. Each task creation message has a unique ID
2. Messages are appended, not replaced
3. All task confirmations stay in chat history

<promise>TASK_5_MULTI_TASK_FIXED</promise>

---

## TASK 6: Improve Terminal Output Display
**Files:**
- `src/renderer/components/terminal/ToolUseCard.tsx`
- `src/renderer/components/terminal/StructuredOutput.tsx`

Current terminal shows minimal info like '[Tool: Read]'. Improve to show:
1. Actual file contents when reading files
2. Command output when running bash
3. Make tool cards expandable to show full input/output
4. Add syntax highlighting for code

<promise>TASK_6_TERMINAL_DISPLAY_IMPROVED</promise>

---

## VERIFICATION

After all tasks:
1. Run: cd apps/frontend && npm run build
2. Verify no TypeScript errors
3. Verify build passes

<promise>ALL_UI_FIXES_COMPLETE</promise>
" --max-iterations 150 --completion-promise "ALL_UI_FIXES_COMPLETE"
```

---

## Alternative: Run Tasks Separately

If you prefer to run each fix separately:

### Task 1 Only (Buttons)
```
/ralph-loop:ralph-loop "Fix TaskDetailModal buttons to match TaskCard workflow. Remove old 'Start Task' button, implement gated workflow: planning+running=Stop, planning+stopped+spec=Resume+StartBuild, coding+stopped=Resume. Reference TaskCard.tsx:880-940. Files: TaskDetailModal.tsx, TaskActions.tsx. <promise>BUTTONS_FIXED</promise>" --max-iterations 30
```

### Task 2-3 (Scroll Fixes)
```
/ralph-loop:ralph-loop "Fix auto-scroll issues: 1) Terminal should auto-scroll to bottom on new content (StructuredOutput.tsx, RawTerminal.tsx), 2) Chat should be at bottom on mount using useLayoutEffect (Insights.tsx). <promise>SCROLL_FIXED</promise>" --max-iterations 30
```

### Task 4 (Aria-Hidden)
```
/ralph-loop:ralph-loop "Fix aria-hidden focus error causing tasks to stop. Ensure focus is moved before dialogs close. Check all Radix dialog/popover components. Add error boundary if needed. <promise>ARIA_FIXED</promise>" --max-iterations 30
```

### Task 5 (Multi-Task)
```
/ralph-loop:ralph-loop "Fix chat multi-task creation bug. When creating multiple tasks, only last one stays visible. Ensure unique message IDs, messages appended not replaced. Files: Insights.tsx, insights-store.ts. <promise>MULTI_TASK_FIXED</promise>" --max-iterations 40
```

### Task 6 (Terminal Display)
```
/ralph-loop:ralph-loop "Improve terminal output display. Show actual file contents, command output instead of just '[Tool: Read]'. Make ToolUseCard expandable with full input/output. Add syntax highlighting. Files: ToolUseCard.tsx, StructuredOutput.tsx. <promise>TERMINAL_DISPLAY_FIXED</promise>" --max-iterations 50
```
