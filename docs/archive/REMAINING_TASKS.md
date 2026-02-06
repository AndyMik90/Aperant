# Remaining Tasks Guide

**Version:** 3.2
**Date:** 2026-02-04
**Status:** ✅ ALL 9 v3.2 TASKS VERIFIED COMPLETE (audit 2026-02-04)
**Audit:** See `docs/SPEC_VS_CODE_AUDIT_REPORT_v2.md` for verification details

---

## Overview - Post v2.5 Audit

After Ralph v2.3 (42 tasks) + v2.5 (5 tasks) = **47/49 tasks complete (96%)**

### Tasks Completed by v2.5:
| ID | Task | Status |
|----|------|--------|
| FIX-5 | Terminal readability | ✅ Done |
| SUG-6 | Task dependencies | ✅ Done |
| SUG-23 | Persistent Learning Memory | ✅ Done |
| UI-3 | Remove border-radius | ✅ Done |
| UI-4 | Cyan glow effects | ✅ Done |

### Decisions Made:
| Original Task | Decision | Reason |
|---------------|----------|--------|
| UI-6: Redesign sidebar | ❌ **SKIP** | Current sidebar already works well, VSCode-style |
| NAV-8: GitHub footer icons | 🔄 **CHANGED** | Combine into one "GitHub" page instead |

### v3.2 Tasks - ALL COMPLETE (Verified 2026-02-04):
| ID | Task | Status | Code Location |
|----|------|--------|---------------|
| NAV-8 | Merge GitHub Issues + PRs into one "GitHub" page | ✅ DONE | GitHubHub.tsx with tabs |
| CLAUDE-1 | Remove task terminal columns from Claude Code page | ✅ DONE | TerminalGrid.tsx:47-53 (excludes task monitors) |
| CLAUDE-2 | Add "+ New Claude Code" button | ✅ DONE | TerminalGrid.tsx:241-253, 421-430 |
| CHAT-1 | Add "See in Kanban" button after task creation | ✅ DONE | Insights.tsx:517-521 |
| FIX-12 | Task card text clipping - fix overflow | ✅ DONE | TaskCard.tsx:589-604 (truncate, line-clamp-3) |
| FIX-13 | Status badge shows "Pending" - should show actual phase | ✅ DONE | TaskCard.tsx:477-534, 656-691 |
| FIX-14 | Hide "Start Build" button until spec is ready | ✅ DONE | TaskCard.tsx:856-922 |
| FIX-15 | Remove context menu dots (⋮) - drag feature was removed | ✅ DONE | No DropdownMenu in TaskCard.tsx |
| FIX-16 | Terminal button click also opens Task Detail modal | ✅ DONE | TaskCard.tsx:430 (stopPropagation) |

**Additional fixes found implemented but not documented:**
| ID | Description | Code Location |
|----|-------------|---------------|
| FIX-21 | Inline terminal expansion | TaskCard.tsx:969-991 |
| FIX-22 | Animated activity indicator | TaskCard.tsx:570-572 |

---

## Task 1: NAV-8 - Combine GitHub Pages

⚠️ **REQUIRED - DO NOT SKIP**

### What
Merge GitHub Issues and GitHub PRs into a single "GitHub" page with tabs (same pattern as Discovery Hub = Roadmap + Ideation).

### Current State
```
Sidebar:
├─ GitHub Issues (separate page)
└─ GitHub PRs (separate page)
```

### Target State
```
Sidebar:
└─ GitHub (single page)
    ├─ [Issues] tab
    └─ [Pull Requests] tab
```

### Implementation

**Step 1 of 4: Create GitHubHub Component**
**Files:** `apps/frontend/src/renderer/components/GitHubHub.tsx` (new)
**What:** Create component with tabs for Issues and PRs (copy pattern from DiscoveryHub.tsx)
**Exit:** Component renders with two tabs

**Step 2 of 4: Move Existing Content**
**Files:** `GitHubHub.tsx`, reference existing GitHub components
**What:** Import existing GitHub Issues and PRs components as tab content
**Exit:** Both tabs show correct content

**Step 3 of 4: Update Sidebar Navigation**
**Files:** `apps/frontend/src/renderer/components/Sidebar.tsx`
**What:** Replace two GitHub nav items with single "GitHub" item
**Exit:** Sidebar shows one GitHub icon

**Step 4 of 4: Update App Routing**
**Files:** `apps/frontend/src/renderer/App.tsx`
**What:** Add GitHubHub to view routing, remove old separate views
**Exit:** Navigation works correctly

### Completion Promise
```
<promise>NAV_8_GITHUB_HUB_COMPLETE</promise>
```

---

## Task 2: CLAUDE-1 - Remove Task Terminal Columns

⚠️ **REQUIRED - DO NOT SKIP**

### What
The Claude Code page currently shows task terminals grouped by status (Planning, In Progress, AI Review, Human Review). **These columns are ACTIVELY creating terminals** when tasks run. Since SUG-1a added TaskTerminalModal (accessible from task cards in Kanban), these columns are redundant and cause duplicate terminal creation.

**After this change:**
- Task terminals will ONLY be accessible via Kanban task cards (click Terminal button)
- Claude Code page will only show user-created terminals (bash, Claude Code sessions)
- No more duplicate terminal creation

### Current State
```
┌────────────────────────────────────────────────────────────────────────┐
│ Planning │ In Progress │ AI Review │ Human Review │ Terminals          │
│   0      │     0       │    0      │      0       │  [Terminal 1]      │
└────────────────────────────────────────────────────────────────────────┘
```

### Target State
```
┌────────────────────────────────────────────────────────────────────────┐
│ [+ New Terminal] [+ New Claude Code]                       [Files]     │
├────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Terminal 1                                                       │  │
│  │ C:\Users\AlienZ\Desktop\GameGenerator>                          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Implementation

**Step 1 of 3: Remove Task Status Columns**
**Files:** `apps/frontend/src/renderer/components/TerminalGrid.tsx`
**What:** Remove the Planning/In Progress/AI Review/Human Review column logic and rendering
**Exit:** No more task status columns

**Step 2 of 3: Update Layout**
**Files:** `apps/frontend/src/renderer/components/TerminalGrid.tsx`
**What:** Change from 5-column Kanban layout to simple terminal grid/list
**Exit:** Clean terminal grid showing only regular terminals

**Step 3 of 3: Update Header**
**Files:** `apps/frontend/src/renderer/components/TerminalGrid.tsx`
**What:** Update header to show terminal count
**Exit:** Header shows "2 terminals" style info

### Completion Promise
```
<promise>CLAUDE_1_REMOVE_TASK_COLUMNS_COMPLETE</promise>
```

---

## Task 3: CLAUDE-2 - Add "+ New Claude Code" Button

⚠️ **REQUIRED - DO NOT SKIP**

### What
Add a "+ New Claude Code" button next to the existing "+ New Terminal" button. Users can quickly launch Claude Code without typing `claude` in a terminal.

### Current State
```
[+ New Terminal Ctrl+T]  [Files]
```

### Target State
```
[+ New Terminal Ctrl+T]  [+ New Claude Code]  [Files]
```

### Implementation

**Step 1 of 4: Add Button to Header**
**Files:** `apps/frontend/src/renderer/components/TerminalGrid.tsx`
**What:** Add "New Claude Code" button next to "New Terminal" button
**Exit:** Button visible in header

**Step 2 of 4: Create Launch Handler**
**Files:** `apps/frontend/src/renderer/stores/terminal-store.ts`
**What:** Add `addClaudeCodeTerminal()` function that creates terminal and runs `claude` command
**Exit:** Function can launch Claude Code in a terminal

**Step 3 of 4: Add IPC Handler (if needed)**
**Files:** `apps/frontend/src/main/ipc-handlers/terminal-handlers.ts`
**What:** Add handler to spawn Claude Code process with --dangerously-skip-permissions
**Exit:** Backend can launch Claude Code

**Step 4 of 4: Style Button**
**Files:** Component styles
**What:** Style with cyan accent to differentiate from regular terminal button
**Exit:** Button has distinct visual style (cyan glow)

### Completion Promise
```
<promise>CLAUDE_2_NEW_CLAUDE_CODE_BUTTON_COMPLETE</promise>
```

---

## Task 4: CHAT-1 - Add "See in Kanban" Button

⚠️ **REQUIRED - DO NOT SKIP**

### What
After a task is created in Chat, show a "See in Kanban" button that navigates to the Kanban board.

### Current State
```
┌─────────────────────────────────────────────────────────────┐
│ ✓ Task Created                                              │
└─────────────────────────────────────────────────────────────┘
```

### Target State
```
┌─────────────────────────────────────────────────────────────┐
│ ✓ Task Created                        [See in Kanban →]     │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**Step 1 of 3: Find Task Creation UI**
**Files:** `apps/frontend/src/renderer/components/chat/` (find component showing "Task Created")
**What:** Locate where "Task Created" message is rendered
**Exit:** Found the correct component

**Step 2 of 3: Add Navigation Button**
**Files:** The component found in Step 1
**What:** Add "See in Kanban" button next to "Task Created" status
**Exit:** Button appears after task creation

**Step 3 of 3: Implement Navigation**
**Files:** Same component + App.tsx or navigation store
**What:** Button click sets activeView to 'kanban' or 'tasks'
**Exit:** Clicking button navigates to Kanban board

### Completion Promise
```
<promise>CHAT_1_SEE_IN_KANBAN_COMPLETE</promise>
```

---

## Task 5: FIX-12 - Task Card Text Clipping

⚠️ **REQUIRED - DO NOT SKIP**

### What
Task card title and description text clips/truncates improperly. Should wrap or show ellipsis within column width.

### Current State
- Title can overflow and get cut off
- Description text clips awkwardly

### Target State
- Title: Single line with ellipsis if too long, full text on hover tooltip
- Description: 2-3 lines max with ellipsis, proper word wrapping

### Implementation

**Step 1 of 2: Fix CSS Overflow**
**Files:** `apps/frontend/src/renderer/components/TaskCard.tsx`, related CSS
**What:** Add proper text-overflow, white-space, and overflow properties
**Exit:** Text truncates cleanly with ellipsis

**Step 2 of 2: Add Tooltip for Full Text**
**Files:** `TaskCard.tsx`
**What:** Show full title on hover tooltip
**Exit:** Users can see full title by hovering

### Completion Promise
```
<promise>FIX_12_TEXT_CLIPPING_COMPLETE</promise>
```

---

## Task 6: FIX-13 - Status Badge Shows Wrong Phase

⚠️ **REQUIRED - DO NOT SKIP**

### What
Task card shows "Pending" badge even when task is actively in Planning phase with agent running.

### Current State
```
[Pending] [Docs] [High Impact] [Large]
```

### Target State
```
[Planning] [Docs] [High Impact] [Large]    ← When planning agent running
[Spec Ready] [Docs] [High Impact] [Large]  ← When spec.md created
```

### Implementation

**Step 1 of 2: Use Actual Task Status**
**Files:** `apps/frontend/src/renderer/components/TaskCard.tsx`
**What:** Display `task.status` or `task.executionProgress.phase` instead of hardcoded "Pending"
**Exit:** Badge shows "Planning", "Coding", etc.

**Step 2 of 2: Add Contextual Labels**
**Files:** `TaskCard.tsx`
**What:** Use contextual labels like "Creating Spec...", "Implementing...", "Testing..."
**Exit:** Users see human-friendly phase descriptions

### Completion Promise
```
<promise>FIX_13_STATUS_BADGE_COMPLETE</promise>
```

---

## Task 7: FIX-14 - Hide Start Build Until Spec Ready

⚠️ **REQUIRED - DO NOT SKIP**

### What
"Start Build" button shows even during planning when spec isn't ready. This confuses users - they click it and get an error.

### Current State
```
[Stop] [Start Build]  ← Shows always, even during planning
```

### Target State
```
During Planning:     [Stop]                    ← Only Stop, no Start Build
Spec Ready:          [Review Spec] [Start Build] ← Both buttons appear
After Build Started: [Stop]                    ← Stop only during coding
```

### Implementation

**Step 1 of 3: Check Spec Ready Status**
**Files:** `apps/frontend/src/renderer/components/TaskCard.tsx`
**What:** Add condition to check if spec.md exists or task.specReady flag
**Exit:** Component knows when spec is ready

**Step 2 of 3: Conditionally Render Button**
**Files:** `TaskCard.tsx`
**What:** Only show "Start Build" when spec is ready AND status is 'planning'
**Exit:** Button hidden during active planning

**Step 3 of 3: Add "Review Spec" Button (optional)**
**Files:** `TaskCard.tsx`
**What:** When spec ready, show "Review Spec" to open spec.md before building
**Exit:** Users can review before starting build

### Completion Promise
```
<promise>FIX_14_HIDE_START_BUILD_COMPLETE</promise>
```

---

## Task 8: FIX-15 - Remove Context Menu Dots

⚠️ **REQUIRED - DO NOT SKIP**

### What
The three-dots menu (⋮) on task cards opens a context menu for moving tasks. Since PROP-1 disabled Kanban drag-and-drop (tasks move systematically), this menu is now useless/confusing.

### Current State
```
[Stop] [Start Build] [📋] [⋮]  ← Dots menu exists but feature removed
```

### Target State
```
[Stop] [Start Build] [📋]      ← No dots menu
```

### Implementation

**Step 1 of 1: Remove Menu Button**
**Files:** `apps/frontend/src/renderer/components/TaskCard.tsx`
**What:** Remove the DropdownMenu/context menu trigger button (⋮)
**Exit:** No more dots button on task cards

### Completion Promise
```
<promise>FIX_15_REMOVE_DOTS_MENU_COMPLETE</promise>
```

---

## Task 9: FIX-16 - Terminal Button Opens Task Detail

⚠️ **REQUIRED - DO NOT SKIP**

### What
Clicking the terminal button on a task card opens the terminal (correct) BUT also opens the Task Detail modal (wrong). This is an event propagation bug.

### Current Behavior
```
Click terminal button → Opens terminal + Opens Task Detail modal
```

### Expected Behavior
```
Click terminal button → Opens terminal ONLY
Double-click card → Opens Task Detail modal
```

### Implementation

**Step 1 of 1: Stop Event Propagation**
**Files:** `apps/frontend/src/renderer/components/TaskCard.tsx`
**What:** Add `e.stopPropagation()` to terminal button onClick handler
**Code:**
```tsx
onClick={(e) => {
  e.stopPropagation(); // Prevent bubbling to card's double-click
  openTerminal(task.id);
}}
```
**Exit:** Terminal button only opens terminal, not the detail modal

### Completion Promise
```
<promise>FIX_16_TERMINAL_BUTTON_PROPAGATION_COMPLETE</promise>
```

---

## Ralph Invocation Prompt (v3.2) - TESTED & WORKING

**Last Tested:** 2026-02-04 (jamie.ballard machine)
**Status:** ✅ Working

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer completing the remaining tasks for Auto-Claude (Jerry).

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- You do not get to decide if tasks are worth doing.
- If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\plans\REMAINING_TASKS.md      (read fully)
- docs\plans\RALPH_IMPLEMENTATION_GUIDE.md
- docs\plans\UI_DESIGN.md           (Tron Grid theme spec)
- docs\PROGRESS.md

---

TASKS (9 required – ALL MUST COMPLETE)

| # | Task                                      | Steps | Promise                                      |
|---|-------------------------------------------|-------|----------------------------------------------|
| 1 | NAV-8: Combine GitHub pages               | 4     | NAV_8_GITHUB_HUB_COMPLETE                    |
| 2 | CLAUDE-1: Remove task terminal columns    | 3     | CLAUDE_1_REMOVE_TASK_COLUMNS_COMPLETE        |
| 3 | CLAUDE-2: Add New Claude Code button      | 4     | CLAUDE_2_NEW_CLAUDE_CODE_BUTTON_COMPLETE     |
| 4 | CHAT-1: Add See in Kanban button          | 3     | CHAT_1_SEE_IN_KANBAN_COMPLETE                |
| 5 | FIX-12: Task card text clipping           | 2     | FIX_12_TEXT_CLIPPING_COMPLETE                |
| 6 | FIX-13: Status badge shows wrong phase    | 2     | FIX_13_STATUS_BADGE_COMPLETE                 |
| 7 | FIX-14: Hide Start Build until spec ready | 3     | FIX_14_HIDE_START_BUILD_COMPLETE             |
| 8 | FIX-15: Remove context menu dots          | 1     | FIX_15_REMOVE_DOTS_MENU_COMPLETE             |
| 9 | FIX-16: Terminal button event propagation | 1     | FIX_16_TERMINAL_BUTTON_PROPAGATION_COMPLETE  |

FINAL COMPLETION PROMISE:
- <promise>REMAINING_TASKS_V3_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 9-TASK JOB – Do NOT stop until all 9 tasks are complete.
2. ALL REQUIRED – Every task is REQUIRED; no skipping allowed except under explicit rules below.
3. NO SUMMARIES – Progress summaries are NOT stopping points.
4. CONTINUATION – After each step you complete, immediately say:
   NEXT: [next step]
   and then continue working on that next step.

---

ANTI-SKIP RULES

You may NOT skip because:
- Task seems complex.
- Current implementation 'works well'.
- You prefer a different design.
- Task requires major changes.

You may ONLY skip if:
- There is a real error after 3 distinct fix attempts, OR
- A required file genuinely does not exist, OR
- A dependency is genuinely missing.

If you skip, you MUST:
- Document it in docs\PROGRESS.md (what you tried, exact errors, concrete reason, approval required).
- Mark the task as blocked, not complete.

---

EXECUTION PROTOCOL

1. Read docs\plans\REMAINING_TASKS.md fully.

2. Task 1 (NAV-8):
   - Complete steps 1–4 from REMAINING_TASKS.md.
   - Then output: <promise>NAV_8_GITHUB_HUB_COMPLETE</promise>
   - Say: NEXT: Task 2 and begin Task 2.

3. Task 2 (CLAUDE-1):
   - Complete steps 1–3.
   - Then output: <promise>CLAUDE_1_REMOVE_TASK_COLUMNS_COMPLETE</promise>
   - Say: NEXT: Task 3.

4. Task 3 (CLAUDE-2):
   - Complete steps 1–4.
   - Then output: <promise>CLAUDE_2_NEW_CLAUDE_CODE_BUTTON_COMPLETE</promise>
   - Say: NEXT: Task 4.

5. Task 4 (CHAT-1):
   - Complete steps 1–3.
   - Then output: <promise>CHAT_1_SEE_IN_KANBAN_COMPLETE</promise>
   - Say: NEXT: Task 5.

6. Task 5 (FIX-12):
   - Complete steps 1–2.
   - Then output: <promise>FIX_12_TEXT_CLIPPING_COMPLETE</promise>
   - Say: NEXT: Task 6.

7. Task 6 (FIX-13):
   - Complete steps 1–2.
   - Then output: <promise>FIX_13_STATUS_BADGE_COMPLETE</promise>
   - Say: NEXT: Task 7.

8. Task 7 (FIX-14):
   - Complete steps 1–3.
   - Then output: <promise>FIX_14_HIDE_START_BUILD_COMPLETE</promise>
   - Say: NEXT: Task 8.

9. Task 8 (FIX-15):
   - Complete step 1.
   - Then output: <promise>FIX_15_REMOVE_DOTS_MENU_COMPLETE</promise>
   - Say: NEXT: Task 9.

10. Task 9 (FIX-16):
    - Complete step 1.
    - Then output: <promise>FIX_16_TERMINAL_BUTTON_PROPAGATION_COMPLETE</promise>
    - Say: NEXT: Verify.

11. Verification:
    - Run: npm run build
    - Fix any errors introduced by your changes until the build is clean.

12. Final completion:
    - ONLY when:
      - All 9 task promises above have been emitted, AND
      - npm run build succeeds without new errors,
      - THEN output: <promise>REMAINING_TASKS_V3_COMPLETE</promise>

---

HARD STOP RULE

- You may NOT stop, summarize, or treat this job as done until:
  - All 9 task promises have been output, AND
  - npm run build is passing, AND
  - <promise>REMAINING_TASKS_V3_COMPLETE</promise> has been truthfully emitted.

- If you find yourself writing 'excellent progress', 'good work today', or any wrap-up style language while tasks remain:
  - STOP that thought.
  - Check how many of the 9 tasks are still incomplete.
  - Continue working and end the turn with a concrete NEXT: ... action.

CURRENT STATUS: 0 of 9 tasks complete. BEGIN NOW.
" --max-iterations 200 --completion-promise "REMAINING_TASKS_V3_COMPLETE"
```

### Key Formatting Notes (for future prompts)

1. **Use plain text headers** - `YOUR IDENTITY:` not `**YOUR IDENTITY:**`
2. **Use en-dashes** - `9-TASK JOB –` works better than markdown bold
3. **Numbered sub-steps** - Explicit step-by-step protocol prevents skipping
4. **Clear promise output format** - `Then output: <promise>...</promise>`
5. **NEXT: pattern** - Forces continuation between tasks

---

## Verification Checklist

After all tasks complete:
- [ ] GitHub page has tabs for Issues and Pull Requests
- [ ] Only one GitHub icon in sidebar (not two)
- [ ] Claude Code page has NO task status columns (Planning, In Progress, etc.)
- [ ] "+ New Claude Code" button exists and launches Claude Code
- [ ] "See in Kanban" button appears after task creation in Chat
- [ ] Clicking "See in Kanban" navigates to Kanban board
- [ ] Task card text doesn't clip - uses ellipsis properly
- [ ] Task card shows actual phase (Planning, Coding, etc.) not "Pending"
- [ ] "Start Build" button hidden during active planning
- [ ] No context menu dots (⋮) on task cards
- [ ] Terminal button click doesn't also open Task Detail modal
- [ ] Build passes: `npm run build`
- [ ] No TypeScript errors

---

**9 tasks. 22 steps. Execute, don't evaluate!**
