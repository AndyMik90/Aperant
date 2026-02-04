# Ralph Prompt: FIX-25 to FIX-32 UX Polish

**Created:** 2026-02-04
**Tasks:** 10
**Estimated Duration:** ~15-20m

---

## Prompt

```bash
/ralph-loop:ralph-loop "
You are completing FIX-25 to FIX-32: UX Polish for Jerry.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- You do not get to decide if tasks are worth doing.
- If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\plans\FIX_25_29_SPEC.md (READ THIS FULLY)

---

TASKS (10 required – ALL MUST COMPLETE)

| # | Task | Description | Promise |
|---|------|-------------|---------|
| 1 | FIX-28 | Remove duplicate '+' button from Planning column header | FIX_28_COMPLETE |
| 2 | FIX-30 | Consolidate chat icons to chat bubble | FIX_30_COMPLETE |
| 3 | FIX-31 | Remove icons from 'New Terminal'/'New Claude Code' buttons | FIX_31_COMPLETE |
| 4 | FIX-32 | Add 'New Claude Code' button to empty state | FIX_32_COMPLETE |
| 5 | FIX-25 | Project removal dialog with two options | FIX_25_COMPLETE |
| 6 | FIX-26 | Clear task cache when project removed | FIX_26_COMPLETE |
| 7 | FIX-27 | Delete tasks from ALL locations (worktrees) | FIX_27_COMPLETE |
| 8 | FIX-29a | Compact inline terminal preview (3-4 lines) | FIX_29A_COMPLETE |
| 9 | FIX-29b | Add 'Pop out' button to task cards | FIX_29B_COMPLETE |
| 10 | FIX-29c | Create BottomPanelTerminal component | FIX_29C_COMPLETE |

FINAL: <promise>FIX_25_32_UX_POLISH_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs\plans\FIX_25_29_SPEC.md FULLY before starting.

2. Task 1 (FIX-28): Remove duplicate '+' button
   - Find '+' button in KanbanBoard.tsx Planning column header
   - Remove it (keep sidebar '+' only)
   - Output: <promise>FIX_28_COMPLETE</promise>

3. Task 2 (FIX-30): Consolidate chat icons
   - In Sidebar.tsx: Change Chat nav icon to MessageSquare (chat bubble)
   - In Insights.tsx: Change ONLY the header icon next to 'Chat' title to MessageSquare
   - DO NOT CHANGE: Sparkles icons for 'Suggested Task' cards (those stay as sparkles)
   - DO NOT CHANGE: Jerry avatar icon
   - Keep all AI/suggestion sparkle icons as they are
   - Output: <promise>FIX_30_COMPLETE</promise>

4. Task 3 (FIX-31): Remove button icons
   - Find 'New Terminal' and 'New Claude Code' buttons in TerminalGrid.tsx
   - Remove the icon components, keep text only
   - Output: <promise>FIX_31_COMPLETE</promise>

5. Task 4 (FIX-32): Add Claude Code to empty state
   - Find empty state in TerminalGrid.tsx
   - Add 'New Claude Code' button next to 'New Terminal'
   - Output: <promise>FIX_32_COMPLETE</promise>

6. Task 5 (FIX-25): Project removal dialog
   - Find removeProject in project-store.ts
   - Add deleteData parameter
   - Create dialog component with two options
   - Output: <promise>FIX_25_COMPLETE</promise>

7. Task 6 (FIX-26): Clear task cache
   - Find task cache in task-store.ts or crud-handlers.ts
   - Add cache invalidation when project is removed
   - Output: <promise>FIX_26_COMPLETE</promise>

8. Task 7 (FIX-27): Delete from worktrees
   - Find deleteTask in crud-handlers.ts
   - Add worktree deletion logic
   - Output: <promise>FIX_27_COMPLETE</promise>

9. Task 8 (FIX-29a): Compact terminal preview
   - Modify TaskCard.tsx terminal section
   - Show only 3-4 lines with auto-scroll
   - Output: <promise>FIX_29A_COMPLETE</promise>

10. Task 9 (FIX-29b): Pop out button
    - Add 'Pop out' button to TaskCard.tsx
    - Wire up to open bottom panel
    - Output: <promise>FIX_29B_COMPLETE</promise>

11. Task 10 (FIX-29c): Bottom panel terminal
    - Create BottomPanelTerminal.tsx component
    - Add resizable drag handle
    - Add chat input field
    - Integrate into KanbanBoard.tsx
    - Output: <promise>FIX_29C_COMPLETE</promise>

12. Verify: npm run build
    - Fix any TypeScript errors
    - Fix any build errors

13. Final: <promise>FIX_25_32_UX_POLISH_COMPLETE</promise>

---

HARD STOP RULE

- You may NOT stop until <promise>FIX_25_32_UX_POLISH_COMPLETE</promise> is output.
- If you find yourself writing wrap-up language while tasks remain, STOP and continue working.

CURRENT STATUS: 0 of 10 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "FIX_25_32_UX_POLISH_COMPLETE"
```

---

## Expected Files Modified

| File | Changes |
|------|---------|
| `KanbanBoard.tsx` | Remove '+' button, add BottomPanelTerminal |
| `Sidebar.tsx` | Change Chat icon to MessageSquare |
| `TerminalGrid.tsx` | Remove button icons, add Claude Code to empty state |
| `project-store.ts` | Add deleteData parameter |
| `task-store.ts` | Add cache invalidation |
| `crud-handlers.ts` | Add worktree deletion |
| `TaskCard.tsx` | Compact preview, pop out button |
| `BottomPanelTerminal.tsx` | NEW - Full bottom panel component |

---

## Success Criteria

All 10 tasks must complete and build must pass.

---

**Document Version:** 1.0
