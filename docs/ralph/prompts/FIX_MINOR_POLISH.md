# FIX_MINOR_POLISH: UX Polish + Accessibility (AUDIT-26 to AUDIT-31)

**Date:** 2026-02-06
**Tasks:** 6
**Max Iterations:** 60
**Priority:** MINOR
**Status:** ✅ EXECUTED SUCCESSFULLY (3m 53s) — 6/6 tasks, build passed
**Depends On:** Batches 1-4 (recommended)
**Source:** [MASTER_AUDIT_REPORT.md](../../MASTER_AUDIT_REPORT.md)

---

## Copy-Paste Prompt

```bash
/ralph-loop:ralph-loop "
You are fixing MINOR UX polish and accessibility issues for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 6-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude
- Frontend: apps/frontend/src/

---

OBJECTIVE: Fix 6 minor UX issues: ARIA labels on tab buttons, error state in SpecDocView, cache invalidation, loading spinner, copy button feedback, and hardcoded i18n strings.

---

FIX_MINOR_POLISH: 6 TASKS

| # | Task | File | Action | Promise |
|---|------|------|--------|---------|
| 1 | Add ARIA labels to tab buttons | apps/frontend/src/renderer/components/terminal/BottomPanelTerminal.tsx | FIX - Add aria-label to Raw, Timeline, Spec, and Prompt tab buttons. Use descriptive labels like 'View raw output', 'View timeline', 'View specification', 'View coding prompt'. | TASK_1_COMPLETE |
| 2 | Add error state to SpecDocView | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | FIX - Add an error state variable. When the IPC call fails (catch block), set error state with the failure reason. Display error message in the UI instead of silently showing empty state. Use text-destructive color for error text. | TASK_2_COMPLETE |
| 3 | Add cache invalidation to SpecDocView | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | FIX - Add a 'Refresh' button next to the Copy button in the header. When clicked, clear the cache and re-fetch content via IPC. Use a RefreshCw icon from lucide-react. | TASK_3_COMPLETE |
| 4 | Add loading spinner to SpecDocView | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | FIX - Add a loading state. Show a spinner or 'Loading...' text while the IPC call is in progress. Use the existing Loader2 icon from lucide-react with animate-spin if available, otherwise use text. | TASK_4_COMPLETE |
| 5 | Add copy button feedback | apps/frontend/src/renderer/components/terminal/SpecDocView.tsx | FIX - After clicking Copy, change the button text/icon to 'Copied!' or a Check icon for 2 seconds, then revert. Use useState with setTimeout. | TASK_5_COMPLETE |
| 6 | Replace hardcoded strings with t() calls | apps/frontend/src/renderer/components/ChatHistorySidebar.tsx | FIX - Find hardcoded strings like 'Today', 'Yesterday', 'Chat History', 'No conversations yet', 'Delete conversation?'. Check if t() or useTranslation is available in the project. If i18n is set up, replace with t() keys. If NOT set up, leave strings as-is but wrap them in a comment noting they should be i18n'd later. | TASK_6_COMPLETE |

FINAL: <promise>FIX_MINOR_POLISH_COMPLETE</promise>

---

KEY REQUIREMENTS:
1. SpecDocView changes (tasks 2-5) should work together cohesively
2. Loading state shows BEFORE content loads, error state shows on failure, cache refresh re-fetches
3. ARIA labels should be descriptive for screen readers
4. i18n task should check existing patterns — don't install new packages

---

VERIFICATION:
- cd apps/frontend && npm run build
- Build passes with no errors

---

CRITICAL CONSTRAINTS
1. 6-TASK JOB - Do NOT stop until all tasks complete
2. Do NOT restructure SpecDocView component architecture
3. BUILD MUST PASS
4. CONTINUATION - After each task: TASK_N_COMPLETE then NEXT: Task N+1

---

ANTI-SKIP RULES
- Do NOT skip any task
- Do NOT mark complete without making the change
- Do NOT output final promise until verification passes

---

CURRENT STATUS: 0 of 6 tasks complete. BEGIN NOW.
" --max-iterations 60 --completion-promise "FIX_MINOR_POLISH_COMPLETE"
```
