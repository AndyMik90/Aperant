# Ralph Task Index

**Updated:** 2026-02-06
**Purpose:** Master index of Ralph Loop prompts and results

---

## Quick Links

- **[RALPH_PROMPT_GUIDE.md](RALPH_PROMPT_GUIDE.md)** - How to write effective prompts
- **[prompts/](prompts/)** - All prompt files
- **[results/](results/)** - Execution outputs

---

## Ready to Run

*No pending tasks.*

---

## Completed Prompts

### Adaptive Task Routing (2026-02-06)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| ADAPTIVE-ROUTING | [ADAPTIVE_TASK_ROUTING.md](prompts/ADAPTIVE_TASK_ROUTING.md) | 8 | 8m 1s | ✅ |

**Files created/modified:**
- `apps/backend/agents/complexity_classifier.py` (NEW)
- `apps/backend/phase_config.py` - COMPLEXITY_PHASE_CONFIG
- `apps/backend/spec/pipeline/orchestrator.py` - Integration
- `apps/backend/cli/build_commands.py` - QA skip logic
- `apps/frontend/src/shared/types/task.ts` - AdaptiveComplexity type
- `apps/frontend/src/main/agent/agent-events.ts` - Parser
- `apps/frontend/src/main/agent/agent-process.ts` - Event emission
- `apps/frontend/src/renderer/components/TaskCard.tsx` - Badge

### Code Sweeps (2026-02-05)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| SWEEP-P0 | [SWEEP_P0_CRITICAL.md](prompts/SWEEP_P0_CRITICAL.md) | 4 | ~5m | ✅ |
| SWEEP-P1-FE | [SWEEP_P1_FRONTEND.md](prompts/SWEEP_P1_FRONTEND.md) | 5 | ~8m | ✅ |
| SWEEP-P1-BE | [SWEEP_P1_BACKEND.md](prompts/SWEEP_P1_BACKEND.md) | 4 | ~6m | ✅ |
| SWEEP-P2 | [SWEEP_P2_MINOR.md](prompts/SWEEP_P2_MINOR.md) | 6 | ~10m | ✅ |

### UI/UX Improvements (2026-02-05)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| UI-CHAT-UX | [UI_CHAT_UX.md](prompts/UI_CHAT_UX.md) | 4 | 5m 21s | ✅ |
| UI-LAYOUT | [UI_LAYOUT_FIXES.md](prompts/UI_LAYOUT_FIXES.md) | 2 | 6m 22s | ✅ |
| UI-TERMINAL | [UI_TERMINAL_VIEWS.md](prompts/UI_TERMINAL_VIEWS.md) | 2 | 5m 46s | ✅ |
| UI-JERRY-CHAT | [UI_JERRY_CHAT_FIXES.md](prompts/UI_JERRY_CHAT_FIXES.md) | 3 | ~5m | ✅ |

### Feature Work (2026-02-04)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| ONBOARDING | [ONBOARDING_SIMPLIFY.md](prompts/ONBOARDING_SIMPLIFY.md) | 7 | 5m 41s | ✅ |
| TERM-7A | [TERM_PHASE7.md](prompts/TERM_PHASE7.md) | 4 | 4m 15s | ✅ |
| TERM-7B | [TERM_7B.md](prompts/TERM_7B.md) | 4 | 3m 48s | ✅ |
| TERM-POLISH | [TERM_POLISH.md](prompts/TERM_POLISH.md) | 2 | 5m 21s | ✅ |
| LIFECYCLE | [LIFECYCLE.md](prompts/LIFECYCLE.md) | 4 | 10m 13s | ✅ |
| METRICS-1 | [METRICS_1.md](prompts/METRICS_1.md) | 3 | 7m 2s | ✅ |

### Bug Fixes (2026-02-04)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| FIX-17 | [FIX_17.md](prompts/FIX_17.md) | 1 | ~5m | ✅ |
| FIX-18-19 | [FIX_18_19.md](prompts/FIX_18_19.md) | 2 | 2m 25s | ✅ |
| FIX-20-23 | [FIX_20_23_COMBINED.md](prompts/FIX_20_23_COMBINED.md) | 7 | 4m 53s | ✅ |
| FIX-24 | [FIX_24_REMOVE_REVIEW_CHECKBOX.md](prompts/FIX_24_REMOVE_REVIEW_CHECKBOX.md) | 1 | 4m 37s | ✅ |
| FIX-25-32 | [FIX_25_32_UX_POLISH.md](prompts/FIX_25_32_UX_POLISH.md) | 10 | 17m 9s | ✅ |

---

## Performance Optimization Prompts

| Prompt | Purpose |
|--------|---------|
| [PERF_AGENT_SPEED.md](prompts/PERF_AGENT_SPEED.md) | Agent execution speed improvements |
| [PERF_THINKING_BUDGETS.md](prompts/PERF_THINKING_BUDGETS.md) | Thinking budget optimization |

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| [RALPH_IMPLEMENTATION_GUIDE.md](prompts/RALPH_IMPLEMENTATION_GUIDE.md) | Historical implementation reference |
| [RALPH_FIX_ALL_PROMPT.md](prompts/RALPH_FIX_ALL_PROMPT.md) | Legacy bulk fix prompt |

---

## Statistics

### 2026-02-05
- **Tasks completed:** 22+ tasks
- **Total duration:** ~45 minutes
- **Average per task:** ~2 minutes

### 2026-02-04
- **Tasks completed:** 45 tasks
- **Total duration:** ~74 minutes
- **Average per task:** ~1.6 minutes

---

## Folder Structure

```
docs/ralph/
├── INDEX.md                  # This file
├── RALPH_PROMPT_GUIDE.md     # How to write prompts
├── prompts/                  # All prompt files
│   ├── ADAPTIVE_TASK_ROUTING.md  ← Ready to run
│   ├── SWEEP_*.md                ← Code sweep prompts
│   ├── UI_*.md                   ← UI improvement prompts
│   ├── FIX_*.md                  ← Bug fix prompts
│   ├── TERM_*.md                 ← Terminal prompts
│   └── PERF_*.md                 ← Performance prompts
└── results/                  # Execution outputs
```

---

## How to Use

1. **Find a prompt** in `prompts/` or create a new one
2. **Follow the guide** in [RALPH_PROMPT_GUIDE.md](RALPH_PROMPT_GUIDE.md)
3. **Run the prompt** with Ralph Loop
4. **Save the output** to `results/` with matching filename
