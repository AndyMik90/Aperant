# Chat Overhaul — Jerry's Insights Page

**Date:** 2026-02-06
**Status:** ✅ IMPLEMENTED — All 3 Ralph prompts executed (13m 55s total)
**Priority:** HIGH
**Affects:** Insights page, chat UX, agent architecture

### Current Jerry Configuration
| Setting | Value |
|---------|-------|
| Default Model | Sonnet (`claude-sonnet-4-5-20250929`) |
| Default Thinking | Medium (4096 tokens) |
| Allowed Tools | Read, Glob, Grep |
| Blocked Tools | Bash, Write, Edit, Task |
| Max Turns | 15 |
| User Profiles | Complex (Opus), Balanced (Sonnet), Quick (Haiku), Custom |

---

## Problem Statement

The Insights chat page has several critical UX and architecture issues:

1. **Jerry acts as executor instead of analyst** — When told to "create a task," Jerry started running Bash commands, installing dependencies, and building code. Jerry should ONLY analyze and suggest — Ralph executes.
2. **Can't interrupt the agent** — Send button is disabled during generation. No stop/cancel button exists. User is locked out while Jerry works.
3. **Send button is outside the input** — Feels disconnected, not modern. Should be inside the text area like VS Code Copilot.
4. **No attachment support** — Can't send screenshots or files to Jerry for context.
5. **Headers don't align** — Each panel has different padding/height, nothing lines up visually.
6. **Sidebars are fixed width** — Chat History (256px) and Task Queue (280px) can't be resized.

---

## Part 1: Jerry's Role — Analyst, Not Executor

### The Rule
**Jerry thinks. Ralph does.**

### Allowed Tools (Read-Only)
| Tool | Purpose |
|------|---------|
| `Read` | Read files for analysis |
| `Glob` | Find files by pattern |
| `Grep` | Search code content |

### Blocked Tools (Write/Execute)
| Tool | Why Blocked |
|------|-------------|
| `Bash` | No shell access — Jerry should never run commands |
| `Write` | No file creation — that's Ralph's job |
| `Edit` | No file modification — that's Ralph's job |
| `NotebookEdit` | No notebook modification |

### What Jerry Should Do
- Analyze codebase structure and patterns
- Answer questions about architecture, code quality, security
- Suggest tasks (which go to the Task Queue sidebar)
- Help plan and prioritize features
- Explain code, identify issues, recommend improvements
- Accept and analyze screenshots/attachments for context

### What Jerry Should NOT Do
- Run any shell commands
- Install dependencies
- Write or modify any files
- Execute tasks — he creates Suggested Task cards, user queues them, Ralph runs them
- Make any changes to the codebase

### Implementation
The backend agent configuration for Jerry must restrict the tool set. The system prompt for the insights agent should explicitly state:
- "You are an analyst. You read and analyze code. You never modify files or run commands."
- "When you want to suggest an action, create a Suggested Task card. Do not attempt to implement it yourself."

---

## Part 2: Chat Input Redesign

### Current State
```
┌─────────────────────────────────────┐  ┌──────┐
│  Ask about your codebase...         │  │ Send │
│                                     │  └──────┘
│                                     │
└─────────────────────────────────────┘
```
- Send button is outside the textarea (separate element)
- Button becomes disabled + unclickable during generation
- No stop button exists
- No attachment support
- Textarea disabled during generation (opacity-60, cursor-not-allowed)

### Proposed Design
```
┌──────────────────────────────────────────────────┐
│  Ask about your codebase...                      │
│                                                  │
│                                                  │
│  ┌─────────────────┐                             │
│  │ 📎 screenshot.png  ✕ │                        │
│  └─────────────────┘                             │
│                                                  │
│  [📎 Attach]                     [⏹ Stop] [➤]   │
└──────────────────────────────────────────────────┘
```

### Key Changes

#### A. Send Button Inside Input
- Move the send button to the bottom-right corner INSIDE the textarea container
- Circular button with arrow icon, matches VS Code Copilot style
- Always visible, disabled state when empty (not hidden)

#### B. Stop/Cancel Button
- Appears ONLY when Jerry is thinking/streaming (replaces send button position)
- Square stop icon (⏹) — universally understood
- Immediately cancels the current generation
- Backend needs: IPC handler `insights:cancel` to abort the in-progress request

#### C. Attachment Support
- Paperclip button at bottom-left of input container
- Opens native file picker
- Supported types: Images (PNG, JPG, GIF), Text files, Code files
- Attachments appear as chips above the bottom toolbar inside the input
- Each chip shows filename + remove (✕) button
- Attachments are sent as context alongside the message text
- Backend needs: Pass attachments as image/file content in the API call

#### D. Input Stays Enabled
- Textarea should NEVER be disabled during generation
- User can type while Jerry responds (queued message)
- OR user can click Stop, then type and send

---

## Part 3: UI Alignment — Consistent Headers

### Current Header Inconsistencies
| Component | Padding | Approx Height |
|-----------|---------|---------------|
| Chat History header | `px-3 py-3` | ~40px |
| Main Chat header | `px-4 py-2` | ~36px |
| Task Queue header | `p-3` | ~44px |
| Page headers (app-wide) | `px-6 py-3` to `px-6 py-4` | varies |

### Standard: All 3 Insights Panel Headers
All three panel headers (Chat History, Main Chat, Task Queue) should use the SAME dimensions:

```
height:    h-12 (48px) — consistent fixed height
padding:   px-3 — consistent horizontal padding
display:   flex items-center — vertically centered content
border:    border-b border-border — consistent bottom border
font:      text-sm font-semibold — consistent title style
```

This ensures all three headers align perfectly in a horizontal line across the top.

### Visual Result
```
┌──────────────┬────────────────────────────────┬──────────────┐
│ Chat History │  [◀] ·····  Model: Balanced    │ Task Queue   │
│  [+]         │                                │  [◀▶]        │
├──────────────┼────────────────────────────────┼──────────────┤
│              │                                │              │
```

All three headers are exactly `h-12`, all borders align, all text vertically centered.

---

## Part 4: Resizable Sidebars

### Current State
- Chat History: Fixed `w-64` (256px)
- Task Queue: Fixed `w-[280px]`
- Neither can be resized by the user

### Proposed Behavior

#### Resize Handle
- Thin (4px) vertical divider between panels
- On hover: cursor changes to `col-resize`, divider highlights (subtle blue/primary color)
- Drag to resize

#### Constraints
| Sidebar | Min Width | Default | Max Width |
|---------|-----------|---------|-----------|
| Chat History | 200px | 256px | 400px |
| Task Queue | 200px | 280px | 450px |

#### Collapse Behavior
- Dragging below min width auto-collapses the panel
- Chat History collapse: hidden entirely (toggle button in main header)
- Task Queue collapse: 48px icon strip (already implemented)

#### Persistence
- Save sidebar widths to localStorage
- Key: `insights-sidebar-widths`
- Restore on page load

### Implementation Approach
Use a simple `mousedown` + `mousemove` resize handler on the divider elements. No external library needed — this is straightforward DOM event handling.

---

## Part 5: Chat Input Component Specification

### Component: `ChatInput`
New standalone component replacing the current inline textarea + button.

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  [textarea - always enabled, auto-grows]         │
│                                                  │
│  ┌──────────┐ ┌──────────┐                       │
│  │📎 file.ts ✕│ │🖼 ss.png ✕│                     │
│  └──────────┘ └──────────┘                       │
│                                                  │
│  [📎]                            [⏹] or [➤]     │
└──────────────────────────────────────────────────┘
```

### States

#### Idle (no generation in progress)
- Textarea: enabled, placeholder "Ask about your codebase..."
- Send button: enabled if text or attachments present, disabled otherwise
- Stop button: hidden
- Attach button: visible

#### Generating (Jerry is thinking/streaming)
- Textarea: ENABLED (user can type next message)
- Send button: hidden
- Stop button: visible (red/destructive style), clicking cancels generation
- Attach button: visible

#### Keyboard
- `Enter` — send message (if not empty)
- `Shift+Enter` — new line
- `Escape` — cancel generation (when generating)

---

## Part 6: Summary of All Changes

### Files to Create
| File | Description |
|------|-------------|
| `components/insights/ChatInput.tsx` | New unified chat input component |
| `components/insights/ResizeHandle.tsx` | Reusable resize handle for sidebar dividers |

### Files to Modify
| File | Changes |
|------|---------|
| `components/Insights.tsx` | Replace inline input with ChatInput, add resize handles, standardize header heights |
| `components/ChatHistorySidebar.tsx` | Standardize header to h-12, accept width prop |
| `components/insights/TaskQueueSidebar.tsx` | Standardize header to h-12, accept width prop |
| `stores/insights-store.ts` | Add cancel generation action |
| Backend: insights agent config | Restrict tool set to Read/Glob/Grep only |
| Backend: IPC handlers | Add `insights:cancel` handler, add attachment support |

### Files NOT Changed
- Task queue store (already works correctly)
- TaskQueueCard (already works correctly)
- Chat session persistence (already works correctly)

---

## Priority Order for Implementation

1. **Restrict Jerry's tools** (backend) — Prevents the "agent runs away" problem
2. **Stop/Cancel button** — Users must be able to interrupt
3. **Send button inside input + input stays enabled** — Core UX fix
4. **Header alignment** — Visual consistency across all 3 panels
5. **Attachment support** — Screenshots and file context
6. **Resizable sidebars** — Nice to have, polish

---

## Resolved Decisions

### 1. Jerry has NO Bash access — CONFIRMED
**Decision:** Strictly Glob/Grep/Read only. No shell access whatsoever.
**Reasoning:**
- "Read-only Bash" is impossible to enforce safely — where's the line between `git log` and `curl`?
- Glob/Grep/Read cover 99% of what Jerry needs for codebase analysis
- Allowing Bash at all is how we got the "agent installing dependencies" problem
- Clean, simple rule: Jerry has no shell. Period.

### 2. No auto-queuing of messages — CONFIRMED
**Decision:** Input stays enabled during generation, but messages are NOT auto-sent.
**Reasoning:**
- User might change their mind about what they typed
- Auto-sending feels unpredictable and "out of control" — the exact problem we're fixing
- Simple rule: user hits Enter or clicks Send. Nothing automatic.

### 3. Attachment limits — CONFIRMED
**Decision:** 10MB for images, 1MB for text/code files.
**Reasoning:**
- Generous enough for screenshots and code snippets
- Prevents accidental 500MB binary uploads
- Claude API has its own limits as a backstop
- Can increase later if needed

### 4. Multi-model mid-conversation — CONFIRMED
**Decision:** Yes, model changes apply seamlessly to the next message.
**Reasoning:**
- Already works this way via the model selector
- No reason to lock model per-session
- Use case: Haiku for quick "what file is X in?" then Sonnet for "analyze this architecture"

### 5. Default model — CONFIRMED
**Decision:** Sonnet with medium thinking (4096 tokens) remains the default.
**Reasoning:**
- Jerry is an analyst, not doing heavy reasoning — Opus is overkill and slow for chat
- Haiku would miss nuance in architecture analysis
- Sonnet hits the sweet spot of quality + speed for interactive conversation
- Users can switch to Opus/Haiku per-message if needed

---

## Investigation Required

**Bug:** Jerry ran Bash commands despite backend tool restriction.
The backend (`insights_runner.py`) already restricts Jerry to `["Read", "Glob", "Grep"]` with `["Task"]` blocked. Yet the screenshot shows Jerry running Bash and installing dependencies.

**Possible causes:**
1. The tool restriction wasn't in place when that session ran (added later)
2. The ClaudeSDKClient isn't enforcing the allowed_tools list correctly
3. The model is ignoring tool restrictions and the SDK isn't blocking it

**Action:** Verify tool enforcement is working before building the rest of this overhaul. If it's broken, fixing it is Priority 0.
