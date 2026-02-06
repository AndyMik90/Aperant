# PROMPT_TAB_UI: Add Spec + Prompt Tabs to Bottom Panel

**Date:** 2026-02-06
**Tasks:** 4
**Max Iterations:** 50
**Priority:** MEDIUM
**Status:** READY FOR EXECUTION
**Design Doc:** docs/plans/PERSISTENT_AGENT.md
**Depends On:** RALPH_PROMPT_GEN (run that first)

---

## Problem

Users can't see the spec document or the generated Ralph prompt from the UI. The bottom panel terminal only has Raw and Timeline views. Users need to review the spec and coding prompt before clicking "Start Build".

## Goal

Add "Spec" and "Prompt" tabs to the existing bottom panel tab bar (alongside Raw and Timeline). Each tab shows rendered markdown content loaded from the task's spec directory.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing PROMPT_TAB_UI for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Add 'Spec' and 'Prompt' tabs to the existing bottom panel terminal header. The bottom panel already has a tab system with 'Raw' and 'Timeline' views at apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx. Extend the ViewMode type to include 'spec' and 'prompt', add the tab buttons, and create content components that load and render markdown files from the task's spec directory via IPC.

Read BottomPanelTerminal.tsx thoroughly to understand the existing tab system before making changes.

---

PROMPT_TAB_UI: 4 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Extend ViewMode and add tab buttons | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - (a) Change the ViewMode type from 'raw' or 'structured' to also include 'spec' and 'prompt'. (b) Add two new tab buttons in the existing view mode toggle area. The Spec button should use a FileText icon (from lucide-react) and the Prompt button should use a Terminal or Code icon. Follow the exact same button styling pattern as the existing Raw and Timeline buttons. Keep all 4 buttons in a single row. | TASK_1_COMPLETE |
| 2 | Create IPC handler to read spec files | apps/frontend/src/main/ipc-handlers/agent-events-handlers.ts | MODIFY - add a new ipcMain.handle for 'task:read-spec-file' that takes (taskId, fileName) args. It should look up the task's spec directory from the agent manager's taskExecutionContext, then read the requested file (spec.md or ralph_prompt.md) from that directory using fs.readFile. Return the file contents as a string, or null if the file doesn't exist. Also add the IPC channel constant to ipc-channels.ts. | TASK_2_COMPLETE |
| 3 | Create SpecDocView component | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | CREATE - a React component that displays rendered markdown content. Props: taskId (string), fileName (string, either 'spec.md' or 'ralph_prompt.md'), title (string). On mount, call window.api.invoke('task:read-spec-file', taskId, fileName) to load the content. Display in a ScrollArea with: (a) a header showing the title and file name, (b) rendered markdown content using dangerouslySetInnerHTML with a simple markdown-to-html conversion (or just display as preformatted text with whitespace-pre-wrap in a monospace font with proper styling). (c) A 'Copy' button to copy raw content to clipboard. (d) An 'empty state' message if file doesn't exist yet ('Spec not available yet — planning phase has not completed'). Use bg-card for background, text-foreground for text, and proper padding. | TASK_3_COMPLETE |
| 4 | Render new tabs in bottom panel | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | MODIFY - in the content area where TaskMonitorChat is rendered, add conditional rendering for the new view modes. When viewMode is 'spec', render SpecDocView with fileName='spec.md' and title='Task Specification'. When viewMode is 'prompt', render SpecDocView with fileName='ralph_prompt.md' and title='Coding Prompt (Ralph Loop)'. Pass the current taskId from the bottom panel state. Keep the existing Raw and Timeline rendering unchanged. | TASK_4_COMPLETE |

FINAL: <promise>PROMPT_TAB_UI_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. Tab buttons must match existing Raw/Timeline button style exactly (same size, colors, hover states)
2. All 4 tabs in a single horizontal row: Raw | Timeline | Spec | Prompt
3. Spec tab shows spec.md content, Prompt tab shows ralph_prompt.md content
4. Content loads via IPC from the spec directory on disk — NOT from the terminal output stream
5. Empty state when file doesn't exist (e.g., before planning completes)
6. Copy button to copy raw markdown to clipboard
7. ScrollArea for long content with proper overflow handling
8. Monospace font for the prompt content (it's code-like), proportional for spec (it's prose)
9. Dark theme consistent — use bg-card, border-border, text-foreground
10. Tab state persists while switching between tabs (don't reload every time)

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure the existing bottom panel layout
3. Do NOT modify TaskMonitorChat or StructuredOutput — only add new content alongside them
4. Do NOT break the existing Raw and Timeline tab functionality
5. BUILD MUST PASS
6. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "PROMPT_TAB_UI_COMPLETE"
```
