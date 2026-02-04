# Auto-Claude (Jerry) Master TODO

**Last Updated:** 2026-02-04
**Status:** ✅ 100% Complete (all original tasks done, all phases complete)

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| 🔴 P0 | Critical - Blocks core workflow |
| 🟠 P1 | High - Major UX issue |
| 🟡 P2 | Medium - Quality improvement |
| 🟢 P3 | Low - Nice to have |

---

## Phase 1: Critical Fixes ✅ COMPLETE

### 🔴 P0 - Workflow Blockers

| ID | Task | Source | Status |
|----|------|--------|--------|
| FIX-8 | Remove auto-start from TASK_UPDATE_STATUS handler | [Issue #8](plans/KNOWN_ISSUES.md#issue-8-kanban-drag-auto-starts-coding-agent) | ✅ Done |
| FIX-6 | Fix phaseToStatus mapping (planning shouldn't → coding) | [Issue #6](plans/KNOWN_ISSUES.md#issue-6-task-auto-transitions-from-planning-to-coding) | ✅ Done |
| FIX-3 | Fix planning agent not restarting on app restart | [Issue #3](plans/KNOWN_ISSUES.md#issue-3-planning-agent-not-starting-on-app-restart) | ✅ Done |
| FIX-4 | Fix recoverStuckTask calling wrong handler | [Issue #4](plans/KNOWN_ISSUES.md#issue-4-stuck-task-recovery-calling-wrong-handler) | ✅ Done |
| FIX-11 | **Planning agent outputs Ralph-compatible spec.md** | [Ralph Guide](plans/RALPH_IMPLEMENTATION_GUIDE.md#fix-11-planning-agent-outputs-ralph-compatible-spec) | ✅ Done |

**Outcome:** Tasks stay in Planning until user clicks "Start Build", spec.md is Ralph-ready

---

## Phase 2: High Priority Improvements ✅ COMPLETE (4/6)

### 🟠 P1 - User Experience

| ID | Task | Source | Status |
|----|------|--------|--------|
| FIX-7 | Add alert when planning completes | [Issue #7](plans/KNOWN_ISSUES.md#issue-7-no-alert-when-planning-completes) | ✅ Done |
| FIX-1 | Show toast when startBuild fails | [Issue #1](plans/KNOWN_ISSUES.md#issue-1-startbuild-error-not-shown-in-ui) | ✅ Done |
| FIX-5 | Improve terminal readability (show file paths, commands) | [Issue #5](plans/KNOWN_ISSUES.md#issue-5-terminal-output-not-legible) | ✅ Done (Phase 7 complete) |
| FIX-9 | Add userInitiated flag to transitions | [Issue #9](plans/KNOWN_ISSUES.md#issue-9-no-user-initiated-flag-for-transitions) | ✅ Done |
| FIX-2 | Fix phase labels not updating in real time | [Issue #2](plans/KNOWN_ISSUES.md#issue-2-phase-labels-not-updating-in-real-time) | ✅ Done |
| SUG-6 | **Task dependencies / ordering** | [Suggestion #6](plans/SUGGESTIONS.md#6-task-dependencies--ordering) | ✅ Done (v2.5) |

**All Phase 2 tasks complete!**

---

## Phase 3: Architectural Cleanup ✅ COMPLETE

### 🟡 P2 - Simplification

| ID | Task | Source | Status |
|----|------|--------|--------|
| PROP-1 | Remove Kanban drag-and-drop | [Proposal #1](plans/FEATURE_PROPOSALS.md#proposal-1-remove-kanban-drag-and-drop) | ✅ Done |
| PROP-2 | Combine Roadmap + Ideation → Discovery Hub | [Proposal #2](plans/FEATURE_PROPOSALS.md#proposal-2-combine-roadmap-and-ideas-into-discovery-hub) | ✅ Done |
| PROP-3 | Move MCP config to Settings | [Proposal #3](plans/FEATURE_PROPOSALS.md#proposal-3-evaluate-mcp-overview-page) | ✅ Done |
| FIX-10 | Add gate enforcement to validateStatusTransition | [Issue #10](plans/KNOWN_ISSUES.md#issue-10-status-validation-allows-all-non-regressive-transitions) | ✅ Done |

**Outcome:** Cleaner sidebar, simpler codebase, fewer bugs

---

## Phase 4: Quick Wins ✅ COMPLETE

### 🟢 P3 - Polish

| ID | Task | Source | Status |
|----|------|--------|--------|
| SUG-3 | Add progress percentage to tasks | [Suggestion #3](plans/SUGGESTIONS.md#3-task-progress-percentage) | ✅ Done |
| SUG-4 | Add "Resume" button for interrupted tasks | [Suggestion #4](plans/SUGGESTIONS.md#4-resume-button-for-interrupted-tasks) | ✅ Done |
| SUG-16 | Better empty states with guidance | [Suggestion #16](plans/SUGGESTIONS.md#16-better-empty-states) | ✅ Done |
| SUG-19 | Quick actions on task hover | [Suggestion #19](plans/SUGGESTIONS.md#19-quick-actions-on-hover) | ✅ Done |
| SUG-20 | "What's Jerry doing?" explainer | [Suggestion #20](plans/SUGGESTIONS.md#20-whats-jerry-doing-explainer) | ✅ Done |
| SUG-21 | Remove redundant project settings icon | [Suggestion #21](plans/SUGGESTIONS.md#21-remove-or-fix-project-settings-icon) | ✅ Done |
| SUG-22 | **Update task creation modal - Ralph UI** | [Ralph Guide](plans/RALPH_IMPLEMENTATION_GUIDE.md#ralph-configuration-options) | ✅ Done |

**Outcome:** More polished, user-friendly experience

---

## Phase 5: Feature Enhancements ✅ COMPLETE (7/9)

### 🟢 P3 - New Capabilities

| ID | Task | Source | Status |
|----|------|--------|--------|
| SUG-1a | Embed task terminal in task detail panel | [Suggestion #1](plans/SUGGESTIONS.md#1-terminal-architecture-redesign) | ✅ Done |
| SUG-1b | Repurpose Terminals page as Claude Code sessions | [Suggestion #1](plans/SUGGESTIONS.md#1-terminal-architecture-redesign) | ⏸️ Deferred |
| SUG-2 | Quick task creation (Cmd+K) | [Suggestion #2](plans/SUGGESTIONS.md#2-quick-task-from-anywhere) | ✅ Done |
| SUG-8 | Global search | [Suggestion #8](plans/SUGGESTIONS.md#8-global-search) | ✅ Done |
| SUG-5 | Task templates | [Suggestion #5](plans/SUGGESTIONS.md#5-task-templates) | ✅ Done |
| SUG-9 | Activity feed / timeline | [Suggestion #9](plans/SUGGESTIONS.md#9-activity-feed--timeline) | ✅ Done |
| SUG-14 | Analytics dashboard | [Suggestion #14](plans/SUGGESTIONS.md#14-analytics-dashboard) | ✅ Done |
| SUG-18 | Notification preferences | [Suggestion #18](plans/SUGGESTIONS.md#18-notification-preferences) | ✅ Done |
| SUG-23 | **Persistent Learning Memory** | [Suggestion #23](plans/SUGGESTIONS.md#23-persistent-learning-memory-institutional-knowledge) | ✅ Done (v2.5) |

**Deferred:** SUG-1b requires major refactor of Terminals page (reconsidered - see new tasks).

---

## Phase 6: UI/UX Redesign ✅ COMPLETE (15/18)

### 🟡 P2 - "Tron Grid" Theme + Navigation Simplification

Complete visual overhaul inspired by Tron Cinematic Universe + VSCode aesthetics.

#### Part A: Navigation Architecture

| ID | Task | Source | Status |
|----|------|--------|--------|
| NAV-1 | Merge Roadmap + Ideation → Discovery page | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-2 | Merge Context + Worktrees → Repository page | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-3 | Rename Terminals → Claude Code | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-4 | Add tabs to Tasks page (Kanban/Dependencies/Analytics) | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-5 | Implement Activity Feed as sidebar widget | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-6 | Move Agent Tools to Settings modal | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-7 | Create unified Settings modal with tabs | [App Architecture](plans/APP_ARCHITECTURE.md) | ✅ Done |
| NAV-8 | ~~Move to footer~~ → Combine into single GitHub page | [App Architecture](plans/APP_ARCHITECTURE.md) | 🔄 Revised |

**NAV-8 Revised:** Instead of footer icons, combine GitHub Issues + PRs into one "GitHub" page with tabs.

#### Part B: Visual Theme

| ID | Task | Source | Status |
|----|------|--------|--------|
| UI-1 | Define CSS variables and design tokens | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-2 | Implement dark base theme (#0a0a0f backgrounds) | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-3 | Remove all border-radius (sharp corners everywhere) | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done (v2.5) |
| UI-4 | Add cyan glow effects on focus/active states | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done (v2.5) |
| UI-5 | Redesign task cards with progress bars | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-6 | Redesign sidebar (VSCode activity bar style) | [UI Design Doc](plans/UI_DESIGN.md) | ❌ Skip (current is good) |
| UI-7 | Redesign Kanban board columns | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-8 | Redesign terminal/Claude Code panels | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-9 | Add monospace fonts for data/code | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |
| UI-10 | Implement subtle animations (glow pulse, transitions) | [UI Design Doc](plans/UI_DESIGN.md) | ✅ Done |

**Skipped Reasons:**
- UI-3: Rounded corners preferred for modern feel (Oscura Midnight theme)
- UI-4: Warm yellow accents used instead of cyan
- UI-6: Current sidebar works well

---

## Summary

### Total Items by Status

| Status | Count |
|--------|-------|
| ✅ Done | 60 (all tasks) |
| ❌ Skipped | 2 (UI-6, SUG-1b) |

### Completed - v3.2 Quick Fixes (9 tasks) ✅ ALL DONE

| ID | Task | Type | Complexity |
|----|------|------|------------|
| NAV-8 | Combine GitHub Issues + PRs into one page | Revised | Low |
| CLAUDE-1 | Remove task terminal columns from Claude Code page | New | Low |
| CLAUDE-2 | Add "+ New Claude Code" button | New | Low |
| CHAT-1 | Add "See in Kanban" button after task creation | New | Low |
| FIX-12 | Task card text clipping - fix overflow | New | Low |
| FIX-13 | Status badge shows "Pending" - should show actual phase | New | Low |
| FIX-14 | Hide "Start Build" button until spec is ready | New | Low |
| FIX-15 | Remove context menu dots - drag feature was removed | New | Low |
| FIX-16 | Terminal button click also opens Task Detail modal | New | Low |

### Phase 7: Terminal Redesign (4 tasks) ✅ ALL DONE

| ID | Task | Type | Complexity |
|----|------|------|------------|
| TERM-1 | Inline terminal expansion in task cards | New | High |
| TERM-2 | Fix Tool Use display (no path/command) | New | Medium |
| TERM-3 | Terminal output parsing (structured view) | New | Medium |
| TERM-4 | Task terminal integration (state/updates) | New | Low |

See: [Terminal Redesign](plans/TERMINAL_REDESIGN.md)

### Completed by Ralph v2.5 Run

| ID | Task |
|----|------|
| FIX-5 | Terminal readability (ToolUseCard + Phase 7 - COMPLETE) |
| SUG-6 | Task dependencies (TaskDependencies.tsx) |
| SUG-23 | Persistent Learning Memory (learnings-store.ts) |
| UI-3 | Remove border-radius (--radius: 0px) |
| UI-4 | Cyan glow effects (--glow-cyan: #00d4ff) |

### Skipped (User Decision)

| ID | Task | Reason |
|----|------|--------|
| UI-6 | Redesign sidebar | Current sidebar already VSCode-style, works well |
| SUG-1b | Claude Code Sessions Page | Replaced by simpler CLAUDE-1/2 + Phase 7 tasks |

---

## Related Documentation

- [Known Issues](plans/KNOWN_ISSUES.md) - 10 documented bugs
- [Feature Proposals](plans/FEATURE_PROPOSALS.md) - 3 architectural changes
- [Suggestions](plans/SUGGESTIONS.md) - 23 enhancement ideas
- [UI Design](plans/UI_DESIGN.md) - "Tron Grid" theme specification
- [Task Workflow](architecture/TASK_WORKFLOW.md) - How it should work
- [Task Architecture](architecture/TASK_ARCHITECTURE.md) - Technical details
- [Ralph Implementation Guide](plans/RALPH_IMPLEMENTATION_GUIDE.md) - Build instructions (v2.4)
- **[Terminal Redesign](plans/TERMINAL_REDESIGN.md) - Phase 7 spec (NEW)**

---

**v3.2: 9 quick fixes | Phase 7: 4 terminal tasks**
