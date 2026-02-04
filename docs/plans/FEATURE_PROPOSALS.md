# Feature Proposals

**Last Updated:** 2026-02-03
**Status:** 📋 PROPOSALS - Awaiting Review

---

## Table of Contents

1. [Proposal #1: Remove Kanban Drag-and-Drop](#proposal-1-remove-kanban-drag-and-drop)
2. [Proposal #2: Combine Roadmap and Ideas into Discovery Hub](#proposal-2-combine-roadmap-and-ideas-into-discovery-hub)
3. [Proposal #3: Evaluate MCP Overview Page](#proposal-3-evaluate-mcp-overview-page)

---

## Proposal #1: Remove Kanban Drag-and-Drop

### Summary
Remove the ability to drag tasks between columns in the Kanban board. Tasks should only move through the pipeline via explicit user actions (buttons).

### Rationale

The current pipeline workflow makes drag-and-drop unnecessary and counterproductive:

| Stage | Transition | How It Should Happen |
|-------|------------|---------------------|
| → Planning | Task created | Auto (from Chat) |
| Planning → Coding | User approval | "Start Build" button only |
| Coding → AI Review | Agent completes | Auto |
| AI Review → Human Review | QA passes | Auto |
| Human Review → Done | User approval | "Approve" button only |

**Why Drag Doesn't Fit:**
- Tasks follow a **linear pipeline**, not a free-form board
- Only 2 user actions exist: "Start Build" and "Approve/Reject"
- Dragging bypasses workflow gates (Issue #8)
- Accidental drags can start unreviewed builds

### Issues Eliminated

Removing drag immediately resolves:

| Issue | Description | Fixed By |
|-------|-------------|----------|
| **#8** | Kanban drag auto-starts coding agent | No drag = no bypass |
| **#9** | No user-initiated flag | Not needed without drag |
| **#10** | Validation too permissive | Simpler validation |

### What to Keep

The Kanban **VIEW** is still valuable:
- ✅ See tasks organized by status
- ✅ Click to expand task details
- ✅ Visual progress tracking
- ✅ Filter and sort capabilities

Just remove the **drag interaction**.

### Implementation

#### Files to Modify

| File | Change |
|------|--------|
| `src/renderer/components/KanbanBoard.tsx` | Remove DnD context and handlers |
| `src/renderer/components/KanbanColumn.tsx` | Remove droppable wrapper |
| `src/renderer/components/TaskCard.tsx` | Remove draggable wrapper |

#### Code Changes

```typescript
// KanbanBoard.tsx - BEFORE
import { DndContext, DragOverlay, ... } from '@dnd-kit/core';

export function KanbanBoard() {
  return (
    <DndContext onDragStart={...} onDragEnd={...}>
      {/* columns with drag-drop */}
    </DndContext>
  );
}

// KanbanBoard.tsx - AFTER
export function KanbanBoard() {
  return (
    <div className="kanban-container">
      {/* columns WITHOUT drag-drop */}
    </div>
  );
}
```

#### Dependencies to Remove
```json
// Can potentially remove if not used elsewhere:
"@dnd-kit/core": "...",
"@dnd-kit/sortable": "...",
"@dnd-kit/utilities": "..."
```

### UI Changes

**Current (with drag):**
```
┌─────────┐  ←drag→  ┌─────────┐  ←drag→  ┌─────────┐
│Planning │          │ Coding  │          │  Done   │
└─────────┘          └─────────┘          └─────────┘
```

**Proposed (no drag):**
```
┌─────────┐  [Start] ┌─────────┐  [Auto]  ┌─────────┐
│Planning │ ──────→  │ Coding  │ ──────→  │  Done   │
└─────────┘  Build   └─────────┘          └─────────┘
     ↑                                         ↑
  Explicit                                  Approve
  Button                                    Button
```

### Migration Path

1. **Phase 1:** Disable drag (keep code, add flag)
   ```typescript
   const ENABLE_KANBAN_DRAG = false; // Feature flag
   ```

2. **Phase 2:** Verify no regressions, collect feedback

3. **Phase 3:** Remove drag code entirely

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Users expect drag | Add tooltip: "Use Start Build button" |
| Manual task organization | Consider separate "Backlog" view if needed |
| Re-prioritization | Add priority/order controls in task details |

### Recommendation

**Strongly Recommend** - Removing drag simplifies the system and enforces the correct workflow. The linear pipeline doesn't need free-form reorganization.

---

## Proposal #2: Combine Roadmap and Ideas into Discovery Hub

### Summary
Merge the "Roadmap" and "Ideation" features into a single unified "Discovery Hub" page that helps users find, organize, and convert improvement opportunities into tasks.

### Current State

**Roadmap Page:**
- Generates product roadmap features
- Competitor analysis integration
- Features organized by priority/timeline
- Convert features → Tasks
- Kanban view for features

**Ideation Page:**
- Generates code improvement ideas
- Categories: Performance, Code Quality, Documentation, etc.
- Ideas organized by type
- Convert ideas → Tasks
- Card/list view

### The Problem

Both features:
- Generate AI suggestions
- Convert to tasks
- Have similar UX patterns
- Are accessed separately
- Duplicate functionality

Users must switch between pages to get a complete picture of work opportunities.

### Proposed: Discovery Hub

A unified page combining both capabilities:

```
┌─────────────────────────────────────────────────────────────────┐
│                      DISCOVERY HUB                               │
├─────────────────────────────────────────────────────────────────┤
│  [Generate All] [Refresh]                    Filter: [All ▼]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── PRODUCT FEATURES ───┐  ┌─── CODE IMPROVEMENTS ───┐        │
│  │                        │  │                          │        │
│  │  🎯 User Auth          │  │  ⚡ Perf: DB queries     │        │
│  │  🎯 Payment Flow       │  │  🔧 Quality: Error      │        │
│  │  🎯 Dashboard          │  │     handling            │        │
│  │                        │  │  📝 Docs: API docs      │        │
│  │  [+ Add Feature]       │  │                          │        │
│  └────────────────────────┘  └──────────────────────────┘        │
│                                                                  │
│  ┌─── QUICK ACTIONS ───────────────────────────────────────┐    │
│  │  Selected: 3 items                                       │    │
│  │  [Convert to Tasks] [Dismiss] [Priority: High ▼]        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Feature Matrix

| Capability | Roadmap | Ideation | Discovery Hub |
|------------|---------|----------|---------------|
| Generate features | ✅ | ❌ | ✅ |
| Generate code improvements | ❌ | ✅ | ✅ |
| Competitor analysis | ✅ | ❌ | ✅ |
| Convert to task | ✅ | ✅ | ✅ |
| Bulk selection | ❌ | ✅ | ✅ |
| Priority/timeline | ✅ | ❌ | ✅ |
| Category filters | ❌ | ✅ | ✅ |
| Kanban view | ✅ | ❌ | ✅ (optional) |
| Archive/dismiss | ❌ | ✅ | ✅ |

### Unified Data Model

```typescript
interface DiscoveryItem {
  id: string;
  type: 'feature' | 'improvement';

  // Common fields
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'new' | 'reviewed' | 'converted' | 'dismissed';
  createdAt: Date;

  // Feature-specific (type === 'feature')
  timeline?: 'short-term' | 'medium-term' | 'long-term';
  competitorInsight?: string;

  // Improvement-specific (type === 'improvement')
  category?: 'performance' | 'quality' | 'documentation' | 'security';
  affectedFiles?: string[];
  estimatedImpact?: string;

  // Task conversion
  convertedToTaskId?: string;
}
```

### UI Sections

#### 1. Generation Panel
```
┌─────────────────────────────────────────────┐
│  What would you like to discover?           │
│                                             │
│  ☑ Product Features                         │
│  ☑ Code Improvements                        │
│    ☑ Performance                            │
│    ☑ Code Quality                           │
│    ☑ Documentation Gaps                     │
│    ☐ Security Issues                        │
│                                             │
│  ☑ Include Competitor Analysis              │
│                                             │
│  [Generate Suggestions]                     │
└─────────────────────────────────────────────┘
```

#### 2. Results View (Tabs or Sections)
```
┌─────────────────────────────────────────────┐
│  [All (15)] [Features (5)] [Improvements (10)]
├─────────────────────────────────────────────┤
│                                             │
│  Filter: [Category ▼] [Priority ▼] [Status ▼]
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🎯 FEATURE: User Authentication     │    │
│  │    Priority: High | Timeline: Q1    │    │
│  │    [Convert to Task] [Dismiss]      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ ⚡ PERF: Optimize database queries  │    │
│  │    Impact: High | Files: 3          │    │
│  │    [Convert to Task] [Dismiss]      │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 3. Detail Panel (Slide-out)
```
┌─────────────────────────────────────────────┐
│  User Authentication System                 │
│  Type: Feature | Priority: High             │
├─────────────────────────────────────────────┤
│                                             │
│  Description:                               │
│  Implement secure user authentication...    │
│                                             │
│  Competitor Insight:                        │
│  CompetitorX uses OAuth2 with social...     │
│                                             │
│  Suggested Implementation:                  │
│  1. Set up auth provider                    │
│  2. Create login/signup flows               │
│  3. Add session management                  │
│                                             │
├─────────────────────────────────────────────┤
│  [Edit] [Convert to Task] [Dismiss]         │
└─────────────────────────────────────────────┘
```

### Navigation Changes

**Current:**
```
Sidebar:
├── Tasks (Kanban)
├── Roadmap        ← Separate
├── Ideation       ← Separate
├── Chat
└── Settings
```

**Proposed:**
```
Sidebar:
├── Tasks (Kanban)
├── Discovery      ← Combined
├── Chat
└── Settings
```

### Implementation Phases

#### Phase 1: Data Unification
- Create unified `DiscoveryItem` type
- Add migration for existing roadmap/ideation data
- Create unified store

#### Phase 2: UI Merge
- Create Discovery Hub component
- Migrate Roadmap generation to Discovery
- Migrate Ideation generation to Discovery
- Unified filters and views

#### Phase 3: Cleanup
- Remove old Roadmap component
- Remove old Ideation component
- Update navigation
- Update i18n strings

### Files Affected

| Current | Action | New |
|---------|--------|-----|
| `components/Roadmap.tsx` | Deprecate | `components/Discovery.tsx` |
| `components/ideation/Ideation.tsx` | Deprecate | ↑ |
| `stores/roadmap-store.ts` | Merge | `stores/discovery-store.ts` |
| `stores/ideation-store.ts` | Merge | ↑ |

### Benefits

1. **Single Source of Truth** - All improvement ideas in one place
2. **Unified UX** - Consistent patterns for both feature types
3. **Better Organization** - Filter across all sources
4. **Reduced Complexity** - One component instead of two
5. **Clearer Mental Model** - "Discovery" → "Tasks" flow

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Feature loss during merge | Feature parity checklist |
| Data migration issues | Versioned migration with rollback |
| User confusion | In-app tooltip explaining changes |
| Larger component | Keep sections modular |

### Recommendation

**Recommend** - The two features serve similar purposes and would benefit from unification. Users get a cleaner experience and developers maintain less code.

---

## Proposal #3: Evaluate MCP Overview Page

### Summary
Evaluate whether the "MCP Overview" (Agent Tools) page is necessary as a standalone navigation item, or if its functionality should be moved to Settings.

### What Is MCP?

**MCP = Model Context Protocol**

A standard for connecting AI models to external tools and services. In Auto-Claude:
- MCP servers provide tools to agents (GitHub, search, databases, etc.)
- Different agent phases have different tool access
- Users can enable/disable servers per project
- Custom MCP servers can be added

### Current Implementation

**File:** `src/renderer/components/AgentTools.tsx`
**Nav Item:** `agent-tools` in Sidebar

**What It Shows:**
```
┌─────────────────────────────────────────────────────────────┐
│  AGENT TOOLS OVERVIEW                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─── SPEC PHASE AGENTS ────────────────────────────────┐   │
│  │  Spec Gatherer                                        │   │
│  │    Tools: Read, Glob, Grep, WebFetch, WebSearch      │   │
│  │    MCP Servers: [none]                               │   │
│  │                                                       │   │
│  │  Spec Researcher                                      │   │
│  │    Tools: Read, Glob, Grep, WebFetch, WebSearch      │   │
│  │    MCP Servers: context7                             │   │
│  │                                                       │   │
│  │  ... more agents ...                                  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── BUILD PHASE AGENTS ───────────────────────────────┐   │
│  │  Planner, Coder, QA Reviewer, QA Fixer               │   │
│  │    Tools: [various]                                   │   │
│  │    MCP Servers: [configurable]                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── MCP SERVER CONFIGURATION ─────────────────────────┐   │
│  │  ☑ context7 (enabled)                                │   │
│  │  ☑ github (enabled)                                  │   │
│  │  ☐ jira (disabled)                                   │   │
│  │  [+ Add Custom Server]                               │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Analysis: Is This Page Needed?

#### Who Uses This Page?

| User Type | Use Case | Frequency |
|-----------|----------|-----------|
| Power Users | Configure MCP servers | Rare (once per project) |
| Developers | Debug tool availability | Occasional |
| Curious Users | Understand what agents can do | Once |
| Regular Users | Day-to-day tasks | Never |

#### Value Assessment

| Aspect | Assessment |
|--------|------------|
| **Daily Workflow** | ❌ Not needed - users don't interact with this during tasks |
| **Configuration** | ⚠️ Useful but could live in Settings |
| **Transparency** | ✅ Valuable - shows what tools agents have |
| **Debugging** | ✅ Helpful for troubleshooting |

### Options

#### Option A: Keep as Standalone Page
**Pros:**
- Easy to find
- Dedicated space for complex info
- No changes needed

**Cons:**
- Clutters sidebar
- Rarely accessed
- Not part of main workflow

#### Option B: Move to Settings
**Pros:**
- Configuration belongs in Settings
- Cleaner sidebar
- Grouped with other project config

**Cons:**
- Less discoverable
- Buried under settings tabs

**Implementation:**
```
Settings → Project → MCP Configuration
```

#### Option C: Move to Developer/Debug Menu
**Pros:**
- Keeps it accessible for power users
- Removes from main navigation
- Appropriate audience targeting

**Cons:**
- Harder to find
- May need new menu system

**Implementation:**
```
Help Menu → Developer Tools → Agent Configuration
```

#### Option D: Remove Page, Keep Config Only (Recommended)

**Analysis:**
Most users only need to:
1. Enable/disable MCP servers (config)
2. Add custom servers (config)

They DON'T need to see:
- Which agent uses which tools (implementation detail)
- Agent phase breakdowns (too technical)

**Proposed:**
- Move MCP server toggles to **Settings → Project → Integrations**
- Move custom server dialog to **Settings → Project → Integrations**
- Remove the detailed agent/tool breakdown entirely

```
Settings → Project → Integrations
┌─────────────────────────────────────────────────────────┐
│  MCP SERVERS                                            │
│                                                         │
│  Enable external tool integrations for AI agents:       │
│                                                         │
│  ☑ Context7 - Documentation search                      │
│  ☑ GitHub - Repository access                           │
│  ☐ Jira - Issue tracking                                │
│  ☐ Slack - Notifications                                │
│                                                         │
│  [+ Add Custom Server]                                  │
│                                                         │
│  ℹ️ Agents will use enabled servers based on task needs │
└─────────────────────────────────────────────────────────┘
```

### Current Sidebar Items

```
Current Sidebar (10 items):
├── Chat (insights)
├── Tasks (kanban)
├── Terminals
├── Worktrees
├── Roadmap          ← Proposal #2: Merge with Ideation
├── Ideation         ← Proposal #2: Merge with Roadmap
├── Changelog
├── Context
├── Agent Tools      ← Proposal #3: Move to Settings
└── [GitHub/GitLab integrations]
```

**Proposed Sidebar (7-8 items):**
```
├── Chat
├── Tasks
├── Terminals
├── Worktrees
├── Discovery        ← Combined Roadmap + Ideation
├── Changelog
├── Context
└── [GitHub/GitLab integrations]
```

### Files Affected

| File | Change |
|------|--------|
| `components/AgentTools.tsx` | Deprecate or simplify |
| `components/Sidebar.tsx` | Remove nav item |
| `components/settings/ProjectSettings.tsx` | Add MCP section |
| `components/CustomMcpDialog.tsx` | Keep, move trigger |

### Migration Path

1. **Phase 1:** Add MCP config section to Settings
2. **Phase 2:** Deprecate Agent Tools page (keep accessible via URL)
3. **Phase 3:** Remove Agent Tools from sidebar
4. **Phase 4:** Remove component entirely

### Recommendation

**Option D: Remove Page, Keep Config Only**

Rationale:
- The detailed agent/tool breakdown is implementation detail
- Users only need to configure servers, not understand internals
- Reduces sidebar clutter
- Configuration belongs in Settings

---

## Summary

| Proposal | Impact | Complexity | Recommendation |
|----------|--------|------------|----------------|
| #1 Remove Kanban Drag | High (fixes 3 issues) | Low | **Strongly Recommend** |
| #2 Discovery Hub | Medium (UX improvement) | Medium | **Recommend** |
| #3 MCP Page → Settings | Low (cleaner sidebar) | Low | **Recommend** |

### Combined Impact

If all 3 proposals are implemented:

**Sidebar Before (10+ items):**
```
Chat, Tasks, Terminals, Worktrees, Roadmap, Ideation,
Changelog, Context, Agent Tools, [GitHub], [GitLab]
```

**Sidebar After (7-8 items):**
```
Chat, Tasks, Terminals, Worktrees, Discovery, Changelog,
Context, [GitHub/GitLab]
```

**Benefits:**
- 30% fewer sidebar items
- Cleaner navigation
- MCP config properly in Settings
- Issues #8, #9, #10 resolved
- Unified discovery experience

---

**End of Feature Proposals**
