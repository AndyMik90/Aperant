# Architecture Documentation

This folder contains architecture and design documentation for Auto-Claude (Jerry).

## Documents

| Document | Description |
|----------|-------------|
| [FULL_ARCHITECTURE.md](FULL_ARCHITECTURE.md) | **Complete multi-layer architecture** - Frontend, Backend, UX, UI |
| [TASK_PHASE_FLOW.md](TASK_PHASE_FLOW.md) | **Code-level phase flow** - What happens at each phase |
| [TASK_WORKFLOW.md](TASK_WORKFLOW.md) | Task lifecycle - Planning to Done |
| [ARCHITECTURE_COMPARISON.md](ARCHITECTURE_COMPARISON.md) | Original vs Current fork comparison |

## Reading Order

1. **Start with** [FULL_ARCHITECTURE.md](FULL_ARCHITECTURE.md) - Overview of all layers
2. **Then read** [TASK_PHASE_FLOW.md](TASK_PHASE_FLOW.md) - Detailed code-level flow
3. **Reference** [TASK_WORKFLOW.md](TASK_WORKFLOW.md) - User-facing workflow
4. **Compare** [ARCHITECTURE_COMPARISON.md](ARCHITECTURE_COMPARISON.md) - Fork vs Original

## Quick Reference

### Task Lifecycle

```
Planning → Coding → AI Review → Human Review → Done
    │         │
    │    (user-triggered)
    │
(auto-start on task create)
```

### Key Files

| Component | Location |
|-----------|----------|
| Task Store | `apps/frontend/src/renderer/stores/task-store.ts` |
| State Machine | `apps/frontend/src/renderer/stores/task-machine.ts` |
| IPC Handlers | `apps/frontend/src/main/ipc-handlers/` |
| Backend Run | `apps/backend/run.py` |
| QA Loop | `apps/backend/qa/loop.py` |
| Phase Config | `apps/backend/phase_config.py` |

### Ralph Wiggum Mode

Enhanced execution mode with higher thresholds:
- 5 retry attempts (vs 3 normal)
- 100 QA iterations (vs 50 normal)
- Force pivot on circular fix detection

See [ARCHITECTURE_COMPARISON.md](ARCHITECTURE_COMPARISON.md) for details.

---

**Last Updated:** 2026-02-04
