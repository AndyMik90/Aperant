# Additional Suggestions & Ideas

**Last Updated:** 2026-02-03
**Status:** 💡 IDEAS - For Discussion

---

## Quick Wins (Low Effort, High Value)

### 1. Terminal Architecture Redesign
**Current:** Terminals page shows task-bound agent output
**Suggestion:** Split into two distinct features:

#### Part A: Task Terminal → Accessible from Task Card
Keep the existing terminal button on task cards in Kanban. When clicked, it opens a terminal UI showing the agent's live activity.

**Current Pattern (Keep):**
- Task cards on Kanban board have a terminal button
- Clicking it opens a terminal modal/panel
- Shows real-time agent output for that specific task

**Enhancement: Add User Interaction**
- User can type messages to communicate with the active agent
- Agent responds within the context of the current task
- Useful for: clarifications, corrections, additional instructions

```
┌─────────────────────────────────────────────────────────────┐
│  Task Terminal: Add User Authentication            [×]      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ● Starting phase 4: CONTEXT DISCOVERY                      │
│    ├─ Read: package.json ✓                                 │
│    ├─ Read: src/index.ts ✓                                 │
│    └─ Analyzing 15 files...                                │
│                                                             │
│  ● Starting phase 5: SPEC DOCUMENT CREATION                 │
│    ├─ Write: .auto-build/specs/001/spec.md ✓               │
│    └─ Spec created successfully!                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Type a message to Jerry...                     [Send] │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**User Interaction Examples:**
```
User: "Make sure to add rate limiting to the auth endpoint"
Jerry: "Got it! I'll add rate limiting using express-rate-limit..."

User: "Use JWT instead of sessions"
Jerry: "Understood. Updating the implementation plan to use JWT..."
```

**Implementation:**
```typescript
// TaskTerminal component
interface TaskTerminalProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
}

function TaskTerminal({ taskId, isOpen, onClose }: TaskTerminalProps) {
  const [messages, setMessages] = useState<TerminalMessage[]>([]);
  const [userInput, setUserInput] = useState('');

  // Subscribe to agent output for this task
  useEffect(() => {
    const unsubscribe = agentEvents.subscribe(taskId, (event) => {
      setMessages(prev => [...prev, event]);
    });
    return unsubscribe;
  }, [taskId]);

  // Send message to agent
  const sendMessage = async () => {
    await ipcRenderer.invoke('AGENT_SEND_MESSAGE', {
      taskId,
      message: userInput
    });
    setUserInput('');
  };

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <TerminalOutput messages={messages} />
      <TerminalInput
        value={userInput}
        onChange={setUserInput}
        onSubmit={sendMessage}
        placeholder="Type a message to Jerry..."
      />
    </Dialog>
  );
}
```

**Key Points:**
- Terminal button stays on task cards (existing UI)
- Modal shows live agent output for THAT task only
- User can send messages to interact with the running agent
- Messages are contextual to the current task/phase

**Input Availability by State:**

| Task State | Input Behavior |
|------------|----------------|
| **Agent running** | Normal input → sends to active agent |
| **Agent idle** (planning done, waiting for Start Build) | Input disabled, show "Click Start Build" hint |
| **Agent paused/interrupted** | Input sends message + resumes agent |
| **Task in coding** (agent idle between subtasks) | Input sends additional instructions |
| **Task done/merged** | Input disabled, view history only |
| **Task failed** | Input can send message to retry with new instructions |

**UI States:**
```
─── AGENT RUNNING ───
┌───────────────────────────────────────────────────────┐
│ Type a message to Jerry...                     [Send] │
└───────────────────────────────────────────────────────┘

─── PLANNING COMPLETE (waiting for Start Build) ───
┌───────────────────────────────────────────────────────┐
│ Spec ready. Review and click Start Build.             │
│                               [View Spec] [Start Build]│
└───────────────────────────────────────────────────────┘

─── AGENT PAUSED/INTERRUPTED ───
┌───────────────────────────────────────────────────────┐
│ Agent paused. Type to resume with instructions...     │
│                                        [Send & Resume] │
└───────────────────────────────────────────────────────┘

─── TASK COMPLETED ───
┌───────────────────────────────────────────────────────┐
│ Task completed successfully.           [View History] │
└───────────────────────────────────────────────────────┘

─── TASK FAILED ───
┌───────────────────────────────────────────────────────┐
│ Task failed. Send instructions to retry...            │
│                                              [Retry]  │
└───────────────────────────────────────────────────────┘
```

#### Part B: Terminals Page → Claude Code Session Launcher
Repurpose the Terminals page as a place to launch **standalone Claude Code sessions** (not tied to tasks).

**Use Cases:**
- Quick questions about the codebase
- Freeform coding assistance
- Debugging help
- Learning/exploration
- Ad-hoc file edits
- Work that doesn't need formal task tracking

**How It Would Work:**
```
┌─────────────────────────────────────────────────────────────┐
│  CLAUDE CODE SESSIONS                           [+ New]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Session 1: "Help with API refactor"      [Active]   │   │
│  │ Started: 2:30 PM | Project: Auto-Claude      [Open] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Session 2: "Debug auth issue"            [Closed]   │   │
│  │ Started: 11:00 AM | Duration: 45 min     [Resume]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  [+ New Session]                     │   │
│  │          Start a new Claude Code terminal           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Session Launch Dialog:**
```
┌─────────────────────────────────────────────────────────────┐
│  New Claude Code Session                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Project:                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Auto-Claude                                     [▼] │   │
│  └─────────────────────────────────────────────────────┘   │
│  Path: C:\Users\AlienZ\Desktop\Auto-Claude                  │
│                                                             │
│  Session Name (optional):                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Help with API refactor                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Options:                                                   │
│  ☑ Skip permissions (--dangerously-skip-permissions)       │
│  ☐ Resume previous session (--resume)                      │
│  ☐ Custom working directory                                │
│                                                             │
│  [Cancel]                              [Start Session]      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```typescript
// ClaudeCodeSessions.tsx - New component for Terminals page
interface ClaudeSession {
  id: string;
  name?: string;
  projectPath: string;
  startedAt: Date;
  status: 'active' | 'closed';
  processId?: number;
}

function ClaudeCodeSessions() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);

  const launchSession = async (options: LaunchOptions) => {
    const { projectPath, skipPermissions, resume, sessionName } = options;

    // Build command
    const args = [];
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    if (resume) args.push('--resume');

    // Launch Claude Code process
    const result = await ipcRenderer.invoke('LAUNCH_CLAUDE_CODE', {
      workingDirectory: projectPath,
      args,
      sessionName
    });

    // Track the session
    setSessions(prev => [...prev, {
      id: result.sessionId,
      name: sessionName,
      projectPath,
      startedAt: new Date(),
      status: 'active',
      processId: result.pid
    }]);
  };

  const openSession = (sessionId: string) => {
    // Focus/bring to front the terminal for this session
    ipcRenderer.invoke('FOCUS_CLAUDE_SESSION', sessionId);
  };

  return (
    <div className="claude-code-sessions">
      <header>
        <h1>Claude Code Sessions</h1>
        <Button onClick={() => setShowNewDialog(true)}>
          + New Session
        </Button>
      </header>

      <div className="sessions-list">
        {sessions.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            onOpen={() => openSession(session.id)}
            onResume={() => resumeSession(session.id)}
          />
        ))}
      </div>

      <NewSessionDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onLaunch={launchSession}
      />
    </div>
  );
}
```

**Backend Handler:**
```typescript
// In main process
ipcMain.handle('LAUNCH_CLAUDE_CODE', async (event, options) => {
  const { workingDirectory, args, sessionName } = options;

  // Path to Claude Code executable
  const claudePath = 'C:\\Users\\AlienZ\\.local\\bin\\claude.exe';

  // Spawn process
  const child = spawn(claudePath, args, {
    cwd: workingDirectory,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Track session
  const sessionId = generateId();
  activeSessions.set(sessionId, {
    process: child,
    name: sessionName,
    workingDirectory
  });

  // Create PTY terminal for UI embedding
  const pty = createPty(child);

  return {
    sessionId,
    pid: child.pid
  };
});
```

**Embedded Terminal View:**
When user clicks "Open" on an active session:
```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code: Help with API refactor              [−] [×]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ╭─────────────────────────────────────────────────────────╮│
│  │ claude> What would you like help with?                  ││
│  │                                                         ││
│  │ You: Can you help me refactor the API endpoints to      ││
│  │      use async/await instead of callbacks?              ││
│  │                                                         ││
│  │ Claude: I'll help you refactor the API endpoints. Let   ││
│  │         me first look at your current implementation... ││
│  │                                                         ││
│  │ Reading: src/api/users.js                              ││
│  │ Reading: src/api/products.js                           ││
│  │                                                         ││
│  │ I found 5 files with callback-based APIs...            ││
│  ╰─────────────────────────────────────────────────────────╯│
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Type your message...                          [Send] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Summary: Two Types of Terminals

| Feature | Task Terminal | Claude Code Session |
|---------|--------------|---------------------|
| **Location** | Button on task card → opens modal | Dedicated sidebar page ("Claude Code") |
| **Purpose** | Watch automated agent work + interact | Freeform coding help |
| **Control** | Automated (agent-driven) + user input | Manual (user-driven) |
| **Lifecycle** | Tied to task | Independent |
| **Use Case** | "What is Jerry doing?" + "Hey Jerry, also do X" | "Help me with X" |

#### Migration: Remove Task Terminals from Terminals Page

**Current Terminals page shows:** Task-bound agent outputs (one per task)
**After migration:** Only Claude Code sessions (user-launched)

**What to remove:**
- All task-specific terminal views from Terminals page
- Task terminal list/grid on Terminals page

**What to keep:**
- Task terminal button on task cards (opens modal)
- Terminal output history per task (stored, accessible from task)

**Sidebar rename:**
```
Before: "Terminals"     → Shows task agent outputs
After:  "Claude Code"   → Shows user-launched sessions only
```

**Impact:**
- Task context stays with tasks (via task card terminal button)
- Users get direct Claude Code access for ad-hoc work
- Clear separation: automated (Jerry on tasks) vs manual (user with Claude)
- Cleaner Terminals/Claude Code page - only shows what YOU launched

---

### 2. "Quick Task" from Anywhere
**Current:** Must go to Chat to create tasks
**Suggestion:** Global keyboard shortcut (Cmd+K) to create task from anywhere

```
Press Cmd+K anywhere:
┌─────────────────────────────────────────────┐
│  🚀 Quick Task                              │
│  ┌───────────────────────────────────────┐  │
│  │ Add dark mode toggle to settings...   │  │
│  └───────────────────────────────────────┘  │
│  [Create Task] or press Enter               │
└─────────────────────────────────────────────┘
```

**Impact:** Faster task creation, better flow

---

### 3. Task Progress Percentage
**Current:** Phase badges show what's happening
**Suggestion:** Add progress bar/percentage

```
┌─────────────────────────────────────────────┐
│  Task: Implement API endpoints              │
│  Status: Coding | Phase: Implementing       │
│  ████████████░░░░░░░░ 60%                   │
│  Subtask 3 of 5: Add validation             │
└─────────────────────────────────────────────┘
```

**Impact:** Better visibility into completion state

---

### 4. "Resume" Button for Interrupted Tasks
**Current:** Tasks can get stuck, need recovery
**Suggestion:** Simple "Resume" button on stuck tasks

```
┌─────────────────────────────────────────────┐
│  Task: Fix login bug                        │
│  Status: Coding | ⚠️ Interrupted            │
│                                             │
│  [Resume] [View Error] [Restart]            │
└─────────────────────────────────────────────┘
```

**Impact:** Easier recovery, less confusion

---

## Medium Effort Ideas

### 5. Task Templates
**Current:** Each task starts from scratch
**Suggestion:** Templates for common task types

```
Create Task:
┌─────────────────────────────────────────────┐
│  Start from template:                       │
│  ○ Blank task                               │
│  ○ Bug fix (includes test requirements)     │
│  ○ New feature (includes docs requirement)  │
│  ○ Refactoring (includes before/after)      │
│  ○ API endpoint (includes schema, tests)    │
└─────────────────────────────────────────────┘
```

**Impact:** Faster setup, better specs

---

### 6. Task Dependencies / Ordering
**Current:** Tasks are independent
**Suggestion:** Allow "Task B depends on Task A"

```
Task A: Create user model ──┐
                            ├──► Task C: Add login
Task B: Create auth service ┘
```

**Why:** Some tasks naturally depend on others. Showing this helps prioritization.

**Impact:** Better planning, clearer workflow

---

### 7. Bulk Operations
**Current:** Must handle tasks one at a time
**Suggestion:** Select multiple tasks, bulk actions

```
☑ Task 1: Fix typo
☑ Task 2: Update deps
☑ Task 3: Add tests

[Archive Selected] [Start All] [Delete]
```

**Note:** I see there's already some bulk PR creation. Extend this pattern.

**Impact:** Faster management of many tasks

---

### 8. Global Search
**Current:** No way to search across everything
**Suggestion:** Cmd+P to search tasks, ideas, files, specs

```
┌─────────────────────────────────────────────┐
│  🔍 Search everything...                    │
│  ┌───────────────────────────────────────┐  │
│  │ authentication                        │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Tasks:                                     │
│  → Add user authentication (#003)           │
│  → Fix auth token refresh (#012)            │
│                                             │
│  Ideas:                                     │
│  → Improve: Auth error handling             │
│                                             │
│  Files:                                     │
│  → src/services/auth.ts                     │
└─────────────────────────────────────────────┘
```

**Impact:** Faster navigation, better discoverability

---

### 9. Activity Feed / Timeline
**Current:** No history of what happened
**Suggestion:** Timeline showing recent activity

```
Activity:
┌─────────────────────────────────────────────┐
│  Today                                      │
│  • 2:30 PM - Task "Add login" completed     │
│  • 1:15 PM - Spec ready for "API update"    │
│  • 11:00 AM - Started "Fix bug #42"         │
│                                             │
│  Yesterday                                  │
│  • 4:00 PM - PR merged for "Dark mode"      │
└─────────────────────────────────────────────┘
```

**Impact:** Better awareness, helps track progress

---

### 10. Estimated Completion
**Current:** No time estimates
**Suggestion:** Show estimated completion based on:
- Subtask count
- Historical data (similar tasks)
- Current progress rate

```
Task: Implement feature X
Progress: 40%
Estimated: ~15 minutes remaining
(Based on 3 similar completed tasks)
```

**Note:** This is tricky and can be misleading. Maybe optional.

**Impact:** Better expectation setting

---

## Larger Ideas (Higher Effort)

### 11. "Watch Mode" - Continuous Improvement
**Current:** Tasks are one-shot
**Suggestion:** Set a task to "watch" for regressions

```
Task: Ensure tests pass
Mode: ☑ Watch (re-run on file changes)

When files change:
→ Re-run affected tests
→ Alert if failures introduced
→ Offer to auto-fix
```

**Impact:** Proactive quality maintenance

---

### 12. Collaboration / Team Features
**Current:** Single-user experience
**Suggestion:** Basic team features

- Share specs for review
- Assign tasks to team members
- Comment on tasks
- Approval workflows

**Impact:** Enable team usage

---

### 13. Custom Workflows
**Current:** Fixed pipeline (Planning → Coding → Review → Done)
**Suggestion:** Allow custom stages

```
Workflow Editor:
Planning → [Design Review] → Coding → Testing → [Security Review] → Done
              ↑                                        ↑
           Custom                                   Custom
```

**Impact:** Adapt to different team processes

---

### 14. Analytics Dashboard
**Current:** No insights into usage
**Suggestion:** Dashboard showing:

- Tasks completed per week
- Average time per phase
- Success rate (tasks completed vs abandoned)
- Most common task types
- Cost tracking (API usage)

```
┌─────────────────────────────────────────────┐
│  This Week                                  │
│  ├── 12 tasks completed                     │
│  ├── Avg time: 8 min planning, 25 min code  │
│  ├── 92% success rate                       │
│  └── Top category: Bug fixes (5)            │
└─────────────────────────────────────────────┘
```

**Impact:** Better understanding of productivity

---

### 15. Offline Mode / Local-First
**Current:** Requires API connection
**Suggestion:** Cache specs, allow offline spec editing

- Edit specs locally when offline
- Sync when back online
- Local LLM fallback option

**Impact:** Work anywhere, reduce API dependency

---

## UI/UX Polish

### 16. Better Empty States
**Current:** Basic "No tasks" messages
**Suggestion:** Helpful empty states with actions

```
┌─────────────────────────────────────────────┐
│  🎯 No tasks in Coding                      │
│                                             │
│  Tasks move here when you click             │
│  "Start Build" on a planned task.           │
│                                             │
│  [View Planning Tasks] [Create New Task]    │
└─────────────────────────────────────────────┘
```

**Impact:** Better guidance, reduced confusion

---

### 17. Keyboard Navigation
**Current:** Mouse-focused
**Suggestion:** Full keyboard navigation

- `j/k` - Navigate tasks
- `Enter` - Open selected
- `s` - Start/Stop task
- `a` - Approve (in review)
- `?` - Show all shortcuts

**Impact:** Power user efficiency

---

### 18. Notification Preferences
**Current:** (Unknown notification state)
**Suggestion:** Granular notification control

```
Notifications:
☑ Spec ready for review
☑ Task completed
☐ Task failed (show in-app only)
☐ Sound alerts
☑ Desktop notifications
```

**Impact:** Reduce noise, improve signal

---

### 19. Quick Actions on Hover
**Current:** Click to open, then find action
**Suggestion:** Show actions on task hover

```
┌─────────────────────────────────────────────┐
│  Task: Fix login bug                        │
│                              [▶] [■] [⋮]   │
│                              Start Stop More │
└─────────────────────────────────────────────┘
```

**Impact:** Faster actions, fewer clicks

---

### 20. "What's Jerry Doing?" Explainer
**Current:** Technical phase labels
**Suggestion:** Human-friendly explanations

```
Current Activity:
┌─────────────────────────────────────────────┐
│  🤖 Jerry is reading your codebase...       │
│                                             │
│  Analyzing 23 files to understand how       │
│  authentication currently works before      │
│  making changes.                            │
│                                             │
│  ████████░░░░░░░░░░░░ 40%                   │
│  Usually takes 1-2 minutes                  │
└─────────────────────────────────────────────┘
```

**Impact:** Reduce anxiety, build trust

---

### 21. Remove or Fix Project Settings Icon
**Current:** Settings icon next to project name in header opens general Settings
**Problem:**
- Redundant - Settings button already exists in bottom left corner
- Misleading - Icon next to project name suggests "Project Settings" but opens general Settings

```
Current:
┌─────────────────────────────────────────────┐
│  GameGenerator  ⚙️  ← Opens general settings │
│                     (same as bottom left)    │
└─────────────────────────────────────────────┘

Option A - Remove:
┌─────────────────────────────────────────────┐
│  GameGenerator      ← No redundant icon     │
└─────────────────────────────────────────────┘

Option B - Fix behavior:
┌─────────────────────────────────────────────┐
│  GameGenerator  ⚙️  ← Opens Project Settings │
│                     directly (not general)   │
└─────────────────────────────────────────────┘
```

**Recommendation:** Option A (remove) - cleaner UI, less confusion
**Impact:** Cleaner header, reduced confusion

---

### 22. Task Creation Modal - Ralph UI
**See:** [RALPH_IMPLEMENTATION_GUIDE.md](RALPH_IMPLEMENTATION_GUIDE.md#sug-22-update-task-creation-modal---ralph-ui)

---

### 23. Persistent Learning Memory (Institutional Knowledge)
**Current:** Each task starts fresh with no memory of past mistakes
**Problem:** Jerry repeats the same errors across tasks, doesn't learn from AI review findings

**EXISTING FOUNDATION:** The `QAFeedbackSection.tsx` component already captures user feedback when they "Request Changes" in human review. This is the perfect starting point!

**Concept:** Create a persistent "learnings" system that:
1. **Captures lessons** from errors and AI review findings
2. **Stores them** in a project-level knowledge base
3. **Injects relevant learnings** into future task prompts
4. **Prevents repeating mistakes** across tasks

#### How It Would Work

```
┌─────────────────────────────────────────────────────────────────┐
│  LEARNING CAPTURE FLOW                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. ERROR OCCURS                                                │
│     └─ Build fails: "Missing null check in user.ts:42"          │
│                                                                 │
│  2. PATTERN EXTRACTED                                           │
│     └─ "Always add null checks when accessing nested objects"   │
│                                                                 │
│  3. LEARNING STORED                                             │
│     └─ .auto-build/learnings.json (or LEARNINGS.md)             │
│                                                                 │
│  4. FUTURE TASKS                                                │
│     └─ Relevant learnings injected into planning/coding prompts │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Learning Sources

| Source | Trigger | Example Learning |
|--------|---------|------------------|
| Build errors | TypeScript/lint error | "Always import types from shared/types" |
| Test failures | Test fails | "Mock external APIs in unit tests" |
| AI Review | QA agent finds issue | "Add error boundaries around async components" |
| **Human Review** | **User clicks "Request Changes"** | **"Follow project's naming conventions for hooks"** |
| User feedback | User corrects agent | "Use project's existing Button component, don't create new ones" |

#### Extending QAFeedbackSection (Existing Component)

**File:** `src/renderer/components/task-detail/task-review/QAFeedbackSection.tsx`

The existing "Request Changes" button in human review already captures:
- Text feedback describing the issue
- Screenshots/images showing the problem

**Proposed Extension:** Add a "Save as Learning" checkbox:

```tsx
// In QAFeedbackSection.tsx - add to existing component

interface QAFeedbackSectionProps {
  // ... existing props
  onSaveAsLearning?: (learning: LearningEntry) => void;
}

// Add checkbox to UI
<div className="flex items-center gap-2 mt-2">
  <input
    type="checkbox"
    checked={saveAsLearning}
    onChange={(e) => setSaveAsLearning(e.target.checked)}
  />
  <label className="text-sm text-muted-foreground">
    Save as learning for future tasks
  </label>
</div>

// When submitting feedback, also create learning if checked
const handleSubmitFeedback = async () => {
  await onReject(); // existing behavior

  if (saveAsLearning && feedback.trim()) {
    await onSaveAsLearning?.({
      id: generateLearningId(),
      source: 'human_review',
      taskId: currentTaskId,
      timestamp: new Date().toISOString(),
      originalFeedback: feedback,
      // AI will extract the pattern from this
      pattern: null, // To be filled by extraction
      images: images
    });
  }
};
```

**UI Mockup (Extended QAFeedbackSection):**
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Request Changes                                         │
│                                                             │
│  Found issues? Describe what needs to be fixed...           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ The component uses inline styles. Please use the    │   │
│  │ existing CSS modules in styles/ directory instead.  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [📷 screenshot1.png]  [📷 screenshot2.png]                 │
│                                                             │
│  ☑ Save as learning for future tasks                        │
│    └─ "Jerry will remember this for similar tasks"          │
│                                                             │
│  [🔄 Request Changes]                                       │
└─────────────────────────────────────────────────────────────┘
```

When checked, after submitting:
1. Feedback is sent to AI for fixing (existing behavior)
2. Feedback is also sent to AI for pattern extraction
3. Extracted pattern is stored in learnings database
4. Future tasks receive this learning in their prompts

#### Storage Format (LEARNINGS.md)

```markdown
# Project Learnings

## Coding Patterns

### L001: Null Safety
**Source:** Build error (2026-02-03)
**Context:** user.ts:42 - TypeError accessing nested property
**Learning:** Always add null checks or use optional chaining (`?.`) when accessing nested objects
**Applies to:** All TypeScript files

### L002: Component Library
**Source:** Human review (2026-02-03)
**Context:** User rejected custom Button, asked to use existing
**Learning:** Use existing components from `src/components/ui/` instead of creating new ones. Check existing components first.
**Applies to:** React components

### L003: API Error Handling
**Source:** AI Review (2026-02-03)
**Context:** QA found unhandled promise rejection
**Learning:** Always wrap API calls in try/catch. Use the `handleApiError()` utility from `src/utils/api.ts`
**Applies to:** API integration code
```

#### Prompt Injection

When starting a new task, Jerry loads relevant learnings:

```markdown
# Task: Add user profile page

## Project Learnings (IMPORTANT - Follow These)

Based on past experience with this codebase:

1. **Null Safety (L001):** Always use optional chaining (`?.`) for nested objects
2. **Component Library (L002):** Use existing components from `src/components/ui/`
3. **API Error Handling (L003):** Wrap API calls in try/catch, use `handleApiError()`

---

{rest of spec.md}
```

#### Implementation Approach

**Phase 1: Manual Capture**
- Add "Save as Learning" button on error toasts
- User confirms and categorizes the learning
- Stored in `.auto-build/learnings.json`

**Phase 2: Automatic Extraction**
- AI extracts patterns from errors
- Suggests learnings for user approval
- Auto-categorizes by file type/feature

**Phase 3: Smart Injection**
- Semantic matching: Only inject relevant learnings
- Context-aware: Different learnings for different task types
- Decay: Old learnings can be marked as outdated

#### Files to Create/Modify

| File | Purpose |
|------|---------|
| `.auto-build/learnings.json` | Storage for learnings |
| `src/main/learnings/learnings-manager.ts` | CRUD operations for learnings |
| `src/main/learnings/learning-extractor.ts` | Extract patterns from errors |
| `src/main/agent/planning-agent.ts` | Inject learnings into prompts |
| `src/renderer/components/LearningCapture.tsx` | UI for capturing learnings |
| `src/renderer/components/LearningsPanel.tsx` | View/manage learnings |

#### UI Mockups

**Error Toast with Learning Capture:**
```
┌─────────────────────────────────────────────┐
│ ❌ Build Error                              │
│                                             │
│ TypeError: Cannot read property 'name'      │
│ of undefined at user.ts:42                  │
│                                             │
│ [Dismiss]  [Save as Learning]               │
└─────────────────────────────────────────────┘
```

**Learnings Panel in Settings:**
```
┌─────────────────────────────────────────────────────────────┐
│  PROJECT LEARNINGS                              [+ Add]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📚 Coding Patterns (3)                                     │
│  ├─ L001: Null Safety                          [Edit] [×]   │
│  ├─ L002: Component Library                    [Edit] [×]   │
│  └─ L003: API Error Handling                   [Edit] [×]   │
│                                                             │
│  🧪 Testing (1)                                             │
│  └─ L004: Mock External APIs                   [Edit] [×]   │
│                                                             │
│  📝 Documentation (0)                                       │
│  └─ No learnings yet                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Impact:**
- **High** - Prevents repeating mistakes across tasks
- Builds project-specific "institutional knowledge"
- Makes Jerry smarter over time for YOUR codebase
- Like training a junior dev who actually remembers feedback

**Complexity:** Medium-High (requires prompt injection, storage, UI)

**Note:** This is similar to how humans learn - we remember past mistakes and apply those lessons to new situations. Jerry should do the same.

---

## Summary by Priority

### Do First (Quick Wins)
| # | Suggestion | Effort | Impact |
|---|------------|--------|--------|
| 3 | Progress percentage | Low | High |
| 4 | Resume button | Low | High |
| 16 | Better empty states | Low | Medium |
| 19 | Quick actions on hover | Low | Medium |

### Do Next (Medium Value)
| # | Suggestion | Effort | Impact |
|---|------------|--------|--------|
| 1 | Terminals in task detail | Medium | High |
| 2 | Quick task shortcut | Medium | High |
| 8 | Global search | Medium | High |
| 20 | Activity explainer | Medium | Medium |

### Consider Later (Larger Investment)
| # | Suggestion | Effort | Impact |
|---|------------|--------|--------|
| 5 | Task templates | Medium | High |
| 9 | Activity feed | Medium | Medium |
| 12 | Team features | High | High |
| 14 | Analytics dashboard | High | Medium |

---

## Notes

These are brainstormed ideas based on:
- Exploring the current codebase
- Common patterns in developer tools
- UX best practices

Not all are necessary - pick what aligns with your vision for Jerry!

---

**End of Suggestions**
