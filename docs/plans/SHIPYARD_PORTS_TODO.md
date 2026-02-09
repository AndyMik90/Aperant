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

### [ ] 2. Model Routing per Agent Role
- **Effort:** ~3-4 hours
- **Target:** `apps/frontend/src/main/agent/agent-manager.ts` + settings store
- **What:** Route different agent roles to different models (haiku for validation, sonnet for building, opus for architecture)
- **Map:** companion=haiku, spec-generation=sonnet, qa-review=sonnet, complexity-classifier=haiku
- **Why:** Jerry uses one model per agent — wastes money and latency on simple tasks

### [ ] 3. Git Checkpoint & Rollback System
- **Effort:** ~4-5 hours
- **Target:** `apps/backend/` (new checkpoint module) + TaskCard UI button
- **What:** Auto-create git tags before/after builds (`jerry-pre-build-{taskId}`, `jerry-post-build-{taskId}`). Add "Rollback" button to TaskCard UI.
- **Why:** No safety net when autonomous agents go off-rails

---

## Phase 2 — MEDIUM Priority

### [ ] 4. Memory Storage Pruning + Repair
- **Effort:** ~6-8 hours
- **Target:** `apps/backend/memory/pruner.py`, `apps/backend/memory/repair.py`
- **What:** Auto-prune oldest entries when over storage cap (default 1GB). 7-check repair pipeline for file-based memory integrity.
- **Config:** `memory_cap_mb` setting (default 1024)
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

### [ ] 7. Lessons Learned / Post-Task Retrospective
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/memory/` + `qa/loop.py` post-pass hook
- **What:** After QA passes, prompt agent for brief retrospective (what worked, what didn't). Store tagged as "lesson" in memory. Retrieve relevant lessons for similar future tasks.
- **Why:** Continuous improvement through institutional knowledge

---

## Total Estimated: ~25-30 hours across 3 phases
