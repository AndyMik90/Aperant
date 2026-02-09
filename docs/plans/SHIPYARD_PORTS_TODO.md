# Shipyard Feature Ports — TODO

**Source:** [SHIPYARD_COMPARISON.md](../SHIPYARD_COMPARISON.md)
**Created:** 2026-02-06
**Status:** Planning

---

## Phase 1 — HIGH Priority

### [x] 1. Secret Scrubbing for Memory Storage ✓ DONE
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/memory/scrubber.py`
- **What:** 17 regex patterns to strip API keys, tokens, and credentials before any memory write
- **Patterns:** AWS keys, GitHub/OAuth tokens, Anthropic/OpenAI keys, DB URLs, private keys, JWTs, Azure strings, Stripe/Slack/NPM tokens
- **Integrated into:** sessions.py, patterns.py, codebase_map.py, project_memory.py, memory_handlers.py, memory_manager.py, memory_integration.py

### [x] 2. Model Routing per Agent Role ✓ DONE
- **Effort:** ~3-4 hours
- **Target:** `apps/backend/phase_config.py` (ROLE_MODEL_DEFAULTS + get_role_model()) + `apps/frontend/src/shared/constants/models.ts` + `agent-process.ts` + `agent-manager.ts`
- **What:** Each agent role has a default model: companion=haiku, supervisor=sonnet, insights/merge/commit=haiku, pr_review=sonnet, spec_critic/ideation/roadmap=opus. Pipeline agents (coder, planner, qa) still use phase-based routing. Per-task overrides via `roleModels` in task_metadata.json.
- **Integrated into:** `phase_config.py`, `simple_client.py`, `companion_agent.py`, `agent-process.ts`, `agent-manager.ts`, `models.ts`
- **Why:** Saves money and latency by routing cheap tasks to Haiku instead of Opus/Sonnet

### [x] 3. Git Checkpoint & Rollback System ✓ DONE (backend)
- **Effort:** ~4-5 hours
- **Target:** `apps/backend/core/git_checkpoint.py` + build lifecycle hooks
- **What:** Annotated git tags at build-start, per-subtask, build-complete, and build-failed. Rollback via `rollback_to()`. Tag format: `ac-jerry/{spec}/{type}-{timestamp}`
- **Integrated into:** `cli/build_commands.py` (start/complete), `agents/coder.py` (subtask/failed)
- **Future:** TaskCard "Rollback" button (frontend UI) deferred

---

## Phase 2 — MEDIUM Priority

### [x] 4. Memory Storage Pruning + Repair ✓ DONE
- **Effort:** ~6-8 hours
- **Target:** `apps/backend/memory/pruner.py`, `apps/backend/memory/repair.py`
- **What:** Auto-prune oldest entries when over storage cap (default 1GB). Pruning order: session insights → codebase map → lessons. 7-check repair pipeline: directory structure, JSON validity, session numbering, codebase map schema, lessons schema, markdown integrity, stale lock cleanup. CLI commands: `--action prune`, `--action repair`, `--action check`.
- **Integrated into:** `cli/build_commands.py` (post-build), `agents/coder.py` (post-QA), `memory/main.py` (CLI)
- **Why:** Jerry's dual-layer memory grows unbounded with no recovery tools

### [ ] 5. Two-Stage Code Review
- **Effort:** ~4-5 hours
- **Target:** `apps/backend/qa/loop.py`
- **What:** Split QA reviewer into Stage 1 (spec compliance, haiku-capable) and Stage 2 (code quality, sonnet). Each stage can block the pipeline.
- **Why:** Single-pass review misses spec drift vs code quality issues

### [x] 6. Adaptive Context Loading ✓ DONE (resume variant)
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/agents/coder.py` + `core/client.py` + `spec/compaction.py`
- **What:** Resume-aware system prompt, compact spec summary (~200 tokens vs 2-5k), skip redundant spec reads on resumed sessions. Saves ~15k tokens/session.
- **See:** [ADAPTIVE_CONTEXT_RESUME.md](./ADAPTIVE_CONTEXT_RESUME.md)
- **Future:** Complexity-tier-based context loading (SIMPLE/STANDARD/COMPLEX) still deferred

---

## Phase 3 — LOW Priority

### [x] 7. Lessons Learned / Post-Task Retrospective ✓ DONE
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/memory/lessons.py` + `apps/backend/analysis/retrospective.py`
- **What:** After QA passes, LLM synthesizes session insights into structured retrospective (what worked, what didn't, key insights, recommendations). Stored as `lessons_learned.json` per spec. Key lessons promoted to `PROJECT_MEMORY.md`. Lessons loaded into coder context for future subtasks.
- **Integrated into:** `cli/build_commands.py` (post-QA), `agents/coder.py` (QA pass + context loading)
- **Why:** Continuous improvement through institutional knowledge

---

## Total Estimated: ~25-30 hours across 3 phases
