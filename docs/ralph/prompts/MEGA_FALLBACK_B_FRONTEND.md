# MEGA_FALLBACK_B: Prompt Tab UI (Frontend)

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (18m 28s) — 4/4 tasks, build passed
**Design Doc:** [docs/plans/PERSISTENT_AGENT.md](../plans/PERSISTENT_AGENT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing MEGA_FALLBACK_B (Frontend) for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Add 'Spec' and 'Prompt' tabs to the existing bottom panel terminal header. The bottom panel already has a tab system with 'Raw' and 'Timeline' views at apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx. Extend the ViewMode type, add tab buttons, create a content component that loads markdown files from disk via IPC.

Read BottomPanelTerminal.tsx thoroughly before making changes.

---

MEGA_FALLBACK_B: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Extend ViewMode and add tab buttons | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - (a) Change ViewMode to include 'spec' and 'prompt'. (b) Add Spec button (FileText icon from lucide-react) and Prompt button (Code icon). Match existing button styling. All 4 buttons in one row. | TASK_1_COMPLETE |
| 2 | Create IPC handler to read spec files | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | MODIFY - add ipcMain.handle for 'task:read-spec-file' taking (taskId, fileName). Look up spec directory from agent manager's taskExecutionContext. Read file with fs.readFile. Return string or null. Add IPC channel constant to ipc channels file (check shared/constants/ipc.ts). | TASK_2_COMPLETE |
| 3 | Create SpecDocView component | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | CREATE - React component. Props: taskId, fileName ('spec.md' or 'ralph_prompt.md'), title. On mount, invoke 'task:read-spec-file' IPC. Display in ScrollArea with header, preformatted text (whitespace-pre-wrap, monospace for prompt, proportional for spec), Copy button, empty state if file doesn't exist. Use bg-card, text-foreground. Cache content in state. | TASK_3_COMPLETE |
| 4 | Render new tabs in bottom panel | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - add conditional rendering for 'spec' and 'prompt' viewModes. 'spec' renders SpecDocView with fileName='spec.md', title='Task Specification'. 'prompt' renders SpecDocView with fileName='ralph_prompt.md', title='Coding Prompt'. Pass taskId. Import SpecDocView. | TASK_4_COMPLETE |

FINAL: <promise>MEGA_FALLBACK_B_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. Tab buttons match existing Raw/Timeline style exactly
2. 4 tabs in single row: Raw | Timeline | Spec | Prompt
3. Content loads via IPC from spec directory on disk
4. Empty state when file doesn't exist
5. Copy button for raw content
6. Tab state persists when switching
7. Dark theme: bg-card, border-border, text-foreground

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS
1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure existing bottom panel layout
3. Do NOT modify TaskMonitorChat or StructuredOutput
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "MEGA_FALLBACK_B_COMPLETE"
```
