# CHAT_INPUT_REDESIGN: New Chat Input Component with Stop Button + Attachments

**Date:** 2026-02-06
**Tasks:** 7
**Max Iterations:** 80
**Priority:** HIGH
**Status:** ✅ EXECUTED SUCCESSFULLY (6m 34s)
**Design Doc:** docs/plans/CHAT_OVERHAUL.md
**Depends On:** CHAT_UI_ALIGNMENT (run that first)

---

## Problem

The Insights chat input has critical UX issues:
- Send button is outside the textarea (disconnected feel)
- No way to stop/cancel the agent mid-generation
- No way to attach screenshots or files for context
- Input is disabled during generation (user locked out)

## Solution

Replace the inline textarea + external button with a new ChatInput component that has the send button inside, a stop/cancel button during generation, and attachment support.

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are implementing CHAT_INPUT_REDESIGN for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 7-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/
- Backend: apps/backend/

---

OBJECTIVE: Replace the current chat input in the Insights page with a modern ChatInput component. The send button goes inside the input box (like VS Code Copilot). A stop/cancel button appears during generation. Users can attach images and files. The input always stays enabled.

---

CHAT_INPUT_REDESIGN: 7 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Create ChatInput component | apps/frontend/src/renderer/components/insights/ChatInput.tsx | NEW FILE - standalone chat input component with textarea, send button inside (bottom-right), attachment button (bottom-left), stop button (replaces send during generation), attachment chips area | TASK_1_COMPLETE |
| 2 | Add cancel IPC handler | apps/frontend/src/main/ipc-handlers/insights-handlers.ts | MODIFY - add 'insights:cancel' IPC handler that aborts the current insights runner process | TASK_2_COMPLETE |
| 3 | Add cancel to insights store | apps/frontend/src/renderer/stores/insights-store.ts | MODIFY - add cancelGeneration action that calls the insights:cancel IPC and resets status to idle | TASK_3_COMPLETE |
| 4 | Add cancel to preload | apps/frontend/src/preload/index.ts | MODIFY - expose insights:cancel in the electron preload bridge if not already available | TASK_4_COMPLETE |
| 5 | Replace input in Insights page | apps/frontend/src/renderer/components/Insights.tsx | MODIFY - remove the inline textarea + send button at the bottom, replace with the new ChatInput component. Pass all needed props (onSend, onCancel, onAttach, isLoading, disabled) | TASK_5_COMPLETE |
| 6 | Add attachment support to message sending | apps/frontend/src/renderer/stores/insights-store.ts | MODIFY - update sendMessage to accept optional attachments array (file path + type). Pass attachments through IPC to the backend runner | TASK_6_COMPLETE |
| 7 | Handle attachments in backend | apps/frontend/src/main/insights/insights-executor.ts | MODIFY - pass attachment data to the insights runner. Images should be included as base64 image content in the API message | TASK_7_COMPLETE |

FINAL: <promise>CHAT_INPUT_REDESIGN_COMPLETE</promise>

---

KEY REQUIREMENTS:

1. ChatInput layout: single container with rounded border, textarea fills the top, bottom toolbar has attach button (left) and send/stop button (right)
2. Send button: circular, inside the input container bottom-right, uses ArrowUp or Send icon, disabled when empty
3. Stop button: replaces send button position during generation, uses Square icon, red/destructive variant, calls cancelGeneration
4. Attach button: Paperclip icon, bottom-left of input, opens native file dialog via electron dialog.showOpenDialog
5. Attachment chips: appear between textarea and bottom toolbar, show filename + remove button
6. Supported attachment types: images (png, jpg, gif, webp), text files (txt, md, ts, tsx, js, py, etc.)
7. Attachment size limits: 10MB for images, 1MB for text files — validate before adding
8. Keyboard: Enter sends, Shift+Enter newline, Escape cancels generation
9. Textarea must NEVER be disabled — always allow typing
10. Use existing UI components (Button, etc.) and lucide-react icons
11. Style should match the existing dark theme and design system

---

VERIFICATION:
- Run: cd apps/frontend && npm run build
- ChatInput renders inside the Insights page with send button inside the input
- Stop button appears during generation
- Attach button opens file picker
- Build passes with no errors

---

CRITICAL CONSTRAINTS

1. 7-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT break existing chat functionality — messages must still send and stream correctly
3. Do NOT modify the insights runner Python code — only frontend and IPC handlers
4. BUILD MUST PASS
5. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES

- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 7 tasks complete. BEGIN NOW.
" --max-iterations 80 --completion-promise "CHAT_INPUT_REDESIGN_COMPLETE"
```
