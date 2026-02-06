# Insights Task Sidebar - Design Document

**Date:** 2026-02-06
**Priority:** HIGH
**Problem:** Tasks created in chat disappear when navigating away
**Solution:** Persistent task sidebar in Insights view

---

## Problem Statement

When the chatbot creates multiple tasks:
1. Tasks exist only in local React state
2. Navigating away clears the state
3. Tasks are lost (except the last one sometimes)
4. User has no visibility into what was created

---

## Solution: Task Sidebar

A persistent right-side panel in the Insights view that:
- Shows all tasks created in the current session
- Persists to localStorage/backend immediately
- Allows Start/Delete actions
- Shows real-time status updates

---

## UI Mockups

### State 1: No Tasks Created Yet

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │  Task Queue   │
│  │                                                 │    │               │
│  │     👋 Hi! I'm Jerry, your AI assistant.       │    │  ┌─────────┐  │
│  │        How can I help you today?               │    │  │         │  │
│  │                                                 │    │  │  No     │  │
│  └─────────────────────────────────────────────────┘    │  │  tasks  │  │
│                                                         │  │  yet    │  │
│                                                         │  │         │  │
│                                                         │  └─────────┘  │
│                                                         │               │
│                                                         │  Create tasks │
│                                                         │  by chatting  │
│                                                         │  with Jerry   │
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │               │
│  │ Ask Jerry anything...                       ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 2: Task Suggested (Not Yet Created)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │  Task Queue   │
│  │ 👤 The login page has a bug where the          │    │               │
│  │    password field doesn't validate properly    │    │  ┌─────────┐  │
│  └─────────────────────────────────────────────────┘    │  │         │  │
│                                                         │  │  No     │  │
│  ┌─────────────────────────────────────────────────┐    │  │  tasks  │  │
│  │ 🤖 I can help fix that! Here's what I suggest: │    │  │  yet    │  │
│  │                                                 │    │  │         │  │
│  │    Fix password validation on login page        │    │  └─────────┘  │
│  │    - Update validation regex                    │    │               │
│  │    - Add error message display                  │    │               │
│  │    - Add unit tests                             │    │               │
│  │                                                 │    │               │
│  │    ┌────────────────┐                           │    │               │
│  │    │ + Create Task  │                           │    │               │
│  │    └────────────────┘                           │    │               │
│  └─────────────────────────────────────────────────┘    │               │
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │               │
│  │ Type a message...                           ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 3: One Task Created

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │  Task Queue   │
│  │ 👤 The login page has a bug...                  │    │     (1)       │
│  └─────────────────────────────────────────────────┘    │               │
│                                                         │  ┌───────────┐│
│  ┌─────────────────────────────────────────────────┐    │  │ 🔵        ││
│  │ 🤖 I can help fix that!                         │    │  │ Fix pass- ││
│  │                                                 │    │  │ word val- ││
│  │    ┌─────────────────┐                          │    │  │ idation   ││
│  │    │ ✓ Task Created  │                          │    │  │           ││
│  │    └─────────────────┘                          │    │  │ ┌───────┐ ││
│  └─────────────────────────────────────────────────┘    │  │ │ Start │ ││
│                                                         │  │ └───────┘ ││
│                                                         │  │    🗑️     ││
│                                                         │  └───────────┘│
│                                                         │               │
│                                                         │               │
│  ┌─────────────────────────────────────────────────┐    │               │
│  │ Type a message...                           ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 4: Multiple Tasks Created

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  [Chat messages scrolling...]                           │  Task Queue   │
│                                                         │     (3)       │
│  ┌─────────────────────────────────────────────────┐    │               │
│  │ 🤖 Created! Anything else?                      │    │  ┌───────────┐│
│  └─────────────────────────────────────────────────┘    │  │ 🔵 Fix    ││
│                                                         │  │ password  ││
│  ┌─────────────────────────────────────────────────┐    │  │ validation││
│  │ 👤 Also need to add dark mode                   │    │  │ [Start]🗑️ ││
│  └─────────────────────────────────────────────────┘    │  ├───────────┤│
│                                                         │  │ 🔵 Add    ││
│  ┌─────────────────────────────────────────────────┐    │  │ dark mode ││
│  │ 🤖 I'll add dark mode support.                  │    │  │ toggle    ││
│  │    ┌─────────────────┐                          │    │  │ [Start]🗑️ ││
│  │    │ ✓ Task Created  │                          │    │  ├───────────┤│
│  │    └─────────────────┘                          │    │  │ 🔵 Update ││
│  └─────────────────────────────────────────────────┘    │  │ user docs ││
│                                                         │  │ [Start]🗑️ ││
│                                                         │  └───────────┘│
│  ┌─────────────────────────────────────────────────┐    │               │
│  │ Type a message...                           ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 5: Task Running

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  [Chat messages...]                                     │  Task Queue   │
│                                                         │     (3)       │
│                                                         │               │
│                                                         │  ┌───────────┐│
│                                                         │  │ 🟢 Fix    ││
│                                                         │  │ password  ││
│                                                         │  │ ━━━━━━━━░ ││
│                                                         │  │ Running   ││
│                                                         │  │  2m 34s   ││
│                                                         │  │  [View]   ││
│                                                         │  ├───────────┤│
│                                                         │  │ 🔵 Add    ││
│                                                         │  │ dark mode ││
│                                                         │  │ [Start]🗑️ ││
│                                                         │  ├───────────┤│
│                                                         │  │ 🔵 Update ││
│                                                         │  │ user docs ││
│                                                         │  │ [Start]🗑️ ││
│  ┌─────────────────────────────────────────────────┐    │  └───────────┘│
│  │ Type a message...                           ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 6: Mixed States (Complete, Running, Pending)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├─────────────────────────────────────────────────────────┬───────────────┤
│                                                         │               │
│  [Chat messages...]                                     │  Task Queue   │
│                                                         │     (3)       │
│                                                         │               │
│                                                         │  ┌───────────┐│
│                                                         │  │ ✅ Fix    ││
│                                                         │  │ password  ││
│                                                         │  │ Complete  ││
│                                                         │  │ 4m 12s    ││
│                                                         │  │ [View PR] ││
│                                                         │  ├───────────┤│
│                                                         │  │ 🟢 Add    ││
│                                                         │  │ dark mode ││
│                                                         │  │ ━━━━━░░░░ ││
│                                                         │  │ Coding... ││
│                                                         │  │  1m 45s   ││
│                                                         │  │  [View]   ││
│                                                         │  ├───────────┤│
│                                                         │  │ 🔵 Update ││
│                                                         │  │ user docs ││
│                                                         │  │ [Start]🗑️ ││
│  ┌─────────────────────────────────────────────────┐    │  └───────────┘│
│  │ Type a message...                           ⏎  │    │               │
│  └─────────────────────────────────────────────────┘    │               │
└─────────────────────────────────────────────────────────┴───────────────┘
```

### State 7: Sidebar Collapsed (Icon Only)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Insights                                                                │
├───────────────────────────────────────────────────────────────────┬─────┤
│                                                                   │     │
│  [Chat takes full width when sidebar collapsed]                   │ 📋  │
│                                                                   │ (3) │
│  ┌───────────────────────────────────────────────────────────┐    │     │
│  │ 👤 User message...                                        │    │ ✅  │
│  └───────────────────────────────────────────────────────────┘    │ 🟢  │
│                                                                   │ 🔵  │
│  ┌───────────────────────────────────────────────────────────┐    │     │
│  │ 🤖 Jerry response...                                      │    │     │
│  └───────────────────────────────────────────────────────────┘    │     │
│                                                                   │     │
│                                                                   │     │
│                                                                   │     │
│  ┌───────────────────────────────────────────────────────────┐    │     │
│  │ Type a message...                                      ⏎  │    │     │
│  └───────────────────────────────────────────────────────────┘    │     │
└───────────────────────────────────────────────────────────────────┴─────┘

Click the 📋 icon or any status dot to expand sidebar
```

---

## Task Card States

### Pending (Not Started)
```
┌─────────────────┐
│ 🔵              │  Blue dot = Pending
│ Fix password    │
│ validation      │  Task title (truncated)
│                 │
│ ┌─────┐         │
│ │Start│    🗑️   │  Start button + Delete icon
│ └─────┘         │
└─────────────────┘
```

### Running
```
┌─────────────────┐
│ 🟢              │  Green dot = Running (pulsing)
│ Fix password    │
│ ━━━━━━━━━░░░░░  │  Progress bar
│ Coding...       │  Current phase
│ 2m 34s          │  Elapsed time
│ ┌──────┐        │
│ │ View │        │  Opens terminal panel
│ └──────┘        │
└─────────────────┘
```

### Complete
```
┌─────────────────┐
│ ✅              │  Checkmark = Complete
│ Fix password    │
│ Complete        │
│ 4m 12s          │  Total time
│ ┌─────────┐     │
│ │ View PR │     │  Opens PR or diff view
│ └─────────┘     │
└─────────────────┘
```

### Failed
```
┌─────────────────┐
│ ❌              │  Red X = Failed
│ Fix password    │
│ Failed          │
│ Error: Timeout  │  Error message
│ ┌───────┐       │
│ │ Retry │  🗑️   │  Retry + Delete
│ └───────┘       │
└─────────────────┘
```

---

## Color Scheme

| State | Icon | Color | Background |
|-------|------|-------|------------|
| Pending | 🔵 | `blue-500` | `blue-500/10` |
| Running | 🟢 | `green-500` | `green-500/10` |
| Complete | ✅ | `emerald-500` | `emerald-500/10` |
| Failed | ❌ | `red-500` | `red-500/10` |

---

## Interactions

### Click Task Card
- **Pending:** Shows task details modal
- **Running:** Opens bottom terminal panel
- **Complete:** Shows diff/PR view
- **Failed:** Shows error details

### Start Button
- Triggers task execution
- Card transitions to Running state
- Progress bar appears

### Delete Button (🗑️)
- Shows confirmation tooltip
- Removes from queue
- Cancels if running

### View Button
- Running: Opens terminal panel
- Complete: Opens PR/diff

### Collapse Toggle
- Click header "Task Queue" to collapse
- Sidebar shrinks to icon strip
- Click to expand

---

## Responsive Behavior

### Desktop (> 1200px)
- Sidebar: 280px wide
- Chat: remaining space

### Tablet (768px - 1200px)
- Sidebar: 240px wide
- Chat: remaining space

### Mobile (< 768px)
- Sidebar: Hidden by default
- Floating action button to show
- Slides in as overlay

---

## Data Persistence

### On Task Create:
1. Immediately save to localStorage: `insights-task-queue`
2. Call backend to persist
3. Update Zustand store
4. Show in sidebar

### On Page Load:
1. Load from localStorage first (instant)
2. Sync with backend
3. Merge any missing tasks

### localStorage Schema:
```json
{
  "projectId": "xxx",
  "tasks": [
    {
      "id": "task-123",
      "title": "Fix password validation",
      "status": "pending",
      "createdAt": "2026-02-06T10:30:00Z",
      "messageId": "msg-456"
    }
  ]
}
```

---

## Component Structure

```
Insights.tsx
├── InsightsChat.tsx (left side)
│   └── ChatMessages
│       └── CreateTaskButton
└── TaskQueueSidebar.tsx (right side)
    ├── SidebarHeader
    │   ├── Title + Count
    │   └── CollapseToggle
    ├── TaskList
    │   └── TaskQueueCard (× n)
    │       ├── StatusIndicator
    │       ├── TaskTitle
    │       ├── ProgressBar (if running)
    │       └── ActionButtons
    └── EmptyState (if no tasks)
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `components/insights/TaskQueueSidebar.tsx` | NEW |
| `components/insights/TaskQueueCard.tsx` | NEW |
| `stores/insights-task-queue-store.ts` | NEW |
| `Insights.tsx` | MODIFY - Add sidebar |
| `insights-store.ts` | MODIFY - Persist immediately |

---

## Next Steps

1. Review and approve this design
2. Create Ralph prompt for implementation
3. Implement in phases:
   - Phase 1: Bug fix (persist immediately)
   - Phase 2: Sidebar UI
   - Phase 3: Real-time status updates
