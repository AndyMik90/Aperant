# Ralph Task Index

**Updated:** 2026-02-06
**Purpose:** Master index of Ralph Loop prompts and results

---

## Quick Links

- **[RALPH_PROMPT_GUIDE.md](RALPH_PROMPT_GUIDE.md)** - How to write effective prompts
- **[prompts/](prompts/)** - All prompt files
- **[results/](results/)** - Execution outputs

---

## Completed — Audit Fix Batches (6 prompts, 37 tasks, 36m 15s)

**Source:** [MASTER_AUDIT_REPORT.md](../MASTER_AUDIT_REPORT.md) (UI Audit + Code Sweep #2)
**Result:** ALL 37 TASKS COMPLETE. All builds pass. Vite warning eliminated.

| # | Prompt | Tasks | Priority | Description |
|---|--------|-------|----------|-------------|
| 1 | [FIX_COMPANION_CRITICAL.md](prompts/FIX_COMPANION_CRITICAL.md) | 4 | CRITICAL | ✅ 3m 44s — 3 fixed, 1 false positive (preload bridge already worked) |
| 2 | [FIX_HIGH_LEAKS_SECURITY.md](prompts/FIX_HIGH_LEAKS_SECURITY.md) | 6 | HIGH | ✅ 6m 7s — 5 fixed, 1 no-leak-found (listeners already clean) |
| 3 | [FIX_MAJOR_STABILITY.md](prompts/FIX_MAJOR_STABILITY.md) | 8 | MAJOR | ✅ 4m 15s — 7 fixed, 1 verified correct (create_agent_session sync) |
| 4 | [FIX_MAJOR_STORES.md](prompts/FIX_MAJOR_STORES.md) | 7 | MAJOR | ✅ 7m 16s — 7 fixed (terminal race, JSON safety, sidebar clamp, cancel guard) |
| 5 | [FIX_MINOR_POLISH.md](prompts/FIX_MINOR_POLISH.md) | 6 | MINOR | ✅ 3m 53s — 5 fixed, 1 already implemented (copy feedback existed) |
| 6 | [FIX_MINOR_CLEANUP.md](prompts/FIX_MINOR_CLEANUP.md) | 6 | MINOR | ✅ 11m 13s — 6 fixed (dead code, format util, Vite warning, type safety) |

---

## Completed — Mega Stress Test (14 tasks in one loop)

**Design Docs:** [MEMORY_LEARNING_ARCHITECTURE.md](../plans/MEMORY_LEARNING_ARCHITECTURE.md), [PERSISTENT_AGENT.md](../plans/PERSISTENT_AGENT.md)
**Strategy:** Try mega loop first → fallback to 2 smaller loops if needed

| # | Prompt | Tasks | Description |
|---|--------|-------|-------------|
| ~~MEGA~~ | [MEGA_MEMORY_PROMPTGEN_TABS.md](prompts/MEGA_MEMORY_PROMPTGEN_TABS.md) | ~~14~~ | ❌ Too long — CLI crashed on input (~6000 words exceeds shell limit) |
| FALLBACK-A | [MEGA_FALLBACK_A_BACKEND.md](prompts/MEGA_FALLBACK_A_BACKEND.md) | 10 | ✅ 6m 2s — Backend: Memory + QA Bridge + Ralph Gen |
| FALLBACK-B | [MEGA_FALLBACK_B_FRONTEND.md](prompts/MEGA_FALLBACK_B_FRONTEND.md) | 4 | ✅ 18m 28s — Frontend: Spec + Prompt tabs |

---

## Completed — Persistent Companion Agent (4 prompts, 17 tasks)

**Design Doc:** [docs/plans/PERSISTENT_AGENT.md](../plans/PERSISTENT_AGENT.md)

| # | Task ID | Prompt | Tasks | Duration | Description |
|---|---------|--------|-------|----------|-------------|
| 1 | COMP-BACK | [COMPANION_BACKEND.md](prompts/COMPANION_BACKEND.md) | 4 | 3m 18s | ✅ Create companion_runner.py + companion_agent.py + context builder |
| 2 | COMP-LIFE | [COMPANION_LIFECYCLE.md](prompts/COMPANION_LIFECYCLE.md) | 5 | 4m 22s | ✅ ProcessType, spawnCompanion, stopCompanion, auto-spawn, handoff |
| 3 | COMP-IPC | [COMPANION_IPC_STATE.md](prompts/COMPANION_IPC_STATE.md) | 4 | 6m 32s | ✅ IPC channels, event handlers, task-store state, useIpc listeners |
| 4 | COMP-UI | [COMPANION_UI.md](prompts/COMPANION_UI.md) | 4 | 4m 37s | ✅ TaskCard badge, terminal companion mode, chat input, styling |

---

## Completed Prompts

### Kanban + Terminal + Timeline (2026-02-06)
**Design Doc:** [docs/plans/KANBAN_TERMINAL_TIMELINE.md](../plans/KANBAN_TERMINAL_TIMELINE.md)

| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| KANBAN-BTN | [KANBAN_BUILD_BUTTON.md](prompts/KANBAN_BUILD_BUTTON.md) | 3 | 3m 45s | ✅ |
| TERM-POLISH | [TERMINAL_OUTPUT_POLISH.md](prompts/TERMINAL_OUTPUT_POLISH.md) | 5 | 8m 41s | ✅ |
| TIMELINE | [TIMELINE_REDESIGN.md](prompts/TIMELINE_REDESIGN.md) | 5 | 3m 21s | ✅ |

**Files modified:**
- `main/ipc-handlers/agent-events-handlers.ts` — Emit TASK_AGENT_STOPPED on planning exit
- `components/TaskCard.tsx` — Show Start Build when subtasks exist and no active agent
- `stores/task-store.ts` — Clear agent stopped state on restart
- `components/terminal/TaskMonitorChat.tsx` — Tool block cards, thinking UX, code blocks, status bar
- `components/ActivityFeed.tsx` — Full timeline redesign with vertical line, date groups, cards, filters
- `utils/activity-tracker.ts` — Duration tracking, phaseInfo, MAX_ACTIVITIES=200

### Chat Overhaul (2026-02-06)
**Design Doc:** [docs/plans/CHAT_OVERHAUL.md](../plans/CHAT_OVERHAUL.md)

| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| CHAT-ALIGN | [CHAT_UI_ALIGNMENT.md](prompts/CHAT_UI_ALIGNMENT.md) | 4 | 2m 4s | ✅ |
| CHAT-INPUT | [CHAT_INPUT_REDESIGN.md](prompts/CHAT_INPUT_REDESIGN.md) | 7 | 6m 34s | ✅ |
| CHAT-RESIZE | [CHAT_RESIZABLE_SIDEBARS.md](prompts/CHAT_RESIZABLE_SIDEBARS.md) | 4 | 5m 17s | ✅ |

**Files created:**
- `components/insights/ChatInput.tsx` — Send inside input, stop button, attachments
- `components/insights/ResizeHandle.tsx` — Drag-to-resize handle

**Files modified:**
- `components/Insights.tsx` — New layout with ChatInput, resize handles, localStorage persistence
- `components/ChatHistorySidebar.tsx` — Dynamic width prop, h-12 header
- `components/insights/TaskQueueSidebar.tsx` — Dynamic width prop, h-12 header
- `stores/insights-store.ts` — cancelGeneration action, attachment support
- `main/ipc-handlers/insights-handlers.ts` — insights:cancel IPC handler
- `preload/api/modules/insights-api.ts` — cancelInsights bridge

### Task Queue Sidebar (2026-02-06)
| Task ID | Prompt | Tasks | Duration | Status |
|---------|--------|-------|----------|--------|
| TASK-SIDEBAR | [INSIGHTS_TASK_SIDEBAR.md](prompts/INSIGHTS_TASK_SIDEBAR.md) | 6 | 4m 40s | ✅ |

**Files created/modified:**
- `apps/frontend/src/renderer/stores/insights-task-queue-store.ts` (NEW)
- `apps/frontend/src/renderer/components/insights/TaskQueueCard.tsx` (NEW)
- `apps/frontend/src/renderer/components/insights/TaskQueueSidebar.tsx` (NEW)
- `apps/frontend/src/renderer/components/Insights.tsx` - Sidebar layout
- `apps/frontend/src/renderer/stores/insights-store.ts` - Queue integration

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

### 2026-02-06
- **Tasks completed:** 110 tasks (Features 73 + Audit Fixes 37)
- **Feature tasks:** Adaptive Routing 8 + Task Sidebar 6 + Chat Overhaul 15 + Kanban Fix 3 + Terminal Polish 5 + Timeline 5 + Companion Agent 17 + Memory/Ralph/Tabs 14
- **Audit fix tasks:** Batch 1 (4) + Batch 2 (6) + Batch 3 (8) + Batch 4 (7) + Batch 5 (6) + Batch 6 (6)
- **Total duration:** ~121 minutes (features ~85m + fixes ~36m)
- **Average per task:** ~66 seconds
- **Issues found:** 65 (all fixed, 0 open)

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
│   ├── ADAPTIVE_TASK_ROUTING.md  ← Completed
│   ├── CHAT_UI_ALIGNMENT.md      ← Ready (1/3)
│   ├── CHAT_INPUT_REDESIGN.md    ← Ready (2/3)
│   ├── CHAT_RESIZABLE_SIDEBARS.md ← Ready (3/3)
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
