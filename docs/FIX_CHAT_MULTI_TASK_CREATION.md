# Fix: Chat Multi-Task Creation Bug

**Created:** 2026-02-04
**Priority:** High
**Status:** Pending

---

## Problem

When asking the chat to create multiple tasks at once:
- Only the **last generated task** stays visible in the chat
- The other tasks disappear from the chat history
- User has to create tasks one at a time as a workaround

---

## Expected Behavior

- User asks: "Create 3 tasks for X, Y, and Z"
- Chat creates all 3 tasks
- All 3 task creation confirmations stay visible in chat
- User can see "See in Kanban" button for each task

---

## Likely Cause

The task creation response in chat is probably being **overwritten** rather than **appended** when multiple tasks are created in sequence.

Possible issues:
1. Message state being replaced instead of appended
2. Task creation tool use replacing previous tool results
3. Session/message ID collision when creating multiple tasks

---

## Files to Investigate

1. `src/renderer/components/Insights.tsx` - Main chat component
2. `src/renderer/stores/insights-store.ts` - Chat message state management
3. `src/main/insights-service.ts` - Backend chat service
4. Look for task creation tool handling

---

## Key Code to Find

Look for where task creation responses are added to messages:
```tsx
// Something like this might be overwriting instead of appending
setMessages(prev => [...prev, newTaskMessage]); // Correct - append
setMessages([newTaskMessage]); // Wrong - replaces all
```

Or there might be a message ID issue:
```tsx
// If all tasks get same ID, only last one shows
const message = { id: 'task-created', ... }; // Wrong - same ID
const message = { id: `task-${Date.now()}-${index}`, ... }; // Correct - unique ID
```

---

## Reproduction Steps

1. Open Chat
2. Ask: "Create tasks for: 1) Feature A, 2) Feature B, 3) Feature C"
3. Watch as chat creates all 3 tasks
4. Notice only the last task (Feature C) remains visible
5. Features A and B task confirmations are gone

---

## Workaround (Current)

Create tasks one at a time:
1. "Create a task for Feature A"
2. Wait for completion
3. "Create a task for Feature B"
4. etc.

---

## Notes

- This might be related to how the insights service handles multiple tool calls
- Check if streaming responses are correctly accumulated
- May need to ensure each task creation has unique message ID
