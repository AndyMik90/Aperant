# Ralph Task Index

**Updated:** 2026-02-05
**Purpose:** Master index linking Ralph prompts to their execution results

---

## Prompt ↔ Result Pairs

Compare what Ralph was asked to do vs what Ralph delivered.

| Task ID | Prompt | Result | Duration | Status |
|---------|--------|--------|----------|--------|
| FIX-17 | [prompts/FIX_17.md](prompts/FIX_17.md) | [results/FIX_17.md](results/FIX_17.md) | ~5m | COMPLETE |
| FIX-18-19 | [prompts/FIX_18_19.md](prompts/FIX_18_19.md) | [results/FIX_18_19.md](results/FIX_18_19.md) | 2m 25s | COMPLETE |
| LIFECYCLE | [prompts/LIFECYCLE.md](prompts/LIFECYCLE.md) | [results/LIFECYCLE.md](results/LIFECYCLE.md) | 10m 13s | COMPLETE |
| TERM-7A | [prompts/TERM_PHASE7.md](prompts/TERM_PHASE7.md) | [results/TERM_PHASE7A.md](results/TERM_PHASE7A.md) | 4m 15s | COMPLETE |
| METRICS-1 | [prompts/METRICS_1.md](prompts/METRICS_1.md) | [results/METRICS_1.md](results/METRICS_1.md) | 7m 2s | COMPLETE |
| SPEC-AUDIT | (ad-hoc) | [results/SPEC_AUDIT.md](results/SPEC_AUDIT.md) | 3m 55s | COMPLETE |
| FIX-24 | [prompts/FIX_24_REMOVE_REVIEW_CHECKBOX.md](prompts/FIX_24_REMOVE_REVIEW_CHECKBOX.md) | - | 4m 37s | COMPLETE |
| FIX-20-23+SETTINGS | [prompts/FIX_20_23_COMBINED.md](prompts/FIX_20_23_COMBINED.md) | - | 4m 53s | COMPLETE |
| TERM-7B | [prompts/TERM_7B.md](prompts/TERM_7B.md) | - | 3m 48s | COMPLETE |
| ONBOARDING-SIMPLIFY | [prompts/ONBOARDING_SIMPLIFY.md](prompts/ONBOARDING_SIMPLIFY.md) | - | 5m 41s | COMPLETE |
| TERM-POLISH | [prompts/TERM_POLISH.md](prompts/TERM_POLISH.md) | - | 5m 21s | COMPLETE |
| FIX-25-32 | [prompts/FIX_25_32_UX_POLISH.md](prompts/FIX_25_32_UX_POLISH.md) | - | 17m 9s | COMPLETE |
| P0-CRITICAL | [prompts/P0_CRITICAL_FIXES.md](prompts/P0_CRITICAL_FIXES.md) | [results/P0_CRITICAL_FIXES.md](results/P0_CRITICAL_FIXES.md) | 1m 15s | COMPLETE |
| P1-EFFICIENCY | [prompts/P1_EFFICIENCY.md](prompts/P1_EFFICIENCY.md) | [results/P1_EFFICIENCY.md](results/P1_EFFICIENCY.md) | 3m 28s | COMPLETE |
| P2-CI-TEST | [prompts/P2_CI_TEST.md](prompts/P2_CI_TEST.md) | [results/P2_CI_TEST.md](results/P2_CI_TEST.md) | 1m 55s | COMPLETE |
| P0-P1-P2-VERIFY | [prompts/P0_P1_P2_VERIFY.md](prompts/P0_P1_P2_VERIFY.md) | [results/P0_P1_P2_VERIFY.md](results/P0_P1_P2_VERIFY.md) | 42s | COMPLETE |
| UI-CHAT-UX | [prompts/UI_CHAT_UX.md](prompts/UI_CHAT_UX.md) | [results/UI_CHAT_UX.md](results/UI_CHAT_UX.md) | 5m 21s | COMPLETE |
| UI-LAYOUT-FIXES | [prompts/UI_LAYOUT_FIXES.md](prompts/UI_LAYOUT_FIXES.md) | [results/UI_LAYOUT_FIXES.md](results/UI_LAYOUT_FIXES.md) | 6m 22s | COMPLETE |
| UI-TERMINAL-VIEWS | [prompts/UI_TERMINAL_VIEWS.md](prompts/UI_TERMINAL_VIEWS.md) | [results/UI_TERMINAL_VIEWS.md](results/UI_TERMINAL_VIEWS.md) | 5m 46s | COMPLETE |

---

## Completed Runs

### 2026-02-05

| Run | Tasks | Duration | Avg/Task |
|-----|-------|----------|----------|
| P0-CRITICAL | 3 | 1m 15s | ~25s |
| P1-EFFICIENCY | 3 | 3m 28s | ~1.2m |
| P2-CI-TEST | 2 | 1m 55s | ~58s |
| P0-P1-P2-VERIFY | 6 checks | 42s | ~7s |
| UI-CHAT-UX | 4 | 5m 21s | ~1.3m |
| UI-LAYOUT-FIXES | 2 | 6m 22s | ~3.2m |
| UI-TERMINAL-VIEWS | 2 | 5m 46s | ~2.9m |

**Total (2026-02-05):** 22 tasks + 6 checks in ~24m 49s

---

### 2026-02-04

| Run | Tasks | Duration | Avg/Task |
|-----|-------|----------|----------|
| FIX-17 | 1 | ~5m | ~5m |
| LIFECYCLE | 4 | 10m 13s | ~2.5m |
| FIX-18-19 | 2 | 2m 25s | ~1.2m |
| TERM-7A | 4 | 4m 15s | ~1m |
| METRICS-1 | 3 | 7m 2s | ~2.3m |
| SPEC-AUDIT | - | 3m 55s | (audit) |
| FIX-24 | 1 | 4m 37s | ~4.6m |
| FIX-20-23+SETTINGS | 7 | 4m 53s | ~0.7m |
| TERM-7B | 4 | 3m 48s | ~1m |
| ONBOARDING-SIMPLIFY | 7 | 5m 41s | ~0.8m |
| TERM-POLISH | 2 | 5m 21s | ~2.7m |
| FIX-25-32 | 10 | 17m 9s | ~1.7m |

**Total:** 45 tasks + 1 audit in ~74m

---

## Ready to Run

*No pending tasks. All queued prompts have been executed.*

---

## Historical Runs

From RALPH_IMPLEMENTATION_GUIDE.md:

| Run | Tasks | Duration | Notes |
|-----|-------|----------|-------|
| JERRY v2.3 | 42/49 (86%) | 1h 6m 10s | Full implementation |
| JERRY v3.2 | 9/9 (100%) | ~unknown | Quick fixes |

---

## Folder Structure

```
docs/ralph/
├── INDEX.md           ← You are here
├── prompts/           ← What Ralph was asked to do
│   ├── FIX_17.md
│   ├── FIX_18_19.md
│   ├── FIX_20_SETTINGS.md
│   ├── FIX_20_23_COMBINED.md
│   ├── FIX_21_23_KANBAN_UI.md
│   ├── FIX_24_REMOVE_REVIEW_CHECKBOX.md
│   ├── FIX_25_32_UX_POLISH.md
│   ├── LIFECYCLE.md
│   ├── METRICS_1.md
│   ├── ONBOARDING_SIMPLIFY.md
│   ├── P0_CRITICAL_FIXES.md
│   ├── P0_P1_P2_VERIFY.md
│   ├── P1_EFFICIENCY.md
│   ├── P2_CI_TEST.md
│   ├── UI_CHAT_UX.md             ← NEW
│   ├── UI_LAYOUT_FIXES.md        ← NEW
│   ├── UI_TERMINAL_VIEWS.md      ← NEW
│   ├── TERM_PHASE7.md
│   ├── TERM_7B.md
│   └── TERM_POLISH.md
└── results/           ← What Ralph delivered
    ├── FIX_17.md
    ├── FIX_18_19.md
    ├── LIFECYCLE.md
    ├── TERM_PHASE7A.md
    ├── METRICS_1.md
    ├── P0_CRITICAL_FIXES.md
    ├── P0_P1_P2_VERIFY.md
    ├── P1_EFFICIENCY.md
    ├── P2_CI_TEST.md
    ├── UI_CHAT_UX.md             ← NEW
    ├── UI_LAYOUT_FIXES.md        ← NEW
    ├── UI_TERMINAL_VIEWS.md      ← NEW
    ├── SPEC_AUDIT.md
    ├── ONBOARDING_SIMPLIFY.md
    └── TERM_POLISH.md
```

---

## How to Use

1. **Before running Ralph:** Create prompt in `prompts/`
2. **After running Ralph:** Create result in `results/` with same name
3. **Compare:** Open both files side-by-side to see prompt vs delivery

---

## Related Documents

- [REMAINING_WORK.md](../plans/REMAINING_WORK.md) - Completion status (all done)
- [TASK_DURATION_LOG.md](../metrics/TASK_DURATION_LOG.md) - Duration metrics
- [TASK_DURATION_TRACKING.md](../architecture/TASK_DURATION_TRACKING.md) - Duration tracking architecture
- [STARTUP_ONBOARDING_AUDIT.md](../reports/STARTUP_ONBOARDING_AUDIT.md) - Onboarding flow audit

---

**Document Version:** 1.2
