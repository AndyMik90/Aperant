# TIMELINE_REDESIGN: Rebuild Activity Feed as Proper Timeline

**Date:** 2026-02-06
**Tasks:** 5
**Max Iterations:** 60
**Priority:** MEDIUM
**Status:** ✅ EXECUTED SUCCESSFULLY (3m 21s)
**Design Doc:** docs/plans/KANBAN_TERMINAL_TIMELINE.md

---

## Problem

The current ActivityFeed is a flat list in a tiny 256px scrollbox. No visual timeline, no date grouping, no connecting lines, no phase durations. It doesn't read like a timeline at all.

## Goal

Rebuild it as a proper vertical timeline with connecting lines, date headers, colored event nodes, event cards with durations, and full-page treatment.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing TIMELINE_REDESIGN for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 5-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Redesign the ActivityFeed component from a flat list into a proper visual timeline. Add a continuous vertical line connecting events, date grouping headers, colored event nodes, event cards with task info and durations, and make it full-page instead of a tiny scrollbox.

The current component is at apps/frontend/src/renderer/components/ActivityFeed.tsx. The activity data comes from apps/frontend/src/renderer/utils/activity-tracker.ts.

---

TIMELINE_REDESIGN: 5 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Add duration tracking | apps/frontend/src/renderer/utils/activity-tracker.ts | MODIFY - extend ActivityEntry to include optional duration (milliseconds) and phaseInfo (which phase completed). Update addActivity to accept these new fields. Increase MAX_ACTIVITIES from 50 to 200. | TASK_1_COMPLETE |
| 2 | Redesign timeline layout | apps/frontend/src/renderer/components/ActivityFeed.tsx | MODIFY - rebuild the component as a vertical timeline. Add a continuous vertical line on the left side. Each event gets a colored circle node on the line (green=completed, red=failed, blue=started, yellow=status change, purple=PR). Remove the 256px max-height constraint — let it take available space. | TASK_2_COMPLETE |
| 3 | Add date grouping | apps/frontend/src/renderer/components/ActivityFeed.tsx | MODIFY - group events by date with sticky headers ('Today', 'Yesterday', date string for older). Each date group has its own section with the timeline line continuing through groups. Add the date label on the left side of the timeline. | TASK_3_COMPLETE |
| 4 | Event cards with details | apps/frontend/src/renderer/components/ActivityFeed.tsx | MODIFY - replace simple text rows with proper event cards. Each card shows: task title, event description, timestamp, duration if available, status badge. Cards should have subtle borders, hover state, and be clickable (for future navigation). | TASK_4_COMPLETE |
| 5 | Add filtering controls | apps/frontend/src/renderer/components/ActivityFeed.tsx | MODIFY - add a filter bar at the top with filter chips for event types (created, started, completed, failed, PR). Clicking a chip toggles that type on/off. Add a 'Clear All' button. Persist filter state in component state. | TASK_5_COMPLETE |

FINAL: <promise>TIMELINE_REDESIGN_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Timeline line: 2px wide, runs vertically on the left side, uses border-border color
2. Event nodes: 12px circles positioned on the timeline line, color-coded by event type
3. Date headers: sticky, text-xs uppercase, muted foreground, with horizontal rule
4. Event cards: bordered, rounded, padding, hover:bg-muted/30, max-width ~600px
5. Duration display: show as '2m 15s' or '45s' format when available
6. Filter chips: small rounded pills with event type icon + label, togglable active state
7. Remove the collapsible wrapper — timeline should always be visible
8. Keep the existing clear all activities functionality
9. Maintain i18n support for all text
10. Use existing UI components (Badge, Button, ScrollArea) from the design system

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 5-TASK JOB - Do NOT stop until all tasks complete
2. Keep backward compatibility with existing ActivityEntry data in localStorage
3. Do NOT modify TasksHub.tsx layout — only the ActivityFeed component internals
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 5 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "TIMELINE_REDESIGN_COMPLETE"
```
